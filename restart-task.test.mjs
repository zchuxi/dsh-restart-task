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
  'planRetryBoost',
  'planKeepAlive',
  'planAutoContinue',
  'isUserStop',
  'truncationOf',
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
  'finishOfStream',
  'ownWakingTurns',
  'restartAffordance',
  'policySummary',
  'numberOr',
  'fieldIsServed',
  'railMarkMode',
  'BROKEN_END_KINDS',
  'BUNDLE_NAME',
  'ENTRY_ID',
  'OWN_SOURCE_KIND',
])

const defaults = host.resolveConfig(undefined)

// ---------------------------------------------------------------- resolveConfig
equal('defaults: in-turn retry on', defaults.retryFailedRequests, true)
equal('defaults: retry budget 30', defaults.maxRequestRetries, 30)
equal('defaults: unlimited retry off', defaults.retryForever, false)
equal('defaults: backoff base 2000', defaults.retryBaseDelayMs, 2000)
equal('defaults: keep-alive on', defaults.keepAliveOnMaxTokens, true)
equal('defaults: per-turn continues 5', defaults.maxTurnContinues, 5)
equal('defaults: turn-level auto-continue off', defaults.autoContinue, false)
equal('defaults: consecutive cap 3', defaults.maxConsecutive, 3)
equal('defaults: delay 1500', defaults.delayMs, 1500)
equal('defaults: every broken reason enabled', defaults.onAborted && defaults.onError && defaults.onInterrupted, true)
equal('defaults: continuation row hidden', defaults.hideContinueRow, true)
equal('defaults: settled retry rows hidden', defaults.hideSettledRetry, true)
equal('defaults: built-in continue text', defaults.continueText, host.DEFAULT_CONTINUE_TEXT)

const junk = host.resolveConfig({ retryFailedRequests: 'yes', maxRequestRetries: '9', continueText: '   ', autoContinue: 1 })
equal('junk: non-boolean keeps retry on', junk.retryFailedRequests, true)
equal('junk: non-number falls back to 30', junk.maxRequestRetries, 30)
equal('junk: blank text falls back to built-in', junk.continueText, host.DEFAULT_CONTINUE_TEXT)
equal('junk: truthy-but-not-true keeps auto-continue off', junk.autoContinue, false)

const off = host.resolveConfig({ retryFailedRequests: false, keepAliveOnMaxTokens: false, hideContinueRow: false, hideSettledRetry: false })
equal('explicit off is honoured', off.retryFailedRequests === false && off.keepAliveOnMaxTokens === false, true)
equal('explicit show rows is honoured', off.hideContinueRow, false)
equal('explicit retry receipts are honoured', off.hideSettledRetry, false)
equal('junk: a non-boolean keeps retry receipts hidden', host.resolveConfig({ hideSettledRetry: 'no' }).hideSettledRetry, true)

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
equal('live: the reader covers every declared field', host.CONFIG_FIELDS.length, 18)
equal('live: an absent config reads as defaults', host.resolveConfig(host.liveConfig(undefined)).maxRequestRetries, 30)
equal('live: undefined reads as defaults', host.resolveConfig(host.liveConfig(undefined)).continueText, host.DEFAULT_CONTINUE_TEXT)

// -------------------------------------------------------------- planRetryBoost
// The plugin no longer retries in place; it widens the routed provider's retry
// policy so the product's own retry owner does the retries *visibly*. The
// planner returns the replacement policy, never a delay.
const boostBase = { retryFailedRequests: true, maxRequestRetries: 30, retryForever: false, retryBaseDelayMs: 2000 }
const boost = host.planRetryBoost({ config: boostBase, current: { mode: 'normal', maxRetries: 5, retryableCodes: ['SERVER'] } })
equal('boost: a bounded config widens', boost.ok, true)
equal('boost: it hands the owner a normal policy', boost.policy.mode, 'normal')
equal('boost: with the configured budget', boost.policy.maxRetries, 30)
equal('boost: the base delay comes from config', boost.policy.initialDelayMs, 2000)
equal('boost: the delay is capped at 60s', boost.policy.maxDelayMs, 60000)
equal('boost: it keeps the provider\'s own terminal verdict', boost.policy.retryableCodes.join(','), 'SERVER')
// With no policy on the failed step, fall back to the product's default codes
// rather than inventing an empty (retry-everything) set.
const boostNoCodes = host.planRetryBoost({ config: boostBase, current: null })
equal('boost: absent codes fall back to the default set', boostNoCodes.policy.retryableCodes.join(','), 'EMPTY_RESPONSE,RATE_LIMIT,SERVER,TIMEOUT,TRANSPORT')
// Unlimited hands the owner an `always` policy, which omits maxRetries (its
// invariant requires that) and drops the terminal-code guard.
const unlimited = { retryFailedRequests: true, maxRequestRetries: 0, retryForever: true, retryBaseDelayMs: 2000 }
const boostForever = host.planRetryBoost({ config: unlimited, current: { mode: 'normal', maxRetries: 5, retryableCodes: ['SERVER'] } })
equal('boost: unlimited hands the owner an always policy', boostForever.policy.mode, 'always')
equal('boost: an always policy omits maxRetries', 'maxRetries' in boostForever.policy, false)
equal('boost: switched off does not widen', host.planRetryBoost({ config: { retryFailedRequests: false }, current: null }).ok, false)
equal('boost: a zero budget does not widen', host.planRetryBoost({ config: { retryFailedRequests: true, maxRequestRetries: 0 }, current: null }).ok, false)
// A planner handed a partial config must decide like the runner, which fills
// every field first: absent means "use the schema default", not "off".
equal('boost: an absent switch reads as its default (on)', host.planRetryBoost({ config: {}, current: null }).ok, true)
equal('boost: an absent budget reads as the schema default (30)', host.planRetryBoost({ config: {}, current: null }).policy.maxRetries, 30)

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
equal('auto: the four broken reasons are exactly these', host.BROKEN_REASONS.join(','), 'aborted,error,interrupted,max-tokens')

