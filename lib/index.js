/**
 * Host half of dsh-restart-task.
 *
 * Everything here is host-side because it needs the live Agent, the session
 * event stream, and the live configuration the settings card edits.
 *
 * ## Configuration (DSH 0.1.7 and later)
 *
 * There is no settings *namespace* to register any more: the retired
 * `settings.register(namespace, schema, { applies: 'live' })` seam was replaced
 * by the configuration form, which projects the plugin's **own profile entry**.
 * So this half declares the policy as `Config` and marks every editable field
 * `.volatile()`:
 *
 * - The loader resolves the entry's configuration into a live reference per
 *   volatile field, and `apply(ctx, config)` receives it: `config.<field>.get()`
 *   is the current value, updated in place when the card writes, with no plugin
 *   restart. `liveConfig` below performs those reads, and it also accepts plain
 *   values so the same code still works on a host that does not know volatile
 *   fields.
 * - The identity a form addresses is the **profile entry id** this package's
 *   `cordis.patch.yml` inserts (`restart-task`), not a namespace this plugin
 *   chooses. The browser half spells that string again, because a client bundle
 *   cannot import a host module; the regression harness asserts the two agree
 *   with the patch file.
 * - `settings.configure({ auto: false }, ctx.fiber)` records that this plugin
 *   ships its own page, so the host does not also auto-generate one. It is
 *   registered from an optional `settings` child, so a composition without the
 *   settings domain still runs the recovery tiers.
 *
 * Three recovery paths, deliberately different in what they leave behind:
 *
 * 1. **In-turn retry (default on, invisible).** `agent/request-error` is a
 *    waterfall: returning `{ kind: 'retry' }` makes the loop retry the *same*
 *    step in place. Nothing is appended to the session — no instruction, no
 *    extra turn — so a recovered request leaves the transcript exactly as if it
 *    had succeeded the first time. Terminal client errors (4xx except 429) are
 *    not retried, and the retry budget can be set to unlimited instead.
 *
 * 2. **In-turn keep-alive (default on, no new round).** When a step ends
 *    because the model ran into its output ceiling, the turn is *about to*
 *    close. `agent/turn-stopping` is the boundary where a listener may object:
 *    `agent.steer(...)` puts fresh input in the inbox before the boundary
 *    commits, and the loop runs another step **inside the same turn** — the
 *    round count and the rail do not move. The steered instruction is a
 *    plugin-sourced message, so it renders as one collapsed row, never as a
 *    user bubble.
 *
 * 3. **New continuation turn (default off, visible).** When a turn really ended
 *    broken (`aborted` / `error` / `interrupted`), it is durably closed; the
 *    only way to give the model more work is a new turn, which necessarily
 *    adds one collapsed context row. That is why it is off by default, and why
 *    the composer's round control does the same thing on demand.
 *
 *    One exception outranks every setting here: a turn the **human** stopped is
 *    never continued. The stop control cancels with `{ kind: 'user' }`, the loop
 *    parks that cause on the aborted turn/end reason, and `isUserStop` reads it —
 *    so pressing stop means stop, whatever the settings say.
 *
 * Plugin-sourced matters for paths 2 and 3: a `user/message` whose
 * `source.kind` is not `'user'` renders as a collapsed context row, never as a
 * user bubble — so continuing never re-displays what the user already sent, and
 * never duplicates a prompt in the model history.
 *
 * The kind itself must be THIS producer's own name (`'dsh-restart-task'`).
 * Session format v4 requires a producer-owned source kind and refuses the
 * retired plugin-namespace wrapper (a plugin source kind plus a plugin field)
 * on newly written messages; that shape is only lifted by the v3→v4 conversion
 * of already-stored history. Regressing to it fails the whole turn with
 * `format v4 message requires a producer-owned source kind`, because the
 * continuation message is appended before the step can run.
 */

import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'

export const name = 'restart-task'

export const inject = ['commands']

