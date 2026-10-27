/**
 * Token-styled presentational primitives shared by every GitHub panel view.
 *
 * The bundle imports no Harness UI package, so these controls are written from
 * plain elements and the `--dsw-alias-*` / `--dsw-radius-*` design tokens. Every
 * color, radius and type size resolves through a token (with an explicit fallback
 * where the token is not part of the documented panel surface), so light and dark
 * themes need no component-side branching.
 *
 * The one stylesheet the plugin ships is exported as {@link CONTROLS_CSS} and
 * rendered by {@link StyleSheet} inside the roots that need it; there is no CSS
 * file import because the client bundle is JavaScript only.
 *
 * @module dsh-plugin-github-issues/client/views/controls
 */

import type { CSSProperties, ReactNode } from 'react'
import { labelColorPair } from './format.ts'
import { CloseGlyph, CopyGlyph } from './Icon.tsx'

/** Semantic color families the panel uses for state and priority marks. */
export type Tone = 'neutral' | 'success' | 'warn' | 'error' | 'info'

/** How one tone paints its foreground, background, border, and dot. */
export interface ToneStyle {
  /** Text color. */
  fg: string
  /** Subtle background color. */
  bg: string
  /** Border color. */
  border: string
  /** Solid dot/mark color. */
  dot: string
}

/**
 * The tone → token mapping every view reads instead of hard-coding colors.
 *
 * The `business` aliases are the panel's blue "informational" tone; they are not
 * part of the documented surface, so each entry carries the documented fallback.
 */
export const TONE: Record<Tone, ToneStyle> = {
  neutral: {
    fg: 'var(--dsw-alias-label-secondary)',
    bg: 'var(--dsw-alias-bg-layer-2)',
    border: 'var(--dsw-alias-border-l2)',
    dot: 'var(--dsw-alias-label-tertiary)',
  },
  success: {
    fg: 'var(--dsw-alias-state-success-primary)',
    bg: 'var(--dsw-alias-state-success-tertiary, var(--dsw-alias-bg-layer-2))',
    border: 'transparent',
    dot: 'var(--dsw-alias-state-success-primary)',
  },
  warn: {
    fg: 'var(--dsw-alias-state-warn-primary)',
    bg: 'var(--dsw-alias-state-warn-tertiary, var(--dsw-alias-bg-layer-2))',
    border: 'transparent',
    dot: 'var(--dsw-alias-state-warn-primary)',
  },
  error: {
    fg: 'var(--dsw-alias-state-error-primary)',
    bg: 'var(--dsw-alias-state-error-secondary, var(--dsw-alias-bg-layer-2))',
    border: 'transparent',
    dot: 'var(--dsw-alias-state-error-primary)',
  },
  info: {
    fg: 'var(--dsw-alias-state-business-primary, var(--dsw-alias-link))',
    bg: 'var(--dsw-alias-state-business-tertiary, var(--dsw-alias-bg-layer-2))',
    border: 'transparent',
    dot: 'var(--dsw-alias-state-business-primary, var(--dsw-alias-link))',
  },
}

/** The terminal command that grants the Projects v2 scope. */
export const PROJECT_SCOPE_COMMAND = 'gh auth refresh -h github.com -s read:project'

/** Props of {@link Button}. */
export interface ButtonProps {
  /** Button label. */
  children: ReactNode
  /** Click handler. */
  onClick?: (() => void) | undefined
  /** Visual weight; defaults to `outline`. */
  variant?: 'primary' | 'outline' | 'ghost' | undefined
  /** Control height; defaults to `md`. */
  size?: 'md' | 'sm' | undefined
  /** Disables the control. */
  disabled?: boolean | undefined
  /** Native tooltip. */
  title?: string | undefined
  /** Accessible name when the visible label is not descriptive. */
  ariaLabel?: string | undefined
}

/**
 * A token-styled button in the three weights the panel needs.
 * @param props - label, click handler, and visual weight.
 * @returns a native `<button>`.
 */
export function Button({ children, onClick, variant = 'outline', size = 'md', disabled, title, ariaLabel }: ButtonProps) {
  return (
    <button
      type="button"
      className={`gh-btn gh-btn-${variant} gh-btn-${size}`}
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={ariaLabel}
    >
      {children}
    </button>
  )
}

/** Props of {@link Chip}. */
export interface ChipProps {
  /** Visible text. */
  label: string
  /** GitHub label color (bare hex); renders the label's own background. */
  color?: string | undefined
  /** Tone used for the leading dot and the default background. */
  tone?: Tone | undefined
  /** Draws a small leading dot in the tone color. */
  dot?: boolean | undefined
  /** Native tooltip. */
  title?: string | undefined
}