// ------------------------------------------------------------- truncationOf
// `max-tokens` is the loop's *sticky* turn-end reason: it is pinned as soon as
// one step hits the ceiling and survives every later step, so a turn tier 2
// already rescued wears it too. The closing step's own finish is the only thing
// that separates "cut off" from "was cut off and finished".
equal('cut: max-tokens with a truncated closing step is unfinished', host.truncationOf('max-tokens', 'max-tokens'), true)
equal('cut: max-tokens whose closing step finished is complete', host.truncationOf('max-tokens', 'stop'), false)
equal('cut: an unobserved closing step trusts the durable reason', host.truncationOf('max-tokens', undefined), true)
equal('cut: an empty closing step trusts the durable reason', host.truncationOf('max-tokens', ''), true)
equal('cut: another reason is never a truncation', host.truncationOf('error', 'max-tokens'), false)
equal('cut: a missing reason is never a truncation', host.truncationOf(undefined, 'max-tokens'), false)
equal('cut: the reason constant is the finish constant', host.TRUNCATED_FINISH, 'max-tokens')

equal('auto: truncation continues by default', host.planAutoContinue({ reason: 'max-tokens', truncated: true, config: { autoContinue: true }, consecutive: 0 }).ok, true)
equal('auto: a rescued turn does not continue again', host.planAutoContinue({ reason: 'max-tokens', truncated: true, config: { autoContinue: true }, consecutive: 0 }).why, 'broken turn (max-tokens)')
equal('auto: the sticky reason is refused when nothing was cut off', host.planAutoContinue({ reason: 'max-tokens', truncated: false, config: { autoContinue: true }, consecutive: 0 }).why, 'the turn was kept alive and finished')
equal('auto: an absent truncation verdict is refused', host.planAutoContinue({ reason: 'max-tokens', config: { autoContinue: true }, consecutive: 0 }).ok, false)
equal('auto: the truncation cause can be excluded', host.planAutoContinue({ reason: 'max-tokens', truncated: true, config: { autoContinue: true, onMaxTokens: false }, consecutive: 0 }).why, 'output ceiling is not enabled')
equal('auto: the truncation cap still applies', host.planAutoContinue({ reason: 'max-tokens', truncated: true, config: { autoContinue: true, maxConsecutive: 2 }, consecutive: 2 }).ok, false)
equal('auto: the truncation cause does not leak into other reasons', host.planAutoContinue({ reason: 'error', truncated: false, config: { autoContinue: true }, consecutive: 0 }).ok, true)


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
// No assistant message means no closing-step evidence, so the sticky reason is
// not enough to call the turn truncated: the card must not offer to continue
// work it cannot prove stopped short.
equal('window: a bare max-tokens end is not enough on its own', client.analyzeWindow(windowOf([end('max-tokens')])).badEnd, '')
equal('window: a later good turn clears an earlier break', client.analyzeWindow(windowOf([end('error'), human('retry'), end('completed')])).badEnd, '')
equal('window: reason-less turn end is clean', client.analyzeWindow(windowOf([end(undefined)])).badEnd, '')

// The closing assistant message carries the raw stream records, and its finish
// chunk is the per-step truncation evidence the durable log otherwise lacks.
const assistantStep = (finish) => ({
  type: 'assistant/message',
  data: {
    turn: 1,
    step: 1,
    content: [{ type: 'text', text: 'half an answer' }],
    stream: [
      { type: 'text-chunks', time0: 0, index: 0, dt: [1], texts: ['half'] },
      { type: 'chunk', time: 2, chunk: { type: 'finish', reason: { kind: finish } } },
    ],
  },
})
const cutOff = windowOf([human('write it'), assistantStep('max-tokens'), end('max-tokens')])
equal('stream: the finish reason is read back', client.finishOfStream(assistantStep('max-tokens').data.stream), 'max-tokens')
equal('stream: a stream without a finish reads empty', client.finishOfStream([{ type: 'text-chunks' }]), '')
equal('stream: a missing stream reads empty', client.finishOfStream(undefined), '')
equal('window: a genuinely cut-off turn is broken', client.analyzeWindow(cutOff).badEnd, 'max-tokens')
// The rescue case: tier 2 kept the turn alive and its closing step finished, so
// the turn still *reports* max-tokens but the work is complete.
const rescued = windowOf([human('write it'), assistantStep('max-tokens'), assistantStep('stop'), end('max-tokens')])
equal('window: a rescued turn is not broken', client.analyzeWindow(rescued).badEnd, '')
equal('window: a fresh turn drops the previous closing finish', client.analyzeWindow(windowOf([assistantStep('max-tokens'), { type: 'turn/start', data: { turn: 2 } }, end('max-tokens')])).badEnd, '')
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

// A cut-off answer is the plugin's headline case: the composer must offer the
// same one-click continue, and say what happened in the user's own terms.
const truncatedTurn = affordance([human('write the report'), assistantStep('max-tokens'), end('max-tokens')])
equal('button: shown after a genuinely truncated turn', truncatedTurn.show && truncatedTurn.mode, 'continue')
equal('button: names the output ceiling', truncatedTurn.reason, '上次回复达到输出上限、没写完')
equal('button: still promises no duplicate prompt', truncatedTurn.title.indexOf('不会重复你的消息') > 0, true)
equal('button: the prompt is kept for a resend fallback', truncatedTurn.text, 'write the report')
// The rescue case must not offer anything: the turn reports max-tokens, but its
// closing step finished, so there is no unfinished work to continue.
const rescuedTurn = affordance([human('write the report'), assistantStep('max-tokens'), assistantStep('stop'), end('max-tokens')])
equal('button: hidden after a rescued turn', rescuedTurn.show, false)
// And the offer still stands down while the agent runs or a message is queued.
equal('button: hidden while a truncated turn is still running', affordance([human('x'), assistantStep('max-tokens'), end('max-tokens')], { running: true }).show, false)
equal('button: a truncated turn stands down behind a queued message', affordance([human('x'), assistantStep('max-tokens'), end('max-tokens')], { queuePending: true }).show, false)