/**
 * The bundle's package name. It is how the browser half's contribution to the
 * Plugins page is keyed: that page keys a bundle's own configuration page by the
 * bundle's package name, which is not necessarily the entry id below.
 */
export const BUNDLE_NAME = 'dsh-restart-task'

/**
 * The profile entry id this package's `cordis.patch.yml` inserts, and therefore
 * the identity every settings form addresses: the configuration form keys its
 * descriptors by `entry.options.id`. Rename the row in `cordis.patch.yml` and
 * this constant (and `ENTRY_ID` in `lib/client.js`) must move with it.
 */
export const ENTRY_ID = 'restart-task'

/**
 * The `source.kind` this plugin stamps on the messages it appends. Session
 * format v4 requires a *producer-owned* kind — the producer's own name — and
 * refuses the retired plugin-namespace wrapper, so this is also the string Chat
 * renders as the row's provenance label.
 */
export const SOURCE_KIND = 'dsh-restart-task'

/**
 * The session-projection key carrying the rounds this plugin opened.
 *
 * The rail shows every round of a session, while the browser half only ever holds
 * a *paged* event window: a round whose events are outside the loaded page (or
 * folded away) is invisible to the client, and its rail mark then keeps showing
 * the anonymous `第 N 轮` card. So the host publishes what it can compute from the
 * whole log through the projection seam, which is delivered to clients whole —
 * `lib/client.js` spells this same key and unions its value into the rounds it
 * attributes from the window.
 */
export const ROUNDS_KEY = 'restartTaskRounds'

/** Shown as the collapsed row's one-line account (never expanded by default). */
const CONTINUE_SUMMARY = '继续上次中断的任务'

// #region auto-logic
/**
 * The producer kind, spelled again inside this region so the pure fold can be
 * sliced out and asserted without the module's exports. The harness pins the two
 * spellings together.
 */
const OWN_SOURCE_KIND = 'dsh-restart-task'

/**
 * The fold behind the `ROUNDS_KEY` projection: which rounds this plugin opened,
 * computed from the **whole** durable log rather than from a client's page.
 *
 * The rule is the one the browser half applies to its window — a turn's input is
 * appended after its `turn/start`, so a message opens the round it lands in
 * exactly when it is that turn's first input — and it is stated once here, over
 * every event, because that is the only place where "every event" is available.
 * State is plain JSON so the projection cache can persist it, and an event that
 * changes nothing returns the same reference (the seam's identity gate).
 *
 * @param state - `{ rounds, turn, spoken }`, where `spoken` means the turn in
 *   force has already taken an input.
 * @param event - one committed session event.
 * @returns the next state.
 */
function foldRounds(state, event) {
  if (event === null || typeof event !== 'object' || typeof event.type !== 'string') return state
  if (event.type === 'turn/start') {
    const turn = event.data !== null && typeof event.data === 'object' ? event.data.turn : undefined
    if (typeof turn !== 'number') return state
    if (state.turn === turn && state.spoken === false) return state
    return { rounds: state.rounds, turn: turn, spoken: false }
  }
  if (event.type === 'turn/end') {
    return state.spoken === true ? state : { rounds: state.rounds, turn: state.turn, spoken: true }
  }
  if (event.type !== 'user/message') return state
  // Whatever it is, this message took the turn's opening slot.
  if (state.spoken === true) return state
  const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
  const source = data.source !== null && typeof data.source === 'object' ? data.source : {}
  const kind = typeof source.kind === 'string' ? source.kind : ''
  if (kind === OWN_SOURCE_KIND && state.turn > 0 && state.rounds.indexOf(state.turn) < 0) {
    return { rounds: state.rounds.concat([state.turn]), turn: state.turn, spoken: true }
  }
  return { rounds: state.rounds, turn: state.turn, spoken: true }
}

/**
 * Model-facing instruction, and the default for the `continueText` setting. The
 * interrupted turn and its partial output are already in history, so this only
 * has to tell the model to pick up from there instead of starting over.
 */
