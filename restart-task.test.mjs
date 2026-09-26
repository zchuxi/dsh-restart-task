/**
 * Regression harness for dsh-restart-task.
 *
 * Three layers, because the port to DSH 0.1.7 has three kinds of failure:
 *
 * 1. **Pure rules** — both halves expose one pure region (`auto-logic` in
 *    `lib/index.js`, `core-logic` in `lib/client.js`), sliced out of the exact
 *    source text and asserted directly, with no Cordis, no React and no browser.
 * 2. **Wiring** — source-level assertions that the halves address the *current*
 *    platform: the settings entry id, the configuration model, the Plugins-page
 *    seat, the transcript attributes. Each of these was silently wrong once.
 * 3. **Host behaviour** — `lib/index.js` is loaded for real and driven through a
 *    stub Cordis context: the command, the retry listener, the turn-stopping
 *    boundary and the auto-continue watcher all run, so a removed service or a
 *    changed payload shape fails here instead of in a live session.
 *
 *   node restart-task.test.mjs
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const hostSource = readFileSync(join(root, 'lib', 'index.js'), 'utf8')
const clientSource = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
const patchSource = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

/** The host module itself: exported constants and a real `Config` schema. */
const hostModule = await import(pathToFileURL(join(root, 'lib', 'index.js')).href)

/**
 * One source with its comments removed.
 *
 * Rules that must not appear in *code* are asserted here rather than on the raw
 * text: the header comments name the retired APIs on purpose, and a naive search
 * would read an explanation as a call.
 */
function codeOf(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n')
}

let passed = 0
const failures = []

function ok(label, condition) {
  if (condition === true) {
    passed += 1
    return
  }
  failures.push(label)
}

function equal(label, actual, expected) {
  const same = actual === expected
  if (same === true) {
    passed += 1
    return
  }
  failures.push(label + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual))
}

/** Slice one marked region out of a source file. */
function region(source, start, end) {
  const from = source.indexOf(start)
  const to = source.indexOf(end)
  if (from < 0 || to < 0 || to <= from) throw new Error('region ' + start + ' not found')
  return source.slice(from + start.length, to)
}

/** The body of one backtick template that starts at `marker` (no nested backticks). */
function templateOf(source, marker) {
  const from = source.indexOf(marker)
  if (from < 0) throw new Error('template ' + marker + ' not found')
  const body = from + marker.length
  const to = source.indexOf('`', body)
  if (to < 0) throw new Error('template ' + marker + ' is unterminated')
  return source.slice(body, to)
}

/** Materialize one region's top-level declarations and hand back what we need. */
function materialize(source, start, end, names) {
  const body = region(source, start, end)
  // eslint-disable-next-line no-new-func
  return new Function(body + '\nreturn {' + names.join(', ') + '}')()
}

const host = materialize(hostSource, '// #region auto-logic', '// #endregion auto-logic', [
  'planRequestRetry',
  'planKeepAlive',
  'planAutoContinue',
  'isUserStop',
  'resolveConfig',
  'liveConfig',
  'foldRounds',
  'CONFIG_FIELDS',
  'DEFAULT_CONTINUE_TEXT',
  'BROKEN_REASONS',
  'TRUNCATED_FINISH',
])

const client = materialize(clientSource, '// #region core-logic', '// #endregion core-logic', [
  'textOfContent',
  'analyzeWindow',
  'ownWakingTurns',
  'restartAffordance',
  'policySummary',
  'numberOr',
  'fieldIsServed',
  'railMarkMode',
  'BUNDLE_NAME',
  'ENTRY_ID',
  'OWN_SOURCE_KIND',
])

const defaults = host.resolveConfig(undefined)

// ---------------------------------------------------------------- resolveConfig
equal('defaults: in-turn retry on', defaults.retryFailedRequests, true)
equal('defaults: retry budget 3', defaults.maxRequestRetries, 3)
equal('defaults: unlimited retry off', defaults.retryForever, false)
equal('defaults: backoff base 2000', defaults.retryBaseDelayMs, 2000)
equal('defaults: keep-alive on', defaults.keepAliveOnMaxTokens, true)
equal('defaults: per-turn continues 5', defaults.maxTurnContinues, 5)
equal('defaults: turn-level auto-continue off', defaults.autoContinue, false)
equal('defaults: consecutive cap 3', defaults.maxConsecutive, 3)
equal('defaults: delay 1500', defaults.delayMs, 1500)
equal('defaults: every broken reason enabled', defaults.onAborted && defaults.onError && defaults.onInterrupted, true)
equal('defaults: continuation row hidden', defaults.hideContinueRow, true)
equal('defaults: built-in continue text', defaults.continueText, host.DEFAULT_CONTINUE_TEXT)

const junk = host.resolveConfig({ retryFailedRequests: 'yes', maxRequestRetries: '9', continueText: '   ', autoContinue: 1 })
equal('junk: non-boolean keeps retry on', junk.retryFailedRequests, true)
equal('junk: non-number falls back to 3', junk.maxRequestRetries, 3)
equal('junk: blank text falls back to built-in', junk.continueText, host.DEFAULT_CONTINUE_TEXT)
equal('junk: truthy-but-not-true keeps auto-continue off', junk.autoContinue, false)

const off = host.resolveConfig({ retryFailedRequests: false, keepAliveOnMaxTokens: false, hideContinueRow: false })
equal('explicit off is honoured', off.retryFailedRequests === false && off.keepAliveOnMaxTokens === false, true)
equal('explicit show rows is honoured', off.hideContinueRow, false)

// ------------------------------------------------------------------ liveConfig
// The loader hands `apply` a live reference per volatile field; a host without
// volatile support hands the value. Both must read the same.
const liveRead = host.liveConfig({
  retryForever: { get: () => true },
  maxRequestRetries: { get: () => 7 },
  autoContinue: false,
  continuedRailMarks: { get: () => 'preview' },
})
equal('live: a volatile reference is unwrapped', liveRead.retryForever, true)
equal('live: numbers survive the unwrap', liveRead.maxRequestRetries, 7)
equal('live: a plain value passes through', liveRead.autoContinue, false)
equal('live: a string reference is unwrapped', liveRead.continuedRailMarks, 'preview')
equal('live: the reader covers every declared field', host.CONFIG_FIELDS.length, 16)
equal('live: an absent config reads as defaults', host.resolveConfig(host.liveConfig(undefined)).maxRequestRetries, 3)
equal('live: undefined reads as defaults', host.resolveConfig(host.liveConfig(undefined)).continueText, host.DEFAULT_CONTINUE_TEXT)

// ------------------------------------------------------------- planRequestRetry
const retryBase = { retryFailedRequests: true, maxRequestRetries: 3, retryForever: false, retryBaseDelayMs: 2000 }
equal('retry: first attempt retried at base delay', host.planRequestRetry({ config: retryBase, status: 500, used: 0 }).delayMs, 2000)
equal('retry: second attempt doubles', host.planRequestRetry({ config: retryBase, status: 503, used: 1 }).delayMs, 4000)
equal('retry: third attempt doubles again', host.planRequestRetry({ config: retryBase, status: 502, used: 2 }).delayMs, 8000)
equal('retry: delay is capped at 60s', host.planRequestRetry({ config: { retryBaseDelayMs: 2000, maxRequestRetries: 50 }, status: 500, used: 20 }).delayMs, 60000)
equal('retry: budget exhausted', host.planRequestRetry({ config: retryBase, status: 500, used: 3 }).ok, false)
equal('retry: no status still retries a network failure', host.planRequestRetry({ config: retryBase, used: 0 }).ok, true)
equal('retry: 429 is retried', host.planRequestRetry({ config: retryBase, status: 429, used: 0 }).ok, true)
equal('retry: 400 is terminal', host.planRequestRetry({ config: retryBase, status: 400, used: 0 }).ok, false)
equal('retry: 401 is terminal', host.planRequestRetry({ config: retryBase, status: 401, used: 0 }).ok, false)
equal('retry: 404 is terminal', host.planRequestRetry({ config: retryBase, status: 404, used: 0 }).ok, false)
equal('retry: 500 is not terminal', host.planRequestRetry({ config: retryBase, status: 500, used: 0 }).ok, true)

const unlimited = { retryFailedRequests: true, maxRequestRetries: 0, retryForever: true, retryBaseDelayMs: 2000 }
equal('retry: unlimited ignores the budget', host.planRequestRetry({ config: unlimited, status: 500, used: 99 }).ok, true)
equal('retry: unlimited still caps the delay', host.planRequestRetry({ config: unlimited, status: 500, used: 40 }).delayMs, 60000)
equal('retry: unlimited still refuses 403', host.planRequestRetry({ config: unlimited, status: 403, used: 0 }).ok, false)
equal('retry: budget 0 means never', host.planRequestRetry({ config: { retryFailedRequests: true, maxRequestRetries: 0 }, used: 0 }).ok, false)
equal('retry: switched off', host.planRequestRetry({ config: { retryFailedRequests: false }, status: 500, used: 0 }).ok, false)
// A planner handed a partial config must decide like the runner, which fills
// every field first: absent means "leave the default alone", not "off".
equal('retry: an absent switch reads as its default (on)', host.planRequestRetry({ config: {}, status: 500, used: 0 }).ok, true)
equal('retry: an absent budget reads as the schema default', host.planRequestRetry({ config: {}, status: 500, used: 3 }).ok, false)
equal('retry: reports the attempt it is about to make', host.planRequestRetry({ config: retryBase, status: 500, used: 1 }).why, 'in-turn retry 2/3')

