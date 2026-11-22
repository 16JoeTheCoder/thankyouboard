import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  CSSProperties,
  FormEvent,
  MutableRefObject,
  ReactNode,
} from 'react'
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Dices,
  Eye,
  EyeOff,
  Flower2,
  Grid2X2,
  Leaf,
  List,
  LockKeyhole,
  LogOut,
  Mail,
  Maximize2,
  Minimize2,
  Palette,
  RotateCcw,
  Scan,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  clampView,
  fitView,
  maxZoom,
  revealRect,
  sameView,
  transformFor,
  zoomAbout,
  zoomStep,
} from './boardView'
import type { BoardView } from './boardView'
import { wallSlots } from './wallSlots'
import './wall.css'

const Export = lazy(() => import('./Export'))
/** Council members preview the wall from the admin area without the teacher passphrase. */
const council = /^\/admin\/wall(?:\/|$)/.test(location.pathname)
const sessionUrl = council ? '/api/admin/wall-session' : '/api/session'
const boardUrl = council ? '/api/admin/board' : '/api/board'
export type WallNote = {
  id: string
  teacher: string
  text: string
  slot: number
  revision?: number
}
type Session = {
  authenticated: boolean
  demo: boolean
  demoPassphrase?: string
  dedication: string
}
type Panel =
  | { type: 'teacher'; teacher: string }
  | { type: 'note'; id: string }
  | { type: 'all' }
const themes = ['Original', 'After Hours', 'Blue Hour', 'Garden'] as const
type Theme = (typeof themes)[number]
const fallbackDedication =
  'Thank you for the time you make for us, the questions you welcome, and the care you bring to our school. These notes are a little of that care coming back to you.'