const DEFAULT_CONTINUE_TEXT = [
  '上一条助手回复被中断或请求失败。请从中断处继续完成这个任务：',
  '已经输出过的内容不要重复，已经做过的步骤不要重做；',
  '如果此前没有产生有效输出，就直接把任务完成。不需要复述我最初的要求。',
].join('')

/** Turn-end reasons that leave work on the table. */
const BROKEN_REASONS = ['aborted', 'error', 'interrupted']

/** Step finish reason that means the model was cut off mid-answer. */
const TRUNCATED_FINISH = 'max-tokens'

/**
 * How the browser half may present a round this plugin opened through the new-turn
 * tier. The value is only carried here so the settings document validates it and a
 * hand-edited file cannot smuggle an unknown mode into the card.
 */
const RAIL_MARK_MODES = ['hide', 'preview', 'keep']

/**
 * Field defaults the planners fall back to. They mirror the schema defaults
 * below on purpose: a planner handed a partial config must reach the same
 * decision as the runner, and `resolveConfig` fills these before it runs.
 *
 * Opt-in and opt-out are spelled out per field rather than shared, because the
 * two kinds of field are genuinely different: a switch that enables a recovery
 * path reads `=== true` (absent means off), while a switch that *excludes* one
 * cause reads `=== false` (absent means on). Keeping each check on the side its
 * own default implies is what makes a partial config behave like the schema.
 */
const FIELD_DEFAULTS = {
  maxRequestRetries: 3,
  retryBaseDelayMs: 2000,
  maxTurnContinues: 5,
  maxConsecutive: 3,
}

/**
 * Every field the `Config` schema declares, in card order. `liveConfig` reads
 * through this list, and the regression harness uses it to keep the schema, the
 * card and this reader from drifting apart.
 */
const CONFIG_FIELDS = [
  'retryFailedRequests',
  'maxRequestRetries',
  'retryForever',
  'retryBaseDelayMs',
  'keepAliveOnMaxTokens',
  'maxTurnContinues',
  'autoContinue',
  'maxConsecutive',
  'delayMs',
  'onAborted',
  'onError',
  'onInterrupted',
  'sendBecomesContinue',
  'hideContinueRow',
  'continuedRailMarks',
  'continueText',
]

/**
 * Read the live configuration `apply` was handed as plain data.
 *
 * A volatile field arrives as a reference (`{ get() }`) whose value the loader
 * updates in place, so reading it here is what makes the card's write visible to
 * the next break with no restart. A host that does not know volatile fields hands
 * the value itself; both shapes are accepted, and an unknown field is simply
 * absent, which `resolveConfig` then fills from the defaults.
 *
 * @param config - the resolved plugin configuration, volatile references or plain.
 * @returns one plain value per declared field.
 */
function liveConfig(config) {
  const source = config !== null && typeof config === 'object' ? config : {}
  const out = {}
  for (let i = 0; i < CONFIG_FIELDS.length; i += 1) {
    const field = CONFIG_FIELDS[i]
    const value = source[field]
    out[field] = value !== null && typeof value === 'object' && typeof value.get === 'function'
      ? value.get()
      : value
  }
  return out
}

/**
 * Decide whether to retry the failed model request **inside the current step**.
 * Pure — the caller supplies the config, the HTTP status and the attempts used.
 *
 * Deterministic failures are refused before any budget is consulted: a 4xx
 * (429 excepted) will not fix itself by being sent again, and an unlimited
 * budget must not turn it into an infinite loop.
 *
 * @param input.config - resolved configuration (`resolveConfig` output).
 * @param input.status - provider HTTP status when the failure carried one.
 * @param input.used - in-turn retries this plugin already spent on that step.
 * @returns whether to retry, after how long, and why.
 */
