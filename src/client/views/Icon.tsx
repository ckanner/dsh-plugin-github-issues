/**
 * The plugin's own vector marks, drawn inline so the bundle imports no Harness
 * package and the browser needs no icon font.
 *
 * All artwork is original: the rail mark is an issue bubble branching into a
 * pull-request node, not the GitHub trademark octocat. Every glyph strokes in
 * `currentColor`, so the surrounding text color decides the tone.
 *
 * @module dsh-plugin-github-issues/client/views/Icon
 */

import type { ReactNode } from 'react'
import type { IconProps } from '../viewmodel.ts'

/** Props every small line glyph accepts. */
export interface GlyphProps {
  /** Square edge in pixels; defaults to 14. */
  size?: number | undefined
}

/** Shared SVG scaffold for one 24×24 line glyph. */
function Glyph({ size = 14, children }: { size?: number | undefined; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

/**
 * The GitHub panel mark: an issue bubble that branches into a pull-request node.
 *
 * @param props - requested square size and whether the panel is selected.
 * @returns the inline mark; `active` adds a subtle rounded-square backdrop.
 */
export function GitHubIcon({ size = 16, active }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {active === true && <rect x="0" y="0" width="24" height="24" rx="6" fill="currentColor" opacity={0.1} stroke="none" />}
      <circle cx="7" cy="7" r="3.1" />
      <circle cx="7" cy="7" r="1" fill="currentColor" stroke="none" />
      <path d="M7 10.2v3.3a4.5 4.5 0 0 0 4.5 4.5h2.3" />
      <circle cx="17" cy="18" r="2.4" />
      <path d="M17 15.5v-6" />
      <circle cx="17" cy="7" r="2.4" />
    </svg>
  )
}

/** A small close mark for dismiss buttons. */
export function CloseGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </Glyph>
  )
}

/** A magnifier for the panel's local filter field. */
export function SearchGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="10.5" cy="10.5" r="6.2" />
      <path d="M15.2 15.2L20 20" />
    </Glyph>
  )
}

/** A circular-arrow mark for the refresh action. */
export function RefreshGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4.6h-4.6" />
    </Glyph>
  )
}

/** A chain-link mark, also used to flag private repositories. */
export function LinkGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M10.3 13.7a4 4 0 0 0 5.7 0l2.7-2.7a4 4 0 0 0-5.7-5.7l-1.4 1.4" />
      <path d="M13.7 10.3a4 4 0 0 0-5.7 0l-2.7 2.7a4 4 0 1 0 5.7 5.7l1.4-1.4" />
    </Glyph>
  )
}

/** A speech-bubble mark for comment counts. */
export function CommentGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M20 15a3 3 0 0 1-3 3H9l-5 3V7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3z" />
    </Glyph>
  )
}

/** Two offset sheets for the copy actions. */
export function CopyGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </Glyph>
  )
}

/** An arrow leaving a frame for "open on GitHub". */
export function ExternalGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M14 5h5v5" />
      <path d="M19 5l-8.5 8.5" />
      <path d="M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </Glyph>
  )
}

/** A pushpin for the panel's pin action. */
export function PlusGlyph(props: GlyphProps) {
  const { size = 14 } = props
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} fill="none" aria-hidden="true">
      <path d="M8 3.5v9M3.5 8h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function PinGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M9 4h6l-1.2 6 3.2 3.2V15H7v-1.8L10.2 10 9 4z" />
      <path d="M12 15v5" />
    </Glyph>
  )
}
