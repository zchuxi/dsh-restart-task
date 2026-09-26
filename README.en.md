---
description: "A DSH web plugin that recovers broken turns: silent in-turn retry, in-turn keep-alive for truncated output, an opt-in continuation turn, and a composer whose send button becomes \"continue\" when the composer is empty."
kind: "package-reference"
---

# dsh-restart-task

English | [中文](README.md)

A DeepSeek Harness **web profile plugin**: a round control in the composer, a
three-tier recovery policy behind it, and a settings card for the whole thing.

The design rule everything follows: **a recovered request should leave no trace.**

| tier | when it applies | what the transcript gains |
| --- | --- | --- |
| 1. in-turn retry | a model request failed | **nothing** — not even a row |
| 2. in-turn keep-alive | the reply hit the output ceiling | no new round; the continuation row is hidden |
| 3. new continuation turn | the turn already ended broken | one round + one collapsed row (hidden by default) |

## 0. Which DSH this is for

Written against **DSH 0.1.7-rc.1 and the 0.1.x line after it**, and it says so where
the loader looks: `peerDependencies["@deepseek-ai/dsh"]` is
`>=0.1.7-rc.1 <0.1.8-0 || >=0.1.8-rc.1 <0.2.0-0` (the enforced field), the
declarative `engines.dsh` agrees, and the plugin's `@deepseek-ai/schemastery` is
`^3.18.4` — the first release with `.volatile()` schemas, which the settings model
below is built on.

> Why the range has two branches: node-semver only lets a prerelease satisfy a
> range when some comparator **on that version's `major.minor.patch` tuple** carries
> a prerelease tag of its own. A range that looks broader, `>=0.1.7-rc.1`, silently
> excludes the next patch line's release candidates (`0.1.8-rc.1`) — the user meets
> an `ERESOLVE`, or the loader skips the bundle. So each supported tuple gets its
> own branch, and `<0.2.0-0` keeps the next major out: 0.2.0 is unverified here, and
> an explicit skip is better than an unverified load.

The version matters because the two seams this plugin lives on both changed:

- **Settings stopped being a namespace a plugin registers.** `settings.register(
  namespace, schema, { applies: 'live' })` and its `settings.get(namespace)` are
  gone in 0.1.7, with no successor: a plugin's `Config` *is* its settings surface,
  and a form addresses the plugin by its **profile entry id**. See §8.
- **A plugin-sourced message is no longer a `{ kind: 'plugin', plugin }` wrapper.**
  Session format v4 requires a producer-owned `source.kind`; this plugin uses its
  own package name. See §4.

On an older runtime the bundle is skipped up front with the loader's own
compatibility line (and `dsh plugin allow-version` is the documented escape hatch),
which is the honest outcome: the two seams above do not exist there.


## 1. The manual control

While the last turn is broken, a round control appears in the composer action
cluster, immediately left of the shipped submit button.

| session state | control does |
| --- | --- |
| last turn ended `error` / `aborted` / `interrupted` | **continue** — asks the host to carry on from the breakpoint |
| an agent-level error was reported (`lastAgentError`) | **continue** |
| only the last *send* failed (`promptError`) | **resend** the last prompt — there is nothing in history to continue from |
| running, blank, or nothing to act on | not rendered |
| the composer holds a draft | not rendered — the message is about to go out, so a continuation is not offered next to it |

Outcome reporting is inside the button (spinning / green check / red `!` + the
message in its `title`). Nothing this plugin renders is inserted into the
layout: an earlier iteration reported through a line under the composer and
every state change reflowed the composer.

### 1.1 The send button itself (`sendBecomesContinue`, default on)

A continuation on offer is exactly the state in which the shipped send button is
**useless**: with an empty composer the product disables it (`empty || blocked ||
uploadsPending`) and renders it at 40% opacity, so there is nothing to send and
nothing to click. So the round control is not the only door: while a continuation
is on offer *and* the composer has nothing else to send, this plugin hands the
send button the same action.