function planRequestRetry(input) {
  const config = input.config
  if (config.retryFailedRequests === false) return { ok: false, delayMs: 0, why: 'in-turn retry is off' }
  // A 4xx (except 429) will not fix itself by being sent again.
  if (typeof input.status === 'number' && input.status >= 400 && input.status < 500 && input.status !== 429) {
    return { ok: false, delayMs: 0, why: 'terminal client error ' + input.status }
  }
  const limit = typeof config.maxRequestRetries === 'number' ? config.maxRequestRetries : FIELD_DEFAULTS.maxRequestRetries
  const used = typeof input.used === 'number' ? input.used : 0
  const unlimited = config.retryForever === true
  if (unlimited !== true) {
    if (limit <= 0) return { ok: false, delayMs: 0, why: 'retry limit is 0' }
    if (used >= limit) return { ok: false, delayMs: 0, why: 'retry limit ' + limit + ' reached' }
  }
  const base = typeof config.retryBaseDelayMs === 'number' ? config.retryBaseDelayMs : FIELD_DEFAULTS.retryBaseDelayMs
  const growth = Math.pow(2, used)
  const delayMs = Math.min(base * growth, 60000)
  return {
    ok: true,
    delayMs: delayMs,
    why: 'in-turn retry ' + (used + 1) + (unlimited === true ? ' (unlimited)' : '/' + limit),
  }
}

/**
 * Decide whether a turn that is about to close should be kept open instead.
 * Pure — the caller supplies the config, the last step's finish reason and the
 * continuations already spent inside that turn.
 *
 * @param input.finishKind - finish reason of the last completed step.
 * @param input.config - resolved configuration (`resolveConfig` output).
 * @param input.used - in-turn continuations already spent on that turn.
 * @returns whether to steer another step into the same turn, and why.
 */
function planKeepAlive(input) {
  const config = input.config
  if (config.keepAliveOnMaxTokens === false) return { ok: false, why: 'in-turn keep-alive is off' }
  if (input.finishKind !== TRUNCATED_FINISH) {
    return { ok: false, why: 'last step did not hit the output ceiling' }
  }
  const limit = typeof config.maxTurnContinues === 'number' ? config.maxTurnContinues : FIELD_DEFAULTS.maxTurnContinues
  const used = typeof input.used === 'number' ? input.used : 0
  if (limit > 0 && used >= limit) return { ok: false, why: 'in-turn continue limit ' + limit + ' reached' }
  return { ok: true, why: 'output ceiling reached' }
}

/**
 * Whether one `turn/end` cancel cause is the human asking to stop.
 *
 * A human stop is never a failure to recover from. The loop records the exact
 * cause it was cancelled with (`agent.cancel({ kind: 'user' })` is what the
 * composer's stop control sends) and parks it on the aborted turn/end reason,
 * so the durable log carries the answer. Pure — takes that cause value.
 *
 * @param cause - the `reason` field of an `aborted` turn/end reason.
 * @returns whether the human asked for this stop.
 */
function isUserStop(cause) {
  if (cause === null || cause === undefined) return false
  if (typeof cause === 'string') return cause === 'user'
  if (typeof cause !== 'object') return false
  return cause.kind === 'user'
}

/**
 * Decide whether one broken turn end should be followed by a new continuation
 * turn. Pure — the caller supplies reason, config and current streak.
 *
 * @param input.reason - the last `turn/end` reason kind.
 * @param input.userStop - whether that reason's cause is a human stop.
 * @param input.config - resolved configuration (`resolveConfig` output).
 * @param input.consecutive - continuations already run for that session.
 * @returns whether to continue, and why (the reason is also the log line).
 */
