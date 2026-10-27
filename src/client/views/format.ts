/**
 * Pure formatting helpers for the GitHub Issues panel views.
 *
 * Everything here is a plain function of view-model data: no React, no theme
 * tokens, no translation. Views call these helpers and translate the locale keys
 * they return, which keeps the presentation rules reviewable (and testable)
 * without a browser.
 *
 * @module dsh-plugin-github-issues/client/views/format
 */

import type {
  IssueCardVM, IssueState, LabelVM, LinkedPRVM, PrioritySource, StateReason,
} from '../../vm.ts'
import type { Tone } from './controls.tsx'

/** One glyph, the semantic tone it carries, and the locale key naming it. */
export interface GlyphSpec {
  /** Short symbol drawn next to a PR number. */
  glyph: string
  /** Semantic color tone. */
  tone: Tone
  /** Locale key describing this state; translate with `t` in the view. */
  label: string
}

/** A label color as the two hex values a GitHub label pill needs. */
export interface LabelColorPair {
  /** `#rrggbb` background taken from the label color. */
  background: string
  /** Near-black or white text that stays readable on that background. */
  text: string
}

/** How many minutes one hour has; used only by {@link relativeTime}. */
const MINUTES_PER_HOUR = 60

/** A hex color with or without the leading `#`, either 3 or 6 digits. */
const HEX_COLOR = /^[0-9a-f]{3}$|^[0-9a-f]{6}$/i

/**
 * Expand one bare GitHub label color into a six-digit lowercase hex string.
 * @param hex - `rrggbb` or `rgb`, optionally prefixed with `#`.
 * @returns the normalized digits, or `undefined` when the value is not a color.
 */
