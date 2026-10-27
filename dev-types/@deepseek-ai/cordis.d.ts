/**
 * Development-only declaration for the harness's Cordis context.
 *
 * Transcribed from the shipped Cordis API, covering only what this plugin uses.
 * Not published; the host supplies the real package at runtime.
 *
 * @module dsh-plugin-github-issues/dev-types/cordis
 */

declare module '@deepseek-ai/cordis' {
  /** The loader entry this plugin instance was mounted from. */
  export interface Fiber {
    /** The loader entry's own options, whose id names this plugin's settings namespace. */
    entry?: { options?: { id?: string } }
  }

  /** The plugin context, narrowed to the members this plugin uses. */
  export interface Context {
    fiber: Fiber
    /** Register a resource owned by this plugin instance; the callback returns its cleanup. */
    effect(callback: () => () => void): () => void
    /** Read one optional service by key, or `undefined` when the composition lacks it. */
    get(name: string): unknown
    /**
     * Run `callback` once the named services are available, against a context
     * that carries them.
     * @param deps - service keys to wait for.
     * @param callback - runs with the injected context.
     */
    inject(deps: readonly string[], callback: (child: Context) => void): void
    /** Publish one event to the whole application. */
    emit(event: string, ...args: unknown[]): void
  }
}