/**
 * One GitHub-style label/milestone/priority chip.
 * @param props - text, optional GitHub color, and optional tone dot.
 * @returns an inline pill.
 */
export function Chip({ label, color, tone = 'neutral', dot, title }: ChipProps) {
  const pair = color === undefined ? undefined : labelColorPair(color)
  const toneStyle = TONE[tone]
  const style: CSSProperties = pair === undefined
    ? { background: toneStyle.bg, color: toneStyle.fg, borderColor: toneStyle.border }
    : { background: pair.background, color: pair.text, borderColor: 'transparent' }
  return (
    <span className="gh-chip" style={style} title={title}>
      {dot === true && <span className="gh-dot" style={{ background: toneStyle.dot }} aria-hidden="true" />}
      <span className="gh-chip-label">{label}</span>
    </span>
  )
}

/** Props of {@link Badge}. */
export interface BadgeProps {
  /** Badge text. */
  children: ReactNode
  /** Semantic tone; defaults to neutral. */
  tone?: Tone | undefined
  /** Native tooltip. */
  title?: string | undefined
}

/**
 * A compact state/priority/type pill.
 * @param props - text and semantic tone.
 * @returns an inline badge.
 */
export function Badge({ children, tone = 'neutral', title }: BadgeProps) {
  const toneStyle = TONE[tone]
  return (
    <span
      className="gh-badge"
      style={{ background: toneStyle.bg, color: toneStyle.fg, borderColor: toneStyle.border }}
      title={title}
    >
      {children}
    </span>
  )
}

/** Props of {@link Pill}. */
export interface PillProps {
  /** Pill text. */
  children: ReactNode
  /** Semantic tone; defaults to neutral. */
  tone?: Tone | undefined
  /** Draws a small leading dot in the tone color. */
  dot?: boolean | undefined
  /** Native tooltip. */
  title?: string | undefined
}

/**
 * A round status pill, used by the settings authorization row.
 * @param props - text, tone, and optional dot.
 * @returns an inline pill.
 */
export function Pill({ children, tone = 'neutral', dot, title }: PillProps) {
  const toneStyle = TONE[tone]
  return (
    <span
      className="gh-pill"
      style={{ background: toneStyle.bg, color: toneStyle.fg, borderColor: toneStyle.border }}
      title={title}
    >
      {dot === true && <span className="gh-dot" style={{ background: toneStyle.dot }} aria-hidden="true" />}
      {children}
    </span>
  )
}

/** Props of {@link ProgressBar}. */
export interface ProgressBarProps {
  /** Completion percentage, clamped to 0–100. */
  value: number
  /** Optional width in pixels; the bar fills its container by default. */
  width?: number | undefined
  /** Accessible name for the progressbar role. */
  label?: string | undefined
}

/**
 * A thin milestone/rollup progress bar.
 * @param props - percentage value, width, and accessible label.
 * @returns a `role="progressbar"` element.
 */
export function ProgressBar({ value, width, label }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value)))
  return (
    <div
      className="gh-progress"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={label}
      style={width === undefined ? undefined : { width }}
    >
      <div className="gh-progress-fill" style={{ width: `${String(clamped)}%` }} />
    </div>
  )
}

/** One option of {@link Select}. */
export interface SelectOption {
  /** Value handed back to `onChange`. */
  value: string
  /** Visible text. */
  label: string
  /** Disables just this option. */
  disabled?: boolean | undefined
}

/** Props of {@link Select}. */
export interface SelectProps {
  /** Choices in display order. */
  options: readonly SelectOption[]
  /** Selected value; `undefined` renders the placeholder/empty option. */
  value?: string | undefined
  /** Called with the newly chosen value. */
  onChange: (value: string) => void
  /** Visible label rendered before the field. */
  label?: string | undefined
  /** Accessible name when there is no visible label. */
  ariaLabel?: string | undefined
  /** Disables the whole select. */
  disabled?: boolean | undefined
  /** Optional leading option shown while nothing is selected. */
  placeholder?: string | undefined
}

/**
 * A native `<select>` styled with the panel tokens.
 * @param props - options, selection, and label.
 * @returns a labeled native select.
 */