// A queued message is the human's own continuation (inbox `next-turn`): the
// affordance must stand down so it never posts a second, competing message into
// the same slot. The mode is still computed — only `show` is withheld.
const queuedBroken = affordance([human('ship it'), end('error')], { queuePending: true })
equal('queue: a broken turn stands down while a message is queued', queuedBroken.show, false)
equal('queue: the mode is still continue underneath', queuedBroken.mode, 'continue')
const queuedResend = affordance([human('ship it')], { promptFailed: true, queuePending: true })
equal('queue: a failed send stands down while a message is queued', queuedResend.show, false)
const notQueuedBroken = affordance([human('ship it'), end('error')], { queuePending: false })
equal('queue: an explicit empty queue still shows', notQueuedBroken.show, true)

// ------------------------------------------------------------------- policySummary
const chips = client.policySummary({ retryFailedRequests: true, maxRequestRetries: 5, keepAliveOnMaxTokens: true, autoContinue: false })
equal('chips: three of them', chips.length, 3)
equal('chips: retry budget is quoted', chips[0].text, '失败可见重试 5 次')
equal('chips: retry is a good state', chips[0].tone, 'on')
equal('chips: truncation is continued in-turn', chips[1].text, '输出超限同轮续写')
equal('chips: turn-level continuation reads as off', chips[2].text, '中断后不自动继续')
const unlimitedChips = client.policySummary({ retryForever: true, autoContinue: true })
equal('chips: unlimited retry is named', unlimitedChips[0].text, '失败可见重试（不限次）')
equal('chips: auto-continue is flagged', unlimitedChips[2].tone, 'alert')
const quietChips = client.policySummary({ retryFailedRequests: false, keepAliveOnMaxTokens: false })
equal('chips: switched-off retry', quietChips[0].text, '失败不自动重试')
equal('chips: switched-off keep-alive', quietChips[1].text, '输出超限不续写')
equal('chips: empty settings read as defaults', client.policySummary(undefined)[0].text, '失败可见重试 30 次')
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
// locks users out of the next harness rc. The 0.2 train is admitted the same way:
// `>=0.2.0-rc.1` is what lets the `0.2.0-rc.1` prerelease (npm's `next` tag) itself
// through, and `<0.3.0-0` keeps the next minor out. The host enforces exactly this
// field — `evaluatePluginCompatibility` runs `semver.satisfies(runtime, range,
// { includePrerelease: true })` over `peerDependencies` at install and launch, and
// never reads `engines`; `engines.dsh` is kept in agreement for the manifest reader.
const RUNTIME_RANGE = '>=0.1.7-rc.1 <0.1.8-0 || >=0.1.8-rc.1 <0.2.0-0 || >=0.2.0-rc.1 <0.3.0-0'
equal('identity: the manifest requires the settings-era runtime', manifest.peerDependencies['@deepseek-ai/dsh'], RUNTIME_RANGE)
equal('identity: the engines range agrees', manifest.engines.dsh, RUNTIME_RANGE)
equal('identity: every supported tuple carries a prerelease branch', (RUNTIME_RANGE.match(/>=0\.\d+\.\d+-rc\.\d+/g) ?? []).length, 3)
equal('identity: the 0.2 train is admitted from its first rc', RUNTIME_RANGE.includes('>=0.2.0-rc.1 <0.3.0-0'), true)
equal('identity: the range keeps the next minor out', RUNTIME_RANGE.includes('<0.3.0-0'), true)

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
// The retry budget must stay a *budget*, not regress to the retired 3-attempt cap.
// The pattern is anchored on the field name: an unanchored probe for
// `.max(50).default(3).volatile()` also matches `maxConsecutive`, which is how
// this assertion silently stopped testing anything.
const retryFieldLine = (hostSource.match(/^\s*maxRequestRetries: z\.natural\(\)[^\n]*$/m) ?? [''])[0]
equal('config: the retry budget is 30 and its cap is 50', retryFieldLine.includes('z.natural().max(50).default(30).volatile()'), true)
equal('config: every declared field is volatile', (hostSource.slice(hostSource.indexOf('export const Config = z.object({')).match(/\.volatile\(\),/g) ?? []).length, hostKeys.length)
equal('config: the reader covers exactly the declared fields', host.CONFIG_FIELDS.join(','), hostKeys.join(','))

/**
 * Every `Config` field's declared schema default, read straight out of the
 * schema text. The card keeps its own copy of these so it can render a value for
 * a field the user layer never wrote, and a copy that drifts is invisible: the
 * card simply shows a number the host does not use. Key parity alone cannot see
 * that, which is how `maxRequestRetries` came to read 3 on the card while the
 * host applied 30.
 */
function hostSchemaDefaults() {
  const start = hostSource.indexOf('export const Config = z.object({')
  const stop = hostSource.indexOf('})', start)
  const body = hostSource.slice(start, stop)
  const out = {}
  for (const match of body.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*): z\.([A-Za-z]+)\(\)([^\n]*)$/gm)) {
    const field = match[1]
    const kind = match[2]
    const declared = /\.default\(([^)]*)\)/.exec(match[3])
    if (declared === null) continue
    const raw = declared[1]
    if (kind === 'boolean') out[field] = raw === 'true'
    else if (kind === 'natural' || kind === 'number') out[field] = Number(raw)
    else out[field] = raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw
  }
  return out
}

function clientDefaultValues() {
  const start = clientSource.indexOf('const DEFAULTS = {')
  const stop = clientSource.indexOf('\n\t\t}', start)
  const body = clientSource.slice(start, stop)
  const out = {}
  for (const match of body.matchAll(/^\s+([A-Za-z][A-Za-z0-9]*): (.*),$/gm)) {
    const raw = match[2].trim()
    if (raw === 'true') out[match[1]] = true
    else if (raw === 'false') out[match[1]] = false
    else if (/^-?\d+(\.\d+)?$/.test(raw)) out[match[1]] = Number(raw)
    else out[match[1]] = raw.replace(/^'/, '').replace(/'$/, '')
  }
  return out
}

const schemaDefaults = hostSchemaDefaults()
const cardDefaultValues = clientDefaultValues()
// The client's `''` for the continuation prompt is the "inherit the host default"
// marker, not a value: the text itself is long, localized, and owned by the host.
const drift = Object.keys(schemaDefaults)
  .filter((key) => key !== 'continueText')
  .filter((key) => cardDefaultValues[key] !== schemaDefaults[key])
  .map((key) => key + '=' + JSON.stringify(cardDefaultValues[key]) + '/' + JSON.stringify(schemaDefaults[key]))
