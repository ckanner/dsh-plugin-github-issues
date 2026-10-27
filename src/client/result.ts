/**
 * Unwrapping what a Remote call resolves to.
 *
 * A namespace method never rejects for a business or transport failure: it
 * resolves to an envelope carrying either the value or the refusal. Rendering the
 * envelope as if it were the value produces a silently empty panel, which is the
 * one failure mode this module exists to prevent.
 *
 * @module dsh-plugin-github-issues/client/result
 */

/** What a Remote call resolves to. */
export type RemoteResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code?: string; message?: string } }

/** An error carrying the Host's code, so callers can branch on it. */
export class RemoteRefusal extends Error {
  readonly code: string | undefined

  /**
   * @param message - human text for the panel.
   * @param code - the Host's machine code, when it sent one.
   */
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'RemoteRefusal'
    this.code = code
  }
}

/**
 * Unwrap a Remote result, turning a refusal into a thrown error.
 * @param result - the envelope the namespace method resolved to.
 * @returns the value it carries.
 * @throws {@link RemoteRefusal} when the call was refused.
 */
export function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  const code = result.error?.code
  const message = result.error?.message
  if (message === undefined || message.length === 0) {
    throw new RemoteRefusal(code === undefined ? 'the GitHub service refused the request' : `GitHub request failed (${code})`, code)
  }
  throw new RemoteRefusal(message, code)
}