// ---------------------------------------------------------------- planKeepAlive
const keepBase = { keepAliveOnMaxTokens: true, maxTurnContinues: 5 }
equal('keep-alive: truncated step is continued', host.planKeepAlive({ finishKind: 'max-tokens', config: keepBase, used: 0 }).ok, true)
equal('keep-alive: a completed step is not', host.planKeepAlive({ finishKind: 'stop', config: keepBase, used: 0 }).ok, false)
equal('keep-alive: a tool-driven step is not', host.planKeepAlive({ finishKind: 'tool-calls', config: keepBase, used: 0 }).ok, false)
equal('keep-alive: unknown finish reason is not', host.planKeepAlive({ finishKind: undefined, config: keepBase, used: 0 }).ok, false)
equal('keep-alive: per-turn cap respected', host.planKeepAlive({ finishKind: 'max-tokens', config: keepBase, used: 5 }).ok, false)
equal('keep-alive: cap 0 means unlimited', host.planKeepAlive({ finishKind: 'max-tokens', config: { keepAliveOnMaxTokens: true, maxTurnContinues: 0 }, used: 40 }).ok, true)
equal('keep-alive: switched off', host.planKeepAlive({ finishKind: 'max-tokens', config: { keepAliveOnMaxTokens: false }, used: 0 }).ok, false)
equal('keep-alive: an absent switch reads as its default (on)', host.planKeepAlive({ finishKind: 'max-tokens', config: {}, used: 0 }).ok, true)
equal('keep-alive: an absent cap reads as the schema default', host.planKeepAlive({ finishKind: 'max-tokens', config: {}, used: 5 }).ok, false)
equal('keep-alive: matched the truncation marker', host.TRUNCATED_FINISH, 'max-tokens')

// ------------------------------------------------------------- planAutoContinue
const autoBase = { autoContinue: true, maxConsecutive: 3, onAborted: true, onError: true, onInterrupted: true }
equal('auto: aborted continues', host.planAutoContinue({ reason: 'aborted', config: autoBase, consecutive: 0 }).ok, true)
equal('auto: error continues', host.planAutoContinue({ reason: 'error', config: autoBase, consecutive: 0 }).ok, true)
equal('auto: interrupted continues', host.planAutoContinue({ reason: 'interrupted', config: autoBase, consecutive: 0 }).ok, true)
equal('auto: a completed turn never continues', host.planAutoContinue({ reason: 'completed', config: autoBase, consecutive: 0 }).ok, false)
equal('auto: a truncated turn is left to the in-turn path', host.planAutoContinue({ reason: 'max-tokens', config: autoBase, consecutive: 0 }).ok, false)
equal('auto: a blocked turn never continues', host.planAutoContinue({ reason: 'blocked', config: autoBase, consecutive: 0 }).ok, false)
equal('auto: streak cap respected', host.planAutoContinue({ reason: 'error', config: autoBase, consecutive: 3 }).ok, false)
equal('auto: cap 0 means unlimited', host.planAutoContinue({ reason: 'error', config: { autoContinue: true, maxConsecutive: 0 }, consecutive: 9 }).ok, true)
equal('auto: switched off', host.planAutoContinue({ reason: 'error', config: { autoContinue: false }, consecutive: 0 }).ok, false)
equal('auto: user stop can be excluded', host.planAutoContinue({ reason: 'aborted', config: { autoContinue: true, onAborted: false }, consecutive: 0 }).ok, false)
equal('auto: model failure can be excluded', host.planAutoContinue({ reason: 'error', config: { autoContinue: true, onError: false }, consecutive: 0 }).ok, false)
equal('auto: orphaned turn can be excluded', host.planAutoContinue({ reason: 'interrupted', config: { autoContinue: true, onInterrupted: false }, consecutive: 0 }).ok, false)
equal('auto: excludes do not leak into other reasons', host.planAutoContinue({ reason: 'error', config: { autoContinue: true, onAborted: false }, consecutive: 0 }).ok, true)
equal('auto: an absent exclude reads as enabled', host.planAutoContinue({ reason: 'aborted', config: { autoContinue: true }, consecutive: 0 }).ok, true)
equal('auto: an absent cap reads as the schema default', host.planAutoContinue({ reason: 'error', config: { autoContinue: true }, consecutive: 3 }).ok, false)
equal('auto: the three broken reasons are exactly these', host.BROKEN_REASONS.join(','), 'aborted,error,interrupted')

// ---------------------------------------------------------------- analyzeWindow
function windowOf(events) {
  return { entries: events.map((event) => ({ type: 'event', event })), hasMore: false, revision: 1, change: null }
}

const human = (text) => ({ type: 'user/message', data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'user' } } })
const injection = (text) => ({ type: 'user/message', data: { role: 'user', content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'x' } } })
const end = (kind) => ({ type: 'turn/end', data: { turn: 1, reason: kind === undefined ? undefined : { kind, error: kind === 'error' ? { message: 'boom' } : undefined } } })

equal('window: empty window is clean', client.analyzeWindow(undefined).badEnd, '')
equal('window: reads the human prompt', client.analyzeWindow(windowOf([human('do the thing')])).text, 'do the thing')
equal('window: the last human prompt wins', client.analyzeWindow(windowOf([human('first'), human('second')])).text, 'second')
equal('window: injected context is not a prompt', client.analyzeWindow(windowOf([human('mine'), injection('继续上次中断的任务')])).text, 'mine')
equal('window: rpc-sent prompts still count', client.analyzeWindow(windowOf([{ type: 'user/message', data: { content: [{ type: 'text', text: 'from rpc' }], source: { kind: 'user-rpc' } } }])).text, 'from rpc')
equal('window: joins text blocks', client.analyzeWindow(windowOf([{ type: 'user/message', data: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }], source: { kind: 'user' } } }])).text, 'a\nb')
equal('window: skips non-text blocks', client.analyzeWindow(windowOf([{ type: 'user/message', data: { content: [{ type: 'image' }, { type: 'text', text: 'a' }], source: { kind: 'user' } } }])).text, 'a')
equal('window: error turn is broken', client.analyzeWindow(windowOf([end('error')])).badEnd, 'error')
equal('window: error message is surfaced', client.analyzeWindow(windowOf([end('error')])).failure, 'boom')
equal('window: aborted turn is broken', client.analyzeWindow(windowOf([end('aborted')])).badEnd, 'aborted')
equal('window: interrupted turn is broken', client.analyzeWindow(windowOf([end('interrupted')])).badEnd, 'interrupted')
equal('window: completed turn is clean', client.analyzeWindow(windowOf([end('completed')])).badEnd, '')
equal('window: truncated turn is clean (no continuation prompt)', client.analyzeWindow(windowOf([end('max-tokens')])).badEnd, '')
equal('window: a later good turn clears an earlier break', client.analyzeWindow(windowOf([end('error'), human('retry'), end('completed')])).badEnd, '')
equal('window: reason-less turn end is clean', client.analyzeWindow(windowOf([end(undefined)])).badEnd, '')
equal('text: missing content is empty', client.textOfContent(undefined), '')

// -------------------------------------------------------------- ownWakingTurns
// Fixtures copied from a real session log (`~/.dsh/sessions/**/session.v4.jsonl`),
// which is the only place this rule can be checked against reality: a turn's input
// is appended AFTER its `turn/start`, never before it.
//
//   seq 106 turn/start turn=7
//   seq 110 user/message kind=dsh-restart-task
//   seq 113 assistant/message step=1
//   seq 144 turn/end turn=7 reason=aborted
//   seq 148 turn/start turn=8
//   seq 152 user/message kind=dsh-restart-task
const ours = () => ({ type: 'user/message', seq: 110, data: { role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: 'dsh-restart-task', form: 'notice', summary: '继续上次中断的任务' } } })
const foreign = () => ({ type: 'user/message', seq: 8, data: { role: 'user', content: [{ type: 'text', text: 'x' }], source: { kind: 'agent-instructions' } } })
const start = (turn, seq) => ({ type: 'turn/start', seq: seq === undefined ? turn * 100 : seq, data: { turn } })
const step = () => ({ type: 'assistant/message', seq: 113, data: { content: [] } })

equal('waking: no window at all reads as none', client.ownWakingTurns(undefined).length, 0)
equal('waking: an empty window reads as none', client.ownWakingTurns(windowOf([])).length, 0)
equal('waking: the round a continuation opened counts', client.ownWakingTurns(windowOf([start(7, 106), ours(), step(), end('aborted')])).join(','), '7')
equal('waking: two continuations count as two rounds', client.ownWakingTurns(windowOf([start(7, 106), ours(), step(), end('aborted'), start(8, 148), ours()])).join(','), '7,8')
// A tier-2 steer is claimed by a step of a turn that is already running, so its
// message is never that turn's first input.
equal('waking: a steered message inside the human\'s round does not', client.ownWakingTurns(windowOf([start(2, 21), human('继续'), ours(), step(), end('completed')])).length, 0)
equal('waking: injected context ahead of ours also keeps it out', client.ownWakingTurns(windowOf([start(1, 5), human('hi'), foreign(), ours(), end('completed')])).length, 0)
equal('waking: another producer opening a round is not ours', client.ownWakingTurns(windowOf([start(4, 40), foreign(), step(), end('completed')])).length, 0)
equal('waking: a message with no turn in force is inert', client.ownWakingTurns(windowOf([ours()])).length, 0)
equal('waking: a message after the turn closed gains no round', client.ownWakingTurns(windowOf([start(3, 30), step(), end('error'), ours()])).length, 0)
// The first message of that turn still counts as its opener; only the second one
// is ignored, because the slot was already spent.
equal('waking: a second message in the same turn adds no round', client.ownWakingTurns(windowOf([start(3, 30), ours(), end('error'), ours()])).join(','), '3')
equal('waking: a transient entry is not a durable message', client.ownWakingTurns({ entries: [{ type: 'transient', event: { type: 'user/message', data: { source: { kind: 'dsh-restart-task' } } } }] }).length, 0)

// ----------------------------------------------------------- restartAffordance
function affordance(events, extra) {
  return client.restartAffordance(Object.assign({
    eventWindow: windowOf(events),
    running: false,
    blank: false,
    removed: false,
    promptFailed: false,
    agentError: '',
  }, extra))
}

const broken = affordance([human('ship it'), end('error')])
equal('button: shown after a broken turn', broken.show, true)
equal('button: continues rather than resends', broken.mode, 'continue')
equal('button: names the failure', broken.reason.indexOf('上次模型请求失败') === 0, true)
equal('button: the failure detail reaches the tooltip', broken.title.indexOf('boom') > 0, true)
equal('button: promises no duplicate prompt', broken.title.indexOf('不会重复你的消息') > 0, true)

const aborted = affordance([human('ship it'), end('aborted')])
equal('button: shown after a user stop', aborted.show && aborted.mode, 'continue')

const orphan = affordance([human('ship it'), end('interrupted')])
equal('button: shown after an orphaned turn', orphan.show && orphan.mode, 'continue')

const done = affordance([human('ship it'), end('completed')])
equal('button: hidden after a good turn', done.show, false)