const readPref = (key: string) => {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
const writePref = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value)
  } catch {
    /* blocked storage */
  }
}
const noteCount = (n: number) => n + ' ' + (n === 1 ? 'note' : 'notes')
async function apiError(response: Response) {
  try {
    return (
      (await response.json()).error || 'Something went wrong. Please try again.'
    )
  } catch {
    return 'Something went wrong. Please try again.'
  }
}
function Brand() {
  return (
    <div className="wall-brand">
      <span className="brand-mark" aria-hidden="true">
        <Mail size={25} strokeWidth={1.5} />
      </span>
      <span>
        STJBS <span className="brand-divider">/</span> <b>Student Council</b>
      </span>
    </div>
  )
}
function ThemePicker({
  theme,
  setTheme,
}: {
  theme: Theme
  setTheme: (t: Theme) => void
}) {
  const [open, toggle] = useState(false),
    host = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!host.current?.contains(e.target as Node)) toggle(false)
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        toggle(false)
        host.current?.querySelector('button')?.focus()
      }
    }
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', escape)
    }
  }, [open])
  return (
    <div className="theme-picker" ref={host}>
      <button
        className="wall-ghost"
        aria-label={'Theme, ' + theme}
        aria-expanded={open}
        onClick={() => toggle(!open)}
      >
        <Palette size={16} />
        <span>Theme</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="wall-menu theme-options" aria-label="Board theme">
          {themes.map((t) => (
            <button
              key={t}
              onClick={() => {
                setTheme(t)
                toggle(false)
                host.current?.querySelector('button')?.focus()
              }}
              aria-pressed={theme === t}
            >
              <i data-swatch={t} />
              {t}
              {theme === t && <Check size={14} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
function Gate({
  session,
  onUnlock,
}: {
  session: Session
  onUnlock: () => Promise<void>
}) {
  const [password, setPassword] = useState(''),
    [visible, setVisible] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError('')
    setBusy(true)
    try {
      const r = await fetch('/api/unlock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase: password }),
      })
      if (!r.ok) throw new Error(await apiError(r))
      await onUnlock()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not connect. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="wall-gate">
      <div className="gate-copy">
        <h1>
          Teacher
          <br />
          <em>Appreciation</em>
          <br />
          Wall<span>.</span>
        </h1>
        <p>
          A collection of thank-you notes from STJBS students to the teachers
          who made a difference.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="wall-pass">Staff passphrase</label>
          <div className="pass-field">
            <LockKeyhole size={17} />
            <input
              id="wall-pass"
              aria-label="Passphrase"
              autoComplete="current-password"
              placeholder="Enter your passphrase"
              type={visible ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              aria-label={visible ? 'Hide passphrase' : 'Show passphrase'}
              onClick={() => setVisible(!visible)}
            >
              {visible ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
          {error && (
            <p className="wall-error" role="alert">
              {error}
            </p>
          )}
          <button className="wall-primary gate-cta" disabled={busy}>
            {busy ? 'Unlocking…' : 'Unlock the wall'}
            <ArrowRight size={18} />
          </button>
        </form>
        {session.demo && (
          <small className="demo-hint">
            Local demo
            {session.demoPassphrase && (
              <>
                {' '}
                · Passphrase <code>{session.demoPassphrase}</code>
              </>
            )}
          </small>
        )}
      </div>
      <figure className="gate-photo">
        <img
          src="/art/council-stationery.webp"
          alt="A handwritten thank-you card in a green envelope with pressed daisies."
        />
        <figcaption>
          <Flower2 size={16} /> With gratitude, STJBS Student Council
        </figcaption>
      </figure>
    </main>
  )
}
function Dialog({
  children,
  onClose,
  title,
  kind = '',
}: {
  children: ReactNode
  onClose: () => void
  title: string
  kind?: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!,
      before = document.activeElement as HTMLElement
    dialog.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = overflow
      if (before.isConnected) before.focus({ preventScroll: true })
    }
  }, [])
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={'wall-dialog ' + kind}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose()
      }}
    >
      <div className="dialog-sheet">{children}</div>
    </dialog>
  )
}
function Dedication({ copy, close }: { copy: string; close: () => void }) {
  return (
    <main className="dedication">
      <div className="dedication-paper">
        <div className="letter-rule">
          <Mail size={24} />
          <span>STJBS Student Council</span>
        </div>
        <h1>
          To our <em>teachers,</em>
        </h1>
        <p>{copy || fallbackDedication}</p>
        <div className="letter-sign">
          With gratitude,
          <br />
          <i>Student Council</i>
        </div>
        <button className="wall-primary" onClick={close}>
          Open the wall <ArrowRight size={17} />
        </button>
      </div>
    </main>
  )
}
// Rasterize the paper print once per size/theme/data revision, and again
// whenever the zoom or pan changes: the canvas always draws exactly what is
// visible at the true resolution, so notes stay crisp instead of being a
// stretched bitmap. Native buttons retain every slot's geometry and semantics
// without 500 rotated paint layers.
const PrintedWall = memo(function PrintedWall({
  notes,
  theme,
  view,
  drawer,
}: {
  notes: WallNote[]
  theme: Theme
  view: MutableRefObject<BoardView>
  drawer: MutableRefObject<(() => void) | null>
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const surface = canvas.current!
    const brush = surface.getContext('2d')
    if (!brush) return
    let mounted = true
    let palettes: string[][] | null = null
    // Wrapped text per note. Measuring is the slow part, so it is done once per
    // board width instead of on every pan or zoom frame.
    let wrapped: { size: number; lines: [string, number][] }[] = []
    let wrappedFor = 0
    function wrap(width: number, height: number) {
      wrappedFor = width
      wrapped = notes.map((note) => {
        const slot = wallSlots[note.slot]
        if (!slot || !slot.excerpt) return { size: 0, lines: [] }
        const w = Math.max(1, (width * slot.width) / 100 - 0.6),
          h = Math.max(1, (height * slot.height) / 100 - 0.6)
        // Small notes get proportionally smaller type so every note carries text.
        const size = Math.max(
          2.4,
          Math.min(8, Math.max(3, width * 0.006), w * 0.2),
        )
        brush!.font = 'italic ' + size + 'px "Instrument Serif", Georgia, serif'
        const lines: [string, number][] = []
        let line = '',
          y = h * 0.15
        for (const word of note.text.slice(0, 56).split(/\s+/)) {
          const joined = line ? line + ' ' + word : word
          if (line && brush!.measureText(joined).width > w * 0.76) {
            lines.push([line, y])
            y += size
            line = word
            if (y >= h * 0.8) break
          } else line = joined
        }
        if (y < h * 0.8) lines.push([line, y])
        return { size, lines }
      })
    }
    function draw() {
      if (!mounted || !brush) return
      const width = surface.clientWidth,
        height = surface.clientHeight
      if (!width || !height) return
      const ratio = Math.min(devicePixelRatio, 2)
      const pixelsWide = Math.round(width * ratio),
        pixelsHigh = Math.round(height * ratio)
      if (surface.width !== pixelsWide || surface.height !== pixelsHigh) {
        surface.width = pixelsWide
        surface.height = pixelsHigh
      }
      const { s, fx, fy } = view.current
      brush.setTransform(1, 0, 0, 1, 0, 0)
      brush.clearRect(0, 0, pixelsWide, pixelsHigh)
      brush.setTransform(
        ratio * s,
        0,
        0,
        ratio * s,
        ratio * fx * width,
        ratio * fy * height,
      )
      if (!palettes) {
        const style = getComputedStyle(surface)
        palettes = Array.from({ length: 8 }, (_, i) => {
          const tone = style.getPropertyValue('--p' + i).trim()
          return [0, 0.13, 0.3, 0.46].map((mix) => {
            const base = [1, 3, 5].map((at) =>
              parseInt(tone.slice(at, at + 2), 16),
            )
            return (
              'rgb(' +
              base
                .map((v, k) => Math.round(v + ([255, 245, 215][k] - v) * mix))
                .join(',') +
              ')'
            )
          })
        })
      }
      if (wrappedFor !== width) wrap(width, height)
      // The part of the board on screen, in board pixels. Zoomed in, most notes are off screen.
      const seen =
        s > 1
          ? {
              left: (-fx * width) / s,
              right: ((1 - fx) * width) / s,
              top: (-fy * height) / s,
              bottom: ((1 - fy) * height) / s,
            }
          : null
      notes.forEach((note, index) => {
        const slot = wallSlots[note.slot]
        if (!slot) return
        const w = Math.max(1, (width * slot.width) / 100 - 0.6),
          h = Math.max(1, (height * slot.height) / 100 - 0.6)
        const x = (width * slot.left) / 100,
          y = (height * slot.top) / 100
        if (seen) {
          const pad = 4 + Math.max(w, h) * 0.3
          if (
            x + w + pad < seen.left ||
            x - pad > seen.right ||
            y + h + pad < seen.top ||
            y - pad > seen.bottom
          )
            return
        }
        brush.save()
        brush.translate(x + w / 2, y + h / 2)
        brush.rotate((slot.tilt * Math.PI) / 180)
        brush.translate(-w / 2, -h / 2)
        brush.fillStyle = '#69574640'
        brush.fillRect(0.8, 1.4, w, h)
        brush.fillStyle = palettes![slot.letter][slot.variant]
        brush.fillRect(0, 0, w, h)
        brush.strokeStyle = '#68564b2b'
        brush.lineWidth = 0.6
        brush.strokeRect(0.3, 0.3, w - 0.6, h - 0.6)
        if (slot.large) {
          brush.fillStyle = '#64534d2b'
          brush.fillRect(w * 0.13, h * 0.89, w * 0.34, 0.55)
          brush.fillStyle = '#fff7dc66'
          brush.beginPath()
          brush.moveTo(w, h)
          brush.lineTo(w * 0.83, h)
          brush.lineTo(w, h - w * 0.17)
          brush.fill()
        }
        const text = wrapped[index]
        if (slot.excerpt && text) {
          brush.beginPath()
          brush.rect(w * 0.12, h * 0.1, w * 0.77, h * 0.72)
          brush.clip()
          brush.font =
            'italic ' + text.size + 'px "Instrument Serif", Georgia, serif'
          brush.fillStyle = '#382d29'
          brush.textBaseline = 'top'
          for (const [line, at] of text.lines) brush.fillText(line, w * 0.12, at)
        }
        brush.restore()
      })
    }
    drawer.current = draw
    const observer = new ResizeObserver(draw)
    observer.observe(surface)
    void document.fonts.ready.then(() => {
      wrappedFor = 0
      draw()
    })
    return () => {
      mounted = false
      if (drawer.current === draw) drawer.current = null
      observer.disconnect()
    }
  }, [notes, theme, view, drawer])
  return <canvas className="printed-wall" ref={canvas} aria-hidden="true" />
})
const Cards = memo(function Cards({
  notes,
  spot,
}: {
  notes: WallNote[]
  spot: string | null
}) {
  let lifts = 0
  return (
    <>
      {notes.map((n, i) => {
        const s = wallSlots[n.slot]
        if (!s) return null
        const match = spot === n.teacher
        const style = {
          left: s.left + '%',
          top: s.top + '%',
          width: s.width + '%',
          height: s.height + '%',
          '--tilt': s.tilt + 'deg',
          '--sw': s.width,
        } as CSSProperties
        return (
          <button
            key={n.id}
            className={
              'paper-tile ink-' +
              s.letter +
              ' tint-' +
              s.variant +
              (s.large ? ' paper-large' : '') +
              (match ? ' matched' : '') +
              (match && lifts++ < 4 ? ' spot-lift' : '')
            }
            style={style}
            data-slot={n.slot}
            data-id={n.id}
            tabIndex={i === 0 ? 0 : -1}
            aria-label={'Read note for ' + n.teacher}
          >
            {match && (
              <span className="paper-face">
                <span>{s.excerpt && n.text.slice(0, 56)}</span>
              </span>
            )}
          </button>
        )
      })}
    </>
  )
})
// A coarse spatial index keeps desktop hit testing independent of the number
// of paper buttons. Touch and keyboard access still use the native controls.
const hitColumns = 48,
  hitRows = 24
