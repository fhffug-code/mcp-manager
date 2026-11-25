/** A refusal or failure the settings page and the model tool both report verbatim. */
export type FailureCode =
  | 'unknown-server'
  | 'not-editable'
  | 'invalid-config'
  | 'name-conflict'
  | 'overridden'
  | 'config-editor-unavailable'
  | 'invalid-request'
  | 'probe-failed'
  | 'call-failed'
  | 'unsupported'

/** One refusal with a stable code, so both surfaces report the same reason. */
export class WorkbenchFailure extends Error {
  constructor(
    readonly code: FailureCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'WorkbenchFailure'
  }
}

/** Normalize anything thrown into the reported shape. */
export function failureOf(error: unknown): { code: FailureCode; message: string; details?: unknown } {
  if (error instanceof WorkbenchFailure) {
    return {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
    }
  }
  const message = error instanceof Error ? error.message : String(error)
  // The config editor refuses writes its higher layers already own.
  if (message.includes('overridden by a home patch') || message.includes('command-line overlay')) {
    return { code: 'overridden', message }
  }
  return { code: 'invalid-request', message }
}