const running = affordance([human('ship it'), end('error')], { running: true })
equal('button: hidden while the agent runs', running.show, false)

const blankSession = affordance([end('error')], { blank: true })
equal('button: hidden on a blank session', blankSession.show, false)

const removedSession = affordance([end('error')], { removed: true })
equal('button: hidden once the session is gone', removedSession.show, false)

const agentFailure = affordance([human('go')], { agentError: 'kaboom' })
equal('button: shown for an agent-level error', agentFailure.show && agentFailure.mode, 'continue')
equal('button: names the agent error', agentFailure.reason, '上次执行出错：kaboom')

const sendFailure = affordance([human('ship it')], { promptFailed: true })
equal('button: a failed send resends instead', sendFailure.mode, 'resend')
equal('button: resend carries the last prompt', sendFailure.text, 'ship it')
equal('button: resend is shown', sendFailure.show, true)

const emptySend = affordance([], { promptFailed: true })
equal('button: a failed send with nothing to resend is hidden', emptySend.show, false)

const brokenNoPrompt = affordance([end('error')])
equal('button: a broken turn still offers continue with no prompt', brokenNoPrompt.show && brokenNoPrompt.mode, 'continue')

// ------------------------------------------------------------------- policySummary
const chips = client.policySummary({ retryFailedRequests: true, maxRequestRetries: 5, keepAliveOnMaxTokens: true, autoContinue: false })
equal('chips: three of them', chips.length, 3)
equal('chips: retry budget is quoted', chips[0].text, '失败静默重试 5 次')
equal('chips: retry is a good state', chips[0].tone, 'on')
equal('chips: truncation is continued in-turn', chips[1].text, '输出超限同轮续写')
equal('chips: turn-level continuation reads as off', chips[2].text, '中断后不自动继续')
const unlimitedChips = client.policySummary({ retryForever: true, autoContinue: true })
equal('chips: unlimited retry is named', unlimitedChips[0].text, '失败静默重试（不限次）')
equal('chips: auto-continue is flagged', unlimitedChips[2].tone, 'alert')
const quietChips = client.policySummary({ retryFailedRequests: false, keepAliveOnMaxTokens: false })
equal('chips: switched-off retry', quietChips[0].text, '失败不自动重试')
equal('chips: switched-off keep-alive', quietChips[1].text, '输出超限不续写')
equal('chips: empty settings read as defaults', client.policySummary(undefined)[0].text, '失败静默重试 3 次')
equal('numbers: a non-number falls back', client.numberOr('3', 7), 7)
equal('numbers: a real zero survives', client.numberOr(0, 7), 0)

// A client-only update lands before the host half is restarted, so the card has
// to know which fields the *running* host actually serves.
equal('served: unknown (loading) reads as served', client.fieldIsServed(null, 'retryForever'), true)
equal('served: a listed field is served', client.fieldIsServed(['retryForever'], 'retryForever'), true)
equal('served: an unlisted field is not', client.fieldIsServed(['autoContinue'], 'retryForever'), false)
equal('served: an empty section serves nothing', client.fieldIsServed([], 'autoContinue'), false)
equal('served: a malformed list reads as served', client.fieldIsServed('oops', 'autoContinue'), true)
equal('card: an unserved field is explained, not silently broken', clientSource.includes('宿主还是旧版本：重启 DSH 后这一项才会生效'), true)
equal('card: every row consults that check', (clientSource.match(/const blocked = blockedBy\(field\)/g) ?? []).length, 1)
equal('card: that check is the only source of row hints', (clientSource.match(/blocked === undefined \? hint : blocked/g) ?? []).length, 1)

// --------------------------------------------- platform identity / wiring
// The settings form addresses a plugin by its **profile entry id**, the Plugins
// page keys a bundle's config page by its **package name**, and the producer kind
// is the package name too. All three were verified against the composed profile
// tree; the harness keeps the three spellings from drifting apart.
const patchEntryId = (/-\s*id:\s*([A-Za-z][A-Za-z0-9._-]*)/.exec(patchSource) ?? [])[1]
equal('identity: the patch inserts the entry the host half names', patchEntryId, hostModule.ENTRY_ID)
equal('identity: the card addresses the same entry', client.ENTRY_ID, hostModule.ENTRY_ID)
equal('identity: the card is keyed by the package name', client.BUNDLE_NAME, manifest.name)
equal('identity: the host half names the same bundle', hostModule.BUNDLE_NAME, manifest.name)
equal('identity: the producer kind is the package name', hostModule.SOURCE_KIND, manifest.name)
equal('identity: both halves agree on the producer kind', client.OWN_SOURCE_KIND, hostModule.SOURCE_KIND)
// node-semver only lets a prerelease satisfy a range when a comparator on the same
// major.minor.patch tuple carries a prerelease tag, so each supported tuple needs
// its own branch: an open-ended `>=0.1.7-rc.1` admits the next *stable* patch but
// silently excludes its release candidates, which is how a broad-looking range
// locks users out of the next harness rc.
const RUNTIME_RANGE = '>=0.1.7-rc.1 <0.1.8-0 || >=0.1.8-rc.1 <0.2.0-0'
equal('identity: the manifest requires the settings-era runtime', manifest.peerDependencies['@deepseek-ai/dsh'], RUNTIME_RANGE)
equal('identity: the engines range agrees', manifest.engines.dsh, RUNTIME_RANGE)
equal('identity: every supported tuple carries a prerelease branch', (RUNTIME_RANGE.match(/>=0\.\d+\.\d+-rc\.\d+/g) ?? []).length, 2)
equal('identity: the range keeps the next major out', RUNTIME_RANGE.includes('<0.2.0-0'), true)

// ------------------------------------------- the whole-session rounds fold
// The rail lists every round of a session while a client only holds one page of
// events, so a round of ours outside that page can only be attributed from the
// host's fold over the whole log. That fold is asserted here against the same
// rule and the same fixtures as the client's window walk, because the two must
// agree: they describe one rule seen from two places.
const windowFold = (events) => events.reduce(host.foldRounds, { rounds: [], turn: 0, spoken: true })
const turnStart = (turn) => ({ type: 'turn/start', data: { turn } })
const turnEnd = (kind) => ({ type: 'turn/end', data: { turn: 1, reason: { kind } } })
const ourMessage = { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: '继续' }], source: { kind: hostModule.SOURCE_KIND, form: 'notice', summary: 'x' } } }
const humanMessage = { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'go' }], source: { kind: 'user' } } }
const injectedMessage = { type: 'user/message', data: { role: 'user', content: [{ type: 'text', text: 'ctx' }], source: { kind: 'runtime-context' } } }

equal('fold: an empty log has no rounds', windowFold([]).rounds.length, 0)
equal('fold: the round a continuation opened is recorded', windowFold([turnStart(7), ourMessage, turnEnd('aborted')]).rounds.join(','), '7')
equal('fold: two continuations record two rounds', windowFold([turnStart(7), ourMessage, turnEnd('aborted'), turnStart(8), ourMessage]).rounds.join(','), '7,8')
equal('fold: a human round is not recorded', windowFold([turnStart(5), humanMessage, turnEnd('completed')]).rounds.length, 0)
equal('fold: a steered message inside the human\'s round is not either', windowFold([turnStart(5), humanMessage, ourMessage, turnEnd('completed')]).rounds.length, 0)
equal('fold: injected context ahead of ours keeps it out', windowFold([turnStart(5), injectedMessage, ourMessage]).rounds.length, 0)
equal('fold: a message before any turn is inert', windowFold([ourMessage]).rounds.length, 0)
equal('fold: a message after the turn closed is inert', windowFold([turnStart(3), humanMessage, turnEnd('error'), ourMessage]).rounds.length, 0)
equal('fold: an unchanged event returns the same state reference', (() => {
  const state = windowFold([turnStart(7), ourMessage])
  return host.foldRounds(state, { type: 'assistant/message', data: {} }) === state
})(), true)
equal('fold: the same round is never recorded twice', windowFold([turnStart(7), ourMessage, turnStart(7), ourMessage]).rounds.join(','), '7')
// The client's window walk and the host's whole-log fold must reach the same
// answer for the same sequence — they are one rule stated twice.
equal('fold: window and fold agree on a real sequence', (() => {
  const sequence = [turnStart(5), humanMessage, injectedMessage, ourMessage, turnStart(7), ourMessage, turnEnd('aborted'), turnStart(8), ourMessage]
  return windowFold(sequence).rounds.join(',') === client.ownWakingTurns(windowOf(sequence)).join(',')
})(), true)

// ------------------------------------------------- settings wiring / consistency
/** Every settings key the host half declares. */
function configKeys() {
  const start = hostSource.indexOf('export const Config = z.object({')
  const stop = hostSource.indexOf('})', start)
  const body = hostSource.slice(start, stop)
  return [...body.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => match[1])
}