equal('config: every schema default reaches the card unchanged', drift.join(' '), '')
equal('config: the card inherits the host continuation prompt', cardDefaultValues.continueText, '')
equal('config: the truncation trigger defaults on', schemaDefaults.onMaxTokens, true)
equal('config: not every switch defaults on (the probe is real)', schemaDefaults.autoContinue, false)

/**
 * The numeric caps the Host schema enforces, read out of the same schema text.
 * `configForms` answers a refused write with `false` (it does not reject), so a
 * value past the cap is a write that silently never lands; the card states the
 * cap on the input to keep that from happening at all, and this keeps the card's
 * copy honest.
 */
function hostSchemaMaxima() {
  const start = hostSource.indexOf('export const Config = z.object({')
  const stop = hostSource.indexOf('})', start)
  const body = hostSource.slice(start, stop)
  const out = {}
  for (const match of body.matchAll(/^\s{2}([A-Za-z][A-Za-z0-9]*): z\.natural\(\)\.max\((\d+)\)/gm)) {
    out[match[1]] = Number(match[2])
  }
  return out
}

function clientMaxima() {
  const start = clientSource.indexOf('const MAXIMA = {')
  const stop = clientSource.indexOf('\n\t\t}', start)
  const body = clientSource.slice(start, stop)
  const out = {}
  for (const match of body.matchAll(/^\s+([A-Za-z][A-Za-z0-9]*): (\d+),$/gm)) out[match[1]] = Number(match[2])
  return out
}