function planAutoContinue(input) {
  const config = input.config
  const reason = typeof input.reason === 'string' ? input.reason : ''
  // An explicit stop outranks every setting: the human said "no more work", and
  // an automatic continuation would look exactly like ignoring the button.
  if (input.userStop === true) return { ok: false, why: 'the user stopped the turn' }
  if (config.autoContinue !== true) return { ok: false, why: 'turn-level auto-continue is off' }
  if (BROKEN_REASONS.indexOf(reason) < 0) return { ok: false, why: 'reason "' + reason + '" is not broken' }
  if (reason === 'aborted' && config.onAborted === false) return { ok: false, why: 'aborted is not enabled' }
  if (reason === 'error' && config.onError === false) return { ok: false, why: 'error is not enabled' }
  if (reason === 'interrupted' && config.onInterrupted === false) return { ok: false, why: 'interrupted is not enabled' }
  const limit = typeof config.maxConsecutive === 'number' ? config.maxConsecutive : FIELD_DEFAULTS.maxConsecutive
  const consecutive = typeof input.consecutive === 'number' ? input.consecutive : 0
  if (limit > 0 && consecutive >= limit) return { ok: false, why: 'consecutive limit ' + limit + ' reached' }
  return { ok: true, why: 'broken turn (' + reason + ')' }
}

/**
 * Normalize one live configuration value into what the runner reads. Every field
 * is checked here rather than trusted, so a hand-edited profile patch cannot
 * make the runner throw.
 */
function resolveConfig(value) {
  const source = value !== null && typeof value === 'object' ? value : {}
  const text = typeof source.continueText === 'string' && source.continueText.trim() !== ''
    ? source.continueText
    : DEFAULT_CONTINUE_TEXT
  return {
    retryFailedRequests: source.retryFailedRequests !== false,
    maxRequestRetries: typeof source.maxRequestRetries === 'number' ? source.maxRequestRetries : 3,
    retryForever: source.retryForever === true,
    retryBaseDelayMs: typeof source.retryBaseDelayMs === 'number' ? source.retryBaseDelayMs : 2000,
    keepAliveOnMaxTokens: source.keepAliveOnMaxTokens !== false,
    maxTurnContinues: typeof source.maxTurnContinues === 'number' ? source.maxTurnContinues : 5,
    autoContinue: source.autoContinue === true,
    maxConsecutive: typeof source.maxConsecutive === 'number' ? source.maxConsecutive : 3,
    delayMs: typeof source.delayMs === 'number' ? source.delayMs : 1500,
    onAborted: source.onAborted !== false,
    onError: source.onError !== false,
    onInterrupted: source.onInterrupted !== false,
    hideContinueRow: source.hideContinueRow !== false,
    continuedRailMarks: RAIL_MARK_MODES.indexOf(source.continuedRailMarks) >= 0 ? source.continuedRailMarks : 'hide',
    continueText: text,
  }
}
// #endregion auto-logic

/**
 * The policy every recovery path reads, and the settings card's form.
 *
 * Every field is `.volatile()`: the loader hands `apply` a live reference per
 * field, so a card write is visible to the next break without restarting the
 * plugin. Fields are flat scalars on purpose — a volatile field must sit at a
 * fixed object path, and the form edits one field at a time.
 *
 * The export must be named exactly `Config`: that is the name the loader reads
 * the plugin's schema under, and the settings form refuses an entry whose plugin
 * has none.
 */
export const Config = z.object({
  retryFailedRequests: z.boolean().default(true).volatile(),
  maxRequestRetries: z.natural().max(50).default(3).volatile(),
  retryForever: z.boolean().default(false).volatile(),
  retryBaseDelayMs: z.natural().max(60000).default(2000).volatile(),
  keepAliveOnMaxTokens: z.boolean().default(true).volatile(),
  maxTurnContinues: z.natural().max(50).default(5).volatile(),
  autoContinue: z.boolean().default(false).volatile(),
  maxConsecutive: z.natural().max(50).default(3).volatile(),
  delayMs: z.natural().max(60000).default(1500).volatile(),
  onAborted: z.boolean().default(true).volatile(),
  onError: z.boolean().default(true).volatile(),
  onInterrupted: z.boolean().default(true).volatile(),
  sendBecomesContinue: z.boolean().default(true).volatile(),
  hideContinueRow: z.boolean().default(true).volatile(),
  continuedRailMarks: z.string().default('hide').volatile(),
  continueText: z.string().default(DEFAULT_CONTINUE_TEXT).volatile(),
})