const hostKeys = configKeys()
equal('config: every field has a card default', hostKeys.every((key) => key in { ...clientDefaults() }), true)
equal('config: every card default is declared by the host', Object.keys(clientDefaults()).every((key) => hostKeys.includes(key)), true)
equal('config: the retention setting is served', hostKeys.includes('hideContinueRow'), true)
equal('config: retry budget allows more than the old cap', hostSource.includes('z.natural().max(50).default(3).volatile()'), true)
equal('config: every declared field is volatile', (hostSource.slice(hostSource.indexOf('export const Config = z.object({')).match(/\.volatile\(\),/g) ?? []).length, hostKeys.length)
equal('config: the reader covers exactly the declared fields', host.CONFIG_FIELDS.join(','), hostKeys.join(','))
// The retired seam is gone, not renamed: `SettingsForms` has neither `register`
// nor `get`, and a leftover call fails the whole plugin at load.
equal('config: the retired settings namespace API is gone', /settings\.register\(/.test(codeOf(hostSource)), false)
equal('config: nothing reads a settings namespace back', /settings\.get\(/.test(codeOf(hostSource)), false)
equal('config: the policy arrives as the apply argument', hostSource.includes('export function apply(ctx, config)'), true)
equal('config: every decision reads the live configuration', hostSource.includes('resolveConfig(liveConfig(config))'), true)
// A plugin that ships its own page says so, so the host does not also generate one.
equal('config: the card owns the settings page', hostSource.includes('configure({ auto: false }, ctx.fiber)'), true)
equal('config: the policy is registered through an optional child', hostSource.includes("ctx.inject(['settings'], (sctx) => {"), true)
equal('config: the recovery tiers do not require the settings domain', hostSource.includes("ctx.inject(['agents', 'timer'], (actx) => {"), true)

/** Every field the card actually renders, from its `row(...)`/`locked(...)` calls. */
function cardFields() {
  const found = new Set()
  for (const match of clientSource.matchAll(/(?:row|locked)\('([A-Za-z][A-Za-z0-9]*)'/g)) found.add(match[1])
  for (const match of clientSource.matchAll(/'(continueText)'/g)) found.add(match[1])
  return [...found]
}

function clientDefaults() {
  const start = clientSource.indexOf('const DEFAULTS = {')
  const stop = clientSource.indexOf('}', start)
  const body = clientSource.slice(start, stop)
  return Object.fromEntries([...body.matchAll(/^\s{3}([A-Za-z][A-Za-z0-9]*):/gm)].map((match) => [match[1], true]))
}

const rendered = new Set(cardFields())
const missing = hostKeys.filter((key) => rendered.has(key) !== true)
equal('card: renders every served setting', missing.join(','), '')
equal('card: renders the retention toggle', rendered.has('hideContinueRow'), true)

// The card's seat moved twice: `settings.plugin.item` was retired in 0.1.7 and a
// list slot would reject a `key`, so the contribution is a keyed bundle seat on
// the Plugins page.
equal('card: registered on the Plugins page', clientSource.includes("'plugins.bundle.config'"), true)
equal('card: keyed by the bundle package name', clientSource.includes('{ name: \'plugins.bundle.config\', key: BUNDLE_NAME }'), true)
equal('card: only while the host serves the entry', clientSource.includes('forms.whileServed([ENTRY_ID]'), true)
equal('card: the retired seat is gone', clientSource.includes('settings.plugin.item'), false)
equal('card: the form is addressed by entry id', clientSource.includes('forms.get(ENTRY_ID)'), true)
equal('card: a summary view adds nothing', clientSource.includes("if (props.view === 'summary') return null"), true)
equal('card: the root is not a list item', clientSource.includes("React.createElement('li', {"), false)
// The settings domain must stay optional: the composer control is not a settings
// surface, and a deployment without that domain still gets it.
equal('card: the settings service is not a hard requirement', clientSource.includes("const inject = ['slots', 'timer']"), true)
equal('card: the form is acquired through an optional child', clientSource.includes("ctx.inject(['configForms'], (fctx) => {"), true)

// The row-hiding rule cannot be a `:has()` on provenance: the attribute is
// valueless and the producer name is text. The pass tags rows instead, and only
// this plugin's own rows are ever tagged.
equal('hide rule: keyed on this plugin\'s own tag', clientSource.includes("const OWN_ROW_ATTR = 'data-dyn-restart-row'"), true)
equal('hide rule: targets context rows and trigger notices', clientSource.includes('[data-chat-flow-kind="context"][\' + OWN_ROW_ATTR + \'="1"], [data-chat-flow-kind="turn-trigger"]'), true)
equal('hide rule: ids our own rows by the provenance label', clientSource.includes('span.textContent.trim() === OWN_SOURCE_KIND'), true)
equal('hide rule: never a phantom attribute value', clientSource.includes('data-context-source="dsh-restart-task"'), false)
equal('hide rule: opt-out is honoured in the client', clientSource.includes('value.hideContinueRow !== false'), true)
equal('hide rule: the tag is cleared on unload', clientSource.includes("document.querySelectorAll('[' + OWN_ROW_ATTR + ']')"), true)

// Styles are owned by the module system through `data-plugin`: an untagged tag is
// adopted by whichever plugin materializes next and removed on ITS unload.
equal('styles: the always-injected tag names its owner', (clientSource.match(/tag\.dataset\.plugin = BUNDLE_NAME/g) ?? []).length, 2)

// The stylesheet injected on every page must not depend on the plugin's own
// attributes: only the conditional rule above may mention them.
const stylesheet = templateOf(clientSource, 'const CSS_TEXT = `')
equal('stylesheet: never selects this plugin\'s provenance span', stylesheet.includes('data-context-source'), false)
equal('stylesheet: carries the rail hide rule', stylesheet.includes("[data-dyn-continued='hide']"), true)
equal('stylesheet: carries the rail preview rule', stylesheet.includes('data-dyn-continued-preview'), true)

// Rail marks: the pass is opt-in per mode, and `keep` must clear every tag.
equal('rail: unknown modes fall back to hiding', client.railMarkMode('nonsense'), 'hide')
equal('rail: a known mode survives', client.railMarkMode('preview'), 'preview')
equal('rail: keep is a known mode', client.railMarkMode('keep'), 'keep')
equal('rail: a non-string falls back to hiding', client.railMarkMode(undefined), 'hide')
equal('rail: keep clears the tag instead of writing one', clientSource.includes("return mode === 'keep' ? '' : mode"), true)
equal('rail: the current mark shape is read', clientSource.includes('[class*="_marks"] button[data-index]'), true)
equal('rail: the retired mark wrapper is gone', clientSource.includes('_markPosition'), false)
equal('rail: only the rail frame is scanned', clientSource.includes("document.querySelectorAll('nav[class*=\"_frame\"]')"), true)
equal('rail: a failed pass is swallowed, never surfaced', clientSource.includes('A transcript this pass cannot read is a cosmetic loss'), true)
equal('rail: tags are removed on unload', clientSource.includes("document.querySelectorAll('[data-dyn-continued]')"), true)

// The composer control must only ever post plugin-sourced text.
equal('control: the host command owns continuation', clientSource.includes("session.command('/continue-task')"), true)
equal('control: resend is the only prompt path', (clientSource.match(/session\.prompt\(/g) ?? []).length, 1)

// The send-button takeover: the one place this plugin writes to the product's own
// control, so the rules it must never break are pinned here.
equal('send: it is the composer\'s own primary control', clientSource.includes('cards[i].querySelectorAll(\'button[class*="_primary"]\')'), true)
equal('send: only ever a control the product cannot use', clientSource.includes('button.disabled !== true) continue'), true)
equal('send: nothing writes the product\'s class list', /\.className\s*=/.test(codeOf(clientSource)), false)
equal('send: the click is intercepted in the capture phase', clientSource.includes("document.addEventListener('click', onClick, true)"), true)
equal('send: and released when the plugin unloads', clientSource.includes("document.removeEventListener('click', onClick, true)"), true)
equal('send: it runs the control\'s own action, not a copy of it', clientSource.includes("document.querySelector('.dyn-retry-round')"), true)
equal('send: the release leaves `disabled` to the product', clientSource.includes('deliberately does not write `disabled`'), true)
// Session format v4 refuses the retired `{ kind: 'plugin', plugin: … }` wrapper
// on newly appended messages, so the continuation must carry this producer's
// own kind. Regressing to `'plugin'` fails the whole turn.
equal('message: continuation is producer-sourced', codeOf(hostSource).includes('kind: SOURCE_KIND'), true)
equal('message: the retired plugin wrapper is gone', /kind:\s*'plugin'/.test(codeOf(hostSource)), false)
equal('message: it renders collapsed', hostSource.includes("form: 'notice'"), true)

// ------------------------------------------------ a human stop is final
// The composer's stop control cancels with `{ kind: 'user' }`, and the loop parks
// that cause on the aborted turn/end reason, so the durable log answers the
// question. A stop must never be answered with more automatic work.
equal('stop: the stop control\'s cause counts as a user stop', host.isUserStop({ kind: 'user' }), true)
equal('stop: another agent cancelling is not a user stop', host.isUserStop({ kind: 'parent' }), false)
equal('stop: a hook cancellation is not a user stop', host.isUserStop({ kind: 'hook', reason: 'loop guard' }), false)
equal('stop: the legacy cause is not a user stop', host.isUserStop({ kind: 'legacy' }), false)
equal('stop: a bare string cause is understood', host.isUserStop('user'), true)
equal('stop: an absent cause is not a user stop', host.isUserStop(undefined), false)
equal('stop: a non-object cause is not a user stop', host.isUserStop(7), false)

// Everything the human might have turned on, turned on.
const sayYesToEverything = host.resolveConfig({ autoContinue: true, onAborted: true, maxConsecutive: 0 })
const breakTurn = (reason, userStop, config) => host.planAutoContinue({
  reason: reason,
  userStop: userStop,
  config: config === undefined ? sayYesToEverything : config,
  consecutive: 0,
})

equal('stop: a user stop outranks autoContinue + onAborted + no limit', breakTurn('aborted', true).ok, false)
equal('stop: and the log line says so', breakTurn('aborted', true).why, 'the user stopped the turn')
equal('stop: a system abort still continues', breakTurn('aborted', false).ok, true)
equal('stop: a failure is unaffected by the stop rule', breakTurn('error', false).ok, true)
equal('stop: the flag alone never enables a path', breakTurn('completed', true, host.resolveConfig({ autoContinue: true })).ok, false)
equal('stop: the watcher reads the cancel cause', hostSource.includes('isUserStop(endReason.reason)'), true)
equal('stop: the cause reaches the planner', hostSource.includes('userStop: userStop === true'), true)
equal('stop: a request killed by a stop is never retried', hostSource.includes('stopSignal.aborted === true) return next()'), true)
// A bare `undefined` from the retry waterfall settles the failure for every
// listener behind this one; an aborted wait must delegate instead.
equal('stop: an aborted wait delegates instead of vetoing it', hostSource.includes("aborted === true ? next() : { kind: 'retry' }"), true)

// -------------------------------------------------- the host half, for real
/**
 * A stub Cordis context: every service the host half asks for, plus a recorder.
 * `live` mirrors what the loader resolves — one live reference per volatile field.
 * Timers are queued, never fired on their own: a delay is something a test drives,
 * so "waited, then retried" and "cancelled before the delay elapsed" are decisions
 * the harness can observe instead of guess.
 */
function makeRuntime(config, options) {
  const settings = options === undefined || options === null ? {} : options
  const state = {
    injections: [],
    effects: [],
    listeners: new Map(),
    commands: [],
    configured: [],
    steers: [],
    followups: [],
    timers: [],
    /** Services this composition carries, for the `inject` gate below. */
    services: Object.assign({ settings: true, sessionProjections: settings.sessionProjections !== false }, settings.services),
    /** Every projection unit registered on this composition. */
    projections: [],
  }
  const agents = new Map()
  const live = {}
  for (const field of host.CONFIG_FIELDS) live[field] = { get: () => config[field] }
  const ctx = {
    fiber: { marker: 'plugin-fiber' },
    effect(fn, label) {
      const dispose = fn()
      state.effects.push({ label, dispose })
      return () => { if (typeof dispose === 'function') dispose() }
    },
    on(event, listener) {
      state.listeners.set(event, listener)
      return () => { state.listeners.delete(event) }
    },
    inject(services, callback) {
      state.injections.push(services.join(','))
      // Cordis only enters an `inject` child once every named service is there, so
      // the stub does the same: a case that supplies no `sessionProjections` must
      // exercise the same path a composition without that seam would.
      const missing = services.filter((service) => service !== 'timer' && service !== 'agents' && state.services[service] !== true)
      if (missing.length > 0) return
      callback(ctx)
    },
    timeout(callback) {
      const handle = { callback, cancelled: false }
      state.timers.push(handle)
      return () => { handle.cancelled = true }
    },
    get: () => undefined,
    commands: {
      register(definition) {
        state.commands.push(definition)
        return () => {}
      },
    },
    settings: {
      configure(policy, fiber) {
        state.configured.push({ policy, fiber })
        return () => {}
      },
    },
    sessionProjections: {
      register(definition) {
        state.projections.push(definition)
        return () => {}
      },
    },
    agents: { get: (id) => agents.get(id) },
  }
  /** Fire every timer still pending, and settle the callbacks they schedule. */
  const fireTimers = async () => {
    const pending = state.timers.splice(0, state.timers.length)
    for (const handle of pending) if (handle.cancelled !== true) handle.callback()
    // Each callback may itself await a microtask; let the queue drain.
    for (let i = 0; i < 4; i += 1) await Promise.resolve()
  }
  return { state, agents, ctx, live, fireTimers }
}

equal('host: the plugin exports its name', hostModule.name, 'restart-task')
equal('host: it requires the command service', hostModule.inject.join(','), 'commands')
equal('host: the schema declares a field per config key', Object.keys(hostModule.Config.dict ?? {}).join(','), hostKeys.join(','))
equal('host: every schema field is marked volatile', hostKeys.every((key) => hostModule.Config.dict[key].meta.volatile === true), true)
equal('host: the continuation message body is the built-in text', hostModule.Config.dict.continueText.meta.default, host.DEFAULT_CONTINUE_TEXT)

const runtime = makeRuntime({
  retryFailedRequests: true,
  maxRequestRetries: 1,
  retryForever: false,
  retryBaseDelayMs: 2000,
  keepAliveOnMaxTokens: true,
  maxTurnContinues: 2,
  autoContinue: false,
  maxConsecutive: 0,
  delayMs: 1500,
  onAborted: true,
  onError: true,
  onInterrupted: true,
  hideContinueRow: true,
  continuedRailMarks: 'hide',
  continueText: '',
})
hostModule.apply(runtime.ctx, runtime.live)

equal('host: the settings page policy names this plugin\'s fiber', runtime.state.configured[0]?.fiber, runtime.ctx.fiber)
equal('host: the page policy opts out of an auto-generated page', runtime.state.configured[0]?.policy.auto, false)
equal('host: the command is registered', runtime.state.commands.map((entry) => entry.name).join(','), 'continue-task')
equal('host: every recovery seam is listened to', [...runtime.state.listeners.keys()].sort().join(','), 'agent/assistant-stream,agent/request-error,agent/turn-stopping,session/event')
equal('host: the settings domain is optional, the agent is not', runtime.state.injections.join(' | '), 'settings | sessionProjections | agents,timer')
// The rounds projection is how a client learns about a round whose events it has
// not loaded; it must carry the client's key, publish the rounds alone, and be
// able to re-seed from persisted state.
equal('host: exactly one projection unit is registered', runtime.state.projections.length, 1)
equal('host: it carries the key both halves spell', runtime.state.projections[0].key, 'restartTaskRounds')
equal('host: its view is the rounds array', runtime.state.projections[0].wire.view({ rounds: [7, 8], turn: 8, spoken: true }).join(','), '7,8')
equal('host: its schema accepts a persisted state', runtime.state.projections[0].stateSchema.safeParse({ rounds: [], turn: 0, spoken: true }).success, true)
equal('host: and refuses a malformed one', runtime.state.projections[0].stateSchema.safeParse({ rounds: 'x' }).success, false)
// A composition without the projection seam must still load the three tiers.
const noProjection = makeRuntime({ maxRequestRetries: 0 }, { sessionProjections: false })
hostModule.apply(noProjection.ctx, noProjection.live)
equal('host: a composition without the projection seam still registers the command', noProjection.state.commands.length, 1)
equal('host: and registers no projection there', noProjection.state.projections.length, 0)

const agent = {
  id: 'session-1',
  followup: (message) => runtime.state.followups.push(message),
  steer: (message) => runtime.state.steers.push(message),
}
runtime.agents.set('session-1', agent)

const command = runtime.state.commands.find((entry) => entry.name === 'continue-task')
equal('host: the command reports success', command.handler({ agent }).kind, 'success')
equal('host: the command posts exactly one message', runtime.state.followups.length, 1)
equal('host: that message is producer-sourced', runtime.state.followups[0].source.kind, hostModule.SOURCE_KIND)
equal('host: and carries the collapsed-row form', runtime.state.followups[0].source.form, 'notice')
equal('host: and a summary for the row', typeof runtime.state.followups[0].source.summary, 'string')
equal('host: and it is a user-role message', runtime.state.followups[0].role, 'user')

const requestError = runtime.state.listeners.get('agent/request-error')
let delegated = 0
const next = () => { delegated += 1; return 'delegated' }
equal('host: a terminal client error is delegated', await requestError({ agent, turn: 1, step: 1, failure: { status: 401 } }, next), 'delegated')
equal('host: a terminal error never waits', runtime.state.timers.length, 0) 
const retried = requestError({ agent, turn: 1, step: 1, failure: { status: 500 } }, next)
equal('host: a retryable failure waits before retrying', runtime.state.timers.length, 1)
await runtime.fireTimers()
equal('host: and then retries in place', JSON.stringify(await retried), JSON.stringify({ kind: 'retry' }))
const exhausted = requestError({ agent, turn: 1, step: 1, failure: { status: 500 } }, next)
await runtime.fireTimers()
equal('host: the retry budget is per step', await exhausted, 'delegated')
equal('host: a stopped turn is delegated, never retried', await requestError({ agent, turn: 1, step: 2, failure: { status: 500 }, signal: { aborted: true } }, next), 'delegated')
equal('host: delegation counts what it delegated', delegated, 3)

runtime.state.listeners.get('agent/assistant-stream')({ agent, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } } })
runtime.state.listeners.get('agent/turn-stopping')({ agent, turn: 1 })
equal('host: a truncated step steers inside the same turn', runtime.state.steers.length, 1)
equal('host: the steered instruction is producer-sourced', runtime.state.steers[0].source.kind, hostModule.SOURCE_KIND)
equal('host: the steered text falls back to the built-in instruction', JSON.stringify(runtime.state.steers[0].content[0].text), JSON.stringify(host.DEFAULT_CONTINUE_TEXT))
runtime.state.listeners.get('agent/assistant-stream')({ agent, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } } })
runtime.state.listeners.get('agent/turn-stopping')({ agent, turn: 1 })
runtime.state.listeners.get('agent/assistant-stream')({ agent, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } } })
runtime.state.listeners.get('agent/turn-stopping')({ agent, turn: 1 })
equal('host: the per-turn cap stops the third continue', runtime.state.steers.length, 2)
runtime.state.listeners.get('agent/assistant-stream')({ agent, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } } })
runtime.state.listeners.get('session/event')({ id: 'session-1' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
runtime.state.listeners.get('agent/turn-stopping')({ agent, turn: 1 })
equal('host: a completed step is never steered', runtime.state.steers.length, 2)

// The keep-alive gate reads the live assistant stream, so a run with no finish
// frame at all must stay untouched.
const quietRuntime = makeRuntime({ keepAliveOnMaxTokens: true, maxTurnContinues: 5 })
hostModule.apply(quietRuntime.ctx, quietRuntime.live)
const quietAgent = { id: 'session-6', followup: () => {}, steer: (message) => quietRuntime.state.steers.push(message) }
quietRuntime.agents.set('session-6', quietAgent)
quietRuntime.state.listeners.get('agent/assistant-stream')({ agent: quietAgent, frame: { type: 'chunk', chunk: { type: 'text', text: 'still typing' } } })
quietRuntime.state.listeners.get('agent/turn-stopping')({ agent: quietAgent, turn: 1 })
quietRuntime.state.listeners.get('agent/assistant-stream')({ agent: quietAgent, frame: { type: 'done' } })
quietRuntime.state.listeners.get('agent/turn-stopping')({ agent: quietAgent, turn: 1 })
equal('host: a step with no finish frame is never steered', quietRuntime.state.steers.length, 0)

// The turn-level tier is off by default: a broken turn must not continue.
const idleRuntime = makeRuntime({ autoContinue: false, maxRequestRetries: 0 })
hostModule.apply(idleRuntime.ctx, idleRuntime.live)
idleRuntime.agents.set('session-2', agent)
idleRuntime.state.listeners.get('session/event')({ id: 'session-2' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } })
await idleRuntime.fireTimers()
equal('host: auto-continue off posts nothing', idleRuntime.state.followups.length, 0)

// And when it is on, a broken turn continues after the configured delay.
const autoRuntime = makeRuntime({ autoContinue: true, maxConsecutive: 0, delayMs: 1, onError: true, onInterrupted: true, onAborted: true })
hostModule.apply(autoRuntime.ctx, autoRuntime.live)
const autoAgent = { id: 'session-3', followup: (message) => autoRuntime.state.followups.push(message), steer: () => {} }
autoRuntime.agents.set('session-3', autoAgent)
autoRuntime.state.listeners.get('session/event')({ id: 'session-3' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } })
equal('host: a broken turn waits out the delay first', autoRuntime.state.followups.length, 0)
await autoRuntime.fireTimers()
equal('host: a broken turn continues when enabled', autoRuntime.state.followups.length, 1)
equal('host: the continuation is producer-sourced', autoRuntime.state.followups[0]?.source.kind, hostModule.SOURCE_KIND)
equal('host: the continuation carries the configured text', autoRuntime.state.followups[0]?.content[0].text, host.DEFAULT_CONTINUE_TEXT)