| composer | send button |
| --- | --- |
| empty, last turn broken | enabled, warn-coloured, round arrow, `aria-label="继续上次任务"` — one click continues from the breakpoint |
| the human is typing | untouched: it stays the ordinary send button and sends what they wrote |
| the agent is running | untouched: it stays the product's stop / queue / steer control |

Mechanically this is the one place the plugin writes to a product element, and it
is written narrowly:

- The composer's primary control is **inline JSX with no slot** (the composer
  exposes `conversation.input.{left,right,model,attachments,activity,dock,overlay,
  permission,plan}` and nothing for submit), so the pass marks *that element* with
  its own attribute, `data-dyn-continue="1"`, and dresses it from its own
  stylesheet. It never touches the class list React owns.
- It may only take a control the product **cannot use** — `disabled` is the
  condition, which is why a composer the human is typing in is never touched.
  Taking it over means clearing `disabled`, and the observer re-applies the
  takeover if React ever writes it back. Because the takeover clears exactly the
  signal it gated on, the **draft itself is re-read** on every pass and again at
  the click: the moment the composer holds something, the takeover lets go, the
  product's label comes back and the human's message sends. A takeover that
  outlived the empty composer would turn a written message into a continuation,
  which is worse than no takeover at all.
- The click is intercepted in the **capture phase on `document`** and stopped
  there: the product's handler rides React's listener on the root container, which
  is below that point, so the send path never also fires. Every other click in the
  window passes straight through.
- The action itself isn't re-implemented: the pass clicks this plugin's own round
  control (which is hidden by CSS while the button carries the action, and still
  mounted), so both affordances share one busy guard, one double-click fence and
  one outcome flash — the button turns green / red / spins with the same state.
- Releasing removes the attributes, restores the label the product gave the button,
  and restores the product's own verdict for an **empty** composer (`disabled`) —
  without that, the control would sit enabled-but-idle for the rest of the session
  and no later continuation could be offered through it. A composer that holds a
  draft keeps whatever the product rendered, because that message is exactly what
  must stay sendable.
- `hideContinueRow` and this switch are independent, and both can be turned off in
  the card. With the takeover off, the round control is the only affordance and
  the send button is left exactly as shipped.

