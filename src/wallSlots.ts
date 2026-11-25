// Each occupied rectangle belongs to a letter. Subdividing those rectangles keeps
// the silhouette and the address of every envelope independent of the notes.
const glyphs = [
  ['11111', '11111', '00100', '00100', '00100', '00100', '00100'],
  ['11011', '11011', '11011', '11111', '11011', '11011', '11011'],
  ['01110', '11011', '11011', '11111', '11011', '11011', '11011'],
  ['11001', '11001', '11101', '11111', '10111', '10011', '10011'],
  ['11011', '11011', '11110', '11100', '11110', '11011', '11011'],
  ['11011', '11011', '01110', '01110', '00100', '00100', '00100'],
  ['01110', '11011', '11011', '11011', '11011', '11011', '01110'],
  ['11011', '11011', '11011', '11011', '11011', '11011', '01110'],
]
type Rect = { x: number; y: number; w: number; h: number; letter: number }
const rects: Rect[] = []
glyphs.forEach((rows, letter) => {
  const x0 = letter < 5 ? letter * 6 : (letter - 5) * 6 + 6
  const y0 = letter < 5 ? 0 : 8.2
  rows.forEach((row, y) => {
    for (const run of row.matchAll(/1+/g)) {
      const x = x0 + run.index!,
        w = run[0].length
      const above = rects.find(
        (r) =>
          r.letter === letter && r.x === x && r.w === w && r.y + r.h === y0 + y,
      )
      if (above) above.h++
      else rects.push({ x, y: y0 + y, w, h: 1, letter })
    }
  })
})
let seed = 7249
const random = () =>
  (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32
while (rects.length < 500) {
  let index = 0
  for (let i = 1; i < rects.length; i++)
    if (rects[i].w * rects[i].h > rects[index].w * rects[index].h) index = i
  const a = rects[index],
    b = { ...a },
    ratio = 0.41 + 0.18 * random()
  if (a.w * 1.3 > a.h) {
    a.w *= ratio
    b.x += a.w
    b.w -= a.w
  } else {
    a.h *= ratio
    b.y += a.h
    b.h -= a.h
  }
  rects.push(b)
}
export const wallSlots = rects
  .sort((a, b) => a.letter - b.letter || a.y - b.y || a.x - b.x)
  .map((r) => ({
    left: (r.x / 29) * 100,
    top: (r.y / 15.2) * 100,
    width: (r.w / 29) * 100,
    height: (r.h / 15.2) * 100,
    letter: r.letter,
    variant: Math.floor(random() * 4),
    tilt: (random() - 0.5) * 8,
    large: r.w * r.h > 0.57,
    excerpt: true, // every note carries its printed opening line
  }))

// Each new round visits all eight letters in a permuted order. A note splits
// an existing piece along its longer edge, without moving neighboring pieces.
// Store only occupied slots, even when restoring a sparse historical backup.
export type PaperLayout = Map<number, (typeof wallSlots)[number]>
export function layoutFor(
  notes: readonly { slot: number }[],
  lastSlot: number,
): PaperLayout {
  const baseCount = wallSlots.length
  const layout: PaperLayout = new Map()
  for (const { slot } of notes) {
    const extra = slot - baseCount
    const base = extra < 0 ? slot : ((extra % baseCount) * 137) % baseCount
    const piece = extra < 0 ? 0 : Math.floor(extra / baseCount) + 1
    // 73 is the multiplicative inverse of 137 modulo 500.
    const firstExtra = baseCount + ((base * 73) % baseCount)
    const count =
      1 + Math.max(0, Math.floor((lastSlot - firstExtra) / baseCount) + 1)
    const rect = { ...wallSlots[base] }
    for (let stride = 1; stride < count; stride *= 2) {
      const parent = piece % stride
      if (parent + stride >= count) continue
      const second = piece % (2 * stride) >= stride
      if (rect.width * 29 >= rect.height * 15.2) {
        rect.width /= 2
        if (second) rect.left += rect.width
      } else {
        rect.height /= 2
        if (second) rect.top += rect.height
      }
    }
    layout.set(slot, rect)
  }
  return layout
}
