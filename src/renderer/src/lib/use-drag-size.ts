import { useCallback, useEffect, useRef, useState } from 'react'

interface Options {
  initial: number
  min: number
  max: number
  axis: 'x' | 'y'
  /** true when dragging towards the axis origin should grow the panel */
  invert?: boolean
}

export function useDragSize({ initial, min, max, axis, invert = false }: Options): {
  size: number
  onPointerDown: (event: { clientX: number; clientY: number; preventDefault: () => void }) => void
  dragging: boolean
} {
  const [size, setSize] = useState(initial)
  const [dragging, setDragging] = useState(false)
  const start = useRef({ pointer: 0, size: initial })

  const onPointerDown = useCallback(
    (event: { clientX: number; clientY: number; preventDefault: () => void }) => {
      event.preventDefault()
      start.current = { pointer: axis === 'x' ? event.clientX : event.clientY, size }
      setDragging(true)
    },
    [axis, size]
  )

  useEffect(() => {
    if (!dragging) return
    const onMove = (event: MouseEvent): void => {
      const pointer = axis === 'x' ? event.clientX : event.clientY
      const delta = (pointer - start.current.pointer) * (invert ? -1 : 1)
      setSize(Math.max(min, Math.min(max, start.current.size + delta)))
    }
    const onUp = (): void => setDragging(false)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [dragging, axis, invert, min, max])

  return { size, onPointerDown, dragging }
}