// Anything the human does cancels the pending round, and a stop always wins.
autoRuntime.state.listeners.get('session/event')({ id: 'session-3' }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'error' } } })
autoRuntime.state.listeners.get('session/event')({ id: 'session-3' }, { type: 'user/message', data: { role: 'user', source: { kind: 'user' } } })
await autoRuntime.fireTimers()
equal('host: the human typing cancels the pending continuation', autoRuntime.state.followups.length, 1)
autoRuntime.state.listeners.get('session/event')({ id: 'session-3' }, { type: 'turn/end', data: { turn: 3, reason: { kind: 'error' } } })
autoRuntime.state.listeners.get('session/event')({ id: 'session-3' }, { type: 'turn/start', data: { turn: 4 } })
await autoRuntime.fireTimers()
equal('host: a fresh turn cancels the pending continuation', autoRuntime.state.followups.length, 1)

const stopRuntime = makeRuntime({ autoContinue: true, maxConsecutive: 0, delayMs: 1, onAborted: true })
hostModule.apply(stopRuntime.ctx, stopRuntime.live)
stopRuntime.agents.set('session-4', { id: 'session-4', followup: (message) => stopRuntime.state.followups.push(message), steer: () => {} })
stopRuntime.state.listeners.get('session/event')({ id: 'session-4' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
await stopRuntime.fireTimers()
equal('host: a human stop is never continued', stopRuntime.state.followups.length, 0)
const capRuntime = makeRuntime({ autoContinue: true, maxConsecutive: 1, delayMs: 1, onError: true })
hostModule.apply(capRuntime.ctx, capRuntime.live)
capRuntime.agents.set('session-5', { id: 'session-5', followup: (message) => capRuntime.state.followups.push(message), steer: () => {} })
capRuntime.state.listeners.get('session/event')({ id: 'session-5' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } })
await capRuntime.fireTimers()
capRuntime.state.listeners.get('session/event')({ id: 'session-5' }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'error' } } })
await capRuntime.fireTimers()
equal('host: the consecutive cap stops the streak', capRuntime.state.followups.length, 1)