const schemaMaxima = hostSchemaMaxima()
equal('config: the card states every numeric cap the host enforces', JSON.stringify(clientMaxima()), JSON.stringify(schemaMaxima))
equal('config: the retry cap is the host\'s own 50', clientMaxima().maxRequestRetries, 50)
equal('config: the cap reaches the input', clientSource.includes('max: props.max'), true)
equal('config: the row hands the cap to the control', clientSource.includes('max: MAXIMA[field]'), true)
// A refused write resolves `false`; settlement alone is therefore not success.
equal('config: a refused write is not treated as accepted', clientSource.includes('function accepted(result)') && clientSource.includes('result !== false'), true)
equal('config: the refusal is reported to the user', clientSource.includes('宿主没有接受这次写入'), true)
equal('config: the per-field write reports the verdict', clientSource.includes('.then(report, reportFailure)'), true)
equal('config: the bulk reset reports the verdict too', clientSource.includes('report(results.every(accepted))'), true)
// The stale success handler would paint "已生效" over a write that never landed.
equal('config: no bare settlement success handler survives', /\.then\(\s*\(\)\s*=>\s*\{\s*setFailure\(null\); ping\(\)/.test(clientSource), false)
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
equal('card: renders the retry-receipt toggle', rendered.has('hideSettledRetry'), true)

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

// A retry this plugin caused is executed by the product's own retry owner, which
// writes the `llm/retry` events Chat renders. The plugin cannot mark those events
// at the source, so the rule keys on the product's own rendered flow kind and
// tells a live retry (which the user asked to see) from a settled one.
equal('retry rows: keyed on the product\'s own flow kind', clientSource.includes('const HIDE_SETTLED_RETRY_CSS'), true)
equal('retry rows: the flow kind is the product\'s', clientSource.includes('[data-chat-flow-kind="model-retry"]'), true)
equal('retry rows: only a settled retry is hidden', clientSource.includes('[data-chat-flow-kind="model-retry"]:not(:has(details[data-active]))'), true)
equal('retry rows: the live countdown stays', clientSource.includes('details[data-active] { display: none'), false)
equal('retry rows: opt-out is honoured in the client', clientSource.includes('value.hideSettledRetry !== false'), true)
equal('retry rows: hidden only while this plugin owns the budget', clientSource.includes('value.retryFailedRequests !== false'), true)
equal('retry rows: both rules share the conditional tag', clientSource.includes("(hideRetry === true ? HIDE_SETTLED_RETRY_CSS : '')"), true)

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
equal('send: it runs the control\'s own action, not a copy of it', clientSource.includes('controlInCard(cardOf(button))'), true)
// The lookup must start from the clicked button's own card. A document-wide query
// is exactly what let one session's composer continue another session's task, so
// it is pinned out rather than merely replaced.
equal('send: never by a document-wide control query', clientSource.includes("document.querySelector('.dyn-retry-round')"), false)
equal('send: the click hands its own button to the resolver', clientSource.includes('runContinuation(button)'), true)
equal('send: two composer cards stand the takeover down', clientSource.includes('if (soleComposer() !== true) {'), true)
equal('send: and the stand-down hands every held button back', clientSource.includes('for (const button of Array.from(held)) releaseButton(button)'), true)
equal('send: the click fallback declines on two cards too', clientSource.includes('if (soleComposer() !== true) return'), true)
equal('send: a draft is re-read before the takeover is kept', clientSource.includes('composerHasDraft(cardOf(button)) !== true'), true)
equal('send: a click with a draft is re-checked at the click', clientSource.includes('if (composerHasDraft(cardOf(button)) === true) return'), true)
// Bug fix (grey/unclickable stop button): `releaseButton` must NEVER write
// `disabled = true`. The product's primary control is one reused DOM node whose
// role React swaps between *send* and *stop*; a release can land on it while it
// is the STOP button (the takeover held it as the idle-empty send button, the
// human clicked continue, a turn started), and forcing it disabled greys out
// stop so the running turn can no longer be paused. React owns that flag.
equal('send: release never writes disabled (would grey out the reused stop button)', /button\.disabled\s*=\s*true/.test(codeOf(clientSource)), false)
equal('send: and the release records why it must not', clientSource.includes('Never write `disabled` here'), true)
// Bug fix (orange "continue" on the new-project / workspace-selection screen with
// an empty composer): the takeover sweep runs for the whole plugin lifetime and
// reads only `affordance.current`, so a `mode:'continue'` left behind when the
// transcript moves to a screen that mounts no composer control of its own is
// repainted onto that screen's idle-empty (disabled) send button — a blank
// composer turned into an orange "continue". The control must retract its offer
// when it leaves the DOM. There are exactly two publishes: the live report and
// this unmount retract.
equal('send: exactly two affordance publishes — the live report and the unmount retract', (clientSource.match(/affordance\.publish\(/g) ?? []).length, 2)
equal('send: the offer is retracted when the composer control unmounts', clientSource.includes("affordance.publish({ sessionId: sessionId, mode: '', title: '', state: 'idle', message: '' })"), true)
// The retract fires only while the hub still holds THIS session's own live offer,
// so a second composer that already published its own continuation is untouched.
equal('send: the retract only clears this session\'s own live offer', clientSource.includes('current.sessionId !== sessionId'), true)
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
// The boost listener never settles the failure itself: every path ends in
// `next()`, so the retry owner behind it still runs and authors the events.
equal('stop: the boost always delegates, never vetoes', hostSource.includes('payload.retryPolicy = plan.policy') && hostSource.includes('return next()'), true)
// It runs ahead of the product's own retry owner (prepend), so the wider
// policy is in place before that owner reads it.
equal('stop: the boost listener is prepended', hostSource.includes("}, true), 'restart-task: visible retry boost')"), true)

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
const routedPolicy = () => ({ mode: 'normal', maxRetries: 5, retryableCodes: ['SERVER'], initialDelayMs: 500, maxDelayMs: 10000, jitterRatio: 0.1 })
// A failed step that routed to a retry policy has that policy replaced with the
// plugin's budget in place, then the call is delegated to the product's retry
// owner, which does the (now visible) retries itself. The boost never waits.
const widened = { agent, turn: 1, step: 1, failure: { status: 500 }, retryPolicy: routedPolicy() }
equal('host: a request error is delegated to the retry owner', await requestError(widened, next), 'delegated')
equal('host: the boost never waits itself', runtime.state.timers.length, 0)
equal('host: the routed policy is set to the plugin budget', widened.retryPolicy.maxRetries, 1)
equal('host: the widened policy keeps the provider terminal-vs-transient verdict', widened.retryPolicy.retryableCodes.join(','), 'SERVER')
// A step that routed to no policy is delegated untouched: a request that reached
// no adapter cannot be helped by inventing one, and the owner refuses anyway.
const noPolicy = { agent, turn: 1, step: 2, failure: { status: 500 } }
equal('host: a policy-less error is delegated', await requestError(noPolicy, next), 'delegated')
equal('host: and left without a forged policy', noPolicy.retryPolicy, undefined)
// A stopped turn is handed straight on, its policy untouched: the failure is the
// stop itself, not something to retry harder.
const stopped = { agent, turn: 1, step: 3, failure: { status: 500 }, signal: { aborted: true }, retryPolicy: routedPolicy() }
equal('host: a stopped turn is delegated, never widened', await requestError(stopped, next), 'delegated')
equal('host: the stopped turn keeps its original policy', stopped.retryPolicy.maxRetries, 5)
equal('host: delegation counts every delegated call', delegated, 3)

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

// ---- the in-turn tier honours the stop control ------------------------------
// `agent/turn-stopping` is awaited before the boundary commits, and the loop only
// re-checks the abort signal *after* the dispatch. So this listener is the last
// chance to notice that the human already stopped the turn, and taking it would
// push a fresh instruction into a turn that is ending because they said stop.
const guardRuntime = makeRuntime({ keepAliveOnMaxTokens: true, maxTurnContinues: 5 })
hostModule.apply(guardRuntime.ctx, guardRuntime.live)
const guardAgent = { id: 'session-7', followup: () => {}, steer: (message) => guardRuntime.state.steers.push(message) }
guardRuntime.agents.set('session-7', guardAgent)
const steer = (stopSignal) => {
  guardRuntime.state.listeners.get('agent/assistant-stream')({ agent: guardAgent, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } } })
  guardRuntime.state.listeners.get('agent/turn-stopping')({ agent: guardAgent, turn: 1, signal: stopSignal })
}
steer({ aborted: true })
equal('host: a stopped turn is never steered into', guardRuntime.state.steers.length, 0)
steer({ aborted: false })
equal('host: an unstopped turn is still steered', guardRuntime.state.steers.length, 1)
// A payload that carries no signal at all must stay steerable: the field is
// optional in the event contract, and treating "absent" as "stopped" would
// silently disable the whole tier on a host that omits it.
steer(undefined)
equal('host: an absent signal is not a stop', guardRuntime.state.steers.length, 2)

// ---- the sticky max-tokens end reason, through the whole tier ----------------
// A turn that really stopped short: keep-alive is off, so nothing rescued it and
// the closing step's own finish agrees with the turn-end reason.
const truncRuntime = makeRuntime({ autoContinue: true, maxConsecutive: 0, delayMs: 1, onMaxTokens: true, keepAliveOnMaxTokens: false })
hostModule.apply(truncRuntime.ctx, truncRuntime.live)
truncRuntime.agents.set('session-8', { id: 'session-8', followup: (message) => truncRuntime.state.followups.push(message), steer: () => {} })
truncRuntime.state.listeners.get('agent/assistant-stream')({ agent: { id: 'session-8' }, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } } })
truncRuntime.state.listeners.get('session/event')({ id: 'session-8' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'max-tokens' } } })
await truncRuntime.fireTimers()
equal('host: a genuinely truncated turn continues', truncRuntime.state.followups.length, 1)
equal('host: and the log line names the ceiling', host.planAutoContinue({ reason: 'max-tokens', truncated: true, config: host.resolveConfig({ autoContinue: true }), consecutive: 0 }).why, 'broken turn (max-tokens)')

