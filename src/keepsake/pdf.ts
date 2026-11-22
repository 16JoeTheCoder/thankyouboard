import { jsPDF } from 'jspdf'
import { fontUrl, runs, runWidth, type Sheet } from './layout'

const fontCache = new Map<string, Promise<string>>()
function fontData(name: string) {
  if (!fontCache.has(name)) {
    const job = fetch(fontUrl(name))
      .then(async (response) => {
        if (!response.ok) throw new Error('The print font could not load.')
        const data = new Uint8Array(await response.arrayBuffer())
        const parts = []
        for (let i = 0; i < data.length; i += 8192)
          parts.push(String.fromCharCode(...data.subarray(i, i + 8192)))
        return btoa(parts.join(''))
      })
      .catch((e) => {
        fontCache.delete(name)
        throw e
      })
    fontCache.set(name, job)
  }
  return fontCache.get(name)!
}

function emoji(
  doc: jsPDF,
  value: string,
  x: number,
  y: number,
  size: number,
  width: number,
) {
  const canvas = document.createElement('canvas'),
    scale = 4
  canvas.width = Math.ceil(Math.max(width, size) * scale * 1.5)
  canvas.height = Math.ceil(size * scale * 1.8)
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.font = size + 'px emoji'
  ctx.fillText(value, 0, size * 1.2)
  // Mark the bitmap with its UTF-16 source so copying and extracting preserve emoji sequences.
  const hex = value
    .split('')
    .map((c) => c.charCodeAt(0).toString(16).padStart(4, '0'))
    .join('')
  const stream = doc.internal as unknown as { write: (s: string) => void }
  stream.write('/Span << /ActualText <FEFF' + hex + '> >> BDC')
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(size)
  doc.text('M', x, y, { renderingMode: 'invisible' })
  doc.addImage(
    canvas,
    'PNG',
    x,
    y - size * 1.2,
    canvas.width / scale,
    canvas.height / scale,
  )
  stream.write('EMC')
}

export async function downloadPdf(sheets: Sheet[], teacher: string) {
  if (!sheets.length) throw new Error('Select at least one note.')
  const { width, height } = sheets[0]
  const doc = new jsPDF({
    unit: 'pt',
    format: [width, height],
    orientation: 'portrait',
    compress: true,
    putOnlyUsedFonts: true,
  })
  doc.setProperties({
    title: 'Notes for ' + teacher,
    author: 'STJBS Student Council',
  })
  const needed = new Set<string>()
  for (const p of sheets)
    for (const i of p.items)
      if (i.kind === 'text')
        for (const r of runs(i.value, i.face))
          if (r.font !== 'emoji') needed.add(r.font)
  await Promise.all(
    [...needed].map(async (name) => {
      const file = name + '.ttf'
      doc.addFileToVFS(file, await fontData(name))
      doc.addFont(file, name, 'normal')
    }),
  )
  for (let i = 0; i < sheets.length; i++) {
    if (i) doc.addPage([width, height], 'portrait')
    for (const item of sheets[i].items) {
      if (item.kind === 'text') {
        let x = item.x
        for (const r of runs(item.value, item.face)) {
          const rw = runWidth(r.value, r.font, item.size)
          if (r.font === 'emoji') emoji(doc, r.value, x, item.y, item.size, rw)
          else {
            doc.setTextColor(item.fill)
            doc.setFontSize(item.size)
            doc.setFont(r.font, 'normal')
            doc.text(r.value, x, item.y)
          }
          x += rw
        }
      } else if (item.kind === 'line') {
        doc.setDrawColor(item.color)
        doc.setLineWidth(item.stroke ?? 0.65)
        doc.line(item.x, item.y, item.x + item.w, item.y + item.h)
      } else {
        doc.setFillColor(item.color)
        if (item.kind === 'ellipse')
          doc.ellipse(item.x, item.y, item.w, item.h, 'F')
        else doc.rect(item.x, item.y, item.w, item.h, 'F')
      }
    }
  }
  doc.save('Notes for ' + teacher.replace(/[\\/:*?"<>|]/g, '-') + '.pdf')
}
