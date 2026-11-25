/** The strip between two bands: it drags, it takes arrow keys, and a double click puts its band back. */
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { fractionOf } from './layout.js'

export interface SplitterProps {
  /** The axis the separator divides: `x` between columns, `y` between rows. */
  axis: 'x' | 'y'
  /** The share of the band before it. */
  value: number
  minMax: readonly [number, number]
  onChange(next: number): void
  onReset(): void
  label: string
  testId: string
}

const STEP = 0.02
const BIG_STEP = 0.05

export function Splitter({ axis, value, minMax, onChange, onReset, label, testId }: SplitterProps) {
  const [min, max] = minMax
  const move = (next: number): void => onChange(Math.min(Math.max(next, min), max))

  const follow = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const parent = event.currentTarget.parentElement
    if (parent === null) return
    move(fractionOf(parent.getBoundingClientRect(), { x: event.clientX, y: event.clientY }, axis))
  }

  const press = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? BIG_STEP : STEP
    const forward = axis === 'x' ? 'ArrowRight' : 'ArrowDown'
    const backward = axis === 'x' ? 'ArrowLeft' : 'ArrowUp'
    if (event.key === forward) {
      event.preventDefault()
      move(value + step)
    } else if (event.key === backward) {
      event.preventDefault()
      move(value - step)
    } else if (event.key === 'Home') {
      event.preventDefault()
      move(min)
    } else if (event.key === 'End') {
      event.preventDefault()
      move(max)
    }
  }

  return (
    <div
      role="separator"
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      aria-label={label}
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={Math.round(min * 100)}
      aria-valuemax={Math.round(max * 100)}
      tabIndex={0}
      data-testid={testId}
      className={axis === 'x' ? 'mcpw-sep mcpw-sep-x' : 'mcpw-sep mcpw-sep-y'}
      onPointerDown={(event) => {
        event.preventDefault()
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) follow(event)
      }}
      onPointerUp={(event) => {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onKeyDown={press}
      onDoubleClick={onReset}
    />
  )
}
