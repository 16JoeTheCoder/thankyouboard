import { runs, runWidth, type Sheet } from './layout'

export default function SheetView({ sheet }: { sheet: Sheet }) {
  return (
    <svg
      className="ks-paper"
      aria-label="Keepsake page"
      viewBox={`0 0 ${sheet.width} ${sheet.height}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width={sheet.width} height={sheet.height} fill="#fff" />
      {sheet.items.map((i, k) => {
        if (i.kind === 'line')
          return (
            <line
              key={k}
              x1={i.x}
              y1={i.y}
              x2={i.x + i.w}
              y2={i.y + i.h}
              stroke={i.color}
              strokeWidth={i.stroke}
            />
          )
        if (i.kind === 'ellipse')
          return (
            <ellipse
              key={k}
              cx={i.x}
              cy={i.y}
              rx={i.w}
              ry={i.h}
              fill={i.color}
            />
          )
        if (i.kind === 'rect')
          return (
            <rect
              key={k}
              x={i.x}
              y={i.y}
              width={i.w}
              height={i.h}
              fill={i.color}
            />
          )
        if (i.kind !== 'text') return null
        let x = i.x
        return (
          <text
            key={k}
            y={i.y}
            fontSize={i.size}
            fill={i.fill}
            xmlSpace="preserve"
          >
            {runs(i.value, i.face).map((r, n) => {
              const left = x
              x += runWidth(r.value, r.font, i.size)
              return (
                <tspan
                  key={n}
                  x={left}
                  fontFamily={r.font === 'emoji' ? 'emoji' : 'Keep' + r.font}
                >
                  {r.value}
                </tspan>
              )
            })}
          </text>
        )
      })}
    </svg>
  )
}