/** One fresh plugin-sourced continuation message. */
function continueMessage(text) {
  const body = typeof text === 'string' && text.trim() !== '' ? text : DEFAULT_CONTINUE_TEXT
  return Object.freeze({
    id: crypto.randomUUID(),
    role: 'user',
    content: Object.freeze([Object.freeze({ type: 'text', text: body })]),
    // Session format v4 requires a *producer-owned* source kind: this plugin's
    // own name. The retired plugin-namespace wrapper (kind `plugin` plus a
    // `plugin` field) is only lifted by the v3→v4 edge for already-stored
    // history; writing it here fails the whole turn with
    // `format v4 message requires a producer-owned source kind`.
    source: Object.freeze({
      kind: SOURCE_KIND,
      form: 'notice',
      summary: CONTINUE_SUMMARY,
    }),
  })
}

function describeError(error) {
  if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
  return String(error)
}

/** Read the `finish` chunk of one assistant-stream frame, when it carries one. */
function finishKindOf(frame) {
  if (frame === null || typeof frame !== 'object' || frame.type !== 'chunk') return undefined
  const chunk = frame.chunk
  if (chunk === null || typeof chunk !== 'object' || chunk.type !== 'finish') return undefined
  const reason = chunk.reason
  if (reason === null || typeof reason !== 'object' || typeof reason.kind !== 'string') return undefined
  return reason.kind
}

/**
 * Persisted state of the `ROUNDS_KEY` projection. Plain JSON, because the seam
 * caches raw state rows and re-seeds a fold from them after a restart.
 */
const roundsStateSchema = zod.object({
  rounds: zod.array(zod.number().int().nonnegative()),
  turn: zod.number().int().nonnegative(),
  spoken: zod.boolean(),
})

/** What the client receives for `ROUNDS_KEY`: the rounds, ascending. */
const roundsViewSchema = zod.array(zod.number().int().nonnegative())