// ------------------------------------------- the transcript pass, over a DOM
/**
 * A DOM just large enough for the transcript pass: elements with parent links,
 * and a `querySelectorAll` that understands exactly the selectors the pass uses.
 * Anything else returns nothing — the same as a real document with no match.
 */
function stubDom() {
  const className = (node) => node.attributes.class ?? ''

  function descendants(node, out = []) {
    for (const child of node.children) {
      out.push(child)
      descendants(child, out)
    }
    return out
  }

  function matches(node, selector) {
    if (selector === '.dyn-retry-round') return className(node).split(/\s+/).includes('dyn-retry-round')
    if (selector === '[data-context-source]') return node.attributes['data-context-source'] !== undefined
    if (selector === '[data-chat-turn]') return node.attributes['data-chat-turn'] !== undefined
    if (selector === '[data-composer-card]') return node.attributes['data-composer-card'] !== undefined
    if (selector === '[data-chat-flow-kind]') return node.attributes['data-chat-flow-kind'] !== undefined
    if (selector === '[data-chat-flow-kind="turn-trigger"]') return node.attributes['data-chat-flow-kind'] === 'turn-trigger'
    if (selector === '[data-dyn-restart-row]') return node.attributes['data-dyn-restart-row'] !== undefined
    if (selector === '[data-dyn-continue]') return node.attributes['data-dyn-continue'] !== undefined
    if (selector === '[data-dyn-continued]') return node.attributes['data-dyn-continued'] !== undefined
    if (selector === '[data-dyn-continued-preview]') return node.attributes['data-dyn-continued-preview'] !== undefined
    if (selector === 'button[data-dyn-continue="1"]') return node.tagName === 'button' && node.attributes['data-dyn-continue'] === '1'
    if (selector === 'button[class*="_primary"]') return node.tagName === 'button' && className(node).includes('_primary')
    if (selector === '[role="tooltip"][class*="_preview"]') return node.attributes.role === 'tooltip' && className(node).includes('_preview')
    if (selector === 'nav[class*="_frame"]') return node.tagName === 'nav' && className(node).includes('_frame')
    if (selector === '[class*="_marks"] button[data-index]') return node.tagName === 'button' && node.attributes['data-index'] !== undefined
    if (selector === '[class*="_marks"]') return className(node).includes('_marks')
    if (selector === '[data-dyn-rail-shifted]') return node.attributes['data-dyn-rail-shifted'] !== undefined
    if (selector === '[data-dyn-rail-compacted]') return node.attributes['data-dyn-rail-compacted'] !== undefined
    if (selector.startsWith('button[aria-describedby=')) {
      const id = selector.slice(selector.indexOf('"') + 1, selector.lastIndexOf('"'))
      return node.tagName === 'button' && node.attributes['aria-describedby'] === id
    }
    return false
  }

  function make(tag, attributes = {}, text = '') {
    const node = {
      tagName: tag,
      attributes: { ...attributes },
      dataset: {},
      textContent: text,
      parent: null,
      children: [],
      /** Geometry the rail's compaction reads, in stub-friendly form. */
      offsetTop: 0,
      offsetHeight: 0,
      style: {
        values: {},
        setProperty(name, value) { this.values[name] = value },
        removeProperty(name) { delete this.values[name] },
      },
      getAttribute(name) { return name in node.attributes ? node.attributes[name] : null },
      setAttribute(name, value) { node.attributes[name] = value },
      removeAttribute(name) { delete node.attributes[name] },
      append(child) { child.parent = node; node.children.push(child) },
      remove() {},
      closest(selector) {
        let current = node
        while (current !== null) {
          if (matches(current, selector)) return current
          current = current.parent
        }
        return null
      },
      querySelector(selector) { return descendants(node).find((candidate) => matches(candidate, selector)) ?? null },
      querySelectorAll(selector) { return descendants(node).filter((candidate) => matches(candidate, selector)) },
    }
    return node
  }

  const html = make('html')
  const head = make('head')
  const body = make('body')
  /** Capture-phase listeners the plugin installed on the document itself. */
  const documentListeners = new Map()
  return {
    make,
    documentListeners,
    document: {
      head,
      body,
      documentElement: html,
      createElement: make,
      addEventListener(type, listener) {
        if (documentListeners.has(type) !== true) documentListeners.set(type, new Set())
        documentListeners.get(type).add(listener)
      },
      removeEventListener(type, listener) {
        const listeners = documentListeners.get(type)
        if (listeners !== undefined) listeners.delete(listener)
      },
      querySelector: (selector) => descendants(body).find((node) => matches(node, selector)) ?? null,
      querySelectorAll: (selector) => descendants(body).filter((node) => matches(node, selector)),
    },
    styles: () => descendants(head).filter((node) => node.tagName === 'style'),
  }
}

/**
 * The browser half's own runtime: slots and effects, a settings form whose
 * snapshot the test drives, synchronous timers, a captured MutationObserver, and
 * a session binding whose event window the test supplies.
 */
function makeClientRuntime(dom, slotValues, initialWindow) {
  const state = { registrations: [], components: new Map(), observers: 0, timers: [] }
  const scopeListeners = new Set()
  const projectionListeners = new Set()
  const projectionRoundsValue = { current: undefined }
  let currentWindow = initialWindow
  let observerCallback = null
  globalThis.document = dom.document
  globalThis.MutationObserver = class {
    constructor(callback) { observerCallback = callback }
    observe() { state.observers += 1 }
    disconnect() {}
  }
  const scope = {
    getSnapshot: () => ({ status: 'ready', value: slotValues, writable: true, mode: 'host', revision: 1, user: {} }),
    subscribe: (listener) => {
      scopeListeners.add(listener)
      return () => { scopeListeners.delete(listener) }
    },
    set: async () => true,
    unset: async () => true,
  }
  const ctx = {
    effect(fn) { const dispose = fn(); return () => { if (typeof dispose === 'function') dispose() } },
    on: () => () => {},
    inject(services, callback) {
      if (services.includes('configForms')) callback(ctx)
      if (services.includes('settings')) callback(ctx)
    },
    get(name) {
      if (name !== 'sessions') return undefined
      return {
        binding: () => ({
          session: {
            command: async () => ({ ok: true, value: { matched: true } }),
            prompt: async () => ({ ok: true }),
            // The host's whole-session view: what the projection seam delivers.
            projections: {
              faceOf: (key) => ({
                getSnapshot: () => (key === 'restartTaskRounds' ? projectionRoundsValue.current : undefined),
                subscribe: (listener) => { projectionListeners.add(listener); return () => { projectionListeners.delete(listener) } },
              }),
            },
          },
          eventSource: { subscribe: () => () => {}, getSnapshot: () => currentWindow },
        }),
      }
    },
    // Timers are queued and fired by the test, never inline: the pass assigns its
    // handle *after* scheduling, so an inline callback would leave it permanently
    // "in flight" and silently stop every later sweep.
    timeout(callback) {
      const handle = { callback, cancelled: false }
      state.timers.push(handle)
      return () => { handle.cancelled = true }
    },
    configForms: {
      get: () => scope,
      whileServed: (namespaces, register) => register(new Set(namespaces)),
      describe: () => ({ getSnapshot: () => ({ view: { namespaces: [] } }) }),
    },
    slots: {
      inject: (_key, callback) => callback(),
      register(options, component) {
        state.registrations.push(options)
        state.components.set(options.name, component)
        return () => {}
      },
    },
  }
  return {
    state, ctx, scope,
    /** Fire every debounced sweep still pending. */
    flush() {
      const pending = state.timers.splice(0, state.timers.length)
      for (const handle of pending) if (handle.cancelled !== true) handle.callback()
    },
    /** Publish a settings change, the way a card write would. */
    notifySettings() {
      scopeListeners.forEach((listener) => {
        try { listener() } catch (error) { void error }
      })
    },
    /** Replace the session window, the way folding or paging does. */
    setWindow(value) { currentWindow = value },
    /** Publish a projection value, the way the host's change feed does. */
    setProjectionRounds(value) {
      projectionRoundsValue.current = value
      projectionListeners.forEach((listener) => {
        try { listener() } catch (error) { void error }
      })
    },
    /** Ask the pass to sweep again, the way a DOM mutation would. */
    sweep() { if (observerCallback !== null) observerCallback() },
    /** Mount the composer control once, which is what publishes the window. */
    mountControl(overrides, sessionId) {
      const component = state.components.get('conversation.input.right')
      const session = Object.assign({ running: false, blank: false, removed: false, promptError: null, lastAgentError: '' }, overrides)
      const useSession = (selector) => selector(session)
      return component({ sessionId: sessionId === undefined ? 's1' : sessionId, useSession })
    },
  }
}