const hitCells: number[][] = Array.from(
  { length: hitColumns * hitRows },
  () => [],
)
wallSlots.forEach((slot, index) => {
  const lastCol = Math.min(
    hitColumns - 1,
    Math.floor(((slot.left + slot.width) * hitColumns) / 100),
  )
  const lastRow = Math.min(
    hitRows - 1,
    Math.floor(((slot.top + slot.height) * hitRows) / 100),
  )
  for (
    let row = Math.floor((slot.top * hitRows) / 100);
    row <= lastRow;
    row++
  ) {
    for (
      let col = Math.floor((slot.left * hitColumns) / 100);
      col <= lastCol;
      col++
    )
      hitCells[row * hitColumns + col].push(index)
  }
})
function BoardArt({
  notes,
  theme,
  spot,
  onNote,
}: {
  notes: WallNote[]
  spot: string | null
  theme: Theme
  onNote: (id: string) => void
}) {
  const byId = useMemo(() => new Map(notes.map((n) => [n.id, n])), [notes])
  const board = useRef<HTMLDivElement>(null)
  const hitPlane = useRef<HTMLDivElement>(null)
  const visibleBySlot = useMemo(
    () => new Map(notes.map((note) => [note.slot, note])),
    [notes],
  )
  const lifted = useRef<HTMLDivElement>(null)
  const preview = useRef<HTMLDivElement>(null)
  const pan = useRef<HTMLDivElement>(null)
  const view = useRef<BoardView>(fitView)
  const drawBoard = useRef<(() => void) | null>(null)
  const [percent, setPercent] = useState(100)
  const size = useRef({ width: 0, height: 0 })
  const current = useRef<WallNote | undefined>(undefined)
  const reveal = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clear = useCallback(() => {
    if (reveal.current !== null) clearTimeout(reveal.current)
    reveal.current = null
    current.current = undefined
    if (preview.current && !preview.current.hidden) {
      preview.current.hidden = true
      if (lifted.current) lifted.current.hidden = true
    }
  }, [])
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      size.current = entry.contentRect
      clear()
    })
    if (board.current) observer.observe(board.current)
    return () => {
      observer.disconnect()
      clear()
    }
  }, [clear])
  useEffect(() => {
    clear()
  }, [notes, spot, clear])
  useEffect(() => {
    const m = matchMedia('(prefers-reduced-motion: reduce)')
    m.addEventListener('change', clear)
    document.addEventListener('visibilitychange', clear)
    window.addEventListener('blur', clear)
    return () => {
      m.removeEventListener('change', clear)
      document.removeEventListener('visibilitychange', clear)
      window.removeEventListener('blur', clear)
    }
  }, [clear])
  // --- Zoom and pan ---------------------------------------------------------
  // The view lives in a ref and is painted once per animation frame: the pan
  // layer is moved with a CSS transform and the canvas is redrawn to match, so
  // gestures never wait on a React render.
  const frameId = useRef(0)
  const tween = useRef(0)
  // Where a running glide is heading, so quick repeated steps build on it.
  const heading = useRef<BoardView | null>(null)
  const flush = useCallback(() => {
    cancelAnimationFrame(frameId.current)
    frameId.current = 0
    const frame = board.current,
      layer = pan.current
    if (!frame || !layer) return
    const v = view.current
    layer.style.transform = transformFor(v)
    layer.style.setProperty('--inv', String(1 / v.s))
    frame.toggleAttribute('data-zoomed', v.s > 1)
    drawBoard.current?.()
    setPercent(Math.round(v.s * 100))
  }, [])
  const setView = useCallback(
    (next: BoardView) => {
      const v = clampView(next)
      if (sameView(v, view.current)) return
      view.current = v
      clear()
      if (!frameId.current) frameId.current = requestAnimationFrame(flush)
    },
    [clear, flush],
  )
  const stopTween = useCallback(() => {
    cancelAnimationFrame(tween.current)
    tween.current = 0
    heading.current = null
  }, [])
  /** Eases to a new view (instant for people who prefer reduced motion). */
  const glide = useCallback(
    (target: BoardView) => {
      stopTween()
      const goal = clampView(target)
      const from = view.current
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
        setView(goal)
        return
      }
      heading.current = goal
      const began = performance.now()
      const tick = (now: number) => {
        const t = Math.min(1, (now - began) / 180)
        const e = 1 - Math.pow(1 - t, 3)
        setView({
          s: from.s + (goal.s - from.s) * e,
          fx: from.fx + (goal.fx - from.fx) * e,
          fy: from.fy + (goal.fy - from.fy) * e,
        })
        flush()
        if (t < 1) tween.current = requestAnimationFrame(tick)
        else {
          tween.current = 0
          heading.current = null
        }
      }
      tween.current = requestAnimationFrame(tick)
    },
    [setView, stopTween, flush],
  )
  const zoomBy = useCallback(
    (factor: number) => {
      const v = heading.current ?? view.current
      glide(zoomAbout(v, v.s * factor, 0.5, 0.5))
    },
    [glide],
  )
  const resetView = useCallback(() => glide(fitView), [glide])
  useEffect(
    () => () => {
      cancelAnimationFrame(frameId.current)
      cancelAnimationFrame(tween.current)
    },
    [],
  )
  /** Pointer position on the board in board pixels, correct at any zoom. */
  const local = useCallback((event: MouseEvent): [number, number] => {
    const plane = hitPlane.current!
    if (!board.current?.hasAttribute('data-zoomed'))
      return [event.offsetX, event.offsetY]
    const box = plane.getBoundingClientRect()
    const k = box.width / (size.current.width || 1)
    return [(event.clientX - box.left) / k, (event.clientY - box.top) / k]
  }, [])
  useEffect(() => {
    const frame = board.current!
    const touches = new Map<number, { x: number; y: number }>()
    let drag: { id: number; x: number; y: number; moving: boolean } | null =
      null
    let pinch: { span: number; cx: number; cy: number; view: BoardView } | null =
      null
    let swallow = false
    const middle = () => {
      const [a, b] = Array.from(touches.values())
      const box = frame.getBoundingClientRect()
      return {
        span: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        cx: ((a.x + b.x) / 2 - box.left) / box.width,
        cy: ((a.y + b.y) / 2 - box.top) / box.height,
      }
    }
    const grab = (id: number) => {
      try {
        frame.setPointerCapture(id)
      } catch {
        /* the pointer is already gone */
      }
    }
    const down = (e: PointerEvent) => {
      swallow = false
      if (e.pointerType === 'mouse' && e.button !== 0) return
      if (touches.size >= 2) return
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (touches.size === 2) {
        stopTween()
        pinch = { ...middle(), view: view.current }
        drag = null
        swallow = true
        clear()
        for (const id of touches.keys()) grab(id)
      } else
        drag = { id: e.pointerId, x: e.clientX, y: e.clientY, moving: false }
    }
    const move = (e: PointerEvent) => {
      const point = touches.get(e.pointerId)
      if (!point) return
      point.x = e.clientX
      point.y = e.clientY
      if (pinch && touches.size === 2) {
        const now = middle()
        const scale = Math.min(
          maxZoom,
          Math.max(1, (pinch.view.s * now.span) / pinch.span),
        )
        // The board point that started under the fingers stays under them.
        const bx = (pinch.cx - pinch.view.fx) / pinch.view.s,
          by = (pinch.cy - pinch.view.fy) / pinch.view.s
        setView({ s: scale, fx: now.cx - bx * scale, fy: now.cy - by * scale })
        return
      }
      if (!drag || drag.id !== e.pointerId || view.current.s <= 1) return
      const dx = e.clientX - drag.x,
        dy = e.clientY - drag.y
      if (!drag.moving) {
        // A small wobble while tapping a note must not turn into a drag.
        if (Math.hypot(dx, dy) < (e.pointerType === 'mouse' ? 4 : 9)) return
        drag.moving = true
        swallow = true
        stopTween()
        grab(e.pointerId)
        frame.toggleAttribute('data-panning', true)
      }
      const box = frame.getBoundingClientRect(),
        v = view.current
      setView({ s: v.s, fx: v.fx + dx / box.width, fy: v.fy + dy / box.height })
      drag.x = e.clientX
      drag.y = e.clientY
    }
    const up = (e: PointerEvent) => {
      if (!touches.delete(e.pointerId)) return
      if (pinch && touches.size < 2) {
        pinch = null
        const rest = Array.from(touches.entries())[0]
        // The finger left behind carries on panning without a jump.
        drag = rest
          ? { id: rest[0], x: rest[1].x, y: rest[1].y, moving: true }
          : null
      } else if (drag?.id === e.pointerId) drag = null
      if (!touches.size) frame.toggleAttribute('data-panning', false)
      try {
        frame.releasePointerCapture(e.pointerId)
      } catch {
        /* not captured */
      }
    }
    // A drag that ends on a note must not also open it.
    const click = (e: MouseEvent) => {
      if (!swallow) return
      swallow = false
      e.stopPropagation()
      e.preventDefault()
    }
    const wheel = (e: WheelEvent) => {
      // Pinch on a trackpad arrives as ctrl + wheel. In full screen there is no
      // page to scroll, so a plain wheel zooms too.
      if (!(e.ctrlKey || e.metaKey || document.fullscreenElement)) return
      if (!e.deltaY) return
      e.preventDefault()
      stopTween()
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 120 : 1
      const delta = Math.max(-30, Math.min(30, e.deltaY * unit))
      const box = frame.getBoundingClientRect()
      const v = view.current
      setView(
        zoomAbout(
          v,
          v.s * Math.exp(-delta * 0.01),
          (e.clientX - box.left) / box.width,
          (e.clientY - box.top) / box.height,
        ),
      )
    }
    frame.addEventListener('pointerdown', down)
    // Captured so a drag is seen even while the hover layer is under the pointer.
    frame.addEventListener('pointermove', move, true)
    frame.addEventListener('pointerup', up)
    frame.addEventListener('pointercancel', up)
    frame.addEventListener('click', click, true)
    frame.addEventListener('wheel', wheel, { passive: false })
    return () => {
      frame.removeEventListener('pointerdown', down)
      frame.removeEventListener('pointermove', move, true)
      frame.removeEventListener('pointerup', up)
      frame.removeEventListener('pointercancel', up)
      frame.removeEventListener('click', click, true)
      frame.removeEventListener('wheel', wheel)
    }
  }, [clear, setView, stopTween])
  const activate = useCallback(
    (note: WallNote | undefined, immediate = false) => {
      if (note === current.current && (!immediate || !preview.current?.hidden))
        return
      clear()
      const slot = note && wallSlots[note.slot]
      if (!note || !slot) return
      current.current = note
      const { width, height } = size.current
      const x = (width * slot.left) / 100,
        y = (height * slot.top) / 100
      const w = (width * slot.width) / 100,
        h = (height * slot.height) / 100
      function printPreview() {
        const previewEl = preview.current
        if (current.current !== note || !previewEl || !note) return
        const card = lifted.current
        if (card && slot) {
          card.className =
            'lifted-paper ink-' + slot.letter + ' tint-' + slot.variant
          card.style.left = x + 'px'
          card.style.top = y + 'px'
          card.style.width = w + 'px'
          card.style.height = h + 'px'
          card.style.setProperty('--sw', String(slot.width))
          card.firstElementChild!.firstElementChild!.textContent = slot.excerpt
            ? note.text.slice(0, 56)
            : ''
          card.hidden = false
        }
        previewEl.firstElementChild!.textContent = note.teacher
        previewEl.lastElementChild!.textContent = note.text.slice(0, 200)
        // Zoomed in, keep the preview inside the part of the wall on screen.
        const { s, fx, fy } = view.current
        const half = 85 / s
        const seenLeft = (-fx * width) / s,
          seenRight = ((1 - fx) * width) / s
        const seenTop = (-fy * height) / s
        const below = s > 1 ? (y - seenTop) * s < 86 : slot!.top < 22
        previewEl.style.left =
          (s > 1
            ? Math.max(
                seenLeft + half,
                Math.min(seenRight - half, x + w / 2),
              )
            : Math.max(85, Math.min(width - 85, x + w / 2))) + 'px'
        previewEl.style.top = (below ? y + h + 4 / s : y - 4 / s) + 'px'
        previewEl.classList.toggle('peek-below', below)
        previewEl.hidden = false
        reveal.current = null
      }
      // Keep the excerpt steady while crossing tiles en route to another note.
      if (immediate) printPreview()
      else reveal.current = setTimeout(printPreview, 95)
    },
    [clear],
  )
  const hit = useCallback(
    (x: number, y: number) => {
      const { width, height } = size.current
      if (!width || !height) return
      const u = (x * 100) / width,
        v = (y * 100) / height
      const cell =
        hitCells[
          Math.floor((v * hitRows) / 100) * hitColumns +
            Math.floor((u * hitColumns) / 100)
        ]
      const index = cell?.find((i) => {
        const s = wallSlots[i]
        return (
          u >= s.left &&
          u < s.left + s.width &&
          v >= s.top &&
          v < s.top + s.height
        )
      })
      return index === undefined ? undefined : visibleBySlot.get(index)
    },
    [visibleBySlot],
  )
  useEffect(() => {
    const surface = hitPlane.current!
    const move = (event: PointerEvent) => {
      event.stopPropagation()
      if (event.pointerType === 'touch') return
      const note = hit(...local(event))
      if (note === current.current) return
      if (note) {
        surface.dataset.slot = String(note.slot)
        surface.dataset.id = note.id
      } else {
        delete surface.dataset.slot
        delete surface.dataset.id
      }
      activate(note)
    }
    const leave = () => {
      delete surface.dataset.slot
      delete surface.dataset.id
      clear()
    }
    const stop = (event: Event) => event.stopPropagation()
    surface.addEventListener('pointermove', move, { passive: true })
    surface.addEventListener('mousemove', stop, { passive: true })
    surface.addEventListener('pointerleave', leave)
    return () => {
      surface.removeEventListener('pointermove', move)
      surface.removeEventListener('mousemove', stop)
      surface.removeEventListener('pointerleave', leave)
      leave()
    }
  }, [activate, clear, hit, local])
  return (
    <div className="mat-board">
      <div
        ref={board}
        className={'paper-board' + (spot ? ' spotlight' : '')}
        aria-label="Thank you wall of student notes"
        onFocus={(e) => {
          const note = byId.get((e.target as HTMLElement).dataset.id || '')
          // Keyboard users moving between notes must never lose the focused one off screen.
          const slot = note && wallSlots[note.slot]
          if (slot && (e.target as HTMLElement).matches(':focus-visible'))
            setView(revealRect(view.current, slot))
          activate(note, true)
        }}
        onBlur={clear}
        onClick={(e) => {
          const id =
            e.target === hitPlane.current
              ? hit(...local(e.nativeEvent))?.id
              : (e.target as Element).closest<HTMLElement>('button[data-id]')
                  ?.dataset.id
          if (id) {
            clear()
            onNote(id)
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            clear()
            return
          }
          if (!e.ctrlKey && !e.metaKey && !e.altKey) {
            const zoom =
              e.key === '+' || e.key === '='
                ? zoomStep
                : e.key === '-' || e.key === '_'
                  ? 1 / zoomStep
                  : e.key === '0'
                    ? 0
                    : null
            if (zoom !== null) {
              e.preventDefault()
              if (zoom) zoomBy(zoom)
              else resetView()
              return
            }
          }
          if (
            ![
              'ArrowRight',
              'ArrowLeft',
              'ArrowDown',
              'ArrowUp',
              'Home',
              'End',
            ].includes(e.key)
          )
            return
          const tiles = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>(
              'button[data-id]',
            ),
          )
          const idx = tiles.indexOf(e.target as HTMLButtonElement)
          if (idx < 0 || !tiles.length) return
          e.preventDefault()
          const step =
            e.key === 'ArrowDown'
              ? 8
              : e.key === 'ArrowUp'
                ? -8
                : e.key === 'ArrowLeft'
                  ? -1
                  : 1
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? tiles.length - 1
                : (idx + step + tiles.length) % tiles.length
          tiles[idx].tabIndex = -1
          tiles[next].tabIndex = 0
          tiles[next].focus({ preventScroll: true })
        }}
      >
        <PrintedWall
          notes={notes}
          theme={theme}
          view={view}
          drawer={drawBoard}
        />
        <div ref={pan} className="board-pan">
          <div className="paper-base">
            <Cards notes={notes} spot={spot} />
          </div>
          <span aria-hidden="true" className="board-postmark">
            <Mail />
            <i />
          </span>
          <span className="board-sign" aria-hidden="true">
            With gratitude,
            <br /> <em>STJBS students</em>
          </span>
          <div ref={hitPlane} className="paper-hit-plane" aria-hidden="true" />
          <div className="paper-hover-plane" aria-hidden="true">
            <div ref={lifted} hidden>
              <span className="paper-face">
                <span />
              </span>
            </div>
            <div className="paper-peek" ref={preview} hidden>
              <strong />
              <span />
            </div>
          </div>
        </div>
      </div>
      <div
        className="board-zoom"
        role="group"
        aria-label="Zoom the wall"
        data-fit={percent <= 100 ? '' : undefined}
      >
        {/* Zoom in stays rightmost: the group grows leftward, so a second quick tap never lands on another control. */}
        <button
          type="button"
          aria-label="Fit the whole wall"
          title="Fit the whole wall (0)"
          aria-disabled={percent <= 100}
          onClick={resetView}
        >
          <Scan size={18} />
        </button>
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out (−)"
          aria-disabled={percent <= 100}
          onClick={() => zoomBy(1 / zoomStep)}
        >
          <ZoomOut size={18} />
        </button>
        <output aria-live="polite" aria-label="Zoom level">
          {percent}%
        </output>
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in (+)"
          aria-disabled={percent >= maxZoom * 100}
          onClick={() => zoomBy(zoomStep)}
        >
          <ZoomIn size={18} />
        </button>
      </div>
    </div>
  )
}
function SearchTeacher({
  teachers,
  onPick,
}: {
  teachers: { name: string; count: number }[]
  onPick: (t: string) => void
}) {
  const [query, setQuery] = useState(''),
    [open, toggle] = useState(false),
    [idx, setIdx] = useState(-1),
    root = useRef<HTMLDivElement>(null)
  const filtered = teachers.filter((p) =>
    p.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  )
  function pick(name: string) {
    setQuery('')
    toggle(false)
    setIdx(-1)
    onPick(name)
  }
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) toggle(false)
    }
    window.addEventListener('pointerdown', outside)
    return () => window.removeEventListener('pointerdown', outside)
  }, [open])
  useEffect(() => {
    if (idx >= 0)
      root.current
        ?.querySelector('#wall-profile-' + idx)
        ?.scrollIntoView({ block: 'nearest' })
  }, [idx])
  return (
    <div
      className="teacher-search"
      ref={root}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) toggle(false)
      }}
    >
      <Search size={17} />
      <input
        type="search"
        role="combobox"
        aria-label="Find my notes"
        aria-controls="wall-profiles"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-activedescendant={
          open && idx >= 0 ? 'wall-profile-' + idx : undefined
        }
        placeholder="Find my notes"
        value={query}
        onFocus={() => toggle(true)}
        onClick={() => toggle(true)}
        onChange={(e) => {
          setQuery(e.target.value)
          toggle(true)
          setIdx(-1)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            toggle(false)
            setIdx(-1)
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            toggle(true)
            setIdx((i) =>
              Math.min(
                filtered.length - 1,
                Math.max(0, i + (e.key === 'ArrowDown' ? 1 : -1)),
              ),
            )
          }
          if (e.key === 'Enter' && open && filtered[Math.max(idx, 0)]) {
            e.preventDefault()
            pick(filtered[Math.max(idx, 0)].name)
          }
        }}
      />
      {open && (
        <div
          className="wall-menu profiles"
          id="wall-profiles"
          role="listbox"
          aria-label="Matching teachers"
        >
          {filtered.length ? (
            filtered.map((p, i) => (
              <button
                key={p.name}
                type="button"
                role="option"
                aria-selected={i === idx}
                id={'wall-profile-' + i}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(p.name)}
              >
                <span>{p.name}</span>
                <small>{noteCount(p.count)}</small>
              </button>
            ))
          ) : (
            <p>No matching teachers.</p>
          )}
        </div>
      )}
    </div>
  )
}
function Reader({
  panel,
  notes,
  close,
  change,
  save,
}: {
  panel: Panel
  notes: WallNote[]
  close: () => void
  change: (p: Panel) => void
  save: (t: string, id?: string) => void
}) {
  const [page, setPage] = useState(0),
    [filter, setFilter] = useState('')
  useEffect(() => {
    setPage(0)
    setFilter('')
  }, [panel])
  const note =
    panel.type === 'note' ? notes.find((n) => n.id === panel.id) : undefined
  const title =
    panel.type === 'all'
      ? 'All notes'
      : panel.type === 'teacher'
        ? panel.teacher
        : note?.teacher || 'Note unavailable'
  const list =
    panel.type === 'teacher'
      ? notes.filter((n) => n.teacher === panel.teacher)
      : panel.type === 'all' && filter
        ? notes.filter((n) =>
            (n.teacher + ' ' + n.text)
              .toLowerCase()
              .includes(filter.toLowerCase()),
          )
        : notes
  const pages = Math.max(1, Math.ceil(list.length / 18)),
    current = Math.min(page, pages - 1)
  return (
    <Dialog title={title} onClose={close}>
      <div className="reader-top">
        <span>
          <BookOpen size={17} /> Note collection
        </span>
        <button className="wall-icon" onClick={close} aria-label="Close reader">
          <X />
        </button>
      </div>
      <header className="reader-heading">
        <h2>{title}</h2>
        {panel.type !== 'note' && <p>{noteCount(list.length)}</p>}
      </header>
      {panel.type === 'all' && (
        <label className="reader-filter">
          <Search size={16} />
          <input
            aria-label="Search all notes"
            placeholder="Search teachers or notes"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setPage(0)
            }}
          />
        </label>
      )}
      {panel.type === 'note' && note ? (
        <article className="reader-letter">
          <span className="letter-to">Dear {note.teacher},</span>
          <p>{note.text}</p>
          <Flower2 size={23} />
        </article>
      ) : (
        <div className="reader-list">
          {list.slice(current * 18, (current + 1) * 18).map((n) => (
            <article key={n.id}>
              {panel.type === 'all' && <h3>{n.teacher}</h3>}
              <p>{n.text}</p>
              <button
                className="wall-link"
                onClick={() => change({ type: 'note', id: n.id })}
              >
                Open note <ArrowRight size={14} />
              </button>
            </article>
          ))}
          {!list.length && <p>No notes to show.</p>}
        </div>
      )}
      {panel.type !== 'note' && pages > 1 && (
        <div className="reader-pages">
          <button
            aria-label="Previous page"
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          Page {current + 1} of {pages}
          <button
            aria-label="Next page"
            disabled={current === pages - 1}
            onClick={() => setPage(current + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      )}
      <footer className="reader-actions">
        {panel.type === 'teacher' && (
          <button
            className="wall-primary"
            disabled={!list.length}
            onClick={() => save(panel.teacher)}
          >
            <ArrowDownToLine size={16} />
            Save my notes
          </button>
        )}
        {note && (
          <>
            <button
              className="wall-primary"
              onClick={() => save(note.teacher, note.id)}
            >
              <ArrowDownToLine size={16} />
              Save this note
            </button>
            <button
              className="wall-ghost"
              onClick={() => change({ type: 'teacher', teacher: note.teacher })}
            >
              More for {note.teacher}
            </button>
          </>
        )}
        <button className="wall-link" onClick={close}>
          <ArrowLeft size={14} />
          {panel.type === 'all' ? 'Back to wall' : 'All notes'}
        </button>
      </footer>
    </Dialog>
  )
}
export default function Wall() {
  const [session, setSession] = useState<Session | null>(null),
    [failure, setFailure] = useState(''),
    [error, setError] = useState('')
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = readPref('stjbs-theme')
    return themes.find((t) => t === saved) || 'Original'
  })
  const [dedication, setDedication] = useState(false),
    [notes, setNotes] = useState<WallNote[]>([]),
    [loaded, setLoaded] = useState(false)
  const [panel, setPanel] = useState<Panel | null>(null),
    [spot, setSpot] = useState<string | null>(null),
    [exporting, setExport] = useState<{ teacher: string; id?: string } | null>(
      null,
    )
  const cache = useRef<{ etag: string | null; notes: WallNote[] }>({
      etag: null,
      notes: [],
    }),
    flight = useRef<Promise<WallNote[]> | null>(null),
    epoch = useRef(0),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    searchBox = useRef<HTMLDivElement>(null),
    collection = useRef<HTMLElement>(null),
    viewButton = useRef<HTMLButtonElement>(null)
  const [full, setFull] = useState(false)
  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    setSpot(null)
  }, [])
  const close = useCallback(() => {
    cancel()
    setPanel(null)
  }, [cancel])
  const reset = useCallback(() => {
    epoch.current++
    flight.current = null
    cache.current = { etag: null, notes: [] }
    setNotes([])
    setLoaded(false)
    setDedication(false)
    setExport(null)
    close()
    setError('')
    setSession((s) => (s ? { ...s, authenticated: false } : null))
  }, [close])
  const loadSession = useCallback(async () => {
    setFailure('')
    try {
      const r = await fetch(sessionUrl, { cache: 'no-store' })
      if (!r.ok) throw new Error(await apiError(r))
      const s: Session = await r.json()
      setSession(s)
      if (s.authenticated && !readPref('stjbs-dedication')) setDedication(true)
    } catch (e) {
      setFailure(
        e instanceof Error ? e.message : 'Could not connect to the wall.',
      )
    }
  }, [])
  useEffect(() => {
    void loadSession()
  }, [loadSession])
  const refresh = useCallback((): Promise<WallNote[]> => {
    if (flight.current) return flight.current
    const version = epoch.current
    const request = (async () => {
      try {
        const r = await fetch(boardUrl, {
          cache: 'no-store',
          headers: cache.current.etag
            ? { 'If-None-Match': cache.current.etag }
            : {},
        })
        if (version !== epoch.current) throw new Error('Session changed.')
        if (r.status === 401 || r.status === 403) {
          reset()
          throw new Error('Please unlock the wall again.')
        }
        if (r.status === 304) {
          setError('')
          return cache.current.notes
        }
        if (!r.ok) throw new Error(await apiError(r))
        const data: { notes: WallNote[] } = await r.json()
        if (version !== epoch.current) throw new Error('Session changed.')
        const next = data.notes.slice().sort((a, b) => a.slot - b.slot)
        cache.current = { etag: r.headers.get('ETag'), notes: next }
        setNotes(next)
        setLoaded(true)
        setError('')
        setPanel((p) =>
          (p?.type === 'note' && !next.some((n) => n.id === p.id)) ||
          (p?.type === 'teacher' && !next.some((n) => n.teacher === p.teacher))
            ? null
            : p,
        )
        setExport((p) =>
          p && !next.some((n) => n.teacher === p.teacher) ? null : p,
        )
        return next
      } catch (e) {
        if (version === epoch.current)
          setError(
            e instanceof Error ? e.message : 'Could not refresh the wall.',
          )
        throw e
      } finally {
        if (version === epoch.current) flight.current = null
      }
    })()
    flight.current = request
    return request
  }, [reset])
  const boardReady = !!session?.authenticated && !dedication
  useEffect(() => {
    if (!boardReady) return
    const sync = () => {
      if (document.visibilityState === 'visible') void refresh().catch(() => {})
    }
    const visibility = () => {
      cancel()
      sync()
    }
    const reduce = matchMedia('(prefers-reduced-motion: reduce)')
    sync()
    const poll = setInterval(sync, 20_000)
    window.addEventListener('focus', sync)
    window.addEventListener('pagehide', cancel)
    window.addEventListener('popstate', cancel)
    document.addEventListener('visibilitychange', visibility)
    reduce.addEventListener('change', cancel)
    return () => {
      clearInterval(poll)
      window.removeEventListener('focus', sync)
      window.removeEventListener('pagehide', cancel)
      window.removeEventListener('popstate', cancel)
      document.removeEventListener('visibilitychange', visibility)
      reduce.removeEventListener('change', cancel)
      cancel()
    }
  }, [boardReady, refresh, cancel])
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', handle)
    return () => window.removeEventListener('keydown', handle)
  }, [cancel])
  const teachers = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of notes)
      counts.set(n.teacher, (counts.get(n.teacher) || 0) + 1)
    return Array.from(counts, ([name, count]) => ({ name, count })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )
  }, [notes])
  // Choosing a teacher dims the wall and lights her notes; she opens them when ready.
  function pick(t: string) {
    cancel()
    setPanel(null)
    setSpot(t)
  }
  const spotCount = spot ? notes.filter((n) => n.teacher === spot).length : 0
  const lit = spotCount > 0 ? spot : null
  useEffect(() => {
    if (lit) viewButton.current?.focus({ preventScroll: true })
  }, [lit])
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === collection.current)
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [])
  function toggleFull() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void collection.current?.requestFullscreen().catch(() => {})
  }
  const canFull = typeof document !== 'undefined' && !!document.fullscreenEnabled
  function openPanel(p: Panel) {
    cancel()
    setPanel(p)
  }
  async function logout() {
    try {
      const r = await fetch('/api/logout', { method: 'POST' })
      if (!r.ok) throw new Error(await apiError(r))
      reset()
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not sign out. Please retry.',
      )
    }
  }
  const leaveDedication = () => {
    writePref('stjbs-dedication', 'seen')
    setDedication(false)
  }
  return (
    <div className="wall-app" data-theme={theme}>
      <header className="wall-mast">
        <Brand />
        <div>
          <ThemePicker
            theme={theme}
            setTheme={(t) => {
              setTheme(t)
              writePref('stjbs-theme', t)
            }}
          />
          {session?.authenticated && (
            <button
              className="wall-ghost wall-signout"
              onClick={logout}
              aria-label="Sign out"
            >
              <LogOut size={16} />
              <span>Sign out</span>
            </button>
          )}
        </div>
      </header>
      {!session ? (
        <main className="wall-wait">
          {failure ? (
            <>
              <p role="alert">{failure}</p>
              <button
                className="wall-primary"
                onClick={() => void loadSession()}
              >
                Retry
              </button>
            </>
          ) : (
            <p>Opening the wall…</p>
          )}
        </main>
      ) : !session.authenticated ? (
        <Gate
          session={session}
          onUnlock={async () => {
            setSession({ ...session, authenticated: true })
            setDedication(!readPref('stjbs-dedication'))
          }}
        />
      ) : dedication ? (
        <Dedication copy={session.dedication} close={leaveDedication} />
      ) : (
        <main className="wall-main">
          <section className="wall-intro">
            <div>
              <h1>
                Teacher <em>Appreciation</em> Wall<span>.</span>
              </h1>
              <p>A thank-you from our students, one note at a time.</p>
            </div>
            <div className="wall-searches" ref={searchBox}>
              <SearchTeacher teachers={teachers} onPick={pick} />
              <button
                className="wall-outline surprise"
                disabled={!notes.length}
                onClick={() =>
                  openPanel({
                    type: 'note',
                    id: notes[Math.floor(Math.random() * notes.length)].id,
                  })
                }
              >
                <Dices size={17} />
                Surprise me
              </button>
            </div>
          </section>
          <section
            className="wall-collection"
            aria-label="Student appreciation collection"
            ref={collection}
          >
            <div className="board-bar">
              {lit ? (
                <div className="spot-bar">
                  <span className="spot-who" role="status">
                    <strong>{lit}</strong>
                    <small>{noteCount(spotCount)} lit up on the wall</small>
                  </span>
                  <button
                    ref={viewButton}
                    className="wall-primary"
                    onClick={() => openPanel({ type: 'teacher', teacher: lit })}
                  >
                    View my notes
                    <ArrowRight size={16} />
                  </button>
                  <button className="wall-ghost" onClick={cancel}>
                    All notes
                  </button>
                </div>
              ) : (
                <div>
                  <span className="board-tab">
                    <Grid2X2 size={15} />
                    The wall
                  </span>
                  <button
                    className="wall-ghost"
                    onClick={() => openPanel({ type: 'all' })}
                  >
                    <List size={16} />
                    Browse all notes
                  </button>
                </div>
              )}
              <div className="board-tools">
                {canFull && (
                  <button
                    className="wall-ghost"
                    onClick={toggleFull}
                    aria-pressed={full}
                    aria-label={full ? 'Exit full screen' : 'Full screen'}
                  >
                    {full ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    <span className="tool-label">
                      {full ? 'Exit full screen' : 'Full screen'}
                    </span>
                  </button>
                )}
                <span className="wall-count">
                  {loaded
                    ? noteCount(notes.length) +
                      ' · ' +
                      teachers.length +
                      ' teachers'
                    : 'Loading notes…'}
                </span>
              </div>
            </div>
            {error && (
              <div className="wall-error" role="alert">
                {error}{' '}
                <button
                  className="wall-link"
                  onClick={() => void refresh().catch(() => {})}
                >
                  Retry
                </button>
              </div>
            )}
            {loaded && notes.length === 0 ? (
              <p className="wall-empty">There are no visible notes yet.</p>
            ) : (
              <BoardArt
                theme={theme}
                notes={notes}
                spot={lit}
                onNote={(id) => openPanel({ type: 'note', id })}
              />
            )}
            <div className="board-caption">
              <span>
                <Mail size={15} /> Select a paper note to read it.
              </span>
              <button
                className="wall-link"
                onClick={() => {
                  close()
                  setDedication(true)
                }}
              >
                <RotateCcw size={14} /> Replay dedication
              </button>
            </div>
          </section>
        </main>
      )}
      <footer className="wall-colophon">
        <span>
          <Leaf size={14} /> A gift from the STJBS Student Council
        </span>
        <a href="/admin">
          Council access <ArrowRight size={13} />
        </a>
      </footer>
      {boardReady && panel && !exporting && (
        <Reader
          notes={notes}
          panel={panel}
          close={close}
          change={openPanel}
          save={(teacher, id) => {
            cancel()
            setExport({ teacher, id })
          }}
        />
      )}
      {boardReady && exporting && (
        <Suspense
          fallback={
            <Dialog title="Opening keepsake" onClose={() => setExport(null)}>
              <p className="wall-empty">Opening keepsake…</p>
            </Dialog>
          }
        >
          <Export
            teacher={exporting.teacher}
            notes={notes}
            initialNoteId={exporting.id}
            refresh={refresh}
            onClose={() => setExport(null)}
          />
        </Suspense>
      )}
    </div>
  )
}
