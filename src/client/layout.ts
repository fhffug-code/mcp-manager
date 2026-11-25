/**
 * How the page divides its width and height, and where that division is remembered.
 * A share is a fraction of the container it divides: `servers` of the whole page, `tools` of the band
 * beside the servers, `detail` of the column the description and the call sit in.
 */
export interface Layout {
  servers: number
  tools: number
  detail: number
}

/** The key the page keeps its division under, in the browser's own storage. */
export const LAYOUT_KEY = 'mcp-workbench:layout'

/** 2:8 on the first split, 3:7 on the two inner ones, so the page looks the same on a fresh browser. */
export const DEFAULT_LAYOUT: Layout = { servers: 0.2, tools: 0.3, detail: 0.3 }

/** How narrow and how wide a band may be dragged: no band can be squeezed out of reach. */
export const LIMITS: Record<keyof Layout, readonly [number, number]> = {
  servers: [0.12, 0.5],
  tools: [0.15, 0.7],
  detail: [0.15, 0.7],
}

const clamp = (value: number, [min, max]: readonly [number, number]): number => Math.min(Math.max(value, min), max)

/** One share of a parsed object: a finite number is kept inside its limits, anything else is the default. */
function share(source: Record<string, unknown>, key: keyof Layout): number {
  const raw = source[key]
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return DEFAULT_LAYOUT[key]
  return clamp(raw, LIMITS[key])
}

/** Whatever a stored or caller-supplied value says, as a division the page can render. */
export function clampLayout(candidate: unknown): Layout {
  const source =
    typeof candidate === 'object' && candidate !== null ? (candidate as Record<string, unknown>) : ({} as const)
  return { servers: share(source, 'servers'), tools: share(source, 'tools'), detail: share(source, 'detail') }
}

/** Read the remembered division; a missing, unreadable or malformed entry is the default one. */
export function readLayout(storage: Storage | undefined): Layout {
  if (storage === undefined) return { ...DEFAULT_LAYOUT }
  let text: string | null
  try {
    text = storage.getItem(LAYOUT_KEY)
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
  if (text === null || text === '') return { ...DEFAULT_LAYOUT }
  try {
    return clampLayout(JSON.parse(text))
  } catch {
    return { ...DEFAULT_LAYOUT }
  }
}

/** Remember the division; a browser that refuses to store it simply forgets it. */
export function writeLayout(storage: Storage | undefined, layout: Layout): void {
  if (storage === undefined) return
  try {
    storage.setItem(LAYOUT_KEY, JSON.stringify(clampLayout(layout)))
  } catch {
    // A page that cannot remember is still a page that works.
  }
}

/** Where a pointer sits inside a box, as a fraction of the axis the separator divides. */
export function fractionOf(
  rect: { left: number; top: number; width: number; height: number },
  point: { x: number; y: number },
  axis: 'x' | 'y',
): number {
  if (axis === 'x') return rect.width <= 0 ? 0 : (point.x - rect.left) / rect.width
  return rect.height <= 0 ? 0 : (point.y - rect.top) / rect.height
}