/**
 * A transcript with the two shapes this plugin's rows take, plus intruders:
 *
 * - round 7, opened by this plugin → the product's trigger notice (no provenance);
 * - round 5, opened by the human, with this plugin's in-turn steer inside it → a
 *   context row carrying this plugin's provenance label;
 * - round 6, opened by someone else (a foreign trigger) and carrying another
 *   producer's context row.
 */
function transcriptDom() {
  const dom = stubDom()
  const triggerRow = dom.make('div', { 'data-chat-flow-kind': 'turn-trigger', 'data-chat-turn': '7' })
  const humanRow = dom.make('div', { 'data-chat-flow-kind': 'user', 'data-chat-turn': '5' })
  const steerRow = dom.make('div', { 'data-chat-flow-kind': 'context', 'data-chat-turn': '5' })
  steerRow.append(dom.make('span', { 'data-context-source': 'true' }, 'dsh-restart-task'))
  const foreignTrigger = dom.make('div', { 'data-chat-flow-kind': 'turn-trigger', 'data-chat-turn': '6' })
  const foreignContext = dom.make('div', { 'data-chat-flow-kind': 'context', 'data-chat-turn': '6' })
  foreignContext.append(dom.make('span', { 'data-context-source': 'true' }, 'time-context'))
  const nav = dom.make('nav', { class: 'abc_frame' })
  const marks = dom.make('div', { class: 'abc_marks' })
  const mark7 = dom.make('button', { class: 'abc_mark', 'data-index': '6', 'aria-label': '跳转到第 7 轮' })
  const mark6 = dom.make('button', { class: 'abc_mark', 'data-index': '5', 'aria-label': '跳转到第 6 轮' })
  const mark5 = dom.make('button', { class: 'abc_mark', 'data-index': '4', 'aria-label': '跳转到第 5 轮' })
  // What the rail's virtualizer leaves on screen: a column of 10px marks on a 10px
  // pitch, and a container sized to hold them all.
  marks.append(mark7)
  marks.append(mark6)
  marks.append(mark5)
  mark7.offsetTop = 0
  mark7.offsetHeight = 10
  mark6.offsetTop = 10
  mark6.offsetHeight = 10
  mark5.offsetTop = 20
  mark5.offsetHeight = 10
  marks.offsetHeight = 30
  nav.append(marks)
  // The composer: the shipped primary control (empty draft ⇒ disabled) and this
  // plugin's own round control, both inside the composer card.
  const card = dom.make('div', { 'data-composer-card': 'true' })
  const send = dom.make('button', { class: 'uV2eYG_primary', 'aria-label': '发送消息', disabled: 'true' })
  send.disabled = true
  const round = dom.make('button', { class: 'dyn-retry-round' })
  round.clicks = 0
  round.click = () => { round.clicks += 1 }
  card.append(send)
  card.append(round)
  for (const node of [triggerRow, humanRow, steerRow, foreignTrigger, foreignContext, nav, card]) dom.document.body.append(node)
  return { dom, triggerRow, humanRow, steerRow, foreignTrigger, foreignContext, nav, marks, mark7, mark6, mark5, card, send, round }
}

/** The window of a real session: a human round with a steer, then our own round. */
const continuationWindow = windowOf([
  start(5, 5),
  human('go'),
  { type: 'user/message', seq: 8, data: { role: 'user', content: [{ type: 'text', text: 'ctx' }], source: { kind: 'runtime-context' } } },
  ours(),
  step(),
  end('error'),
  start(7, 106),
  ours(),
  step(),
  end('aborted'),
])

let clientBundle = null
globalThis.window = { __ModuleLoader__: { load: (definition) => { clientBundle = definition } } }
// eslint-disable-next-line no-new-func
new Function('window', clientSource)(globalThis.window)
const stubReact = {
  createElement: () => null,
  useMemo: (factory) => factory(),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: (fn) => { const dispose = fn(); void dispose },
  useRef: (value) => ({ current: value === undefined ? null : value }),
  useCallback: (fn) => fn,
  memo: (component) => component,
}
const clientBundleExports = clientBundle.factory((spec) => {
  if (spec === 'react') return stubReact
  throw new Error('unexpected module request: ' + spec)
})
equal('dom: the bundle exports apply and inject', Object.keys(clientBundleExports).sort().join(','), 'apply,inject,policySummary')

// ---- hide mode (the default): the mark, and with it the hover card, go away --
const hideDom = transcriptDom()
const hideRuntime = makeClientRuntime(hideDom.dom, { hideContinueRow: true, continuedRailMarks: 'hide' }, continuationWindow)
clientBundleExports.apply(hideRuntime.ctx)
hideRuntime.flush()
equal('dom: the composer control and the card are both registered', hideRuntime.state.registrations.map((entry) => entry.name).join(','), 'conversation.input.right,plugins.bundle.config')
equal('dom: the stylesheet and the conditional row rule are both injected', hideDom.dom.styles().length, 2)
equal('dom: the pass is observing', hideRuntime.state.observers, 1)
equal('dom: the row rule hides only this plugin\'s own tags', hideDom.dom.styles()[1].textContent.includes('[data-chat-flow-kind="context"][data-dyn-restart-row="1"]'), true)

const rowsIn = (fixture) => fixture.dom.document.querySelectorAll('[data-dyn-restart-row]')
// Before the composer control mounts there is no window, so the steer row (which
// names its producer in the DOM) is still attributable while the trigger notice
// — the shape with no provenance at all — is not.
equal('dom: the steer row is attributable without any window', hideDom.steerRow.getAttribute('data-dyn-restart-row'), '1')
equal('dom: the trigger notice needs the window first', hideDom.triggerRow.getAttribute('data-dyn-restart-row'), null)
equal('dom: a human row is never tagged', hideDom.humanRow.getAttribute('data-dyn-restart-row'), null)
equal('dom: another producer\'s context row is never tagged', hideDom.foreignContext.getAttribute('data-dyn-restart-row'), null)
equal('dom: an unattributable trigger is never tagged', hideDom.foreignTrigger.getAttribute('data-dyn-restart-row'), null)

// Mounting the composer control publishes the session window the pass needs to
// attribute a trigger notice — the row shape that carries no provenance at all.
hideRuntime.mountControl()
hideRuntime.flush()
equal('dom: the round\'s trigger notice is attributed once the window is known', hideDom.triggerRow.getAttribute('data-dyn-restart-row'), '1')
equal('dom: and the steer row keeps its tag', hideDom.steerRow.getAttribute('data-dyn-restart-row'), '1')
equal('dom: exactly the plugin\'s two rows are tagged', rowsIn(hideDom).length, 2)
equal('dom: a foreign producer\'s trigger is still untouched', hideDom.foreignTrigger.getAttribute('data-dyn-restart-row'), null)
// This is the screenshot: with the mark hidden the hover card ("第 7 轮") has
// nothing left to attach to, so the round leaves no trace in the rail either.
equal('dom: the plugin round\'s rail mark is hidden', hideDom.mark7.getAttribute('data-dyn-continued'), 'hide')
// A steer hides a row inside the human's own round; that round's mark is not this
// plugin's to touch, and neither is a foreign round's.
equal('dom: the human round\'s mark stays', hideDom.mark5.getAttribute('data-dyn-continued'), null)
equal('dom: a foreign round\'s mark stays', hideDom.mark6.getAttribute('data-dyn-continued'), null)
// Hiding the mark is not enough: the rail's virtualizer reserved that round's
// slot, so `hide` alone left a hole in the middle of the rail. The pass measures
// the marks on screen and closes it, and every mark after the hidden one moves up.
equal('dom: the marks after the hidden one move up by one pitch', hideDom.mark6.style.values.transform, 'translateY(-10px)')
equal('dom: and so does the next', hideDom.mark5.style.values.transform, 'translateY(-10px)')
equal('dom: the hidden mark itself is not shifted', hideDom.mark7.attributes['data-dyn-rail-shifted'], undefined)
equal('dom: the container shrinks by the hidden slot', hideDom.dom.document.querySelector('[class*="_marks"]').style.values.height, '20px')

// ---- a round whose events are not loaded at all ------------------------------
// This is the reported case: the session is paged (`加载更早`) and the round's own
// events — the message that opened it, its `turn/start` — are not in the client's
// window, so nothing on screen says whose round it is. The host's fold over the
// whole log does, and the projection seam delivers it whole.
const remoteDom = transcriptDom()
const pagedWindow = windowOf([start(9, 900), human('later'), step()])
const remoteRuntime = makeClientRuntime(remoteDom.dom, { hideContinueRow: true, continuedRailMarks: 'hide', sendBecomesContinue: false }, pagedWindow)
clientBundleExports.apply(remoteRuntime.ctx)
remoteRuntime.flush()
remoteRuntime.mountControl()
remoteRuntime.flush()
equal('projection: a paged-away round is not attributable from the window', remoteDom.mark7.getAttribute('data-dyn-continued'), null)
// The host reports the rounds it opened over the whole log, round 7 among them.
remoteRuntime.setProjectionRounds([7])
remoteRuntime.sweep()
remoteRuntime.flush()
equal('projection: the whole-log rounds reach the rail', remoteDom.mark7.getAttribute('data-dyn-continued'), 'hide')
equal('projection: and their slot is closed like any other', remoteDom.mark6.style.values.transform, 'translateY(-10px)')
equal('projection: the container shrinks for that round too', remoteDom.dom.document.querySelector('[class*="_marks"]').style.values.height, '20px')
// A later, narrower report cannot take the round back: what either source ever
// said stays true while the transcript is on this session.
remoteRuntime.setProjectionRounds([])
remoteRuntime.sweep()
remoteRuntime.flush()
equal('projection: a narrower report does not retract it', remoteDom.mark7.getAttribute('data-dyn-continued'), 'hide')