export function apply(ctx, config) {
  // ---- the manual command the composer control calls -----------------------
  ctx.effect(() => ctx.commands.register({
    name: 'continue-task',
    description: '继续上一次被中断或失败的任务（不重复用户消息）',
    handler: (invocation) => {
      try {
        invocation.agent.followup(continueMessage(null))
      } catch (error) {
        return { kind: 'error', text: '继续失败：' + describeError(error) }
      }
      return { kind: 'success', text: '已继续上一次任务' }
    },
  }), 'restart-task: continue-task command')

  // The card is this plugin's own page, so the host must not also generate a
  // settings page for the entry. `auto: false` records that, and the policy has
  // to name the plugin's own fiber — the form resolves it per entry. Optional:
  // a composition without the settings domain still runs all three tiers.
  ctx.inject(['settings'], (sctx) => {
    sctx.effect(() => sctx.settings.configure({ auto: false }, ctx.fiber), 'restart-task: owns its settings page')
  })

  // ---- publish the rounds this plugin opened, whole-session ---------------
  // The rail lists every round of a session, but a client only ever holds a paged
  // event window: a round outside the loaded page is invisible to the browser half,
  // which would leave its `第 N 轮` mark showing. The projection seam folds the
  // *whole* log, and the API layer delivers every registered key to the client
  // wholesale, so this is what lets the browser half know a round is this plugin's
  // even when none of its events are loaded. Optional: a composition without the
  // seam keeps the window-derived attribution it had.
  ctx.inject(['sessionProjections'], (pctx) => {
    if (pctx.sessionProjections === undefined || typeof pctx.sessionProjections.register !== 'function') return
    pctx.effect(() => pctx.sessionProjections.register({
      key: ROUNDS_KEY,
      stateVersion: 1,
      stateSchema: roundsStateSchema,
      init: () => ({ rounds: [], turn: 0, spoken: true }),
      apply: foldRounds,
      wire: {
        viewSchema: roundsViewSchema,
        view: (state) => state.rounds,
      },
    }), 'restart-task: rounds projection')
  })

  ctx.inject(['agents', 'timer'], (actx) => {
    // Live configuration: one read per decision, through the volatile
    // references the loader handed `apply`.
    const readConfig = () => resolveConfig(liveConfig(config))
    /** sessionId → in-turn retries already spent, keyed by `turn:step`. */
    const spent = new Map()
    /** sessionId → continuations run since the last human turn. */
    const streaks = new Map()
    /** sessionId → pending delayed continuation timer. */
    const timers = new Map()
    /** sessionId → finish reason of that agent's most recent step. */
    const lastFinish = new Map()
    /** sessionId → { turn, used } in-turn keep-alives spent on the open turn. */
    const keepAlives = new Map()

    /** Sleep that resolves `true` when the turn was aborted while waiting. */
    function waitForRetry(delayMs, signal) {
      return new Promise((resolve) => {
        if (signal !== undefined && signal !== null && signal.aborted === true) {
          resolve(true)
          return
        }
        let settled = false
        let dispose = () => {}
        const finish = (aborted) => {
          if (settled === true) return
          settled = true
          try { dispose() } catch (error) { void error }
          if (signal !== undefined && signal !== null && typeof signal.removeEventListener === 'function') {
            signal.removeEventListener('abort', onAbort)
          }
          resolve(aborted)
        }
        const onAbort = () => finish(true)
        dispose = actx.timeout(() => finish(false), delayMs)
        if (signal !== undefined && signal !== null && typeof signal.addEventListener === 'function') {
          signal.addEventListener('abort', onAbort)
        }
      })
    }

    function cancel(id) {
      const dispose = timers.get(id)
      if (dispose === undefined) return
      timers.delete(id)
      try {
        dispose()
      } catch (error) {
        void error
      }
    }

    /** Human activity or a good turn clears the streak and any pending timer. */
    function reset(id) {
      cancel(id)
      streaks.delete(id)
    }

    function schedule(id, reason, userStop) {
      const config = readConfig()
      const plan = planAutoContinue({
        reason: reason,
        config: config,
        consecutive: streaks.get(id) ?? 0,
        userStop: userStop === true,
      })
      if (plan.ok !== true) return
      cancel(id)
      timers.set(id, actx.timeout(() => {
        timers.delete(id)
        const agent = actx.agents.get(id)
        if (agent === undefined || agent === null) return
        const current = readConfig()
        streaks.set(id, (streaks.get(id) ?? 0) + 1)
        try {
          agent.followup(continueMessage(current.continueText))
        } catch (error) {
          console.warn('[restart-task] 自动继续失败 ' + id + ': ' + describeError(error))
        }
      }, config.delayMs))
    }

    // ---- recovery path 1: retry the failed request in place ----------------
    actx.effect(() => actx.on('agent/request-error', (payload, next) => {
      const agent = payload !== null && typeof payload === 'object' ? payload.agent : null
      if (agent === null || agent === undefined) return next()
      // A request that died because its turn was stopped is not a failure to
      // recover from: retrying it would fight the stop that caused it, so hand
      // it straight to the next listener instead of spending a retry budget.
      const stopSignal = payload.signal
      if (stopSignal !== null && stopSignal !== undefined && stopSignal.aborted === true) return next()
      const id = agent.id
      const failure = payload.failure !== null && typeof payload.failure === 'object' ? payload.failure : {}
      const stepKey = String(payload.turn) + ':' + String(payload.step)
      let byStep = spent.get(id)
      if (byStep === undefined) {
        byStep = new Map()
        spent.set(id, byStep)
      }
      const plan = planRequestRetry({
        config: readConfig(),
        status: typeof failure.status === 'number' ? failure.status : undefined,
        used: byStep.get(stepKey) ?? 0,
      })
      if (plan.ok !== true) {
        byStep.delete(stepKey)
        return next()
      }
      byStep.set(stepKey, (byStep.get(stepKey) ?? 0) + 1)
      // Owning the wait keeps the retry silent: no event is appended, so the
      // transcript never learns that a request had to be retried at all. A turn
      // stopped while we waited is handed on with `next()` rather than settled
      // with a bare `undefined`, which would end recovery for every listener
      // behind this one.
      return waitForRetry(plan.delayMs, payload.signal).then((aborted) => (aborted === true ? next() : { kind: 'retry' }))
    }), 'restart-task: in-turn request retry')

    // ---- recovery path 2: keep a truncated turn open -----------------------
    // The finish reason arrives on the live assistant stream, one frame before
    // the loop reaches its stop boundary, so the boundary listener can decide
    // without reading the session log.
    actx.effect(() => actx.on('agent/assistant-stream', (payload) => {
      const agent = payload !== null && typeof payload === 'object' ? payload.agent : null
      if (agent === null || agent === undefined) return
      const kind = finishKindOf(payload.frame)
      if (kind === undefined) return
      lastFinish.set(agent.id, kind)
    }), 'restart-task: assistant finish watcher')

    actx.effect(() => actx.on('agent/turn-stopping', (payload) => {
      const agent = payload !== null && typeof payload === 'object' ? payload.agent : null
      if (agent === null || agent === undefined) return
      const id = agent.id
      const turn = payload.turn
      const live = keepAlives.get(id)
      const used = live !== undefined && live.turn === turn ? live.used : 0
      const config = readConfig()
      const plan = planKeepAlive({ finishKind: lastFinish.get(id), config: config, used: used })
      if (plan.ok !== true) return
      keepAlives.set(id, { turn: turn, used: used + 1 })
      // Steering before the boundary commits makes the machine re-read its
      // inbox: another step runs inside this very turn, so the transcript gains
      // no new round — only one collapsed context row.
      try {
        agent.steer(continueMessage(config.continueText))
      } catch (error) {
        console.warn('[restart-task] 同轮续写失败 ' + id + ': ' + describeError(error))
      }
    }), 'restart-task: in-turn keep-alive')

    // ---- recovery path 3: a new continuation turn when a turn really broke --
    actx.effect(() => actx.on('session/event', (session, event) => {
      const id = session !== null && typeof session === 'object' ? session.id : undefined
      if (id === undefined || id === null) return
      if (event === null || typeof event !== 'object' || typeof event.type !== 'string') return

      if (event.type === 'turn/end') {
        spent.delete(id)
        lastFinish.delete(id)
        keepAlives.delete(id)
        const data = event.data
        const endReason = data !== null && typeof data === 'object' && data.reason !== null && typeof data.reason === 'object'
          ? data.reason
          : null
        const reason = endReason !== null ? endReason.kind : undefined
        // `aborted` carries the cause it was cancelled with; a human stop must
        // never be answered with more automatic work.
        const userStop = endReason !== null && isUserStop(endReason.reason)
        if (reason === 'aborted' || reason === 'error' || reason === 'interrupted') schedule(id, reason, userStop)
        else reset(id)
        return
      }
      // A fresh turn, or anything the human just typed, means the moment for an
      // automatic continuation has passed.
      if (event.type === 'turn/start') {
        cancel(id)
        return
      }
      if (event.type === 'user/message') {
        const source = event.data !== null && typeof event.data === 'object' ? event.data.source : undefined
        const kind = source !== null && typeof source === 'object' && typeof source.kind === 'string' ? source.kind : ''
        if (kind === 'user' || kind === 'user-rpc') reset(id)
      }
    }), 'restart-task: auto-continue watcher')
  })
}
