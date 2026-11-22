/**
 * Zoom and pan state for the wall.
 *
 * `s` is the scale (1 = the whole wall fits). `fx` and `fy` are the offset of the
 * scaled wall's top-left corner, as a fraction of the board's own width and
 * height. Fractions (not pixels) let the same state survive a resize, a rotation
 * or a full screen change without any bookkeeping, and map directly onto CSS
 * `translate(%)`.
 */
export type BoardView = { s: number; fx: number; fy: number }

export const minZoom = 1
export const maxZoom = 6
export const zoomStep = 1.5
export const fitView: BoardView = { s: 1, fx: 0, fy: 0 }

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, n))

/** Keeps the scale in range and the wall covering the whole frame (no empty gutters). */
export function clampView({ s, fx, fy }: BoardView): BoardView {
  if (!Number.isFinite(s) || !Number.isFinite(fx) || !Number.isFinite(fy))
    return fitView
  // Snap the last sliver back to "fit" so zooming out always lands exactly on 100%.
  const scale = s < 1.02 ? minZoom : clamp(s, minZoom, maxZoom)
  if (scale === minZoom) return fitView
  return {
    s: scale,
    fx: clamp(fx, 1 - scale, 0),
    fy: clamp(fy, 1 - scale, 0),
  }
}

/** Changes the scale while the board point under (px, py) stays under it. px/py are frame fractions. */
export function zoomAbout(
  view: BoardView,
  scale: number,
  px: number,
  py: number,
): BoardView {
  const next = clamp(scale, minZoom, maxZoom)
  const bx = (px - view.fx) / view.s
  const by = (py - view.fy) / view.s
  return clampView({ s: next, fx: px - bx * next, fy: py - by * next })
}

export const sameView = (a: BoardView, b: BoardView) =>
  a.s === b.s && a.fx === b.fx && a.fy === b.fy

/** CSS transform for the pan layer. The layer's transform-origin is its top-left corner. */
export const transformFor = ({ s, fx, fy }: BoardView) =>
  s === 1
    ? ''
    : `translate(${(fx * 100).toFixed(4)}%, ${(fy * 100).toFixed(4)}%) scale(${s.toFixed(5)})`

/**
 * Moves the view the least amount needed so a rectangle (given in board
 * percentages, like the wall slots) sits inside the frame with a margin.
 * Used so keyboard focus never lands on a note that is off screen.
 */
export function revealRect(
  view: BoardView,
  rect: { left: number; top: number; width: number; height: number },
  margin = 0.05,
): BoardView {
  if (view.s === 1) return view
  const place = (offset: number, start: number, size: number) => {
    const lo = offset + view.s * (start / 100)
    const hi = offset + view.s * ((start + size) / 100)
    let next = offset
    if (hi > 1 - margin) next -= hi - (1 - margin)
    if (lo + (next - offset) < margin) next += margin - (lo + (next - offset))
    return next
  }
  return clampView({
    s: view.s,
    fx: place(view.fx, rect.left, rect.width),
    fy: place(view.fy, rect.top, rect.height),
  })
}