// The client only ever holds a *paged* window, and folding a completed round or
// loading another slice replaces it. A rule recomputed from the current window
// alone forgot a round it had already recognised, so the mark came back until the
// next slice arrived — which is exactly what the rail showed. Attribution
// therefore accumulates while the transcript stays on one session.
const foldDom = transcriptDom()
const foldedRuntime = makeClientRuntime(foldDom.dom, { hideContinueRow: true, continuedRailMarks: 'hide', sendBecomesContinue: false }, continuationWindow)
clientBundleExports.apply(foldedRuntime.ctx)
foldedRuntime.flush()
foldedRuntime.mountControl()
foldedRuntime.flush()
equal('fold: the round is attributed while its events are loaded', foldDom.mark7.getAttribute('data-dyn-continued'), 'hide')
// The window shrinks to the recent tail: no `turn/start`, no message of ours.
foldedRuntime.setWindow(windowOf([start(9, 900), human('later'), step()]))
foldedRuntime.mountControl()
foldedRuntime.flush()
equal('fold: a shrunk window does not take the round back', foldDom.mark7.getAttribute('data-dyn-continued'), 'hide')
equal('fold: nor does it lose the row tag', foldDom.triggerRow.getAttribute('data-dyn-restart-row'), '1')
equal('fold: and the human round\'s mark is still untouched', foldDom.mark5.getAttribute('data-dyn-continued'), null)
// Another session starts over rather than lending ours.
foldedRuntime.setWindow(windowOf([start(9, 900), human('later')]))
foldedRuntime.mountControl({}, 's2')
foldedRuntime.flush()
equal('fold: another session gets its rail back', foldDom.mark7.getAttribute('data-dyn-continued'), null)
// …and coming back to the first session re-attributes it from the window it has.
foldedRuntime.setWindow(continuationWindow)
foldedRuntime.mountControl({}, 's1')
foldedRuntime.flush()
equal('fold: returning to the session attributes it again', foldDom.mark7.getAttribute('data-dyn-continued'), 'hide')

// ---- the shipped send button carries the continuation ------------------------
// The composer's own control is inline JSX with no slot, so this is the only seam
// that can make the *send button itself* continue — and it may only ever take over
// a control the product cannot use, which is exactly what an empty composer makes
// of it.
equal('send: the empty composer\'s button carries the continuation', hideDom.send.getAttribute('data-dyn-continue'), '1')
equal('send: it is made clickable again', hideDom.send.disabled, false)
equal('send: it announces the continuation', hideDom.send.getAttribute('aria-label'), '继续上次任务')
equal('send: its tooltip explains why', (hideDom.send.getAttribute('title') ?? '').includes('不会重复你的消息'), true)
equal('send: the shipped arrow is swapped for the round arrow', hideDom.dom.styles()[0].textContent.includes("button[data-dyn-continue='1'] > svg"), true)
equal('send: the round control steps aside while it carries the action', hideDom.dom.styles()[1].textContent.includes(':has(button[data-dyn-continue="1"])'), true)

// Clicking it runs the composer control's own action: one busy guard, one outcome
// flash, one double-click fence — and nothing reaches the product's submit path.
// The plugin reads the live `document` at call time (as a browser plugin does), so
// the stub points that global at this fixture before dispatching.
const clickFlags = { prevented: 0, stopped: 0 }
const capture = [...(hideDom.dom.documentListeners.get('click') ?? [])]
equal('send: a capture listener is installed', capture.length, 1)
globalThis.document = hideDom.dom.document
capture[0]({
  target: hideDom.send,
  preventDefault: () => { clickFlags.prevented += 1 },
  stopPropagation: () => { clickFlags.stopped += 1 },
  stopImmediatePropagation: () => { clickFlags.stopped += 1 },
})
equal('send: the click does not also submit', clickFlags.prevented, 1)
equal('send: and it does not reach the product', clickFlags.stopped, 2)
equal('send: the composer control runs the continuation', hideDom.round.clicks, 1)
clickFlags.prevented = 0
capture[0]({ target: hideDom.card, preventDefault: () => { clickFlags.prevented += 1 }, stopPropagation: () => {}, stopImmediatePropagation: () => {} })
equal('send: every other click passes straight through', clickFlags.prevented, 0)

// A composer the human is typing in keeps its send button: their message wins.
const typingDom = transcriptDom()
typingDom.send.disabled = false
const typingRuntime = makeClientRuntime(typingDom.dom, { hideContinueRow: true, continuedRailMarks: 'hide', sendBecomesContinue: true }, continuationWindow)
clientBundleExports.apply(typingRuntime.ctx)
typingRuntime.flush()
typingRuntime.mountControl()
typingRuntime.flush()
equal('send: a non-empty composer keeps its own button', typingDom.send.getAttribute('data-dyn-continue'), null)
equal('send: and its own label', typingDom.send.getAttribute('aria-label'), '发送消息')

// A turn the agent is already re-running offers nothing, so it takes nothing: the
// control's own `show` decides the offer, not the bare mode.
const busyDom = transcriptDom()
const busyRuntime = makeClientRuntime(busyDom.dom, { hideContinueRow: true, continuedRailMarks: 'hide', sendBecomesContinue: true }, continuationWindow)
clientBundleExports.apply(busyRuntime.ctx)
busyRuntime.flush()
busyRuntime.mountControl({ running: true })
busyRuntime.flush()
equal('send: a running agent never hands the button over', busyDom.send.getAttribute('data-dyn-continue'), null)
busyRuntime.mountControl({ blank: true })
busyRuntime.flush()
equal('send: a blank session never hands it over either', busyDom.send.getAttribute('data-dyn-continue'), null)
busyRuntime.mountControl({})
busyRuntime.flush()
equal('send: and an idle broken turn hands it over again', busyDom.send.getAttribute('data-dyn-continue'), '1')

// The switch hands the control back, with the label the product gave it.
const releaseDom = transcriptDom()
const releaseValues = { hideContinueRow: true, continuedRailMarks: 'hide', sendBecomesContinue: true }
const releaseRuntime = makeClientRuntime(releaseDom.dom, releaseValues, continuationWindow)
clientBundleExports.apply(releaseRuntime.ctx)
releaseRuntime.flush()
releaseRuntime.mountControl()
releaseRuntime.flush()
equal('send: taken over while the switch is on', releaseDom.send.getAttribute('data-dyn-continue'), '1')
releaseValues.sendBecomesContinue = false
releaseRuntime.notifySettings()
releaseRuntime.flush()
equal('send: switching it off hands the button back', releaseDom.send.getAttribute('data-dyn-continue'), null)
equal('send: and restores the product\'s own label', releaseDom.send.getAttribute('aria-label'), '发送消息')
equal('send: the hidden round control is gone from the rule too', releaseDom.dom.styles()[1].textContent.includes(':has(button[data-dyn-continue="1"])'), false)

// ---- preview mode: the mark stays clickable, the anonymous label does not ----
const previewDom = transcriptDom()
const previewRuntime = makeClientRuntime(previewDom.dom, { hideContinueRow: true, continuedRailMarks: 'preview' }, continuationWindow)
clientBundleExports.apply(previewRuntime.ctx)
previewRuntime.flush()
previewRuntime.mountControl()
previewRuntime.flush()
equal('dom: preview keeps the mark', previewDom.mark7.getAttribute('data-dyn-continued'), 'preview')
// `preview` keeps the mark on screen, so nothing is compacted: the rail keeps the
// geometry the product gave it.
equal('dom: preview leaves the marks where they are', previewDom.mark6.style.values.transform, undefined)
equal('dom: and the container keeps its own height', previewDom.dom.document.querySelector('[class*="_marks"]').style.values.height, undefined)
// The hover card is a sibling of the marks, so "this preview belongs to a
// continued round" is carried on the rail itself.
const tooltip = previewDom.dom.make('div', { role: 'tooltip', class: 'abc_preview', id: 'tp' })
previewDom.mark7.setAttribute('aria-describedby', 'tp')
previewDom.nav.append(tooltip)
previewRuntime.sweep()
previewRuntime.flush()
equal('dom: preview flags the rail so the anonymous label is dropped', previewDom.nav.getAttribute('data-dyn-continued-preview'), '1')
equal('dom: the conditional rule drops only the prompt line', clientSource.includes("nav[data-dyn-continued-preview='1'] [class*='_previewPrompt']"), true)

// ---- keep mode: the product's own presentation, untouched --------------------
const keepDom = transcriptDom()
const keepRuntime = makeClientRuntime(keepDom.dom, { hideContinueRow: true, continuedRailMarks: 'keep' }, continuationWindow)
clientBundleExports.apply(keepRuntime.ctx)
keepRuntime.flush()
keepRuntime.mountControl()
keepRuntime.flush()
equal('dom: keep writes no rail tag', keepDom.dom.document.querySelectorAll('[data-dyn-continued]').length, 0)
equal('dom: keep still attributes the rows, for the hide rule and the rail', keepDom.dom.document.querySelectorAll('[data-dyn-restart-row]').length, 2)

// ---- the switch off: rows come back, tags are cleared ------------------------
const showDom = transcriptDom()
const showRuntime = makeClientRuntime(showDom.dom, { hideContinueRow: false, continuedRailMarks: 'hide' }, continuationWindow)
clientBundleExports.apply(showRuntime.ctx)
showRuntime.flush()
showRuntime.mountControl()
showRuntime.flush()
const conditionalRule = showDom.dom.styles()[1].textContent
equal('dom: with hiding off the row rule is gone', conditionalRule.includes('data-dyn-restart-row'), false)
equal('dom: the send takeover rule is on by default', conditionalRule.includes('data-dyn-continue'), true)
equal('dom: the rows are still tagged, so the rail still knows them', showDom.dom.document.querySelectorAll('[data-dyn-restart-row]').length, 2)
equal('dom: the rail mark is still hidden in hide mode', showDom.mark7.getAttribute('data-dyn-continued'), 'hide')

// ------------------------------------------------------------------------ report
if (failures.length > 0) {
  console.error('FAILED — ' + failures.length + ' of ' + (passed + failures.length) + ' assertions')
  for (const failure of failures) console.error('  ✗ ' + failure)
  process.exit(1)
}
console.log('ok — ' + passed + ' assertions passed (rules, wiring, host behaviour, transcript)')