function normalizeHex(hex: string): string | undefined {
  const cleaned = hex.trim().replace(/^#/, '')
  if (!HEX_COLOR.test(cleaned)) return undefined
  if (cleaned.length === 3) {
    return cleaned.split('').map(digit => `${digit}${digit}`).join('').toLowerCase()
  }
  return cleaned.toLowerCase()
}

/** Linearize one sRGB channel for the relative-luminance formula. */
function linearize(channel: number): number {
  const value = channel / 255
  return value <= 0.039_28 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

/**
 * Pick readable text for one GitHub label color.
 * @param hex - the label's bare hex color (with or without `#`).
 * @returns near-black or white, whichever contrasts with the background.
 */
export function labelTextColor(hex: string): string {
  const normalized = normalizeHex(hex)
  if (normalized === undefined) return '#ffffff'
  const red = Number.parseInt(normalized.slice(0, 2), 16)
  const green = Number.parseInt(normalized.slice(2, 4), 16)
  const blue = Number.parseInt(normalized.slice(4, 6), 16)
  const luminance = 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue)
  return luminance > 0.5 ? '#111111' : '#ffffff'
}

/**
 * Resolve one GitHub label color into the pill's background and text colors.
 * @param hex - the label's bare hex color (with or without `#`).
 * @returns the two hex values, or `undefined` when the color is malformed.
 */
export function labelColorPair(hex: string): LabelColorPair | undefined {
  const normalized = normalizeHex(hex)
  if (normalized === undefined) return undefined
  return { background: `#${normalized}`, text: labelTextColor(normalized) }
}

/**
 * Format an instant as a short, locale-neutral age such as `2h` or `3d`.
 * @param iso - ISO 8601 timestamp.
 * @param now - reference instant in milliseconds; defaults to the current time.
 * @returns the compact age, or `''` when the timestamp cannot be parsed.
 */
export function relativeTime(iso: string, now: number = Date.now()): string {
  const timestamp = Date.parse(iso)
  if (Number.isNaN(timestamp)) return ''
  const elapsedMinutes = Math.max(0, now - timestamp) / 60_000
  if (elapsedMinutes < 1) return 'just now'
  if (elapsedMinutes < MINUTES_PER_HOUR) return `${String(Math.floor(elapsedMinutes))}m`
  const hours = elapsedMinutes / MINUTES_PER_HOUR
  if (hours < 24) return `${String(Math.floor(hours))}h`
  const days = hours / 24
  if (days < 7) return `${String(Math.floor(days))}d`
  const weeks = days / 7
  if (weeks < 5) return `${String(Math.floor(weeks))}w`
  const months = days / 30
  if (months < 12) return `${String(Math.floor(months))}mo`
  return `${String(Math.floor(days / 365))}y`
}

/**
 * Format a milestone due date in a locale-neutral way.
 * @param iso - ISO 8601 date (or `null` when the milestone has no due date).
 * @returns `YYYY-MM-DD`, or `''` when there is no date.
 */
export function formatDue(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return ''
  // GitHub milestone due dates are date-only; keep the calendar day instead of
  // letting the browser shift it into the local timezone.
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (dateOnly !== null) {
    const [, year = '', month = '', day = ''] = dateOnly
    return `${year}-${month}-${day}`
  }
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${String(parsed.getFullYear())}-${month}-${day}`
}

/**
 * Map a priority name to the tone its chip uses.
 * @param name - the rendered priority (`P0`, `Urgent`, `High`, ...).
 * @returns the tone: error for P0/Urgent, warn for P1/High, info for P2/Medium.
 */
export function priorityTone(name: string): Tone {
  const key = name.trim().toLowerCase()
  if (key.startsWith('p0') || key === 'urgent' || key === 'critical' || key === 'blocker') return 'error'
  if (key.startsWith('p1') || key === 'high') return 'warn'
  if (key.startsWith('p2') || key === 'medium' || key === 'normal') return 'info'
  return 'neutral'
}

/**
 * Locale key describing where a priority value came from.
 * @param source - the rendered priority's source.
 * @returns the locale key for the source label.
 */
export function prioritySourceLabel(source: PrioritySource): string {
  switch (source) {
    case 'project': return 'panel.priority.project'
    case 'issue-field': return 'panel.priority.issueField'
    case 'label': return 'panel.priority.label'
  }
}

/**
 * Locale key naming an issue state.
 * @param state - the issue state.
 * @returns `panel.state.open` or `panel.state.closed`.
 */
export function stateLabelKey(state: IssueState): string {
  return state === 'OPEN' ? 'panel.state.open' : 'panel.state.closed'
}

/**
 * Map an issue state to the tone its dot and state badge use.
 * @param state - the issue state.
 * @param stateReason - why a closed issue was closed.
 * @returns success while open, neutral for not-planned/duplicate, info for completed.
 */
export function stateTone(state: IssueState, stateReason: StateReason): Tone {
  if (state === 'OPEN') return 'success'
  if (stateReason === 'NOT_PLANNED' || stateReason === 'DUPLICATE') return 'neutral'
  return 'info'
}

/**
 * Describe a pull request with one glyph, tone, and state label.
 * @param pr - the linked pull request.
 * @returns the glyph spec; merged/draft/open/closed in that precedence order.
 */
export function prGlyph(pr: LinkedPRVM): GlyphSpec {
  if (pr.merged) return { glyph: '◆', tone: 'info', label: 'panel.merged' }
  if (pr.isDraft) return { glyph: '◍', tone: 'neutral', label: 'panel.draft' }
  if (pr.state === 'OPEN') return { glyph: '●', tone: 'success', label: 'panel.openPR' }
  return { glyph: '✕', tone: 'error', label: 'panel.closedPR' }
}

/**
 * Describe the rolled-up check state of a pull request.
 * @param pr - the linked pull request.
 * @returns the glyph spec, or `undefined` when no checks were reported.
 */
export function checksGlyph(pr: LinkedPRVM): GlyphSpec | undefined {
  switch (pr.checks) {
    case null: return undefined
    case 'SUCCESS': return { glyph: '✓', tone: 'success', label: 'panel.checks.success' }
    case 'FAILURE':
    case 'ERROR': return { glyph: '✕', tone: 'error', label: 'panel.checks.failure' }
    case 'PENDING':
    case 'EXPECTED': return { glyph: '…', tone: 'warn', label: 'panel.checks.pending' }
    default: return { glyph: '–', tone: 'neutral', label: 'panel.checks.none' }
  }
}

/**
 * Describe the review decision of a pull request.
 * @param pr - the linked pull request.
 * @returns the glyph spec, or `undefined` when reviews are not required.
 */
export function reviewGlyph(pr: LinkedPRVM): GlyphSpec | undefined {
  switch (pr.reviewDecision) {
    case null: return undefined
    case 'APPROVED': return { glyph: '✓', tone: 'success', label: 'panel.review.approved' }
    case 'CHANGES_REQUESTED': return { glyph: '✕', tone: 'error', label: 'panel.review.changes' }
    case 'REVIEW_REQUIRED': return { glyph: '◔', tone: 'warn', label: 'panel.review.required' }
  }
}

/**
 * One-line plain-text description of a card, used for dock tooltips.
 * @param card - the issue card.
 * @returns `repo#number · title`.
 */
export function summaryLine(card: IssueCardVM): string {
  return `${card.repo}#${String(card.number)} · ${card.title}`
}

/**
 * Labels to render after the priority chip, without the label the chip already
 * shows. A P-label used as the priority would otherwise appear twice.
 * @param card - the rendered card.
 * @returns the labels this row should show.
 */
export function labelsWithoutPriority(card: IssueCardVM): readonly LabelVM[] {
  const priority = card.priority
  if (priority === undefined || priority.source !== 'label') return card.labels
  const name = priority.name.toLowerCase()
  return card.labels.filter(label => label.name.toLowerCase() !== name)
}