Known limits: this reads the product's DOM rather than a declared API, so a
release that renames the primary class or drops `data-composer-card` makes the
takeover stop happening (nothing else breaks — the round control still works);
in the rare states where the product disables the send button for its own reasons
while a continuation is on offer (an upload in flight, a pending approval) the
takeover applies there too; the shipped tooltip still says “发送消息” while the
button carries the continuation (the button's accessible name and its `title` are
this plugin's); and the **Enter key is left alone** — the fixed send action is
read-only in the product and hijacking it would make an empty-draft Enter start
unrequested work.

## 2. Tier 1 — in-turn retry (default on, invisible)

`agent/request-error` is a **waterfall**: a listener that returns
`{ kind: 'retry' }` without calling `next()` makes the loop retry the *same step*
in place. This plugin waits its own backoff (`retryBaseDelayMs × 2^attempt`,
capped at 60s) and then claims recovery, up to `maxRequestRetries` — or forever,
with `retryForever`.

Nothing is appended to the session — no instruction message, no extra turn, no
retry row — so a request that fails and then succeeds leaves the transcript
exactly as if it had worked the first time. Terminal client errors (4xx except
429) are delegated instead of retried, *before* any budget is consulted, so an
unlimited budget can never turn a bad API key into an infinite loop. The
per-step counter is cleared at `turn/end`.

The shipped `dsh-llm-retry` also listens on `agent/request-error`, and `dsh-base`
mounts it **before** this plugin, so it sits upstream: it tries its own policy
first (normal mode: five attempts with its own backoff) and only delegates with
`next()` once that is exhausted, at which point this plugin's budget starts. The
two budgets therefore add up — turn the shipped policy down, or this one off, if a
failure should stop sooner.

## 3. Tier 2 — in-turn keep-alive (no new round)

When a step ends because the model ran into its output ceiling, the turn is
**about to** close. `agent/turn-stopping` is the boundary where a listener may
object: calling `agent.steer(...)` puts fresh input in the inbox before the
boundary commits, and the loop runs another step **inside the same turn**.

> "The turn is about to close ... a listener that objects steers
> (`agent.steer(...)`) and the machine re-reads its inbox: fresh steering runs
> another step, none closes the turn."
> — `dsh-agent/lib/types/runtime-types.d.ts`, `agent/turn-stopping`

So the round count, the rail and the history do not move. Bounded by
`maxTurnContinues` (per turn), and only ever triggered when the step's finish
reason really was `max-tokens` — read from the `finish` chunk of the live
`agent/assistant-stream`, one frame before the boundary, so no session-log
poking is needed.

Two honest limits:

- The boundary is only reached on a **normal** stop. `aborted` and `error` leave
  the loop through `throw`, so tier 2 never applies to them.
- The steered instruction is still a logged `user/message` — it renders as one
  collapsed context row (see §6), never as a user bubble.
## 4. Tier 3 — a new continuation turn (default off, visible)

When a turn really ended broken, a continuation posts one *plugin-sourced*
message through `agent.followup`:

```js
{ role: 'user',
  content: [{ type: 'text', text: '<continue instruction>' }],
  source: { kind: 'dsh-restart-task', form: 'notice',
            summary: '继续上次中断的任务' } }
```

`source.kind !== 'user'` is what keeps it from being a user bubble: it renders as
a collapsed row — and because this message *opens* the round, the product renders
it as its non-human trigger notice rather than a context row (§6). The kind must be **this producer's own name** — session
format v4 requires a producer-owned source kind and refuses the retired
plugin-namespace wrapper (`kind: 'plugin'` plus a `plugin` field) on newly
written messages; that shape is only lifted by the v3→v4 conversion of
already-stored history. Writing it here fails the entire turn with `format v4
message requires a producer-owned source kind`, because the continuation message
is appended before the step can run. But it is still **a new turn**, so the transcript gains
that row and the turn rail gains an entry — which is exactly why `autoContinue`
defaults to `false` and the manual control exists for on-demand use.

Guard rails while it is enabled: a good turn end, a new `turn/start`, or anything
the human typed cancels the pending continuation and clears the streak;
`maxConsecutive` caps a run of continuations.

**A stop is final.** The composer's stop control cancels the turn with
`{ kind: 'user' }`, the loop parks that cause on the aborted `turn/end` reason
(`agent.cancel(cause)` → `turn/end { reason: signal.reason }`), and `isUserStop`
reads it back. A turn the human stopped is therefore **never** continued, whatever
`autoContinue` / `onAborted` / `maxConsecutive` say — the check runs before all of
them. Tier 1 applies the same rule from the other end: a request that died because
its turn was stopped is handed to the next listener instead of being retried, so
pressing stop is never fought by a retry.

`resend` (manual, send-failure case only) is the one path that posts user text —
a prompt that never reached the host is not in history, so re-posting it is the
only thing that can work. It registers no optimistic echo, so it cannot double a
row.

## 5. Why a closed turn cannot be continued in place

This is a structural constraint of the agent loop, not a missing API. The facts,
for the record:

- A new turn number can only be `previous + 1`, and it is always announced with
  `turn/start` (`dsh-agent-loop/lib/index.js`, `turn()`).
- `turn/end` is appended in a `finally` block on every path, so a broken turn is
  durably closed before any plugin hears about it.
- Every message that enters a step is appended as `user/message` with
  `surfaceOp: 'append'`; the plugin cannot choose a non-appending surface op for
  the message that wakes the loop.
- Session events are append-only: there is no remove / truncate / rewrite API on
  the `Session` seam or the persistence layer, so a continuation cannot be pruned
  after the fact. (`dsh-rewind-plugin` does not delete events either — it appends
  a *replacement* surface, and replacement copies stay model-only.)
- The `interrupted` marker is written by the crash **repair** path, which closes
  an orphaned turn after the fact; the loop never emits it live, and resuming a
  session does not wake a driver.

So tiers 1 and 2 are the whole answer to "can it continue without a new round",
and tier 3 is the only thing possible for a turn that has already ended.

## 6. Hiding the continuation row

Tier 2 and tier 3 rows exist so the *model* can read the instruction; they are
plumbing, and Chat has exactly two shapes for them — neither of which a
stylesheet can single out:

| shape | when | what identifies it |
| --- | --- | --- |
| collapsed context row | the message did not open the turn (tier 2, a steered step) | a valueless `data-context-source` attribute, and the producer's name as **text** |
| non-human trigger notice (`data-chat-flow-kind="turn-trigger"`) | the message opened the turn (tier 3, tier-1's manual use) | nothing — an unknown source kind is not even distinguished from a request trigger |

So `hideContinueRow` (default **on**) is a small **transcript pass**, not a
selector: every row the pass can attribute to this plugin is tagged
`data-dyn-restart-row="1"`, and one conditional rule hides this plugin's tags:

```css
[data-chat-flow-kind="context"][data-dyn-restart-row="1"],
[data-chat-flow-kind="turn-trigger"][data-dyn-restart-row="1"] { display: none !important; }
```

Attribution has two sources, and it never guesses:

1. A context row whose provenance label is exactly this plugin's `source.kind`.
2. A trigger row in a round this plugin opened — computed from the live session
   event window (`ownWakingTurns`), read from the session the composer control is
   mounted for. A turn's input is appended **after** its `turn/start`, never before
   it (the durable order is `turn/start(7)` → `user/message(kind: dsh-restart-task)`
   → …), so a message opens the round it lands in exactly when it is that round's
   **first** input. Tiers 1 and 3 post through the next-turn inbox, which is what
   makes their row the trigger notice; a tier-2 steer is claimed by a step of an
   already-open turn, so it is never a first input and never gains a round.
   Without a window yet, this rule is skipped and rule 1 still covers tier 2.

The second source **accumulates**, and a third makes it whole-session. The client
only ever holds a *paged* window, and folding a completed round or loading another
slice replaces it with a smaller one; a set recomputed from the current window
alone would forget a round it had already recognised, and the rail mark would come
back until the next slice arrived. So:

- whatever either source says is remembered while the transcript stays on one
  session, and starts over when the transcript moves to another one;
- the **host half** registers a session projection (`restartTaskRounds`, the same
  fold over the *whole* log rather than one page) whose value the projection seam
  delivers to the client wholesale, and the browser half unions it in. That is what
  attributes a round whose events are not loaded at all — the case a paged
  transcript (`加载更早`) produces, where nothing on screen says whose round it is.

Another producer's row — time context, `AGENTS.md`, skills, cron, subagent
settlements, goal rounds — is never tagged and never hidden. The pass is
idempotent (React re-renders leave foreign attributes alone), it clears its own
tags when the switch goes off or the plugin unloads, and when it cannot read a
view it does nothing at all rather than hiding something it cannot attribute.
A lost attribution is therefore a cosmetic miss (a row keeps rendering), never a
wrong guess about someone else's row.

Caveats, honestly: both rules read the product's rendering rather than a declared
API, so a release that renames the flow attributes or re-labels the provenance
span makes the pass stop matching (nothing breaks — the row simply shows again);
a round whose events are **not in the loaded window yet** is not attributed until
its history is loaded — the rail's own whole-log outline knows every round but
carries only `{turn, prompt, response}` and no producer kind, so a round with no
human prompt is indistinguishable there from a subagent's, a goal's or a cron
trigger's, and guessing would hide someone else's round (this is the one gap a
future release could close by exposing the trigger kind); and the turn rail's own
entry for a tier-3 round is untouched by this rule (see §7).


## 7. The turn rail

A tier-3 continuation is a real turn, so the rail earns a mark for it — and
because that turn carries **no human prompt**, the mark's hover card can only
fall back to an anonymous `第 N 轮 / Turn N`. That fallback is not data a plugin
can change: the rail is inline JSX with no extension point, and the
whole-session `turnOutline` projection accepts a prompt preview only from
`source.kind === 'user'` (`dsh-session-turn-outline/lib/types/projection.js`).

`continuedRailMarks` therefore treats it as presentation, with three modes:

| mode | effect |
| --- | --- |
| `hide` (default) | the round's rail mark, and with it the hover card, is not shown |
| `preview` | the mark stays (still clickable to jump there); hovering it no longer shows `第 N 轮` — only the round's answer preview |
| `keep` | the product's own behaviour, untouched |

Mechanically it is one small DOM pass, not a stylesheet trick. The rounds are the
ones `ownWakingTurns` attributes to this plugin (§6) — the *rounds*, not the rows
the transcript pass tagged: a tier-2 steer hides a row inside the human's own
round, and that round's rail mark is emphatically not this plugin's to touch. Each
rail mark is matched to its round through the mark's accessible label (the only
per-round attribute it has), then tagged with the configured mode:

```css
[data-dyn-continued='hide'] { display: none !important; }
nav[data-dyn-continued-preview='1'] [class*='_previewPrompt'] { display: none !important; }
```

Our own round's mark is tagged `hide`/`preview`; every other mark is left exactly
as the product drew it. Because `hide` is `display: none` on the mark itself, the
hover card has nothing left to attach to: that round's `第 N 轮` tooltip cannot
appear at all.

Hiding the mark is only half of it. The rail's virtualizer reserves that round's
place — it sizes the marks container from its own measurements and never reflows
it, and the product writes no per-mark geometry of its own — so a hidden mark left
its slot behind as a hole in the middle of the rail. The pass therefore **compacts**
what is on screen: it measures the pitch between the marks the view rendered,
moves every mark after a hidden one up by one pitch, and shrinks the container by
the number of hidden rounds. Both overrides are this plugin's own inline
properties, recomputed on every pass and removed the moment nothing is hidden or
the plugin unloads, so the rail returns to exactly what the product drew.

Honest limits: it can only tag and compact rounds the view has actually rendered
(a round far outside the loaded window is tagged as soon as it is scrolled into
range); marks are virtualized, so only the marks in the rail's own scroll window
are handled at any moment; it matches marks through their accessible label because
a mark carries no round attribute of its own; the rail's own DOM changed in 0.1.7
(a `button[data-index]` inside the marks container, with no per-mark position
wrapper), which is what this pass reads; and the compaction is geometry the
product recomputes on its own schedule — a re-render puts the marks back where the
virtualizer wants them, and the next pass (a DOM mutation away) compacts them
again.


## 8. Settings card

**Plugins page → dsh-restart-task** (the sidebar page the plugin manager owns).
The card is registered into that page's `plugins.bundle.config` seat, keyed by
this bundle's package name (`dsh-restart-task`) — the page's own contract for "a
bundle that carries its own configuration", and the only seat that survives the
0.1.7 rewrite (the old `settings.plugin.item` tab is gone). It is registered only
while the host serves this plugin's settings entry, so a deployment that never
mounted the row shows no trace of the card.

The card owns its whole chrome: a collapsible header with a live policy summary,
four grouped sections, per-field "已自定义 / 恢复默认", and a footer with the
write state and "全部恢复默认".

![The card, top: header with the live policy summary, the delivery-priority note, the in-turn retry group, and the keep-alive group](docs/settings-card-1.png)

![The card, bottom: how a finished round continues, the per-cause switches, and the continuation instruction and its presentation (hidden row, rail mark mode)](docs/settings-card-2.png)

| field | default | meaning |
| --- | --- | --- |
| `retryFailedRequests` | `true` | retry a failed request inside the same step (invisible) |
| `maxRequestRetries` | `3` | how many in-turn retries before delegating (`0` = none) |
| `retryForever` | `false` | ignore the budget and retry until success or abort |
| `retryBaseDelayMs` | `2000` | backoff base: 2s, 4s, 8s … capped at 60s |
| `keepAliveOnMaxTokens` | `true` | keep a truncated turn open and continue inside it |
| `maxTurnContinues` | `5` | continued steps allowed inside one turn (`0` = no limit) |
| `autoContinue` | `false` | open a new continuation turn after a broken turn (visible) |
| `delayMs` | `1500` | wait after the break before continuing |
| `maxConsecutive` | `3` | cap on consecutive continuation turns (`0` = no limit) |
| `onAborted` | `true` | continue after a *system* cancellation (parent agent / hook); a human stop is never continued |
| `onError` | `true` | continue after a model request failure |
| `onInterrupted` | `true` | continue after a crash-orphaned turn |
| `sendBecomesContinue` | `true` | hand the shipped send button the continuation while the composer is empty (see §1.1) |
| `hideContinueRow` | `true` | hide this plugin's own collapsed rows in Chat |
| `continuedRailMarks` | `hide` | how the rail presents rounds this plugin continued (`hide` / `preview` / `keep`) |
| `continueText` | (built-in) | the instruction sent to the model |

`onAborted` / `onError` / `onInterrupted` are disabled while `autoContinue` is
off, because they only describe when that tier fires.

### How the values get in and out (0.1.7's configuration model)

There is no settings namespace any more, so the wiring is:

- **The host half's `Config` is the form.** Every field is `.volatile()`, which is
  what makes it live-editable; the loader then hands `apply` a *reference* per
  field, and `config.<field>.get()` is what the three tiers read on every
  decision. A write takes effect on the next break with no restart, and no
  plugin event is involved.
- **The form addresses the profile entry id**, `restart-task` — the id this
  package's `cordis.patch.yml` inserts. It is *not* the package name, and the
  browser half cannot import the host half's constant, so both halves and the
  patch file spell it; the regression harness asserts all three agree.
- **Writes go through `configForms.get('restart-task')`** (the browser half's
  shared form for that entry): a snapshot of the *served* form values plus the raw
  user layer, with `set` / `unset` per field and a revision-stamped mutate queue
  behind them. Refused writes come back as `false`, and a conflict re-reads the
  host rather than clobbering it.
- **The host does not also generate a page**: the plugin registers
  `settings.configure({ auto: false }, ctx.fiber)` inside an optional
  `settings` child. That child is optional on purpose — a composition without the
  settings domain still runs the three tiers and the composer control, and only
  the card and the two transcript passes stay away.

### When client and host disagree

A browser half can be newer than the running host — the normal state right after
a plugin update, before the profile restarts. Then the entry may not be served, or
may be served without the newer fields, and the card says so instead of failing a
write: a field the running host does not serve is shown read-only with "宿主还是旧
版本：重启 DSH 后这一项才会生效", and an entry the host does not serve at all is
explained with "宿主没有提供本插件的设置入口". A non-loopback page (settings kept
in memory for that session) is labelled too.


> **Coexistence:** `dsh-client-auto-continue` also ships in this profile and also
> auto-continues interrupted turns (with a *user-sourced* message, which does show
> a bubble). Run one of them, and note that it is the visible path — tiers 1 and 2
> above are silent either way. This plugin yields if the other fires first: any
> user-sourced message cancels its pending continuation.

## Layout

- `cordis.patch.yml` — profile bundle patch inserting the `restart-task` row; its
  id is also the settings entry id, and the comments there say so.
- `lib/index.js` — host half: the `Config` schema every field of which is
  `.volatile()`, in-turn retry, in-turn keep-alive, optional continuation turn,
  `continue-task` command.
- `lib/client.js` — browser half: `window.__ModuleLoader__.load` bundle exporting
  `apply` + `inject` (`['slots', 'timer']`), the composer control, the
  Plugins-page card (over an optional `configForms` child), and the transcript
  pass that tags this plugin's own rows, presents the rail for the rounds it
  opened, and hands the shipped send button the continuation while the composer
  is empty.
- `restart-task.test.mjs` — the regression harness (below).
- `screenshots.json` — the 1–8 images a storefront shows for this plugin (§8), and
  `docs/awesome-dsh-plugin-entry.yml` — the entry to copy into
  [`awesome-dsh-plugin`](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin)
  when submitting or updating the listing there. Screenshots live in this
  repository on purpose: changing one is a push here, not a pull request there.

The control's shape is pinned with `!important` on purpose: it lives inside the
product composer tool row, which has its own button and `svg` rules. The settings
card uses the product's `--dsw-alias-*` tokens and matches its card chrome
(`.5px` borders, 16px radius, 14–16px header padding) without needing any. Both
injected `<style>` tags carry `data-plugin`, because the module system owns
styles by that attribute: an untagged tag is adopted by whichever plugin
materializes next and removed when *that* one unloads.

Three regions are asserted directly — `auto-logic` in `lib/index.js`, `core-logic`
in `lib/client.js`, and the host module's own exports — so the decisions the
shipped code runs are the decisions under test:

```sh
node dsh-restart-task/restart-task.test.mjs   # 299 assertions, both halves
```

The suite has four layers, because the port to 0.1.7 failed in three ways and the
row/rail presentation can only be judged by its effect on a document:

1. **Rules** — the retry budget (terminal 4xx, 429, doubling, the 60s cap,
   unlimited), the keep-alive gate (only `max-tokens`, per-turn cap), the
   turn-level gate (broken reasons, per-cause switches, streak cap), the
   transcript reader (human prompts only, broken vs clean ends), the waking-round
   reader, the composer control's mode choice, the header summary wording.
2. **Wiring** — every identity string agrees (patch entry id ↔ host `ENTRY_ID` ↔
   client `ENTRY_ID`, package name ↔ bundle seat key ↔ producer kind), every
   `Config` field is volatile and every served field is rendered by the card, the
   retired settings seam and the retired seats/selectors are gone, the row-hiding
   rule is keyed on this plugin's own tag, and both style tags name their owner.
3. **Host behaviour** — `lib/index.js` is imported for real and driven through a
   stub Cordis context: the command posts one producer-sourced message, a 401 is
   delegated while a 500 waits and retries in place, an aborted wait delegates, a
   truncated step steers inside its turn while a completed one does not, and the
   turn-level tier continues only when enabled — never after a human stop, and
   never past its streak cap.
4. **Transcript, rail and the send button, over a stub DOM** — the browser half is
   loaded and applied against a fake document holding one plugin round, one human
   round (carrying this plugin's in-turn steer), a foreign context row, a foreign
   trigger notice, and a composer whose primary control starts disabled: the
   plugin's own rows are tagged while everyone else's are not, the steer row is
   recognised from its provenance label alone while the trigger notice needs the
   session window, the plugin round's rail mark is hidden in `hide` mode and
   flagged in `preview` mode while the human's and the foreign round's marks are
   never touched, and the send button is taken over, clicked (the click is stopped
   before the product sees it and the round control runs instead), left alone when
   the composer has text, and handed back when the switch goes off. The event
   fixtures are copied from a real `session.v4.jsonl`, including the `turn/start`
   → message order that decides attribution.



## Further Exploration

These pages cover the seams this plugin builds on, so each one can be checked
against the release it declares:

- [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) — the
  runtime, the plugin contract, and the packages referenced throughout:
  `dsh-agent` (the Agent face and `agent/request-error` /
  `agent/turn-stopping` dispatch), `dsh-agent-loop` (turn and step boundaries),
  `dsh-settings` (the configuration form), `dsh-session-format` (the v4 source
  rule), `dsh-client-ui-conversation` (the composer and its slots),
  `dsh-client-ui-chat` (the flow rows and the turn rail).
- `dsh-client-shortcuts` — the fixed input actions (`fixed.send` = `Enter`,
  `fixed.newline` = `Shift+Enter`, `fixed.complementary` = `Ctrl`/`Cmd+Enter`)
  that this plugin deliberately does not rebind; the busy-Enter behaviour
  (queue vs steer) is the `ui-conversation` settings field `busyEnter`.
- `dsh-llm-retry` — the shipped retry executor that mounts upstream of this
  plugin and delegates to it once its own policy is exhausted.
- `dsh-client-ui-plugin-manager` — the Plugins page that owns the
  `plugins.bundle.config` seat this card registers into.

## Model Experience

What the model sees, per tier:

- **Tier 1** is invisible: a retried request reconstructs the same step from the
  same durable history, with no retry event, delay or provider error reaching the
  model.
- **Tier 2** adds one `user/message` whose `source.kind` is this plugin's name:
  the model reads the instruction, the human reads a collapsed row (hidden by
  default).
- **Tier 3** is a new turn whose only input is that same producer-sourced
  message. The model therefore sees a short instruction to carry on, never a
  second copy of the user's own prompt.

#### KV Cache effect

Retried and continued requests rebuild the same prefix as the attempt they
recover, so provider cache reuse is preserved under that provider's rules. The
plugin itself contributes no tokens: it adds no tool schemas, no system prompt
text, and no context beyond the one continuation instruction that tiers 2 and 3
actually need.

## Dev Note

- **The harness is the specification.** `restart-task.test.mjs` slices the pure
  regions out of the shipped sources and drives the host module for real, so a
  rule cannot pass here while the shipped code does something else.
- **Event fixtures come from real logs.** The `turn/start` → message order that
  decides attribution was read out of a live `session.v4.jsonl` (one zstd frame
  per appended batch), after a first version of the rule assumed the opposite
  order and silently attributed nothing.
- **DOM passes read the product's rendering on purpose**, because the product
  offers no slot for the rows they act on (a collapsed context row's provenance is
  *text*, a trigger notice carries no provenance, the turn rail is inline JSX, and
  the composer's primary control is inline JSX too). Every one of them is written
  to degrade to "do nothing" rather than to guess, and the limits of each are
  documented next to it.

## Install / remove

From this repository (no registry needed):

```sh
dsh plugin --profile web add github:zchuxi/dsh-restart-task
# or: dsh plugin --profile web add https://github.com/zchuxi/dsh-restart-task
# or from a checkout: dsh plugin --profile web add link:<space-free path to this directory>
# then restart the profile (Host + page): the host half changes
dsh plugin --profile web remove dsh-restart-task
```

`desktop` is the Electron-owned profile name and the CLI refuses it; install into
it from the plugin manager instead, with the same git address.

The bundle joins `dsh.profile.bundles` through its `dsh.bundle.patch` manifest
field; removing the dependency removes the row again on the next start.

> Keep a checkout in a path **without spaces**. `dsh plugin` forwards its
> arguments through a shell, so a path containing spaces is split into several
> bogus dependencies.

**Requirements.** DSH `>=0.1.7-rc.1 <0.1.8-0 || >=0.1.8-rc.1 <0.2.0-0` (declared as
an enforced `peerDependencies["@deepseek-ai/dsh"]` range, so an older runtime skips
the bundle with the loader's own compatibility line instead of failing somewhere
inside it), Node `>=24`, and one runtime dependency — `@deepseek-ai/schemastery
^3.18.4`, the first release whose schemas can be `.volatile()`. A development
checkout installs it with `npm install --legacy-peer-deps`: the `@deepseek-ai/dsh`
peer is the host the plugin runs inside and must not be dragged in as a build
dependency.

The **browser half hot-reloads**: `dsh-client-hmr` stat-polls every client bundle
and swaps a rebuilt one into the running page, so editing `lib/client.js` shows
up on save. The **host half needs a profile restart** — `agent/turn-stopping` and
the new settings keys only exist after `lib/index.js` reloads.
