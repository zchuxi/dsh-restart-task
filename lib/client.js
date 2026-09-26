/**
 * Browser half of dsh-restart-task.
 *
 * A ModuleLoader bundle: the client runtime loads this file, the factory runs
 * with the shared module registry as `require`, and the module it returns is
 * mounted as a Cordis plugin on the client root context (`apply` + `inject`).
 *
 * Two things live here:
 *
 * 1. The composer control — while the last turn is broken, a round control
 *    appears in the action cluster and asks the host to continue from the
 *    breakpoint. It posts no user text of its own, so the transcript never
 *    repeats what the user already sent.
 *
 * 2. The settings card, and the two transcript passes behind it. The card is
 *    this bundle's own configuration page on the **Plugins page** (the sidebar
 *    page the plugin manager owns), registered into its `plugins.bundle.config`
 *    seat keyed by this bundle's package name. It edits the plugin's profile
 *    entry through `configForms`, the 0.1.7 settings transport: one shared form
 *    per entry id, immediate writes, and a snapshot that also says which fields
 *    the *running* host serves.
 *
 * Everything settings-dependent is acquired inside an optional `configForms`
 * child, so a composition without the settings domain still runs the composer
 * control and the host half's recovery tiers.
 *
 * The core-logic region below is pure (it uses no closure symbols beyond its
 * own arguments), so it can be sliced out of this exact text and asserted on
 * directly by a test harness.
 */
