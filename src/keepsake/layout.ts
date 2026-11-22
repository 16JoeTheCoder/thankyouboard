export interface Note {
  id: string
  teacher: string
  text: string
}
export const sizes = {
  A3: [297, 420],
  A4: [210, 297],
  A5: [148, 210],
  A6: [105, 148],
} as const
export type Size = keyof typeof sizes
export const layouts = [
  'Gallery',
  'Botanical',
  'Rose Letter',
  'Blue Ink',
  'Letterpress',
] as const
export type Layout = (typeof layouts)[number]
export type Face = 'Serif' | 'Sans' | 'Italic'
export interface TextItem {
  kind: 'text'
  x: number
  y: number
  size: number
  face: Face
  fill: string
  value: string
}
type Shape = {
  kind: 'line' | 'rect' | 'ellipse'
  x: number
  y: number
  w: number
  h: number
  color: string
  stroke?: number
}
export type Item = TextItem | Shape
export interface Sheet {
  width: number
  height: number
  items: Item[]
}
export const palette: Record<Layout, string> = {
  Gallery: '#b04e35',
  Botanical: '#506c4e',
  'Rose Letter': '#9a4d61',
  'Blue Ink': '#32598b',
  Letterpress: '#675a45',
}
const ink = '#332f29'
const fonts = import.meta.glob('./fonts/*.ttf', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>
const promises = new Map<string, Promise<void>>()
export function fontUrl(name: string) {
  return fonts['./fonts/' + name + '.ttf']
}
export function isEmoji(char: string) {
  return /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(char)
}
export function fontFor(char: string, face: Face) {
  const cp = char.codePointAt(0) || 0
  const block = 'CJK-' + (cp >> 12).toString(16)
  return !isEmoji(char) && cp >= 0x2e00 && cp < 0x20000 && fontUrl(block)
    ? block
    : face
}
export async function loadFonts(text: string) {
  const names = new Set(['Serif', 'Italic', 'Sans'])
  for (const c of text) names.add(fontFor(c, 'Serif'))
  await Promise.all(
    [...names].map((name) => {
      if (!promises.has(name)) {
        const job = new FontFace('Keep' + name, 'url(' + fontUrl(name) + ')')
          .load()
          .then((face) => {
            document.fonts.add(face)
          })
          .catch((err) => {
            promises.delete(name)
            throw err
          })
        promises.set(name, job)
      }
      return promises.get(name)
    }),
  )
}
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const graphemes = (value: string) =>
  Array.from(segmenter.segment(value), (v) => v.segment)
export function runs(value: string, face: Face) {
  const result: { value: string; font: string }[] = []
  for (const c of graphemes(value)) {
    const font = isEmoji(c) ? 'emoji' : fontFor(c, face)
    const last = result[result.length - 1]
    if (last && last.font === font && font !== 'emoji') last.value += c
    else result.push({ value: c, font })
  }
  return result
}
let ctx: CanvasRenderingContext2D | null
export function runWidth(value: string, font: string, size: number) {
  ctx ??= document.createElement('canvas').getContext('2d')!
  ctx.font =
    size + 'px ' + (font === 'emoji' ? 'emoji' : '"Keep' + font + '", serif')
  return ctx.measureText(value).width
}
function measure(value: string, face: Face, size: number) {
  return runs(value, face).reduce(
    (w, r) => w + runWidth(r.value, r.font, size),
    0,
  )
}
function lines(value: string, face: Face, size: number, width: number) {
  const out: string[] = []
  for (const para of value.split(/\r\n|\r|\n/)) {
    let line = '',
      used = 0
    // Keep western words whole when possible. Long words and CJK wrap at grapheme boundaries.
    for (const token of para.match(/\s+|[^\s]+/gu) || []) {
      const tw = measure(token, face, size)
      if (line && used + tw > width && tw <= width && token.trim()) {
        out.push(line)
        line = ''
        used = 0
      }
      if (used + tw <= width) {
        line += token
        used += tw
        continue
      }
      for (const c of graphemes(token)) {
        const cw = measure(c, face, size)
        if (line && used + cw > width) {
          out.push(line)
          line = ''
          used = 0
        }
        line += c
        used += cw
      }
    }
    out.push(line)
  }
  return out
}

export function compose(
  notes: readonly Note[],
  teacher: string,
  layout: Layout,
  size: Size,
): Sheet[] {
  if (!notes.length) return []
  const [wm, hm] = sizes[size]
  const w = (wm * 72) / 25.4,
    h = (hm * 72) / 25.4
  const m = w * 0.105,
    accent = palette[layout],
    single = notes.length === 1
  const center =
    layout === 'Gallery' || layout === 'Rose Letter' || layout === 'Letterpress'
  const face: Face =
    layout === 'Blue Ink'
      ? 'Sans'
      : layout === 'Rose Letter'
        ? 'Italic'
        : 'Serif'
  const pages: Sheet[] = []
  let items: Item[] = []
  const rule = (
    x: number,
    y: number,
    dx: number,
    dy: number,
    color = accent,
    stroke = 0.65,
  ) => items.push({ kind: 'line', x, y, w: dx, h: dy, color, stroke })
  const rect = (
    x: number,
    y: number,
    width: number,
    height: number,
    color: string,
  ) => items.push({ kind: 'rect', x, y, w: width, h: height, color })
  const ellipse = (
    x: number,
    y: number,
    rx: number,
    ry: number,
    color: string,
  ) => items.push({ kind: 'ellipse', x, y, w: rx, h: ry, color })
  function text(
    value: string,
    x: number,
    y: number,
    fontSize: number,
    fontFace: Face,
    fill: string,
    align: 'left' | 'center' | 'right' = 'left',
  ) {
    const offset =
      align === 'left'
        ? 0
        : measure(value, fontFace, fontSize) / (align === 'center' ? 2 : 1)
    items.push({
      kind: 'text',
      value,
      x: x - offset,
      y,
      size: fontSize,
      face: fontFace,
      fill,
    })
  }
  const bodyW = w - m * 2,
    bottom = h - m * 0.95
  const nameSize = Math.max(15, Math.min(42, w * 0.068)),
    nameFace = layout === 'Rose Letter' ? 'Italic' : 'Serif'
  const nameLines = lines(teacher, nameFace, nameSize, bodyW)
  const start = m * 1.56 + nameLines.length * nameSize * 1.15 + m * 0.54
  function newPage() {
    items = []
    pages.push({ width: w, height: h, items })
    const k = w / 595
    if (layout === 'Gallery') {
      const x = m * 0.58,
        y = m * 0.56,
        s = 10 * k
      rect(x, y, s, s, '#be5c42')
      rect(x + s * 1.18, y, s, s, '#dab163')
      rect(x, y + s * 1.18, s, s, '#a6b79d')
      rule(x + s * 3.1, y + s * 0.5, w - x * 2 - s * 3.1, 0, '#b9a697')
    } else if (layout === 'Botanical') {
      const x = w - m * 1.07,
        y = m * 1.45
      rule(x, y, 13 * k, -43 * k)
      for (let j = 0; j < 4; j++) {
        const lx = x + 3.2 * k * j,
          ly = y - 9 * k * j
        rule(lx, ly, -6 * k, -6 * k)
        ellipse(lx - 7 * k, ly - 8 * k, 4 * k, 6 * k, '#7b8f71')
        rule(lx + 2 * k, ly - 4 * k, 6 * k, -4 * k)
        ellipse(lx + 10 * k, ly - 10 * k, 5 * k, 3 * k, '#a5ad88')
      }
    } else if (layout === 'Rose Letter') {
      rule(m * 0.65, m * 0.62, w - m * 1.3, 0, '#c997a3')
      const cx = w / 2,
        cy = m * 0.64
      rect(cx - 15 * k, cy - 6 * k, 30 * k, 13 * k, '#ffffff')
      for (let j = 0; j < 5; j++) {
        const a = (j * Math.PI * 2) / 5
        ellipse(
          cx + Math.cos(a) * 4.8 * k,
          cy + Math.sin(a) * 4.8 * k,
          3.8 * k,
          3.8 * k,
          '#b5667b',
        )
      }
      ellipse(cx, cy, 2.6 * k, 2.6 * k, '#d8a064')
    } else if (layout === 'Blue Ink') {
      rule(m, m * 0.62, bodyW, 0, accent, 1.8)
      rule(m, m * 0.62 + 4 * k, bodyW, 0, accent)
      rect(m * 0.62, m, 2 * k, h - m * 2, '#a4b9d1')
    } else {
      rule(m * 0.62, m * 0.66, w - m * 1.24, 0, '#70614d', 1.2)
      rule(m * 0.62, m * 0.66 + 4 * k, w - m * 1.24, 0, '#a1988a')
    }
    const ax = center ? w / 2 : m
    text(
      'For',
      ax,
      m * 1.25,
      Math.max(8, Math.min(13, w * 0.023)),
      'Italic',
      accent,
      center ? 'center' : 'left',
    )
    nameLines.forEach((l, i) =>
      text(
        l,
        ax,
        m * 1.53 + (i + 0.8) * nameSize * 1.15,
        nameSize,
        nameFace,
        ink,
        center ? 'center' : 'left',
      ),
    )
    rule(center ? w / 2 - 11 * k : m, start - m * 0.27, 22 * k, 0, accent, 1.55)
    rule(m, h - m * 0.7, bodyW, 0, '#cfc7bb')
    text(
      'STJBS Student Council',
      m,
      h - m * 0.43,
      Math.max(7, Math.min(10, w * 0.017)),
      'Sans',
      ink,
    )
    text(
      String(pages.length).padStart(2, '0'),
      w - m,
      h - m * 0.43,
      Math.max(7, Math.min(10, w * 0.017)),
      'Sans',
      accent,
      'right',
    )
  }
  newPage()
  let top = start
  for (const note of notes) {
    let fs = single
      ? Math.min(37, Math.max(19, w * 0.054))
      : Math.min(17, Math.max(11, w * 0.027))
    let wrapped = lines(note.text, face, fs, bodyW)
    if (single) {
      const minimum = Math.max(11, fs * 0.6)
      while (wrapped.length * fs * 1.47 > bottom - start && fs > minimum) {
        fs = Math.max(minimum, fs - 1)
        wrapped = lines(note.text, face, fs, bodyW)
      }
      top =
        start +
        Math.max(0, (bottom - start - wrapped.length * fs * 1.47) * 0.42)
    }
    const step = fs * 1.47
    const gap = single ? 0 : Math.max(16, w * 0.043)
    if (top > start && !single) {
      if (
        top + gap + Math.min(wrapped.length, 2) * step > bottom ||
        (wrapped.length * step <= bottom - start &&
          top + gap + wrapped.length * step > bottom)
      ) {
        newPage()
        top = start
      } else {
        rule(
          center ? w / 2 - 7 : m,
          top + gap * 0.39,
          center ? 14 : bodyW,
          0,
          '#c6b9aa',
        )
        top += gap
      }
    }
    for (const l of wrapped) {
      if (top + step > bottom && top > start) {
        newPage()
        top = start
      }
      text(
        l,
        center ? w / 2 : m,
        top + fs,
        fs,
        face,
        ink,
        center ? 'center' : 'left',
      )
      top += step
    }
  }
  return pages
}