// The rescue case: the closing step finished normally, so the turn wears the
// sticky reason but holds no unfinished work.
const rescuedRuntime = makeRuntime({ autoContinue: true, maxConsecutive: 0, delayMs: 1, onMaxTokens: true, keepAliveOnMaxTokens: true })
hostModule.apply(rescuedRuntime.ctx, rescuedRuntime.live)
rescuedRuntime.agents.set('session-9', { id: 'session-9', followup: (message) => rescuedRuntime.state.followups.push(message), steer: () => {} })
rescuedRuntime.state.listeners.get('agent/assistant-stream')({ agent: { id: 'session-9' }, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'stop' } } } })
rescuedRuntime.state.listeners.get('session/event')({ id: 'session-9' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'max-tokens' } } })
await rescuedRuntime.fireTimers()
equal('host: a rescued turn is not continued again', rescuedRuntime.state.followups.length, 0)

// No finish frame was ever observed: the durable reason is the only evidence, and
// abandoning a turn the log calls truncated is the worse failure.
const blindRuntime = makeRuntime({ autoContinue: true, maxConsecutive: 0, delayMs: 1, onMaxTokens: true })
hostModule.apply(blindRuntime.ctx, blindRuntime.live)
blindRuntime.agents.set('session-10', { id: 'session-10', followup: (message) => blindRuntime.state.followups.push(message), steer: () => {} })
blindRuntime.state.listeners.get('session/event')({ id: 'session-10' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'max-tokens' } } })
await blindRuntime.fireTimers()
equal('host: an unobserved closing step trusts the durable reason', blindRuntime.state.followups.length, 1)

// The cause switch still outranks the verdict.
const ceilingOff = makeRuntime({ autoContinue: true, maxConsecutive: 0, delayMs: 1, onMaxTokens: false })
hostModule.apply(ceilingOff.ctx, ceilingOff.live)
ceilingOff.agents.set('session-11', { id: 'session-11', followup: (message) => ceilingOff.state.followups.push(message), steer: () => {} })
ceilingOff.state.listeners.get('agent/assistant-stream')({ agent: { id: 'session-11' }, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } } })
ceilingOff.state.listeners.get('session/event')({ id: 'session-11' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'max-tokens' } } })
await ceilingOff.fireTimers()
equal('host: the ceiling cause can be excluded', ceilingOff.state.followups.length, 0)

// A human stop still outranks the ceiling reason.
const ceilingStop = makeRuntime({ autoContinue: true, maxConsecutive: 0, delayMs: 1, onMaxTokens: true, onAborted: true })
hostModule.apply(ceilingStop.ctx, ceilingStop.live)
ceilingStop.agents.set('session-12', { id: 'session-12', followup: (message) => ceilingStop.state.followups.push(message), steer: () => {} })
ceilingStop.state.listeners.get('agent/assistant-stream')({ agent: { id: 'session-12' }, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } } })
ceilingStop.state.listeners.get('session/event')({ id: 'session-12' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } } })
await ceilingStop.fireTimers()
equal('host: a user stop is not rescued by the ceiling tier', ceilingStop.state.followups.length, 0)

// The finish watcher is per session: one session's truncated step must not
// authorize a continuation of another session's turn.
const crossRuntime = makeRuntime({ autoContinue: true, maxConsecutive: 0, delayMs: 1, onMaxTokens: true })
hostModule.apply(crossRuntime.ctx, crossRuntime.live)
const crossContinued = []
for (const id of ['session-13', 'session-14']) {
  crossRuntime.agents.set(id, { id, followup: () => crossContinued.push(id), steer: () => {} })
}
crossRuntime.state.listeners.get('agent/assistant-stream')({ agent: { id: 'session-13' }, frame: { type: 'chunk', chunk: { type: 'finish', reason: { kind: 'max-tokens' } } } })
crossRuntime.state.listeners.get('session/event')({ id: 'session-14' }, { type: 'turn/end', data: { turn: 1, reason: { kind: 'max-tokens' } } })
await crossRuntime.fireTimers()
equal('host: another session\'s finish cannot authorize a continue', crossContinued.length, 1)
equal('host: and it is the ended session that continues', crossContinued.join(','), 'session-14')

// The verdict is consumed by the turn that ended: a later identical turn with no
// finish frame of its own must not reuse the previous turn's closing reason.
crossRuntime.state.listeners.get('session/event')({ id: 'session-13' }, { type: 'turn/end', data: { turn: 2, reason: { kind: 'max-tokens' } } })
await crossRuntime.fireTimers()
equal('host: the closing finish is cleared with the turn', crossContinued.join(','), 'session-14,session-13')


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
    if (selector === '[contenteditable="true"]') return node.attributes.contenteditable === 'true'
    if (selector === '[class*="_attachment"], [class*="_reference"], [class*="_chip"]') {
      return ['_attachment', '_reference', '_chip'].some((part) => className(node).includes(part))
    }
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
  // plugin's own round control, both inside the composer card. The editor is the
  // draft the takeover has to watch once it holds the button.
  const card = dom.make('div', { 'data-composer-card': 'true' })
  const editor = dom.make('div', { contenteditable: 'true' })
  const send = dom.make('button', { class: 'uV2eYG_primary', 'aria-label': '发送消息', disabled: 'true' })
  send.disabled = true
  const round = dom.make('button', { class: 'dyn-retry-round' })
  round.clicks = 0
  round.click = () => { round.clicks += 1 }
  card.append(editor)
  card.append(send)
  card.append(round)
  for (const node of [triggerRow, humanRow, steerRow, foreignTrigger, foreignContext, nav, card]) dom.document.body.append(node)
  return { dom, triggerRow, humanRow, steerRow, foreignTrigger, foreignContext, nav, marks, mark7, mark6, mark5, card, editor, send, round }
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
// A settled retry row is not this plugin's markup, so the rule names the product's
// flow kind — and only the settled half of it: a retry waiting out its backoff is
// `scheduled` and carries `data-active`, and that countdown is what the user asked
// to see.
equal('dom: the settled retry rule rides the conditional sheet', hideDom.dom.styles()[1].textContent.includes('[data-chat-flow-kind="model-retry"]:not(:has(details[data-active]))'), true)
equal('dom: and it leaves the live countdown alone', hideDom.dom.styles()[1].textContent.includes('details[data-active] { display: none'), false)

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
// The round control follows the product's own verdict: it is hidden whenever the
// composer holds something to send, so a continuation is never offered next to a
// message that is about to go out. One rule in the always-injected stylesheet
// covers both cases (a typed message enables the primary; the takeover clears its
// `disabled`), and it needs no keystroke bookkeeping of its own.
equal('send: the round control steps aside while the composer has something to send', hideDom.dom.styles()[0].textContent.includes(":has(button[class*='_primary']:not([disabled])) .dyn-retry-round"), true)

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