export function Select({ options, value, onChange, label, ariaLabel, disabled, placeholder }: SelectProps) {
  return (
    <label className="gh-select-wrap">
      {label !== undefined && <span className="gh-field-label">{label}</span>}
      <select
        className="gh-select"
        value={value ?? ''}
        aria-label={ariaLabel ?? label}
        disabled={disabled}
        onChange={event => onChange(event.target.value)}
      >
        {placeholder !== undefined && <option value="" disabled>{placeholder}</option>}
        {options.map(option => (
          <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>
        ))}
      </select>
    </label>
  )
}

/** Props of {@link TextInput}. */
export interface TextInputProps {
  /** Current value. */
  value: string
  /** Called with the new value on every keystroke. */
  onChange: (value: string) => void
  /** Accessible name; also the placeholder when `placeholder` is omitted. */
  ariaLabel: string
  /** Placeholder text. */
  placeholder?: string | undefined
  /** Disables the field. */
  disabled?: boolean | undefined
}

/**
 * A single-line text field styled with the panel tokens.
 * @param props - value, change handler, and accessible name.
 * @returns a native `<input>`.
 */
export function TextInput({ value, onChange, ariaLabel, placeholder, disabled }: TextInputProps) {
  return (
    <input
      className="gh-input"
      type="text"
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
    />
  )
}

/** Props of {@link TextArea}. */
export interface TextAreaProps {
  /** Current value. */
  value: string
  /** Called with the new value on every keystroke. */
  onChange: (value: string) => void
  /** Accessible name. */
  ariaLabel: string
  /** Visible height in rows; defaults to 8. */
  rows?: number | undefined
  /** Renders the content in the code font. */
  mono?: boolean | undefined
}

/**
 * A multi-line text field styled with the panel tokens.
 * @param props - value, change handler, and accessible name.
 * @returns a native `<textarea>`.
 */
export function TextArea({ value, onChange, ariaLabel, rows = 8, mono }: TextAreaProps) {
  return (
    <textarea
      className={`gh-textarea${mono === true ? ' gh-textarea-mono' : ''}`}
      value={value}
      rows={rows}
      aria-label={ariaLabel}
      spellCheck={false}
      onChange={event => onChange(event.target.value)}
    />
  )
}

/** Props of {@link IconButton}. */
export interface IconButtonProps {
  /** Accessible name of the icon-only control. */
  label: string
  /** Renders the mark. */
  children: ReactNode
  /** Click handler. */
  onClick?: (() => void) | undefined
  /** Disables the control. */
  disabled?: boolean | undefined
  /** Marks the control as currently active. */
  active?: boolean | undefined
}

/**
 * A square icon-only button with a mandatory accessible name.
 * @param props - accessible label, glyph, and click handler.
 * @returns a native `<button>`.
 */