window.__ModuleLoader__.load({
	id: 'dsh-restart-task',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const rawReact = require('react')
		const React = rawReact !== null && typeof rawReact === 'object' && typeof rawReact.createElement === 'function'
			? rawReact
			: rawReact.default

		/**
		 * Stylesheet. The composer control lives inside the product composer tool
		 * row (which has its own button/svg rules), so its shape is pinned
		 * explicitly; every value below reads a DSH design token, so the card
		 * follows the active theme instead of hard-coding a palette.
		 */
		const CSS_TEXT = `
.dyn-retry-round {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  box-sizing: border-box !important;
  width: 30px !important;
  height: 30px !important;
  min-width: 30px !important;
  padding: 0 !important;
  margin: 0 !important;
  border-radius: 999px !important;
  border: 1.5px solid var(--dsw-alias-state-warn-primary, #f5a524) !important;
  background: transparent !important;
  color: var(--dsw-alias-state-warn-primary, #f5a524) !important;
  cursor: pointer !important;
  flex: none !important;
  line-height: 0 !important;
}
.dyn-retry-round:hover {
  background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, .16)) !important;
}
.dyn-retry-round:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4c8dff) !important;
  outline-offset: 2px !important;
}
.dyn-retry-round[data-state='done'] {
  border-color: var(--dsw-alias-state-success-primary, #35c46a) !important;
  color: var(--dsw-alias-state-success-primary, #35c46a) !important;
}
.dyn-retry-round[data-state='error'] {
  border-color: var(--dsw-alias-state-error-primary, #f2555a) !important;
  color: var(--dsw-alias-state-error-primary, #f2555a) !important;
}
.dyn-retry-round[disabled] { opacity: .55 !important; cursor: default !important; }
.dyn-retry-round svg {
  display: block !important;
  width: 15px !important;
  height: 15px !important;
  flex: none !important;
  overflow: visible !important;
}
.dyn-retry-round[data-state='busy'] svg { animation: dyn-retry-spin 900ms linear infinite; }
@keyframes dyn-retry-spin { to { transform: rotate(360deg); } }

/* ---------- the shipped send button, while it carries the continuation ----
   The product's own primary control is inline JSX with no slot, so this is a
   presentation layer over the very element the transcript pass took over: only
   this plugin's own attribute selects it (React rewrites the class attribute, so
   keying on a class would silently stop matching). The shipped arrow is hidden
   and the round arrow of "continue" takes its place, in the same warn colour the
   composer control uses, so the two affordances read as one action. */
button[data-dyn-continue='1'] {
  background: var(--dsw-alias-state-warn-primary, #f5a524) !important;
  color: #fff !important;
  opacity: 1 !important;
  cursor: pointer !important;
}
button[data-dyn-continue='1']:hover:not(:disabled) {
  filter: brightness(1.06);
}
button[data-dyn-continue='1']:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary, #4c8dff) !important;
  outline-offset: 2px;
}
button[data-dyn-continue='1'] > svg { display: none !important; }
button[data-dyn-continue='1']::after {
  content: '↻' !important;
  font-size: 17px !important;
  line-height: 1 !important;
  font-weight: 500 !important;
}
button[data-dyn-continue-state='busy']::after { animation: dyn-retry-spin 900ms linear infinite; }
button[data-dyn-continue-state='done'] {
  background: var(--dsw-alias-state-success-primary, #35c46a) !important;
}
button[data-dyn-continue-state='error'] {
  background: var(--dsw-alias-state-error-primary, #f2555a) !important;
}

/* ---------- settings card ---------- */
.dyn-rt-card {
  --dyn-rt-accent: var(--dsw-alias-brand-primary, #4c8dff);
  --dyn-rt-soft: var(--dsw-alias-bg-module-platform, rgba(127, 127, 127, .12));
  position: relative !important;
  display: block !important;
  box-sizing: border-box !important;
  list-style: none !important;
  overflow: hidden !important;
  border: .5px solid var(--dsw-alias-border-l4, rgba(127, 127, 127, .3)) !important;
  border-radius: 16px !important;
  background: var(--dsw-alias-bg-layer-3, transparent) !important;
  color: var(--dsw-alias-label-primary, #e6e6e6) !important;
  transition: border-color .16s ease, background .16s ease !important;
}
.dyn-rt-card:hover { border-color: var(--dsw-alias-label-dimmed, rgba(127, 127, 127, .55)) !important; }
.dyn-rt-card[data-open='true'] {
  background: var(--dsw-alias-bg-layer-2, rgba(127, 127, 127, .08)) !important;
  border-color: var(--dsw-alias-label-dimmed, rgba(127, 127, 127, .55)) !important;
}
.dyn-rt-card::before {
  content: '' !important;
  position: absolute !important;
  inset: 0 0 auto 0 !important;
  height: 2px !important;
  pointer-events: none !important;
  opacity: .8 !important;
  background: linear-gradient(90deg, transparent, var(--dyn-rt-accent) 22%, var(--dsw-alias-state-success-primary, #35c46a) 78%, transparent) !important;
}

.dyn-rt-head {
  appearance: none !important;
  display: flex !important;
  align-items: center !important;
  gap: 12px !important;
  width: 100% !important;
  padding: 15px 16px !important;
  font: inherit !important;
  color: inherit !important;
  text-align: left !important;
  background: none !important;
  border: 0 !important;
  border-radius: 16px !important;
  cursor: pointer !important;
}
.dyn-rt-head:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #4c8dff) !important; outline-offset: -2px !important; }
.dyn-rt-mark {
  display: grid !important;
  place-items: center !important;
  flex: none !important;
  width: 40px !important;
  height: 40px !important;
  border-radius: 12px !important;
  color: var(--dyn-rt-accent) !important;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .3)) !important;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-2, #1b1b1b) 82%, var(--dyn-rt-accent) 18%) !important;
}
.dyn-rt-mark svg { width: 21px !important; height: 21px !important; display: block !important; }
.dyn-rt-headText { display: flex !important; flex-direction: column !important; gap: 4px !important; flex: 1 1 auto !important; min-width: 0 !important; }
.dyn-rt-name { font-size: 15px !important; font-weight: 600 !important; line-height: 1.4 !important; }
.dyn-rt-desc { font-size: 13px !important; line-height: 1.5 !important; color: var(--dsw-alias-label-tertiary, #8b8f95) !important; }
.dyn-rt-chips { display: flex !important; flex-wrap: wrap !important; align-items: center !important; gap: 6px !important; margin-top: 4px !important; }
.dyn-rt-chip {
  display: inline-flex !important;
  align-items: center !important;
  gap: 5px !important;
  padding: 1px 8px !important;
  border-radius: 999px !important;
  font-size: 11px !important;
  line-height: 17px !important;
  color: var(--dsw-alias-label-secondary, #b6b9be) !important;
  background: var(--dyn-rt-soft) !important;
  white-space: nowrap !important;
}
.dyn-rt-chip::before {
  content: '' !important;
  width: 5px !important;
  height: 5px !important;
  flex: none !important;
  border-radius: 999px !important;
  background: var(--dsw-alias-label-dimmed, rgba(127, 127, 127, .6)) !important;
}
.dyn-rt-chip[data-tone='on']::before { background: var(--dsw-alias-state-success-primary, #35c46a) !important; }
.dyn-rt-chip[data-tone='alert']::before { background: var(--dsw-alias-state-warn-primary, #f5a524) !important; }
.dyn-rt-chevron { flex: none !important; color: var(--dsw-alias-label-tertiary, #8b8f95) !important; transition: transform .16s ease !important; }
.dyn-rt-chevron svg { width: 16px !important; height: 16px !important; display: block !important; }
.dyn-rt-chevron[data-open='true'] { transform: rotate(180deg) !important; }

.dyn-rt-body {
  display: flex !important;
  flex-direction: column !important;
  gap: 12px !important;
  padding: 0 16px 12px !important;
  margin: 0 !important;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .3)) !important;
}
.dyn-rt-note {
  margin: 12px 0 0 !important;
  font-size: 12px !important;
  line-height: 1.55 !important;
  color: var(--dsw-alias-label-tertiary, #8b8f95) !important;
}
.dyn-rt-note strong { color: var(--dsw-alias-label-secondary, #b6b9be) !important; font-weight: 600 !important; }

.dyn-rt-section {
  border: .5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .3)) !important;
  border-radius: 12px !important;
  overflow: hidden !important;
  background: color-mix(in srgb, var(--dsw-alias-bg-layer-3, #171717) 94%, var(--dyn-rt-accent) 6%) !important;
}
.dyn-rt-section[data-tone='retry'] { --dyn-rt-accent: var(--dsw-alias-state-success-primary, #35c46a); }
.dyn-rt-section[data-tone='inline'] { --dyn-rt-accent: var(--dsw-alias-brand-primary, #4c8dff); }
.dyn-rt-section[data-tone='turn'] { --dyn-rt-accent: var(--dsw-alias-state-warn-primary, #f5a524); }
.dyn-rt-section[data-tone='text'] { --dyn-rt-accent: var(--dsw-alias-label-tertiary, #8b8f95); }
.dyn-rt-secHead {
  display: flex !important;
  align-items: center !important;
  gap: 10px !important;
  padding: 11px 13px !important;
  border-bottom: .5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .3)) !important;
}
.dyn-rt-secBar {
  flex: none !important;
  width: 3px !important;
  height: 26px !important;
  border-radius: 999px !important;
  background: var(--dyn-rt-accent) !important;
}
.dyn-rt-secText { display: flex !important; flex-direction: column !important; gap: 2px !important; min-width: 0 !important; }
.dyn-rt-secTitle { font-size: 13px !important; font-weight: 600 !important; line-height: 1.4 !important; }
.dyn-rt-secSub { font-size: 11.5px !important; line-height: 1.45 !important; color: var(--dsw-alias-label-tertiary, #8b8f95) !important; }
.dyn-rt-fields { display: block !important; padding: 0 13px !important; }
.dyn-rt-fieldsSub { display: block !important; padding: 0 13px 2px 25px !important; }

.dyn-rt-field {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 16px !important;
  padding: 11px 0 !important;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .3)) !important;
}
.dyn-rt-fields > .dyn-rt-field:first-child,
.dyn-rt-fieldsSub > .dyn-rt-field:first-child { border-top: 0 !important; }
.dyn-rt-field[data-stacked='true'] { display: block !important; padding-bottom: 13px !important; }
.dyn-rt-fieldText { display: flex !important; flex-direction: column !important; gap: 3px !important; min-width: 0 !important; }
.dyn-rt-labelRow { display: flex !important; align-items: center !important; gap: 8px !important; min-width: 0 !important; }
.dyn-rt-label { font-size: 13px !important; font-weight: 500 !important; line-height: 1.5 !important; }
.dyn-rt-hint { font-size: 11.5px !important; line-height: 1.5 !important; color: var(--dsw-alias-label-tertiary, #8b8f95) !important; }
.dyn-rt-badge {
  padding: 0 7px !important;
  border-radius: 999px !important;
  font-size: 10.5px !important;
  line-height: 16px !important;
  color: var(--dsw-alias-label-secondary, #b6b9be) !important;
  background: var(--dyn-rt-soft) !important;
  white-space: nowrap !important;
}
.dyn-rt-reset {
  appearance: none !important;
  font: inherit !important;
  padding: 0 !important;
  border: 0 !important;
  background: none !important;
  font-size: 12px !important;
  line-height: 1.5 !important;
  cursor: pointer !important;
  color: var(--dsw-alias-label-secondary, #b6b9be) !important;
}
.dyn-rt-reset:hover:not(:disabled) { color: var(--dsw-alias-label-primary, #e6e6e6) !important; }
.dyn-rt-reset:disabled { cursor: default !important; opacity: .5 !important; }
.dyn-rt-control { display: flex !important; align-items: center !important; gap: 8px !important; flex: none !important; }

.dyn-rt-switch { position: relative !important; display: inline-flex !important; flex: none !important; width: 36px !important; height: 21px !important; }
.dyn-rt-switch input {
  position: absolute !important;
  inset: 0 !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  opacity: 0 !important;
  cursor: pointer !important;
}
.dyn-rt-switch input:disabled { cursor: default !important; }
.dyn-rt-switch span {
  position: absolute !important;
  inset: 0 !important;
  border-radius: 999px !important;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .35)) !important;
  background: var(--dyn-rt-soft) !important;
  transition: background .16s ease, border-color .16s ease !important;
  pointer-events: none !important;
}
.dyn-rt-switch span::after {
  content: '' !important;
  position: absolute !important;
  top: 2px !important;
  left: 2px !important;
  width: 15px !important;
  height: 15px !important;
  border-radius: 999px !important;
  background: var(--dsw-alias-label-tertiary, #8b8f95) !important;
  transition: transform .16s ease, background .16s ease !important;
}
.dyn-rt-switch input:checked + span {
  background: var(--dsw-alias-brand-primary, #4c8dff) !important;
  border-color: transparent !important;
}
.dyn-rt-switch input:checked + span::after { transform: translateX(15px) !important; background: #fff !important; }
.dyn-rt-switch input:focus-visible + span { outline: 2px solid var(--dsw-alias-brand-primary, #4c8dff) !important; outline-offset: 2px !important; }
.dyn-rt-switch input:disabled + span { opacity: .45 !important; }

.dyn-rt-numWrap { position: relative !important; display: inline-flex !important; align-items: center !important; }
.dyn-rt-input {
  box-sizing: border-box !important;
  width: 104px !important;
  height: 32px !important;
  padding: 0 30px 0 10px !important;
  font: inherit !important;
  font-size: 13px !important;
  text-align: right !important;
  color: var(--dsw-alias-label-primary, #e6e6e6) !important;
  border: .5px solid var(--dsw-alias-border-l4, rgba(127, 127, 127, .3)) !important;
  border-radius: 8px !important;
  background: var(--dsw-alias-bg-layer-3, transparent) !important;
}
.dyn-rt-input:focus-visible { border-color: var(--dsw-alias-brand-primary, #4c8dff) !important; outline: none !important; }
.dyn-rt-input:disabled { color: var(--dsw-alias-label-tertiary, #8b8f95) !important; cursor: default !important; }
.dyn-rt-input::-webkit-outer-spin-button,
.dyn-rt-input::-webkit-inner-spin-button { appearance: none !important; margin: 0 !important; }
.dyn-rt-unit {
  position: absolute !important;
  right: 9px !important;
  font-size: 11px !important;
  line-height: 1 !important;
  color: var(--dsw-alias-label-tertiary, #8b8f95) !important;
  pointer-events: none !important;
}

.dyn-rt-areaRow { display: block !important; margin-top: 8px !important; }
.dyn-rt-area {
  box-sizing: border-box !important;
  display: block !important;
  width: 100% !important;
  min-height: 76px !important;
  padding: 8px 10px !important;
  font: inherit !important;
  font-size: 12.5px !important;
  line-height: 1.6 !important;
  resize: vertical !important;
  color: var(--dsw-alias-label-primary, #e6e6e6) !important;
  border: .5px solid var(--dsw-alias-border-l4, rgba(127, 127, 127, .3)) !important;
  border-radius: 8px !important;
  background: var(--dsw-alias-bg-layer-3, transparent) !important;
}
.dyn-rt-area:focus-visible { border-color: var(--dsw-alias-brand-primary, #4c8dff) !important; outline: none !important; }
.dyn-rt-area:disabled { color: var(--dsw-alias-label-tertiary, #8b8f95) !important; }
.dyn-rt-areaFoot {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 12px !important;
  margin-top: 6px !important;
  font-size: 11.5px !important;
  color: var(--dsw-alias-label-tertiary, #8b8f95) !important;
}

.dyn-rt-foot {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  gap: 12px !important;
  padding: 10px 16px 13px !important;
  border-top: .5px solid var(--dsw-alias-border-l2, rgba(127, 127, 127, .3)) !important;
}
.dyn-rt-footText { font-size: 11.5px !important; line-height: 1.5 !important; color: var(--dsw-alias-label-tertiary, #8b8f95) !important; }
.dyn-rt-footText[data-tone='ok'] { color: var(--dsw-alias-state-success-primary, #35c46a) !important; }
.dyn-rt-footText[data-tone='error'] { color: var(--dsw-alias-state-error-primary, #f2555a) !important; }
.dyn-rt-footActions { display: flex !important; align-items: center !important; gap: 8px !important; flex: none !important; }

.dyn-rt-select {
  box-sizing: border-box !important;
  height: 32px !important;
  min-width: 128px !important;
  padding: 0 8px !important;
  font: inherit !important;
  font-size: 13px !important;
  line-height: 1.5 !important;
  color: var(--dsw-alias-label-primary, #e6e6e6) !important;
  border: .5px solid var(--dsw-alias-border-l4, rgba(127, 127, 127, .3)) !important;
  border-radius: 8px !important;
  background: var(--dsw-alias-bg-layer-3, transparent) !important;
}
.dyn-rt-select:focus-visible { border-color: var(--dsw-alias-brand-primary, #4c8dff) !important; outline: none !important; }
.dyn-rt-select:disabled { color: var(--dsw-alias-label-tertiary, #8b8f95) !important; cursor: default !important; }

/* Turn-rail marks: a turn this plugin continued through the "new turn" tier is
   only a round because the model had to be woken again, so the rail can either
   drop its mark or keep the mark and stop calling it an anonymous round. Both
   rules key off ONE attribute this plugin writes (see tagContinuedRailMarks), so
   they never match a turn the human started. */
[data-dyn-continued='hide'] { display: none !important; }
nav[data-dyn-continued-preview='1'] [class*='_previewPrompt'] { display: none !important; }
@media (max-width: 560px) {
  .dyn-rt-field { align-items: flex-start !important; }
  .dyn-rt-input { width: 88px !important; }
  .dyn-rt-foot { flex-direction: column !important; align-items: flex-start !important; }
}
`

		const EMPTY_WINDOW = { entries: [], hasMore: false, revision: -1, change: null }

		/** Glyph paths per state, drawn in a 16x16 box with a 2px stroke. */
		const GLYPHS = {
			continue: ['M13.2 8.4A5.3 5.3 0 1 1 9.5 3.1', 'M13.3 2.3v3.1H10.2'],
			done: ['M3.6 8.6l3 3 5.8-7.2'],
			error: ['M8 4.6v4.4', 'M8 11.5v.1'],
			chevron: ['M4.5 6.5L8 10l3.5-3.5'],
		}

		// #region core-logic
		/**
		 * The bundle's package name. The Plugins page keys a *bundle's* own
		 * configuration page by its package name, which is why this is the key the
		 * settings card registers under — not the locale namespace and not the
		 * profile entry id.
		 */
		const BUNDLE_NAME = 'dsh-restart-task'

		/**
		 * The profile entry id this package's `cordis.patch.yml` inserts, and
		 * therefore the identity its settings form addresses: `configForms` keys its
		 * forms by `entry.options.id`. It is deliberately not the package name (the
		 * loader convention for shipped entries is a short row id). Changing the row
		 * in `cordis.patch.yml` means changing this constant; the regression harness
		 * asserts the three agree.
		 */
		const ENTRY_ID = 'restart-task'

		/**
		 * The `source.kind` the host half stamps on every message it appends. Session
		 * format v4 requires a producer-owned kind — the producer's own name — and
		 * Chat renders exactly this string as the row's provenance label, which is
		 * how the transcript pass recognizes the plugin's own collapsed rows.
		 */
		const OWN_SOURCE_KIND = 'dsh-restart-task'

		/**
		 * The session-projection key the host half registers its rounds under. The
		 * projection seam delivers every registered key to the client whole, so this is
		 * the browser half's window-independent answer to "which rounds did this plugin
		 * open" — the client's own event window only ever holds one page.
		 */
		const ROUNDS_KEY = 'restartTaskRounds'

		/** Join the text blocks of one durable message content array. */
		function textOfContent(content) {
			if (!Array.isArray(content)) return ''
			let out = ''
			for (let i = 0; i < content.length; i += 1) {
				const block = content[i]
				if (block === null || typeof block !== 'object') continue
				if (block.type !== 'text' || typeof block.text !== 'string' || block.text === '') continue
				out = out === '' ? block.text : out + '\n' + block.text
			}
			return out
		}

		/**
		 * Read the last human prompt and the last turn outcome from one Session
		 * event window. Only leaf scalars are read; nothing live is copied.
		 */
		function analyzeWindow(eventWindow) {
			const result = { text: '', badEnd: '', failure: '' }
			if (eventWindow === null || eventWindow === undefined) return result
			const entries = eventWindow.entries
			if (!Array.isArray(entries)) return result
			for (let i = 0; i < entries.length; i += 1) {
				const entry = entries[i]
				if (entry === null || typeof entry !== 'object' || entry.type !== 'event') continue
				const event = entry.event
				if (event === null || typeof event !== 'object' || typeof event.type !== 'string') continue
				if (event.type === 'user/message') {
					const data = event.data
					if (data === null || typeof data !== 'object') continue
					const source = data.source
					const kind = source !== null && typeof source === 'object' && typeof source.kind === 'string' ? source.kind : ''
					// Only human prompts count: injected context, tool results,
					// subagent messages, skill invocations, goal rounds and this
					// plugin's own continuation carry other source kinds.
					if (kind !== 'user' && kind !== 'user-rpc') continue
					const text = textOfContent(data.content)
					if (text !== '') result.text = text
					continue
				}
				if (event.type === 'turn/end') {
					const data = event.data
					const reason = data !== null && typeof data === 'object' ? data.reason : null
					const kind = reason !== null && typeof reason === 'object' && typeof reason.kind === 'string' ? reason.kind : ''
					if (kind === 'error' || kind === 'aborted' || kind === 'interrupted') {
						result.badEnd = kind
						const failure = reason !== null && typeof reason === 'object' ? reason.error : null
						result.failure = failure !== null && typeof failure === 'object' && typeof failure.message === 'string' ? failure.message : ''
					} else {
						result.badEnd = ''
						result.failure = ''
					}
				}
			}
			return result
		}

		function errorText(error) {
			if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
			return String(error)
		}

		/**
		 * The rounds a session window shows this plugin *opening*.
		 *
		 * A turn's input is appended **after** its `turn/start`, never before it: the
		 * durable order for a continuation is
		 * `turn/start(7)` → `user/message(source.kind: dsh-restart-task)` → … , so a
		 * message opens the round it lands in exactly when it is that turn's **first**
		 * input. Tiers 1 and 3 post through the next-turn inbox, which is why the
		 * product renders their row as its non-human trigger notice; a tier-2 steer is
		 * claimed by a step of an already-open turn, so it is never the first input and
		 * never gains a round of its own.
		 *
		 * The walk is in append order: `turn/start` names the turn in force and opens
		 * its input slot, any `user/message` consumes it, and `turn/end` closes it.
		 * One assumption is worth naming: injected context appended *before* the
		 * claimed input (the `runtime-context` / `agent-instructions` family) would
		 * consume the slot and cost this plugin its attribution. Every observed turn
		 * appends the claimed input first and the injections after it, and a lost
		 * attribution only means a row this plugin cannot prove is its own keeps
		 * rendering.
		 *
		 * @param eventWindow - one Session event window (`{ entries }`).
		 * @returns the turn numbers this plugin opened, as strings, in window order.
		 */
		function ownWakingTurns(eventWindow) {
			const out = []
			const entries = eventWindow !== null && typeof eventWindow === 'object' && Array.isArray(eventWindow.entries)
				? eventWindow.entries
				: []
			let turn = ''
			// Nothing belongs to a turn before that turn has started.
			let spoke = true
			for (let i = 0; i < entries.length; i += 1) {
				const entry = entries[i]
				if (entry === null || typeof entry !== 'object' || entry.type !== 'event') continue
				const event = entry.event
				if (event === null || typeof event !== 'object' || typeof event.type !== 'string') continue
				const data = event.data
				if (event.type === 'turn/start') {
					const value = data !== null && typeof data === 'object' ? data.turn : undefined
					turn = typeof value === 'number' ? String(value) : ''
					spoke = false
					continue
				}
				if (event.type === 'turn/end') {
					spoke = true
					continue
				}
				if (event.type !== 'user/message') continue
				const source = data !== null && typeof data === 'object' ? data.source : undefined
				const kind = source !== null && typeof source === 'object' && typeof source.kind === 'string' ? source.kind : ''
				const opening = spoke !== true
				spoke = true
				if (opening === true && kind === OWN_SOURCE_KIND && turn !== '') out.push(turn)
			}
			return out
		}

		function resultFailureText(result) {
			if (result !== null && typeof result === 'object') {
				if (result.ok === false) {
					const error = result.error
					if (error !== null && typeof error === 'object' && typeof error.message === 'string') return error.message
					return '请求被拒绝'
				}
				if (typeof result.message === 'string') return result.message
			}
			return '未知原因'
		}

		/**
		 * The single decision point: does the composer need a recovery control,
		 * which action should it perform, and why.
		 *
		 * - `continue` — the last turn ended error/aborted/interrupted, or an agent
		 *   error was reported: the work is already in history, so the action asks
		 *   the host to carry on and posts no user text at all.
		 * - `resend` — only the last *send* failed, so there is nothing in history
		 *   to continue from and the prompt has to be posted again.
		 */
		function restartAffordance(input) {
			const state = analyzeWindow(input.eventWindow)
			const agentError = typeof input.agentError === 'string' ? input.agentError : ''
			const promptFailed = input.promptFailed === true
			const brokenTurn = state.badEnd === 'error' || state.badEnd === 'aborted' || state.badEnd === 'interrupted'
			const mode = brokenTurn === true || agentError !== '' ? 'continue' : (promptFailed === true ? 'resend' : '')
			const idle = input.running !== true && input.blank !== true && input.removed !== true
			let reason = ''
			if (state.badEnd === 'error') reason = '上次模型请求失败' + (state.failure !== '' ? '：' + state.failure : '')
			else if (state.badEnd === 'aborted') reason = '上次任务被中断'
			else if (state.badEnd === 'interrupted') reason = '上次任务因进程中断而被关闭'
			else if (agentError !== '') reason = '上次执行出错：' + agentError
			else if (promptFailed === true) reason = '上次发送未成功'
			const hint = mode === 'continue'
				? '点击从中断处继续，不会重复你的消息。'
				: (mode === 'resend' ? '点击重新发送上一条请求。' : '')
			return {
				show: idle === true && (mode === 'continue' || (mode === 'resend' && state.text !== '')),
				mode: mode,
				text: state.text,
				reason: reason,
				title: reason === '' ? hint : reason + '。' + hint,
			}
		}

		function numberOr(value, fallback) {
			return typeof value === 'number' && Number.isFinite(value) ? value : fallback
		}

		/**
		 * Whether the Host this page is talking to serves one settings field.
		 *
		 * `servedKeys` is `null` while the snapshot is still loading, which reads
		 * as "served" so a loading card never looks broken. Once the Host has
		 * answered, its schema-resolved section lists every field it knows, so a
		 * field missing from that list means the browser half is newer than the
		 * running Host — the case right after a client-only update, before the
		 * profile is restarted. Such a row is shown as read-only with the reason
		 * instead of accepting a write the Host would reject.
		 */
		function fieldIsServed(servedKeys, field) {
			if (servedKeys === null || servedKeys === undefined) return true
			if (!Array.isArray(servedKeys)) return true
			return servedKeys.indexOf(field) >= 0
		}

		/** How the turn rail may present a round this plugin opened. */
		const RAIL_MARK_MODES = ['hide', 'preview', 'keep']

		/**
		 * Normalize the rail-mark setting. A stored value outside the vocabulary
		 * (a hand-edited settings file, or a field an older client wrote) falls
		 * back to hiding, so the rail can never end up in a half-applied state.
		 */
		function railMarkMode(value) {
			return typeof value === 'string' && RAIL_MARK_MODES.indexOf(value) >= 0 ? value : 'hide'
		}

		/**
		 * The plugin's effective policy as short chips, read from the settings the
		 * card edits. Pure, so a test can assert on the wording rules directly.
		 */
		function policySummary(value) {
			const source = value !== null && typeof value === 'object' ? value : {}
			const chips = []
			if (source.retryFailedRequests === false) chips.push({ text: '失败不自动重试', tone: 'off' })
			else if (source.retryForever === true) chips.push({ text: '失败静默重试（不限次）', tone: 'on' })
			else chips.push({ text: '失败静默重试 ' + numberOr(source.maxRequestRetries, 3) + ' 次', tone: 'on' })
			if (source.keepAliveOnMaxTokens === false) chips.push({ text: '输出超限不续写', tone: 'off' })
			else chips.push({ text: '输出超限同轮续写', tone: 'on' })
			if (source.autoContinue === true) chips.push({ text: '中断后自动开新一轮', tone: 'alert' })
			else chips.push({ text: '中断后不自动继续', tone: 'off' })
			return chips
		}
		// #endregion core-logic

		/**
		 * Required client services. `configForms` is deliberately *not* here: the
		 * settings surfaces are acquired through an optional child inside `apply`, so
		 * a composition without the settings domain still gets the composer control.
		 * `timer` is what debounces both DOM passes.
		 */
		const inject = ['slots', 'timer']

		/** Fields the card edits, with the schema default each one falls back to. */
		const DEFAULTS = {
			retryFailedRequests: true,
			maxRequestRetries: 3,
			retryForever: false,
			retryBaseDelayMs: 2000,
			keepAliveOnMaxTokens: true,
			maxTurnContinues: 5,
			autoContinue: false,
			delayMs: 1500,
			maxConsecutive: 3,
			onAborted: true,
			onError: true,
			onInterrupted: true,
			sendBecomesContinue: true,
			hideContinueRow: true,
			continuedRailMarks: 'hide',
			continueText: '',
		}

		/** Read one field's effective value: user layer, then schema default. */
		function readField(value, field) {
			const source = value !== null && typeof value === 'object' ? value : {}
			const current = source[field]
			if (typeof DEFAULTS[field] === 'boolean') return current === undefined ? DEFAULTS[field] : current === true
			if (typeof DEFAULTS[field] === 'number') return numberOr(current, DEFAULTS[field])
			return typeof current === 'string' ? current : DEFAULTS[field]
		}

		/** Whether the raw user layer carries this field (presence, not value). */
		function isOverridden(user, field) {
			if (user === null || typeof user !== 'object') return false
			return Object.prototype.hasOwnProperty.call(user, field)
		}

		/** One inline SVG in a 16x16 box. */
		function glyph(shape, size, extra) {
			const paths = (GLYPHS[shape] ?? []).map((d, index) => React.createElement('path', { key: index, d: d }))
			const props = {
				width: size,
				height: size,
				viewBox: '0 0 16 16',
				fill: 'none',
				stroke: 'currentColor',
				strokeWidth: 2,
				strokeLinecap: 'round',
				strokeLinejoin: 'round',
				'aria-hidden': 'true',
				focusable: 'false',
			}
			if (extra !== undefined && extra !== null) {
				const keys = Object.keys(extra)
				for (let i = 0; i < keys.length; i += 1) props[keys[i]] = extra[keys[i]]
			}
			return React.createElement('svg', props, paths)
		}

		/**
		 * The one rule that keeps a continuation invisible in the transcript.
		 *
		 * Chat renders an appended `user/message` whose `source.kind` is not `'user'`
		 * as a collapsed context row, and one that *opens* a turn as the product's
		 * non-human trigger notice; either way the row is a fact a plugin cannot opt
		 * out of on the host side. Neither row can be addressed from a stylesheet:
		 * the context row's provenance span carries a valueless
		 * `data-context-source` and spells the producer's name as **text**, which no
		 * selector can match, and the trigger notice carries no provenance at all.
		 *
		 * So the transcript pass below tags this plugin's own rows with its own
		 * attribute — in JavaScript, where the text is readable — and this rule acts
		 * on that attribute alone. Another producer's row (time context, AGENTS.md,
		 * skills, cron, subagent settlements, goal rounds) is never tagged and never
		 * hidden.
		 */
		const OWN_ROW_ATTR = 'data-dyn-restart-row'
		const HIDE_CONTINUE_CSS = '[data-chat-flow-kind="context"][' + OWN_ROW_ATTR + '="1"], [data-chat-flow-kind="turn-trigger"][' + OWN_ROW_ATTR + '="1"] { display: none !important; }'

		/**
		 * The shipped send button, while this plugin has taken it over.
		 *
		 * The composer's primary control is inline JSX with no slot, so the only way
		 * to change what it *is* is to change the element: this plugin's own attribute
		 * marks it, and the stylesheet dresses it as "continue". Nothing here touches
		 * `class` — React rewrites that — and the attribute is removed the moment the
		 * takeover no longer applies.
		 */
		const SEND_ATTR = 'data-dyn-continue'
		/** The result the control reports, mirrored onto the button for the stylesheet. */
		const SEND_STATE_ATTR = 'data-dyn-continue-state'
		/** What the button is called while it carries the continuation. */
		const CONTINUE_LABEL = '继续上次任务'
		/**
		 * While the send button carries the action, the round control in the action
		 * cluster steps aside: two identical affordances 20px apart is a bug, not a
		 * feature. `:has()` is safe here — Electron ships the Chromium that has it.
		 */
		const COMPOSER_BUTTON_CSS = '[data-composer-card]:has(button[' + SEND_ATTR + '="1"]) .dyn-retry-round { display: none !important; }'

		function apply(ctx) {
			ctx.effect(() => {
				const tag = document.createElement('style')
				// The module system owns styles by `data-plugin`: an untagged tag is
				// adopted by whichever plugin materializes next and removed when *that*
				// plugin unloads, so both tags below must name their owner.
				tag.dataset.plugin = BUNDLE_NAME
				tag.dataset.pluginCss = BUNDLE_NAME + '/restart-task.css'
				tag.dataset.dynRestartTask = '1'
				tag.textContent = CSS_TEXT
				document.head.append(tag)
				return () => { tag.remove() }
			}, 'restart-task: stylesheet')

			// ---- shared between the parts ---------------------------------------
			/** A tiny publish/subscribe cell: one current value plus listeners. */
			function createHub() {
				const listeners = new Set()
				return {
					current: null,
					publish(value) {
						if (value === this.current) return
						this.current = value
						listeners.forEach((listener) => {
							try { listener() } catch (error) { void error }
						})
					},
					subscribe(listener) {
						listeners.add(listener)
						return () => { listeners.delete(listener) }
					},
				}
			}

			/**
			 * The live event window of the session the transcript is rendering.
			 *
			 * The composer control is mounted for the session on screen, and it is the
			 * only part of this plugin that is handed a session id (`props.sessionId`),
			 * so it publishes the window it already subscribes to here. The transcript
			 * pass reads it to attribute a *trigger* row — the one shape of this
			 * plugin's own row that carries no provenance at all.
			 */
			const transcriptWindow = createHub()

			/**
			 * What the composer control decided this moment, published for the transcript
			 * pass: whether a continuation is on offer at all, for which session, and the
			 * outcome it is currently reporting. The send button is handed the same
			 * action the round control runs, so it needs the same inputs.
			 */
			const affordance = createHub()

			/**
			 * The rounds the host's `ROUNDS_KEY` projection reports for the session on
			 * screen. Published by the composer control, which is the part of the plugin
			 * that holds the session binding; an absent projection simply publishes nothing
			 * and leaves the window-derived attribution in charge.
			 */
			const projectionRounds = createHub()

			/**
			 * The shared configuration form for this plugin's entry, once the settings
			 * domain is there. Apply-scope on purpose: the card's components are
			 * declared at this scope and render only while the child below has
			 * registered them.
			 */
			let scope = null

			// ---- the composer control -------------------------------------------
			// The action cluster is part of the composer, not of the settings domain,
			// so it is registered unconditionally: a composition without settings keeps
			// the manual continue control.
			ctx.slots.inject('conversation.input.right', () => ctx.slots.register(
				{ name: 'conversation.input.right', id: 'restart-task', order: 20, label: '继续任务' },
				RetryRoundButton,
			))

			// ---- everything that reads settings ---------------------------------
			// `configForms` is the 0.1.7 settings transport: one shared form per
			// profile entry, addressed by entry id, with immediate writes. Optional —
			// when the settings domain is not composed, the card and both transcript
			// passes stay away and the composer control keeps working.
			ctx.inject(['configForms'], (fctx) => {
				const forms = fctx.configForms
				if (forms === undefined || forms === null || typeof forms.get !== 'function') return
				scope = forms.get(ENTRY_ID)
				const readValue = () => {
					const snapshot = scope.getSnapshot()
					return snapshot !== null && typeof snapshot === 'object' ? snapshot.value : undefined
				}

				// A continuation row this plugin posted is pure plumbing: it exists so
				// the model can see the instruction, not so the human can read it again.
				// Hiding it is opt-out, live, and limited to this plugin's own rows.
				fctx.effect(() => {
					const tag = document.createElement('style')
					tag.dataset.plugin = BUNDLE_NAME
					tag.dataset.pluginCss = BUNDLE_NAME + '/restart-task-rows.css'
					tag.dataset.dynRestartTaskRows = '1'
					document.head.append(tag)
					const sync = () => {
						const value = readValue()
						const served = value !== null && typeof value === 'object'
						const hide = served === false ? true : value.hideContinueRow !== false
						const takeover = served === false ? true : value.sendBecomesContinue !== false
						tag.textContent = (hide === true ? HIDE_CONTINUE_CSS : '')
							+ (takeover === true ? COMPOSER_BUTTON_CSS : '')
					}
					sync()
					const unsubscribe = scope.subscribe(sync)
					return () => {
						try { unsubscribe() } catch (error) { void error }
						tag.remove()
					}
				}, 'restart-task: continuation row visibility')

				/**
				 * The transcript pass: find this plugin's own rows, and present the rail
				 * for the rounds it opened.
				 *
				 * Chat gives a plugin-sourced message one of two shapes, and neither can
				 * be addressed from a stylesheet:
				 *
				 * - a collapsed **context row**, whose provenance span carries a valueless
				 *   `data-context-source` and spells the producer's name as text;
				 * - a **non-human trigger notice** (`data-chat-flow-kind="turn-trigger"`)
				 *   when that message opens a turn, which carries no provenance at all —
				 *   an unknown source kind is not even distinguished from a request
				 *   trigger, so only the session window says whose it is.
				 *
				 * A pass is therefore unavoidable, and it only ever writes this plugin's
				 * own attribute:
				 *
				 * 1. Every context row whose provenance label is exactly this plugin's
				 *    source kind is ours.
				 * 2. Every trigger row in a round this plugin opened is ours, where the
				 *    rounds come from the live window (`ownWakingTurns`) rather than from
				 *    anything the DOM carries. With no window yet — the composer control
				 *    publishes it for the session on screen — this rule is skipped, and
				 *    the first rule alone still hides the in-turn tier's rows.
				 * 3. A rail mark for one of the *rounds* the window attributes to this
				 *    plugin is tagged with the configured mode, matched through the mark's
				 *    accessible label (the only per-turn attribute it has). The round set,
				 *    not the tagged rows, is the source here: a tier-2 steer makes a row
				 *    inside the human's own round this plugin's to hide, but that round's
				 *    rail mark is not this plugin's to touch.
				 *
				 * Rows are tagged regardless of the hide switch, because the rail uses the
				 * same set; the stylesheet is what hides them, and it is synced live from
				 * the setting. The pass is idempotent (React re-renders leave foreign
				 * attributes alone), and inert when the rail mode is `keep`: every tag it
				 * owns is cleared again.
				 */
				function createTranscriptPass() {
					const observer = new MutationObserver(() => schedule())
					let timer = null
					let disposed = false
					/** Buttons this pass currently holds, so a release can restore them. */
					const held = new Set()
					/**
					 * Rounds attributed to this plugin so far, and the session they belong to.
					 *
					 * Attribution accumulates on purpose. The event window is *paged*: folding
					 * a completed round or loading another slice can hand the composer control
					 * a window that no longer contains our message, and a rule recomputed from
					 * that window alone would forget a round it had already recognised — the
					 * rail mark would come back until the next slice arrived. A round this
					 * plugin opened stays opened for the whole session, so the set only grows,
					 * and it starts over when the transcript moves to another session.
					 */
					let ownedRounds = new Set()
					let ownedSession

					function railTag() {
						const value = readValue()
						const mode = railMarkMode(value !== null && typeof value === 'object' ? value.continuedRailMarks : undefined)
						return mode === 'keep' ? '' : mode
					}

					/** Whether the send-button takeover is switched on. */
					function sendTakeoverOn() {
						const value = readValue()
						return value === null || typeof value !== 'object' ? true : value.sendBecomesContinue !== false
					}

					/** The composer's own primary control (`<hash>_primary`), per composer card. */
					function primaryButtons() {
						const found = []
						const cards = document.querySelectorAll('[data-composer-card]')
						for (let i = 0; i < cards.length; i += 1) {
							const buttons = cards[i].querySelectorAll('button[class*="_primary"]')
							for (let j = 0; j < buttons.length; j += 1) found.push(buttons[j])
						}
						return found
					}

					/** Hand one button back, leaving `disabled` to the product's next render. */
					function releaseButton(button) {
						held.delete(button)
						button.removeAttribute(SEND_ATTR)
						button.removeAttribute(SEND_STATE_ATTR)
						button.removeAttribute('title')
						const previous = button.dataset.dynContinueLabel
						delete button.dataset.dynContinueLabel
						if (typeof previous === 'string' && previous !== '') button.setAttribute('aria-label', previous)
						// A wrongly enabled send button refuses an empty draft anyway, while a
						// wrongly disabled one would eat the human's own message — so this
						// deliberately does not write `disabled`.
					}

					/**
					 * Make the shipped send button carry the continuation.
					 *
					 * Only ever a control the product cannot use: an empty composer disables
					 * it (`empty || blocked || uploadsPending`), and a composer the human is
					 * typing in must keep sending what they typed — that is the whole reason
					 * the takeover is gated on `disabled` rather than on our mode alone.
					 * Clearing `disabled` is what makes the button clickable at all; React
					 * only rewrites it when its own props change, and our own observer puts
					 * the takeover back if it ever does.
					 */
					function applySendButton(state, enabled) {
						const wanted = enabled === true && state !== null && state.mode === 'continue'
						const buttons = primaryButtons()
						for (let i = 0; i < buttons.length; i += 1) {
							const button = buttons[i]
							const ours = held.has(button)
							if (wanted === true) {
								if (ours !== true && button.disabled !== true) continue
								if (ours !== true) {
									button.dataset.dynContinueLabel = button.getAttribute('aria-label') ?? ''
									held.add(button)
								}
								button.setAttribute(SEND_ATTR, '1')
								button.setAttribute(SEND_STATE_ATTR, state.state)
								button.setAttribute('aria-label', CONTINUE_LABEL)
								button.setAttribute('title', state.message !== '' ? state.message : state.title)
								if (button.disabled === true) button.disabled = false
								continue
							}
							if (ours === true) releaseButton(button)
						}
					}

					/** Whether one provenance span is this plugin's: the label is its kind. */
					function spanIsOurs(span) {
						return span.textContent !== null && span.textContent.trim() === OWN_SOURCE_KIND
					}

					/**
					 * The rounds this plugin opened, as far as everything seen has shown.
					 *
					 * Two sources feed it, and neither is enough alone:
					 *
					 * - the **session window** the composer control publishes, which is what the
					 *   browser half can read live but only ever holds one *page* of events;
					 * - the host's **`ROUNDS_KEY` projection**, folded over the whole log and
					 *   delivered whole by the projection seam, which is the only way a round
					 *   whose events are not loaded — the very case that left a `第 N 轮` mark
					 *   showing on a folded or paged transcript — can still be attributed.
					 *
					 * Whatever either source says is remembered while the transcript stays on one
					 * session, so a window that pages older rounds away, or a fold that replaces
					 * it, cannot retract a round. The set starts over when the transcript moves to
					 * another session.
					 */
					function ownedTurns() {
						const state = affordance.current
						const session = state === null || state === undefined ? undefined : state.sessionId
						if (session !== ownedSession) {
							ownedSession = session
							ownedRounds = new Set()
						}
						const published = projectionRounds.current
						if (Array.isArray(published) === true) {
							for (let i = 0; i < published.length; i += 1) ownedRounds.add(String(published[i]))
						}
						const seen = ownWakingTurns(transcriptWindow.current)
						for (let i = 0; i < seen.length; i += 1) ownedRounds.add(seen[i])
						return ownedRounds
					}

					/**
					 * Tag the rows this plugin produced.
					 *
					 * A tag is written once and left alone while it still describes the row;
					 * a row that stops being ours has it removed. The rounds come from the
					 * window rather than from the tags, so the hide rule and the rail agree on
					 * the same set even while a row is virtualized out of the document.
					 */
					function tagOwnRows(turns) {
						const wanted = new Set()
						const spans = document.querySelectorAll('[data-context-source]')
						for (let i = 0; i < spans.length; i += 1) {
							if (spanIsOurs(spans[i]) !== true) continue
							const row = spans[i].closest('[data-chat-flow-kind]')
							if (row !== null) wanted.add(row)
						}
						if (turns.size > 0) {
							const triggers = document.querySelectorAll('[data-chat-flow-kind="turn-trigger"]')
							for (let i = 0; i < triggers.length; i += 1) {
								// The row carries its own turn; if a release ever nests it, the
								// nearest holder still names the round it belongs to.
								const holder = typeof triggers[i].closest === 'function' ? triggers[i].closest('[data-chat-turn]') : null
								const turn = holder === null ? null : holder.getAttribute('data-chat-turn')
								if (turn !== null && turn !== '' && turns.has(turn)) wanted.add(triggers[i])
							}
						}
						const tagged = document.querySelectorAll('[' + OWN_ROW_ATTR + ']')
						for (let i = 0; i < tagged.length; i += 1) {
							if (wanted.has(tagged[i]) !== true) tagged[i].removeAttribute(OWN_ROW_ATTR)
						}
						wanted.forEach((row) => {
							if (row.getAttribute(OWN_ROW_ATTR) !== '1') row.setAttribute(OWN_ROW_ATTR, '1')
						})
					}

					/**
					 * The turn number behind one rail mark. The label is localized
					 * ("跳转到第 3 轮" / "Jump to turn 3"), so the digits are the only part
					 * that means the same thing in every language.
					 */
					function markTurn(mark) {
						const label = mark === null ? null : mark.getAttribute('aria-label')
						if (label === null) return ''
						const digits = label.replace(/[^0-9]/g, '')
						return digits === '' ? '' : String(Number(digits))
					}

					function applyRail(nav, ours, tag) {
						const marks = nav.querySelectorAll('[class*="_marks"] button[data-index]')
						for (let i = 0; i < marks.length; i += 1) {
							const mark = marks[i]
							const turn = markTurn(mark)
							const wanted = turn !== '' && ours.has(turn) ? tag : ''
							const current = mark.getAttribute('data-dyn-continued') ?? ''
							if (current === wanted) continue
							if (wanted === '') mark.removeAttribute('data-dyn-continued')
							else mark.setAttribute('data-dyn-continued', wanted)
						}
						compactRail(nav, marks)
						// The hover card is a sibling of the marks, so "this preview belongs
						// to a continued round" is carried on the rail itself.
						const preview = nav.querySelector('[role="tooltip"][class*="_preview"]')
						const described = preview === null ? null : preview.getAttribute('id')
						let previewOurs = false
						if (described !== null && described !== '') {
							const mark = nav.querySelector('button[aria-describedby="' + described + '"]')
							previewOurs = mark !== null && mark.getAttribute('data-dyn-continued') === 'preview'
						}
						if (previewOurs === true) nav.setAttribute('data-dyn-continued-preview', '1')
						else nav.removeAttribute('data-dyn-continued-preview')
					}

					/**
					 * Close the hole a hidden mark leaves behind.
					 *
					 * `hide` is `display: none` on the mark, but the rail's virtualizer
					 * reserves that round's place: it sizes the marks container from its own
					 * measurements and never reflows it, so the round's slot stayed as empty
					 * space in the middle of the rail. The product writes no per-mark geometry
					 * at all (the container's height is the virtualizer's, the marks carry no
					 * position of their own), so the only honest fix is to measure what is on
					 * screen and compensate: every mark after a hidden one moves up by one
					 * pitch, and the container shrinks by the number of hidden marks.
					 *
					 * Both overrides are inline `!important` properties of this plugin's own
					 * making (`--dyn-rail-*` bookkeeping attributes), recomputed on every pass
					 * and removed the moment nothing is hidden — including on unload — so the
					 * rail returns to exactly what the product drew.
					 */
					function compactRail(nav, marks) {
						const container = marks.length > 0 && typeof marks[0].closest === 'function'
							? marks[0].closest('[class*="_marks"]')
							: null
						if (container === null) return
						// The advance one mark occupies, from the marks actually on screen.
						let pitch = 0
						for (let i = 1; i < marks.length; i += 1) {
							const delta = marks[i].offsetTop - marks[i - 1].offsetTop
							if (delta > 0 && (pitch === 0 || delta < pitch)) pitch = delta
						}
						if (pitch <= 0) {
							for (let i = 0; i < marks.length; i += 1) {
								const size = marks[i].offsetHeight
								if (size > 0) {
									pitch = size
									break
								}
							}
						}
						let shift = 0
						let hidden = 0
						for (let i = 0; i < marks.length; i += 1) {
							const mark = marks[i]
							const isHidden = mark.getAttribute('data-dyn-continued') === 'hide'
							if (isHidden === true) {
								hidden += 1
								shift += pitch > 0 ? pitch : 0
								continue
							}
							if (shift > 0 && mark.style !== undefined) {
								mark.style.setProperty('transform', 'translateY(-' + String(shift) + 'px)', 'important')
								mark.setAttribute('data-dyn-rail-shifted', String(shift))
							} else if (mark.getAttribute('data-dyn-rail-shifted') !== null) {
								clearRailShift(mark)
							}
						}
						if (hidden > 0 && pitch > 0 && container.style !== undefined) {
							const height = container.offsetHeight
							if (height > 0) {
								container.style.setProperty('height', String(Math.max(0, height - hidden * pitch)) + 'px', 'important')
								container.setAttribute('data-dyn-rail-compacted', '1')
							}
						} else if (container.getAttribute('data-dyn-rail-compacted') !== null) {
							container.style.removeProperty('height')
							container.removeAttribute('data-dyn-rail-compacted')
						}
					}

					/** Undo one mark's compaction offset, if this plugin wrote one. */
					function clearRailShift(mark) {
						mark.removeAttribute('data-dyn-rail-shifted')
						if (mark.style !== undefined) mark.style.removeProperty('transform')
					}

					function sweep() {
						// The rounds this plugin opened, accumulated across every window seen: a
						// steered row inside a round the human started is this plugin's to hide,
						// but that round's rail mark is not this plugin's to touch.
						const ours = ownedTurns()
						tagOwnRows(ours)
						// The shipped send button carries the same action the round control does,
						// whenever a continuation is on offer and the composer has nothing else to
						// send.
						applySendButton(affordance.current, sendTakeoverOn())
						const tag = railTag()
						// The rail is a sibling of the transcript scroller, not a descendant of
						// it, so a rail mark is matched by turn against the whole document.
						const navs = document.querySelectorAll('nav[class*="_frame"]')
						for (let i = 0; i < navs.length; i += 1) applyRail(navs[i], ours, tag)
					}

					function schedule() {
						if (disposed === true || timer !== null) return
						timer = ctx.timeout(() => {
							timer = null
							if (disposed === true) return
							try {
								sweep()
							} catch (error) {
								// A transcript this pass cannot read is a cosmetic loss, never
								// a functional one: leave the view exactly as the product drew it.
								void error
							}
						}, 120)
					}

					return {
						start() {
							const target = document.body ?? document.documentElement
							if (target === null || target === undefined) return () => {}
							// Attribute changes matter as much as added nodes: React writes
							// `disabled`/`aria-label` back onto the control this pass holds.
							observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'class', 'aria-label'] })
							const unsubscribeWindow = transcriptWindow.subscribe(() => schedule())
							const unsubscribeAffordance = affordance.subscribe(() => schedule())
							const unsubscribe = scope.subscribe(() => schedule())
							schedule()
							return () => {
								disposed = true
								observer.disconnect()
								try { unsubscribeWindow() } catch (error) { void error }
								try { unsubscribeAffordance() } catch (error) { void error }
								try { unsubscribe() } catch (error) { void error }
								if (timer !== null) {
									try { timer() } catch (error) { void error }
									timer = null
								}
								Array.from(held).forEach((button) => {
									try { releaseButton(button) } catch (error) { void error }
								})
								const tagged = document.querySelectorAll('[' + OWN_ROW_ATTR + ']')
								for (let i = 0; i < tagged.length; i += 1) tagged[i].removeAttribute(OWN_ROW_ATTR)
								const marked = document.querySelectorAll('[data-dyn-continued]')
								for (let i = 0; i < marked.length; i += 1) marked[i].removeAttribute('data-dyn-continued')
								const flagged = document.querySelectorAll('[data-dyn-continued-preview]')
								for (let i = 0; i < flagged.length; i += 1) flagged[i].removeAttribute('data-dyn-continued-preview')
								// Leave the rail exactly as the product drew it: no offsets, no
								// shrunk container.
								const shifted = document.querySelectorAll('[data-dyn-rail-shifted]')
								for (let i = 0; i < shifted.length; i += 1) clearRailShift(shifted[i])
								const compacted = document.querySelectorAll('[data-dyn-rail-compacted]')
								for (let i = 0; i < compacted.length; i += 1) {
									if (compacted[i].style !== undefined) compacted[i].style.removeProperty('height')
									compacted[i].removeAttribute('data-dyn-rail-compacted')
								}
							}
						},
						sweep: schedule,
					}
				}

				fctx.effect(() => {
					if (typeof MutationObserver !== 'function') return () => {}
					return createTranscriptPass().start()
				}, 'restart-task: transcript rows and turn rail marks')

				/**
				 * The shipped send button, once taken over, must not also submit.
				 *
				 * The product's own handler rides React's listener on the root container,
				 * which is *below* this capture listener, so stopping the event here is what
				 * keeps the two from both firing. Everything else — every click anywhere
				 * else in the window — passes straight through.
				 */
				fctx.effect(() => {
					const onClick = (event) => {
						const target = event === null || event === undefined ? null : event.target
						const button = target !== null && typeof target.closest === 'function'
							? target.closest('button[' + SEND_ATTR + '="1"]')
							: null
						if (button === null) return
						if (typeof event.preventDefault === 'function') event.preventDefault()
						if (typeof event.stopPropagation === 'function') event.stopPropagation()
						if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation()
						runContinuation()
					}
					document.addEventListener('click', onClick, true)
					return () => {
						try { document.removeEventListener('click', onClick, true) } catch (error) { void error }
					}
				}, 'restart-task: the send button runs the continuation')

				/**
				 * Run the continuation from the taken-over send button.
				 *
				 * It clicks the composer control rather than re-implementing the action, so
				 * both affordances share one busy guard, one outcome flash and one double-click
				 * fence — the hidden round control is still mounted and still clickable.
				 */
				function runContinuation() {
					const control = document.querySelector('.dyn-retry-round')
					if (control !== null && typeof control.click === 'function') {
						control.click()
						return
					}
					const state = affordance.current
					if (state === null || state.sessionId === undefined || state.sessionId === null) return
					const session = sessionOf(state.sessionId)
					if (session === undefined || session === null) return
					try {
						Promise.resolve(session.command('/continue-task')).catch((error) => { void error })
					} catch (error) {
						void error
					}
				}

				// The card is this bundle's own configuration page on the Plugins page.
				// A bundle's page is keyed by the bundle's package name, and the page
				// withholds the seat entirely while the host does not serve the entry —
				// so a deployment that never mounted this plugin's row shows no trace.
				fctx.effect(() => forms.whileServed([ENTRY_ID], () => fctx.slots.inject(
					'plugins.bundle.config',
					() => fctx.slots.register(
						{ name: 'plugins.bundle.config', key: BUNDLE_NAME },
						SettingsCard,
					),
				)), 'restart-task: Plugins-page configuration card')
			})

			/** Live Session face for one id, or undefined while the service is absent. */
			function sessionOf(sessionId) {
				const sessions = ctx.get('sessions')
				const binding = sessions !== undefined && sessions !== null && sessionId !== undefined && sessionId !== null
					? sessions.binding(sessionId)
					: undefined
				return binding !== undefined && binding !== null ? binding.session : undefined
			}

			/**
			 * Round recovery control in the composer action cluster, immediately left
			 * of the shipped submit button. It exists only while the last turn is
			 * broken, so the resting composer stays exactly as shipped — and its
			 * result is reported inside itself (glyph, colour, tooltip), never by
			 * inserting a row that would reflow the composer.
			 */
			function RetryRoundButton(props) {
				const sessionId = props.sessionId
				const useSession = props.useSession

				const running = useSession((s) => s.running === true)
				const blank = useSession((s) => s.blank === true)
				const removed = useSession((s) => s.removed === true)
				const promptFailed = useSession((s) => s.promptError !== null && s.promptError !== undefined)
				const agentError = useSession((s) => (typeof s.lastAgentError === 'string' ? s.lastAgentError : ''))

				const sessions = ctx.get('sessions')
				const binding = sessions !== undefined && sessions !== null && sessionId !== undefined && sessionId !== null
					? sessions.binding(sessionId)
					: undefined
				const source = binding !== undefined && binding !== null ? binding.eventSource : undefined

				const store = React.useMemo(() => {
					if (source === undefined || source === null) {
						return {
							subscribe: () => () => {},
							getSnapshot: () => EMPTY_WINDOW,
						}
					}
					return {
						subscribe: (listener) => source.subscribe(listener),
						getSnapshot: () => source.getSnapshot(),
					}
				}, [source])

				const [eventWindow, setEventWindow] = React.useState(() => store.getSnapshot())
				React.useEffect(() => {
					setEventWindow(store.getSnapshot())
					return store.subscribe(() => setEventWindow(store.getSnapshot()))
				}, [store])

				// The transcript pass cannot read a session window itself — this control
				// is the only part of the plugin that is handed a session id — so the
				// window it already holds is what lets the pass tell a trigger row this
				// plugin opened from one another producer opened.
				React.useEffect(() => {
					transcriptWindow.publish(eventWindow)
				}, [eventWindow])

				// The whole-session answer to the same question, from the host's projection:
				// the window above is one page of events, so a round of ours outside it (or
				// folded away) is only visible through this face. Absent — an older host, or a
				// composition without the projection seam — it publishes nothing and the
				// window keeps full authority, as it did before.
				const session = sessionOf(sessionId)
				const roundsFace = session !== undefined && session !== null && session.projections !== undefined
					&& typeof session.projections.faceOf === 'function'
					? session.projections.faceOf(ROUNDS_KEY)
					: undefined
				React.useEffect(() => {
					if (roundsFace === undefined) {
						projectionRounds.publish(null)
						return () => {}
					}
					const push = () => {
						const value = roundsFace.getSnapshot()
						projectionRounds.publish(Array.isArray(value) ? value : null)
					}
					push()
					return roundsFace.subscribe(push)
				}, [roundsFace])

				const [busy, setBusy] = React.useState(false)
				const [flash, setFlash] = React.useState(null)
				const inFlight = React.useRef(false)
				const flashTimer = React.useRef(null)

				React.useEffect(() => () => {
					if (flashTimer.current !== null) {
						try { flashTimer.current() } catch (error) { void error }
						flashTimer.current = null
					}
				}, [])

				const view = restartAffordance({
					eventWindow: eventWindow,
					running: running,
					blank: blank,
					removed: removed,
					promptFailed: promptFailed,
					agentError: agentError,
				})

				// The shipped send button runs this same action when it carries it, so it is
				// handed the same state: which session, whether a continuation is on offer,
				// and the outcome this control is reporting right now. `show` decides the
				// offer — a broken turn the agent is already re-running, a blank session or
				// a removed one puts nothing on the button.
				React.useEffect(() => {
					affordance.publish({
						sessionId: sessionId === undefined ? undefined : sessionId,
						mode: view.show === true ? view.mode : '',
						title: view.title,
						state: busy === true ? 'busy' : (flash !== null ? flash.kind : 'idle'),
						message: flash !== null ? flash.message : '',
					})
				}, [sessionId, view.show, view.mode, view.title, busy, flash])

				/** Report an outcome on the button itself, with no layout effect. */
				function settle(kind, message, hold) {
					inFlight.current = false
					setBusy(false)
					if (message === null) return
					setFlash({ kind: kind, message: message })
					if (flashTimer.current !== null) {
						try { flashTimer.current() } catch (error) { void error }
					}
					flashTimer.current = ctx.timeout(() => { setFlash(null) }, hold)
				}

				function act() {
					// A second click while the first request is in flight would send
					// twice; the ref closes that window before React re-renders.
					if (inFlight.current === true) return
					const session = sessionOf(sessionId)
					if (session === undefined || session === null) {
						settle('error', '会话尚未就绪', 5000)
						return
					}
					inFlight.current = true
					setBusy(true)

					if (view.mode === 'continue') {
						// The host command owns the continuation: it posts a plugin-sourced
						// message, so no user bubble and no duplicate prompt appear.
						let pending
						try {
							pending = session.command('/continue-task')
						} catch (error) {
							settle('error', '继续失败：' + errorText(error), 7000)
							return
						}
						Promise.resolve(pending).then((result) => {
							if (result !== null && typeof result === 'object' && result.ok === true
								&& result.value !== null && typeof result.value === 'object' && result.value.matched === true) {
								settle('done', '已从中断处继续', 1600)
								return
							}
							settle('error', '继续失败：宿主未注册 continue-task 命令（重启一次 DSH 后生效）', 9000)
						}, (error) => {
							settle('error', '继续失败：' + errorText(error), 7000)
						})
						return
					}

					let pending
					try {
						pending = session.prompt([{ type: 'text', text: view.text }], 'queue')
					} catch (error) {
						settle('error', '重新发送失败：' + errorText(error), 7000)
						return
					}
					Promise.resolve(pending).then((result) => {
						if (result !== null && typeof result === 'object' && result.ok === true) {
							settle('done', '已重新发送上一条请求', 1600)
							return
						}
						settle('error', '重新发送失败：' + resultFailureText(result), 7000)
					}, (error) => {
						settle('error', '重新发送失败：' + errorText(error), 7000)
					})
				}

				if (view.show !== true) return null

				const state = busy === true ? 'busy' : (flash !== null ? flash.kind : 'idle')
				const shape = state === 'done' ? 'done' : (state === 'error' ? 'error' : 'continue')
				const title = flash !== null ? flash.message : view.title

				return React.createElement('button', {
					type: 'button',
					className: 'dyn-retry-round',
					'data-mode': view.mode,
					'data-state': state,
					title: title,
					'aria-label': title,
					disabled: busy === true,
					onClick: act,
				}, glyph(shape, 15))
			}

			// ---- settings card in the product's plugin settings page ------------
			// The host half owns the namespace and its schema; this card edits the
			// user layer through the settings scope bound to that namespace (created
			// once, above). Every write is immediate (the namespace is registered
			// `applies: 'live'`) and each field can be cleared back to the schema
			// default.

			function readSnapshot() {
				// The card is only registered once the form exists, but a torn-down
				// settings domain leaves the last form behind: read it defensively.
				if (scope === null || scope === undefined || typeof scope.getSnapshot !== 'function') {
					return { status: 'loading', value: {}, user: undefined, writable: false }
				}
				const snapshot = scope.getSnapshot()
				if (snapshot === null || typeof snapshot !== 'object') {
					return { status: 'loading', value: {}, user: undefined, writable: false }
				}
				return snapshot
			}

			/** The framed row every control sits in: label, hint, badges, reset. */
			function FieldRow(props) {
				const badges = []
				if (props.overridden === true) {
					badges.push(React.createElement('span', { className: 'dyn-rt-badge', key: 'badge' }, '已自定义'))
					badges.push(React.createElement('button', {
						type: 'button',
						className: 'dyn-rt-reset',
						key: 'reset',
						disabled: props.disabled === true,
						title: '恢复为默认值',
						onClick: props.onReset,
					}, '恢复默认'))
				}
				const text = React.createElement('div', { className: 'dyn-rt-fieldText' },
					React.createElement('div', { className: 'dyn-rt-labelRow' },
						React.createElement('span', { className: 'dyn-rt-label' }, props.label),
						badges,
					),
					props.hint === undefined ? null : React.createElement('span', { className: 'dyn-rt-hint' }, props.hint),
				)
				const control = props.stacked === true
					? React.createElement('div', { className: 'dyn-rt-areaRow' }, props.control)
					: React.createElement('div', { className: 'dyn-rt-control' }, props.control)
				return React.createElement('div', {
					className: 'dyn-rt-field',
					'data-stacked': props.stacked === true ? 'true' : undefined,
				}, text, control)
			}

			/** A toggle switch. */
			function SwitchField(props) {
				return React.createElement(FieldRow, {
					label: props.label,
					hint: props.hint,
					overridden: props.overridden,
					disabled: props.disabled,
					onReset: props.onReset,
					control: React.createElement('label', { className: 'dyn-rt-switch' },
						React.createElement('input', {
							type: 'checkbox',
							role: 'switch',
							checked: props.value === true,
							disabled: props.disabled === true,
							'aria-label': props.label,
							onChange: (event) => props.commit(event.target.checked),
						}),
						React.createElement('span', null),
					),
				})
			}

			/** A small vocabulary choice, rendered as a select. */
			function ChoiceField(props) {
				return React.createElement(FieldRow, {
					label: props.label,
					hint: props.hint,
					overridden: props.overridden,
					disabled: props.disabled,
					onReset: props.onReset,
					control: React.createElement('select', {
						className: 'dyn-rt-select',
						value: props.value,
						disabled: props.disabled === true,
						'aria-label': props.label,
						onChange: (event) => props.commit(event.target.value),
					}, props.options.map((option) => React.createElement('option', {
						key: option.value,
						value: option.value,
					}, option.label))),
				})
			}

			/** A whole-number field with a unit suffix; commits on blur or Enter. */
			function NumberField(props) {
				const [draft, setDraft] = React.useState(() => String(props.value))
				React.useEffect(() => { setDraft(String(props.value)) }, [props.value])
				function commit() {
					const parsed = Number(draft)
					if (draft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0) props.commit(Math.floor(parsed))
					else setDraft(String(props.value))
				}
				return React.createElement(FieldRow, {
					label: props.label,
					hint: props.hint,
					overridden: props.overridden,
					disabled: props.disabled,
					onReset: props.onReset,
					control: React.createElement('span', { className: 'dyn-rt-numWrap' },
						React.createElement('input', {
							className: 'dyn-rt-input',
							type: 'number',
							min: 0,
							step: 1,
							inputMode: 'numeric',
							value: draft,
							disabled: props.disabled === true,
							'aria-label': props.label,
							onChange: (event) => setDraft(event.target.value),
							onBlur: commit,
							onKeyDown: (event) => {
								if (event.key !== 'Enter') return
								event.preventDefault()
								commit()
								event.currentTarget.blur()
							},
						}),
						props.unit === undefined ? null : React.createElement('span', { className: 'dyn-rt-unit' }, props.unit),
					),
				})
			}

			/** One titled group of fields. */
			function Section(props) {
				return React.createElement('section', { className: 'dyn-rt-section', 'data-tone': props.tone },
					React.createElement('div', { className: 'dyn-rt-secHead' },
						React.createElement('span', { className: 'dyn-rt-secBar', 'aria-hidden': 'true' }),
						React.createElement('div', { className: 'dyn-rt-secText' },
							React.createElement('span', { className: 'dyn-rt-secTitle' }, props.title),
							props.subtitle === undefined ? null : React.createElement('span', { className: 'dyn-rt-secSub' }, props.subtitle),
						),
					),
					React.createElement('div', { className: props.sub === true ? 'dyn-rt-fieldsSub' : 'dyn-rt-fields' }, props.children),
				)
			}

			/**
			 * The bundle's own configuration page on the Plugins page.
			 *
			 * `view: 'summary'` is the one-line form the page asks a contribution for
			 * when it lists a bundle; the bundle card already carries this package's own
			 * description, so there is nothing to add there.
			 */
			function SettingsCard(props) {
				const [snapshot, setSnapshot] = React.useState(readSnapshot)
				const [failure, setFailure] = React.useState(null)
				const [flash, setFlash] = React.useState(false)
				const [draftText, setDraftText] = React.useState(null)
				const [open, setOpen] = React.useState(true)
				const flashTimer = React.useRef(null)

				React.useEffect(() => scope.subscribe(() => setSnapshot(readSnapshot())), [])
				React.useEffect(() => () => {
					if (flashTimer.current !== null) {
						try { flashTimer.current() } catch (error) { void error }
						flashTimer.current = null
					}
				}, [])

				// The page's one-line view. Every hook above has already run, so this
				// return costs nothing and keeps the calls unconditional.
				if (props.view === 'summary') return null

				const value = snapshot.value
				const user = snapshot.user
				const ready = snapshot.status === 'ready'
				const disabled = ready !== true || snapshot.writable === false
				/** Fields the running Host serves, or null while that is still unknown. */
				const servedKeys = ready === true && value !== null && typeof value === 'object'
					? Object.keys(value)
					: null
				/** Why one row cannot be edited right now, or undefined when it can. */
				function blockedBy(field) {
					if (servedKeys !== null && fieldIsServed(servedKeys, field) !== true) {
						return '宿主还是旧版本：重启 DSH 后这一项才会生效'
					}
					if (snapshot.writable === false) return '当前连接不允许写入设置（内存模式）'
					if (ready !== true) return '正在读取 Host 设置…'
					return undefined
				}

				function ping() {
					setFlash(true)
					if (flashTimer.current !== null) {
						try { flashTimer.current() } catch (error) { void error }
					}
					flashTimer.current = ctx.timeout(() => { setFlash(false) }, 1600)
				}

				function write(field, next) {
					Promise.resolve(scope.set(field, next)).then(
						() => { setFailure(null); ping() },
						(failed) => { setFailure(errorText(failed)) },
					)
				}

				function reset(field) {
					Promise.resolve(scope.unset(field)).then(
						() => { setFailure(null); ping() },
						(failed) => { setFailure(errorText(failed)) },
					)
				}

				/** Build the shared props of one row from the live snapshot. */
				function row(field, label, hint, unit) {
					const blocked = blockedBy(field)
					return {
						key: field,
						label: label,
						hint: blocked === undefined ? hint : blocked,
						unit: unit,
						value: readField(value, field),
						overridden: isOverridden(user, field),
						disabled: disabled === true || blocked !== undefined,
						commit: (next) => write(field, next),
						onReset: () => reset(field),
					}
				}

				/** A row whose control is disabled for a reason of the card's own. */
				function locked(field, label, hint, disabled) {
					const props = row(field, label, hint)
					props.disabled = disabled === true || disabled === undefined
					return props
				}

				const storedText = readField(value, 'continueText')
				const text = draftText === null ? storedText : draftText
				const autoContinue = readField(value, 'autoContinue') === true
				const chips = policySummary(value)

				const header = React.createElement('button', {
					type: 'button',
					className: 'dyn-rt-head',
					'aria-expanded': open === true,
					onClick: () => setOpen(!open),
				},
					React.createElement('span', { className: 'dyn-rt-mark', 'aria-hidden': 'true' }, glyph('continue', 21)),
					React.createElement('span', { className: 'dyn-rt-headText' },
						React.createElement('span', { className: 'dyn-rt-name' }, '继续任务'),
						React.createElement('span', { className: 'dyn-rt-desc' }, '回合被中断或请求失败后的恢复策略：能静默恢复的，绝不写进对话历史。'),
						React.createElement('span', { className: 'dyn-rt-chips' },
							chips.map((chip) => React.createElement('span', {
								className: 'dyn-rt-chip',
								key: chip.text,
								'data-tone': chip.tone,
							}, chip.text)),
						),
					),
					React.createElement('span', {
						className: 'dyn-rt-chevron',
						'data-open': open === true ? 'true' : 'false',
						'aria-hidden': 'true',
					}, glyph('chevron', 16, { strokeWidth: 1.6 })),
				)

				const body = open !== true ? null : React.createElement('div', { className: 'dyn-rt-body' },
					React.createElement('p', { className: 'dyn-rt-note' },
						React.createElement('strong', null, '优先级'),
						'：请求失败 → 同一步内静默重试（不新增回合、不写历史）；输出被截断 → 在同一轮里续写（不新开回合）；'
						+ '只有已经结束的回合（用户停止、进程中断遗留）才必须开新一轮 —— 那一定会留下一条折叠记录。',
					),
					snapshot.status === 'unavailable'
						? React.createElement('p', { className: 'dyn-rt-note' }, snapshot.mode === 'memory'
							? '当前连接不写入设置（内存模式），下面的值是内置默认值，改动不会持久化。'
							: '宿主没有提供本插件的设置入口：这一行还没挂载，或者客户端比宿主新。重启 DSH 后这里会出现可编辑的开关。')
						: null,

					React.createElement(Section, {
						title: '请求失败：原地静默重试',
						subtitle: '同一步内重发，不新增回合、不写进历史，恢复后看不出发生过失败',
						tone: 'retry',
					},
						React.createElement(SwitchField, row('retryFailedRequests', '启用原地重试', '4xx（429 除外）属于确定性错误，不重试，直接交给宿主')),
						React.createElement(NumberField, row('maxRequestRetries', '原地重试上限', '0 表示不重试', '次')),
						React.createElement(SwitchField, row('retryForever', '不限次数重试', '一直重试到成功或被中止，适合无人值守的长任务')),
						React.createElement(NumberField, row('retryBaseDelayMs', '退避基数', '按 2 的幂递增：2000 → 2s、4s、8s…（上限 60s）', '毫秒')),
					),

					React.createElement(Section, {
						title: '输出超限：同一轮内续写',
						subtitle: '模型单次输出被截断时，在同一个回合里继续，不新开一轮',
						tone: 'inline',
					},
						React.createElement(SwitchField, row('keepAliveOnMaxTokens', '输出被截断时同轮续写', '在回合结束前追加一条继续指令，回合不关闭')),
						React.createElement(NumberField, row('maxTurnContinues', '单轮续写上限', '同一个回合内最多续写几次，0 表示不限', '次')),
					),

					React.createElement(Section, {
						title: '回合已结束：开新一轮继续',
						subtitle: '用户停止、请求彻底失败、进程中断遗留的回合只能靠新一轮接续，会在历史里留下一条折叠记录',
						tone: 'turn',
					},
						React.createElement(SwitchField, row('sendBecomesContinue', '失败后发送键变成“继续”', '输入框为空且上一轮中断时，发送键接管为「继续上次任务」（原本它是灰的、点了没用）；输入框里有内容时它照旧是发送键')),
						React.createElement(SwitchField, row('autoContinue', '中断后自动开新一轮', '默认关闭；临时补救用空输入框时的发送键，或输入框右侧的圆形按钮')),
						React.createElement(NumberField, row('delayMs', '继续前的延迟', '给宿主一点时间收拾队列', '毫秒')),
						React.createElement(NumberField, row('maxConsecutive', '连续继续上限', '防止无限续命，0 表示不限', '次')),
					),
					React.createElement(Section, {
						title: '触发条件',
						subtitle: autoContinue === true ? '选择哪些中断原因值得自动接续' : '上一节的自动继续关闭时，这些偏好不会生效',
						tone: 'turn',
						sub: true,
					},
						React.createElement(SwitchField, locked('onAborted', '中断之后继续（用户点停止除外）', '你按下停止的回合永不自动继续，这是硬规则', disabled || autoContinue !== true)),
						React.createElement(SwitchField, locked('onError', '模型请求失败之后继续', undefined, disabled || autoContinue !== true)),
						React.createElement(SwitchField, locked('onInterrupted', '进程中断遗留回合之后继续', undefined, disabled || autoContinue !== true)),
					),

					React.createElement(Section, {
						title: '继续指令',
						subtitle: '以插件来源的消息发给模型，渲染为一条折叠记录，不会显示成你的发言',
						tone: 'text',
					},
						React.createElement(SwitchField, row('hideContinueRow', '隐藏这条折叠记录', '只隐藏本插件发出的继续指令那一行；其它插件的上下文行不受影响')),
						React.createElement(ChoiceField, Object.assign(
							row('continuedRailMarks', '轮次导航里的标记', '自动继续开出的那一轮本来没有人类提问，标记只能显示成「第 N 轮」'),
							{
								value: railMarkMode(readField(value, 'continuedRailMarks')),
								options: [
									{ value: 'hide', label: '不显示这一轮' },
									{ value: 'preview', label: '保留标记，悬停不显示「第 N 轮」' },
									{ value: 'keep', label: '照原样显示「第 N 轮」' },
								],
							},
						)),
						React.createElement(FieldRow, {
							label: '发给模型的内容',
							hint: '留空则使用内置默认指令',
							overridden: isOverridden(user, 'continueText'),
							disabled: disabled,
							stacked: true,
							onReset: () => { setDraftText(null); reset('continueText') },
							control: React.createElement('span', null,
								React.createElement('textarea', {
									className: 'dyn-rt-area',
									value: text,
									placeholder: '上一条助手回复被中断或请求失败。请从中断处继续完成这个任务……',
									disabled: disabled === true,
									'aria-label': '发给模型的继续指令',
									onChange: (event) => setDraftText(event.target.value),
									onBlur: () => {
										if (draftText === null) return
										write('continueText', draftText)
										setDraftText(null)
									},
								}),
								React.createElement('span', { className: 'dyn-rt-areaFoot' },
									React.createElement('span', null, text.length === 0 ? '使用内置默认指令' : text.length + ' 个字符'),
									React.createElement('span', null, '失焦即生效'),
								),
							),
						}),
					),
				)

				const footer = open !== true ? null : React.createElement('div', { className: 'dyn-rt-foot' },
					React.createElement('span', {
						className: 'dyn-rt-footText',
						'data-tone': failure !== null ? 'error' : (flash === true ? 'ok' : undefined),
					}, failure !== null
						? '设置未写入：' + failure
						: (ready !== true ? '正在读取 Host 设置…' : (flash === true ? '已生效（无需保存）' : '设置实时生效，无需保存'))),
					React.createElement('span', { className: 'dyn-rt-footActions' },
						React.createElement('button', {
							type: 'button',
							className: 'dyn-rt-reset',
							disabled: disabled === true,
							onClick: () => {
								const fields = Object.keys(DEFAULTS)
								const pending = []
								setDraftText(null)
								for (let i = 0; i < fields.length; i += 1) pending.push(scope.unset(fields[i]))
								Promise.all(pending).then(
									() => { setFailure(null); ping() },
									(failed) => { setFailure(errorText(failed)) },
								)
							},
						}, '全部恢复默认'),
					),
				)

				// The host mounts a plugin's configuration page inside its own section,
				// not inside a list, so the card's root is a plain block element.
				return React.createElement('div', {
					className: 'dyn-rt-card',
					'data-open': open === true ? 'true' : 'false',
				}, header, body, footer)
			}
		}

		exports.apply = apply
		exports.inject = inject
		exports.policySummary = policySummary
		return module.exports
	},
})