// A cut-off answer is the break the composer could not see before: the turn
// reports `max-tokens`, and the closing step's own durable finish is what proves
// the answer really stopped mid-sentence. That case must offer the continuation.
const truncatedDom = transcriptDom()
const truncatedWindow = windowOf([start(3, 300), human('write the report'), assistantStep('max-tokens'), end('max-tokens')])
const truncatedRuntime = makeClientRuntime(truncatedDom.dom, { hideContinueRow: true, continuedRailMarks: 'hide', sendBecomesContinue: true }, truncatedWindow)
clientBundleExports.apply(truncatedRuntime.ctx)
truncatedRuntime.flush()
truncatedRuntime.mountControl()
truncatedRuntime.flush()
equal('truncated: the shipped button carries the continuation', truncatedDom.send.getAttribute('data-dyn-continue'), '1')
equal('truncated: it announces the continuation', truncatedDom.send.getAttribute('aria-label'), '继续上次任务')
equal('truncated: and the tooltip names the output ceiling', (truncatedDom.send.getAttribute('title') ?? '').includes('输出上限'), true)

// …and must stay quiet when tier 2 already carried that same turn to completion:
// the end reason is identical, only the closing step differs.
const rescuedDom = transcriptDom()
const rescuedWindow = windowOf([start(3, 300), human('write the report'), assistantStep('max-tokens'), assistantStep('stop'), end('max-tokens')])
const rescuedTurnRuntime = makeClientRuntime(rescuedDom.dom, { hideContinueRow: true, continuedRailMarks: 'hide', sendBecomesContinue: true }, rescuedWindow)
clientBundleExports.apply(rescuedTurnRuntime.ctx)
rescuedTurnRuntime.flush()
rescuedTurnRuntime.mountControl()
rescuedTurnRuntime.flush()
equal('rescued: the shipped button stays the send button', rescuedDom.send.getAttribute('data-dyn-continue'), null)
equal('rescued: and keeps its own label', rescuedDom.send.getAttribute('aria-label'), '发送消息')

// ---- two composer surfaces in one document ----------------------------------
// The shipped product renders one card per conversation, and the layout mounts
// the centre panel through the keyed `main` slot, so two cards is not today's
// shape. It is the shape this pass must not mis-handle the day it arrives: with
// one plugin-wide `affordance` and a document-wide button sweep, nothing here can
// tell which card belongs to which session.
//
// Two cards, each with its own primary control and its own round control. The
// plugin must (a) dress neither send button, and (b) never resolve a click by
// reaching into the other card.
function twoComposerDom() {
  const fixture = transcriptDom()
  const second = fixture.dom.make('div', { 'data-composer-card': 'true' })
  const secondSend = fixture.dom.make('button', { class: 'uV2eYG_primary', 'aria-label': '发送消息' })
  secondSend.disabled = true
  const secondRound = fixture.dom.make('button', { class: 'dyn-retry-round' })
  secondRound.clicks = 0
  secondRound.click = () => { secondRound.clicks += 1 }
  second.append(fixture.dom.make('div', { contenteditable: 'true' }))
  second.append(secondSend)
  second.append(secondRound)
  fixture.dom.document.body.append(second)
  return { fixture, second, secondSend, secondRound }
}

const twoDom = twoComposerDom()
const twoRuntime = makeClientRuntime(twoDom.fixture.dom, { hideContinueRow: true, continuedRailMarks: 'hide', sendBecomesContinue: true }, continuationWindow)
clientBundleExports.apply(twoRuntime.ctx)
twoRuntime.flush()
twoRuntime.mountControl({}, 's1')
twoRuntime.flush()
equal('two cards: the plugin sees both', twoDom.fixture.dom.document.querySelectorAll('[data-composer-card]').length, 2)
equal('two cards: the first send button is left alone', twoDom.fixture.send.getAttribute('data-dyn-continue'), null)
equal('two cards: the second send button is left alone', twoDom.secondSend.getAttribute('data-dyn-continue'), null)
equal('two cards: and neither is re-labelled', twoDom.secondSend.getAttribute('aria-label'), '发送消息')
// The per-session round control is scoped by its own slot, so the stand-down
// leaves it alone: it stays in the DOM as the affordance that always works, and
// each card's control resolves inside its own card.
equal('two cards: each card keeps its own round control', twoDom.fixture.card.querySelector('.dyn-retry-round') === twoDom.fixture.round, true)
equal('two cards: and the second card keeps its own', twoDom.second.querySelector('.dyn-retry-round') === twoDom.secondRound, true)

// A click that lands on a taken-over button while a second card exists must still
// resolve inside its own card. This is the case the document-wide query got
// wrong: it clicked whichever `.dyn-retry-round` came first in the document.
const twoCapture = [...(twoDom.fixture.dom.documentListeners.get('click') ?? [])]
globalThis.document = twoDom.fixture.dom.document
// Dress the second card's button by hand: the stand-down leaves real buttons
// bare, so this is the one state the guard has to survive — an attribute written
// while single, still present when a second surface appears.
twoDom.secondSend.setAttribute('data-dyn-continue', '1')
const twoFlags = { prevented: 0, stopped: 0 }
twoCapture[0]({
  target: twoDom.secondSend,
  preventDefault: () => { twoFlags.prevented += 1 },
  stopPropagation: () => { twoFlags.stopped += 1 },
  stopImmediatePropagation: () => { twoFlags.stopped += 1 },
})
equal('two cards: the click runs the clicked card\'s own control', twoDom.secondRound.clicks, 1)
equal('two cards: and never the other card\'s', twoDom.fixture.round.clicks, 0)
equal('two cards: the click still does not submit', twoFlags.prevented, 1)

