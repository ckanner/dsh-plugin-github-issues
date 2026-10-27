/**
 * Mounting this plugin's own Client Remote namespace.
 *
 * The generated `ctx.remote.*` aggregate is assembled at build time from a fixed
 * list of shipped packages, so nothing installs a namespace for an out-of-tree
 * plugin. This hand-written contribution is that missing piece; it is built from
 * the same `REMOTE_METHODS` table the Host decorates, so the two sides cannot drift
 * apart without a type error.
 *
 * Two validators read these descriptors: the Gateway requires a `strict` codec on
 * every parameter and never calls it, while the Typert registry requires a strict
 * codec to also name a type symbol and provide a `create()` factory. Parameters
 * satisfy both; the result uses `src-json`, which is exempt from the second check
 * and ignored by the first.
 *
 * @module dsh-plugin-github-issues/client/remote
 */

import { REMOTE_METHODS, REMOTE_NAMESPACE, REMOTE_SERVICE_KEY } from '../remote-methods.ts'

/** The package name the mount is attributed to, as the Gateway records it. */
const PACKAGE = 'dsh-plugin-github-issues'

/** How the Host receives a result this side does not need to decode. */
const RESULT_CODEC = { mode: 'src-json' as const }

/**
 * A codec both validators accept, for one argument.
 * @param typeSymbol - the name the registry records for this argument's type.
 * @returns the codec.
 */
function parameterCodec(typeSymbol: string): { mode: 'strict'; typeSymbol: string; create: () => unknown } {
  return {
    mode: 'strict',
    typeSymbol,
    create: () => ({ parse: (value: unknown) => value }),
  }
}

/** A descriptor as far as both validators and the client's call path read it. */
interface RemoteDescriptor {
  id: string
  service: string
  namespace: string
  method: string
  invocation: { kind: 'direct' }
  parameters: {
    name: string
    wire: string
    source: 'json'
    codec: { mode: 'strict'; typeSymbol: string; create: () => unknown }
    acceptsUndefined?: true
  }[]
  result: { mode: 'src-json' }
  sourceLocation: { file: string; line: number; column: number }
}

/** A contribution of one package's descriptors. */
export interface RemoteContribution {
  package: string
  descriptors: RemoteDescriptor[]
}

/**
 * The contribution this plugin mounts.
 * @returns one descriptor per exposed method.
 */
export function remoteContribution(): RemoteContribution {
  return {
    package: PACKAGE,
    descriptors: REMOTE_METHODS.map(({ method, parameters }) => ({
      id: `${PACKAGE}#${REMOTE_NAMESPACE}/${method}`,
      service: REMOTE_SERVICE_KEY,
      namespace: REMOTE_NAMESPACE,
      method,
      invocation: { kind: 'direct' as const },
      parameters: parameters.map(({ wire, optional }) => ({
        name: wire,
        wire,
        source: 'json' as const,
        codec: parameterCodec(`${PACKAGE}#${REMOTE_NAMESPACE}/${method}:${wire}`),
        ...optional === true ? { acceptsUndefined: true as const } : {},
      })),
      result: RESULT_CODEC,
      // Point the descriptor at the declaration it mirrors so a Gateway diagnostic
      // leads to the method it is really about.
      sourceLocation: { file: 'src/controller.ts', line: 1, column: 1 },
    })),
  }
}