export function IconButton({ label, children, onClick, disabled, active }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`gh-icon-btn${active === true ? ' gh-icon-btn-active' : ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  )
}

/** Props of {@link Spinner}. */
export interface SpinnerProps {
  /** Square edge in pixels; defaults to 14. */
  size?: number | undefined
}

/**
 * A small indeterminate activity spinner.
 * @param props - requested size.
 * @returns a decorative CSS spinner; callers pair it with visible loading text.
 */
export function Spinner({ size = 14 }: SpinnerProps) {
  return <span className="gh-spinner" style={{ width: size, height: size }} aria-hidden="true" />
}

/** Props of {@link EmptyState}. */
export interface EmptyStateProps {
  /** Primary line. */
  title: string
  /** Optional secondary explanation. */
  hint?: string | undefined
  /** Optional mark above the title. */
  icon?: ReactNode | undefined
  /** Optional action below the hint. */
  action?: ReactNode | undefined
}

/**
 * A centered placeholder for an empty list or an absent selection.
 * @param props - title, hint, mark, and action.
 * @returns a muted block.
 */
export function EmptyState({ title, hint, icon, action }: EmptyStateProps) {
  return (
    <div className="gh-empty">
      {icon !== undefined && <div className="gh-empty-icon">{icon}</div>}
      <div className="gh-empty-title">{title}</div>
      {hint !== undefined && <div className="gh-empty-hint">{hint}</div>}
      {action !== undefined && <div className="gh-empty-action">{action}</div>}
    </div>
  )
}

/** Props of {@link ErrorBanner}. */
export interface ErrorBannerProps {
  /** Human-readable error text, already translated. */
  message: string
  /** Optional retry button label. */
  retryLabel?: string | undefined
  /** Optional retry handler; the button renders only when both retry props are set. */
  onRetry?: (() => void) | undefined
  /** Extra content below the message (scope hints, commands). */
  children?: ReactNode
}

/**
 * A non-blocking error banner with an optional retry action.
 * @param props - message, optional retry, and extra hint content.
 * @returns a `role="alert"` block.
 */
export function ErrorBanner({ message, retryLabel, onRetry, children }: ErrorBannerProps) {
  return (
    <div className="gh-error" role="alert">
      <div className="gh-error-row">
        <span className="gh-error-glyph" aria-hidden="true">!</span>
        <span className="gh-error-text">{message}</span>
        {onRetry !== undefined && retryLabel !== undefined && (
          <Button size="sm" variant="ghost" onClick={onRetry}>{retryLabel}</Button>
        )}
      </div>
      {children}
    </div>
  )
}

/** Props of {@link Toast}. */
export interface ToastProps {
  /** Already-translated confirmation text; the toast renders nothing when empty. */
  text: string
  /** Called when the user dismisses the toast. */
  onDismiss: () => void
  /** Accessible name of the dismiss control. */
  dismissLabel: string
}

/**
 * The transient confirmation toast pinned to the bottom of the page.
 * @param props - text, dismiss handler, and dismiss label.
 * @returns the toast, or `null` when there is nothing to show.
 */
export function Toast({ text, onDismiss, dismissLabel }: ToastProps) {
  if (text === '') return null
  return (
    <div className="gh-toast" role="status">
      <span className="gh-toast-text">{text}</span>
      <button type="button" className="gh-toast-close" aria-label={dismissLabel} title={dismissLabel} onClick={onDismiss}>
        <CloseGlyph size={12} />
      </button>
    </div>
  )
}

/** Props of {@link CommandBlock}. */
export interface CommandBlockProps {
  /** The exact command to display. */
  command: string
  /** Already-translated copy action label. */
  copyLabel: string
  /** Copies the command. */
  onCopy: () => void
}

/**
 * A one-line terminal command with its copy action.
 * @param props - command text, copy label, and copy handler.
 * @returns a code block row.
 */
export function CommandBlock({ command, copyLabel, onCopy }: CommandBlockProps) {
  return (
    <div className="gh-command">
      <code className="gh-command-text">{command}</code>
      <Button size="sm" variant="ghost" onClick={onCopy}>
        <CopyGlyph size={12} />
        {copyLabel}
      </Button>
    </div>
  )
}

/** Props of {@link StyleSheet}. */
export interface StyleSheetProps {
  /** CSS chunks composed by the owning view. */
  chunks: readonly string[]
}

/**
 * Render one plugin stylesheet into the page.
 *
 * The client bundle is JavaScript only, so each view root renders the shared
 * control sheet plus its own chunk here. Duplicate copies of the same text are
 * harmless; they only appear when two plugin surfaces are mounted at once.
 *
 * @param props - the CSS chunks to emit.
 * @returns a `<style>` element.
 */
export function StyleSheet({ chunks }: StyleSheetProps) {
  return <style>{chunks.join('\n')}</style>
}

/** The control, focus, and status styles every view shares. */
export const CONTROLS_CSS = `
.gh-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;box-sizing:border-box;border:0.5px solid transparent;border-radius:var(--dsw-radius-md,8px);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;cursor:pointer;white-space:nowrap;text-decoration:none;transition:background-color .15s,border-color .15s,color .15s;color:var(--dsw-alias-label-primary);background:transparent}
.gh-btn-md{height:32px;padding:0 12px}
.gh-btn-sm{height:26px;padding:0 8px;font-size:12px;border-radius:var(--dsw-radius-sm,6px)}
.gh-btn-primary{background:var(--dsw-alias-button-primary-fill,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)));color:var(--dsw-alias-label-primary-foreground,#fff)}
.gh-btn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,var(--dsw-alias-state-business-primary,var(--dsw-alias-link)))}
.gh-btn-outline{border-color:var(--dsw-alias-border-l3);color:var(--dsw-alias-label-primary)}
.gh-btn-outline:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l2)}
.gh-btn-ghost{color:var(--dsw-alias-label-secondary)}
.gh-btn-ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gh-btn:disabled{opacity:.45;cursor:default}
.gh-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;box-sizing:border-box;border:0.5px solid transparent;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;flex:none}
.gh-icon-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gh-icon-btn-active{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.gh-icon-btn:disabled{opacity:.45;cursor:default}
.gh-chip{display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;min-width:0;max-width:180px;height:20px;padding:0 7px;border:0.5px solid transparent;border-radius:var(--dsw-radius-sm,6px);font-size:12px;line-height:18px;white-space:nowrap;vertical-align:middle}
.gh-chip-label{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gh-badge{display:inline-flex;align-items:center;gap:4px;box-sizing:border-box;max-width:100%;height:20px;padding:0 7px;border:0.5px solid transparent;border-radius:var(--dsw-radius-sm,6px);font-size:12px;line-height:18px;white-space:nowrap;vertical-align:middle}
.gh-pill{display:inline-flex;align-items:center;gap:6px;box-sizing:border-box;min-height:22px;padding:0 10px;border:0.5px solid transparent;border-radius:999px;font-size:12px;line-height:18px;white-space:nowrap}
.gh-dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none}
.gh-progress{position:relative;height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;flex:none}
.gh-progress-fill{height:100%;border-radius:999px;background:var(--dsw-alias-state-business-primary,var(--dsw-alias-link));transition:width .2s}
.gh-field-label{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.gh-select-wrap{display:inline-flex;align-items:center;gap:6px;min-width:0}
.gh-select{box-sizing:border-box;height:28px;max-width:240px;padding:0 6px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);cursor:pointer}
.gh-select:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.gh-select:disabled{opacity:.5;cursor:default}
.gh-input{box-sizing:border-box;height:32px;width:100%;padding:0 10px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px}
.gh-input::placeholder{color:var(--dsw-alias-label-tertiary)}
.gh-input:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}
.gh-input:focus{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-link))}
.gh-textarea{box-sizing:border-box;width:100%;padding:8px 10px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;resize:vertical;min-height:80px}
.gh-textarea:hover{border-color:var(--dsw-alias-border-l2)}
.gh-textarea:focus{border-color:var(--dsw-alias-state-business-primary,var(--dsw-alias-link))}
.gh-textarea-mono{font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace)}
.gh-spinner{display:inline-block;box-sizing:border-box;border:1.5px solid var(--dsw-alias-border-l3);border-top-color:var(--dsw-alias-label-secondary);border-radius:50%;animation:gh-spin .8s linear infinite;flex:none}
.gh-empty{display:flex;flex-direction:column;align-items:center;gap:6px;padding:44px 20px;text-align:center;color:var(--dsw-alias-label-tertiary)}
.gh-empty-icon{color:var(--dsw-alias-label-tertiary);margin-bottom:4px;display:flex}
.gh-empty-title{font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;color:var(--dsw-alias-label-secondary)}
.gh-empty-hint{font-size:12px;line-height:20px;color:var(--dsw-alias-label-tertiary);max-width:420px}
.gh-empty-action{margin-top:8px}
.gh-error{display:flex;flex-direction:column;gap:8px;box-sizing:border-box;padding:10px 12px;border:0.5px solid var(--dsw-alias-state-error-primary);border-radius:var(--dsw-radius-lg,12px);background:var(--dsw-alias-state-error-secondary,var(--dsw-alias-bg-layer-1))}
.gh-error-row{display:flex;align-items:flex-start;gap:8px}
.gh-error-glyph{flex:none;color:var(--dsw-alias-state-error-primary);font-weight:600;line-height:20px}
.gh-error-text{flex:1;min-width:0;font-size:var(--dsh-content-font-size-secondary,13px);line-height:20px;overflow-wrap:anywhere;color:var(--dsw-alias-label-primary)}
.gh-command{display:flex;align-items:center;gap:8px;flex-wrap:wrap;box-sizing:border-box;padding:6px 8px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-1)}
.gh-command-text{flex:1;min-width:0;font-family:var(--dsh-font-family-code,ui-monospace,SFMono-Regular,Menlo,monospace);font-size:12px;line-height:20px;color:var(--dsw-alias-label-primary);overflow-wrap:anywhere}
.gh-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:40;display:inline-flex;align-items:center;gap:8px;box-sizing:border-box;max-width:min(480px,calc(100vw - 32px));padding:6px 8px 6px 12px;border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-toast-bg,var(--dsw-alias-bg-layer-3));color:var(--dsw-alias-toast-label,var(--dsw-alias-label-primary));box-shadow:var(--dsw-shadow-lv3,0 6px 24px rgba(0,0,0,.18));font-size:12px;line-height:20px}
.gh-toast-text{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.gh-toast-close{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;padding:0;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:inherit;cursor:pointer;flex:none;opacity:.75}
.gh-toast-close:hover{opacity:1}
.gh-btn:focus-visible,.gh-icon-btn:focus-visible,.gh-select:focus-visible,.gh-input:focus-visible,.gh-textarea:focus-visible,.gh-toast-close:focus-visible{outline:2px solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px}
@keyframes gh-spin{to{transform:rotate(360deg)}}
`.trim()