// With one card, the same click resolves to that card's own control — the
// behaviour the scoped lookup has to preserve.
const scopeDom = transcriptDom()
const scopeRuntime = makeClientRuntime(scopeDom.dom, { hideContinueRow: true, continuedRailMarks: 'hide', sendBecomesContinue: true }, continuationWindow)
clientBundleExports.apply(scopeRuntime.ctx)
scopeRuntime.flush()
scopeRuntime.mountControl({}, 's1')
scopeRuntime.flush()
const scopeCapture = [...(scopeDom.dom.documentListeners.get('click') ?? [])]
globalThis.document = scopeDom.dom.document
scopeCapture[0]({
  target: scopeDom.send,
  preventDefault: () => {},
  stopPropagation: () => {},
  stopImmediatePropagation: () => {},
})
equal('one card: the scoped lookup still runs the control', scopeDom.round.clicks, 1)
equal('one card: the takeover is still offered', scopeDom.send.getAttribute('data-dyn-continue'), '1')

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

// ---- the takeover must not outlive the empty composer ------------------------
// Reported: with the turn stopped, the composer showed the orange continue control
// *while the human's message sat in it*, so clicking continued the old task instead
// of sending. The takeover clears the product's own `disabled`, which is why the
// draft itself has to be re-read — a held button that never lets go is worse than
// no takeover at all.
const stickyDom = transcriptDom()
const stickyRuntime = makeClientRuntime(stickyDom.dom, { hideContinueRow: true, continuedRailMarks: 'hide', sendBecomesContinue: true }, continuationWindow)
clientBundleExports.apply(stickyRuntime.ctx)
stickyRuntime.flush()
stickyRuntime.mountControl()
stickyRuntime.flush()
equal('sticky: taken while the composer is empty', stickyDom.send.getAttribute('data-dyn-continue'), '1')
// The human types. The product re-renders on every keystroke and re-applies its own
// verdict (`disabled = empty`), which the stub mirrors — and the takeover must let
// go on the next pass and give the label back.
const typeDraft = (text) => {
  stickyDom.editor.textContent = text
  const empty = text.replace(/[\u200b\u200c\ufeff]/g, '').trim() === ''
  stickyDom.send.disabled = empty
}
typeDraft('帮我写一个对话历史管理插件')
stickyRuntime.sweep()
stickyRuntime.flush()
equal('sticky: typing hands the button straight back', stickyDom.send.getAttribute('data-dyn-continue'), null)
equal('sticky: with the product\'s own label', stickyDom.send.getAttribute('aria-label'), '发送消息')
equal('sticky: and the human\'s message stays sendable', stickyDom.send.disabled, false)
// Clearing the draft again re-offers it — the gate is the draft, not a one-way door.
typeDraft('')
stickyRuntime.sweep()
stickyRuntime.flush()
equal('sticky: an empty composer offers it again', stickyDom.send.getAttribute('data-dyn-continue'), '1')
// And even inside one debounce window — typed, not yet swept — the click itself
// must reach the product instead of running the continuation.
typeDraft('新的一段话')
const stickyCapture = [...(stickyDom.dom.documentListeners.get('click') ?? [])]
const stickyFlags = { prevented: 0 }
globalThis.document = stickyDom.dom.document
const beforeClicks = stickyDom.round.clicks
stickyCapture[0]({
  target: stickyDom.send,
  preventDefault: () => { stickyFlags.prevented += 1 },
  stopPropagation: () => {},
  stopImmediatePropagation: () => {},
})
equal('sticky: a click with a draft is never intercepted', stickyFlags.prevented, 0)
equal('sticky: and never continues the old task', stickyDom.round.clicks, beforeClicks)
// The editor's zero-width padding is not a draft.
typeDraft('\u200b')
stickyRuntime.sweep()
stickyRuntime.flush()
equal('sticky: zero-width padding still counts as empty', stickyDom.send.getAttribute('data-dyn-continue'), '1')

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
// The round control's "step aside" rule is not gated on a setting: it follows the
// product's primary control, and it lives in the always-injected stylesheet.
equal('dom: the step-aside rule is always injected', showDom.dom.styles()[0].textContent.includes(":has(button[class*='_primary']:not([disabled]))"), true)
equal('dom: and the conditional sheet only carries the row rule', conditionalRule.includes("_primary"), false)
equal('dom: the rows are still tagged, so the rail still knows them', showDom.dom.document.querySelectorAll('[data-dyn-restart-row]').length, 2)
equal('dom: the rail mark is still hidden in hide mode', showDom.mark7.getAttribute('data-dyn-continued'), 'hide')

// ---- retry receipts: gated on the boost, not on the row switch -----------------
// Hiding a retry record is only this plugin's business while this plugin is the
// one that widened the budget. With the boost off those retries are the product's
// own, and the rule must not be written at all.
const ownBudgetDom = transcriptDom()
const ownBudgetRuntime = makeClientRuntime(ownBudgetDom.dom, { retryFailedRequests: false, hideSettledRetry: true }, continuationWindow)
clientBundleExports.apply(ownBudgetRuntime.ctx)
ownBudgetRuntime.flush()
equal('retry rows: not hidden while the product owns the budget', ownBudgetDom.dom.styles()[1].textContent.includes('model-retry'), false)

const keepReceiptsDom = transcriptDom()
const keepReceiptsRuntime = makeClientRuntime(keepReceiptsDom.dom, { retryFailedRequests: true, hideSettledRetry: false }, continuationWindow)
clientBundleExports.apply(keepReceiptsRuntime.ctx)
keepReceiptsRuntime.flush()
equal('retry rows: the switch brings the receipt back', keepReceiptsDom.dom.styles()[1].textContent.includes('model-retry'), false)
equal('retry rows: and the row rule is unaffected', keepReceiptsDom.dom.styles()[1].textContent.includes('data-dyn-restart-row'), true)

// ------------------------------------------------------------------------ report
if (failures.length > 0) {
  console.error('FAILED — ' + failures.length + ' of ' + (passed + failures.length) + ' assertions')
  for (const failure of failures) console.error('  ✗ ' + failure)
  process.exit(1)
}
console.log('ok — ' + passed + ' assertions passed (rules, wiring, host behaviour, transcript)')
