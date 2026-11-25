/** Settle a promise within its own budget instead of the transport's. */

/**
 * Wait for `work`, but fail with `message` once `timeoutMs` elapses.
 *
 * The raced promise keeps running; callers use this for budgets the protocol does not enforce itself
 * (a listing that never pages out, a call the server answers only on close).
 */
export async function withDeadline<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs)
  })
  try {
    return await Promise.race([work, deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
