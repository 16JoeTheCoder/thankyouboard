import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal, flushSync } from 'react-dom'
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  FileText,
  Printer,
} from 'lucide-react'
import {
  compose,
  layouts,
  loadFonts,
  sizes,
  type Layout,
  type Size,
  type Note,
  type Sheet,
} from './keepsake/layout'
import SheetView from './keepsake/SheetView'
import './keepsake/export.css'

interface Props {
  teacher: string
  notes: readonly Note[]
  initialNoteId?: string
  onClose: () => void
  refresh: () => Promise<readonly Note[]>
}

export default function Export({
  teacher,
  notes,
  initialNoteId,
  onClose,
  refresh,
}: Props) {
  const visible = useMemo(
    () => notes.filter((n) => n.teacher === teacher),
    [notes, teacher],
  )
  const [ids, setIds] = useState(
    () => new Set(initialNoteId ? [initialNoteId] : visible.map((n) => n.id)),
  )
  const selected = useMemo(
    () => visible.filter((n) => ids.has(n.id)),
    [visible, ids],
  )
  const [layout, setLayout] = useState<Layout>('Gallery'),
    [size, setSize] = useState<Size>('A4')
  const [page, setPage] = useState(0),
    [sheets, setSheets] = useState<Sheet[]>([]),
    [printSheets, setPrintSheets] = useState<Sheet[]>([])
  const [preparing, setPreparing] = useState(true),
    [busy, setBusy] = useState(false)
  const [error, setError] = useState(''),
    [retry, setRetry] = useState(0)
  const dialog = useRef<HTMLDialogElement>(null),
    alive = useRef(false)
  useLayoutEffect(() => {
    const element = dialog.current!
    element.showModal()
    alive.current = true
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      alive.current = false
      element.close()
      document.body.style.overflow = prev
    }
  }, [])
  useEffect(() => {
    const valid = new Set(visible.map((n) => n.id))
    setIds((old) =>
      [...old].some((id) => !valid.has(id))
        ? new Set([...old].filter((id) => valid.has(id)))
        : old,
    )
  }, [visible])
  useLayoutEffect(() => {
    let live = true
    setPreparing(true)
    setSheets([])
    setPrintSheets([])
    setError('')
    setPage(0)
    loadFonts(teacher + selected.map((n) => n.text).join(''))
      .then(() => {
        if (live) setSheets(compose(selected, teacher, layout, size))
      })
      .catch(() => {
        if (live)
          setError(
            'The print fonts could not load. Check your connection and retry.',
          )
      })
      .finally(() => {
        if (live) setPreparing(false)
      })
    return () => {
      live = false
    }
  }, [selected, teacher, layout, size, retry])
  async function output(action: 'print' | 'pdf') {
    if (busy || !selected.length) return
    setBusy(true)
    setError('')
    try {
      const fresh = (await refresh()).filter(
        (n) => n.teacher === teacher && ids.has(n.id),
      )
      if (!alive.current) return
      if (!fresh.length)
        throw new Error(
          'None of these notes are currently visible. Select another note.',
        )
      await loadFonts(teacher + fresh.map((n) => n.text).join(''))
      if (!alive.current) return
      const pages = compose(fresh, teacher, layout, size)
      if (action === 'pdf') {
        const { downloadPdf } = await import('./keepsake/pdf')
        if (alive.current) await downloadPdf(pages, teacher)
      } else {
        flushSync(() => setPrintSheets(pages))
        window.print()
      }
    } catch (e) {
      if (alive.current)
        setError(
          e instanceof Error && e.message.startsWith('None of')
            ? e.message
            : 'Your keepsake could not be prepared. Check your connection and try again.',
        )
    } finally {
      if (alive.current) setBusy(false)
    }
  }
  const index = Math.min(page, Math.max(0, sheets.length - 1))
  const count = selected.length
  const noExport = !count || busy || preparing || !sheets.length
  return createPortal(
    <dialog
      className="ks-dialog"
      ref={dialog}
      aria-labelledby="ks-title"
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="ks-screen">
        <header className="ks-top">
          <button className="ks-back" onClick={onClose}>
            <ArrowLeft size={18} /> Back to notes
          </button>
          <div className="ks-brand">
            STJBS <span>Student Council</span>
          </div>
        </header>
        <div className="ks-main">
          <header className="ks-heading">
            <div>
              <h1 id="ks-title">
                Save my notes<span>.</span>
              </h1>
              <p>
                A keepsake for <strong>{teacher}</strong>
              </p>
            </div>
            <div className="ks-actions">
              <button disabled={noExport} onClick={() => void output('print')}>
                <Printer size={17} /> Print
              </button>
              <button
                disabled={noExport}
                className="primary"
                onClick={() => void output('pdf')}
              >
                <Download size={17} /> {busy ? 'Preparing…' : 'Download PDF'}
              </button>
            </div>
          </header>
          {error && (
            <div role="alert" className="ks-error">
              {error}{' '}
              <button onClick={() => setRetry((n) => n + 1)}>
                Retry preview
              </button>
            </div>
          )}
          <div className="ks-content">
            <aside className="ks-settings">
              <fieldset className="ks-layout">
                <legend>Layout</legend>
                <div className="ks-styles">
                  {layouts.map((l) => (
                    <label key={l} className={layout === l ? 'active' : ''}>
                      <input
                        type="radio"
                        checked={layout === l}
                        name="keepsake-layout"
                        onChange={() => setLayout(l)}
                      />
                      <span
                        className={
                          'ks-swatch sw-' + l.replace(' ', '-').toLowerCase()
                        }
                        aria-hidden="true"
                      >
                        <i />
                        <b />
                        <em />
                      </span>
                      <span>{l}</span>
                      {layout === l && <Check size={13} />}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset className="ks-size">
                <legend>Paper size</legend>
                <div>
                  {(Object.keys(sizes) as Size[]).map((s) => (
                    <label key={s} className={s === size ? 'active' : ''}>
                      <input
                        type="radio"
                        name="keepsake-size"
                        checked={s === size}
                        onChange={() => setSize(s)}
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </fieldset>
              <section className="ks-notes">
                <h2>
                  Select notes{' '}
                  <small>
                    {count} of {visible.length}
                  </small>
                </h2>
                <div className="ks-selection-actions">
                  <button
                    onClick={() => setIds(new Set(visible.map((n) => n.id)))}
                  >
                    Select all
                  </button>
                  <span>·</span>
                  <button onClick={() => setIds(new Set())}>Clear</button>
                </div>
                <div className="ks-list">
                  {visible.map((n, i) => (
                    <label key={n.id}>
                      <input
                        type="checkbox"
                        aria-label={`Note ${i + 1}: ${n.text}`}
                        checked={ids.has(n.id)}
                        onChange={() =>
                          setIds((prev) => {
                            const next = new Set(prev)
                            if (next.has(n.id)) next.delete(n.id)
                            else next.add(n.id)
                            return next
                          })
                        }
                      />
                      <span>{n.text}</span>
                    </label>
                  ))}
                </div>
              </section>
            </aside>
            <section className="ks-proof" aria-label="Live preview">
              <div className="ks-proofhead">
                <h2>
                  <FileText size={15} /> Live preview
                </h2>
                <span>
                  {size} <i>·</i> {sizes[size].join(' × ')} mm
                </span>
              </div>
              <div className="ks-stage">
                {sheets[index] ? (
                  <SheetView sheet={sheets[index]} />
                ) : (
                  <p role="status">
                    {!count
                      ? 'Select a note to preview, download, or print your keepsake.'
                      : error
                        ? 'Preview unavailable.'
                        : 'Preparing your preview…'}
                  </p>
                )}
              </div>
              <div className="ks-pagination">
                <button
                  aria-label="Previous page"
                  disabled={!index}
                  onClick={() => setPage(index - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span aria-live="polite">
                  {sheets.length
                    ? `Page ${index + 1} of ${sheets.length}`
                    : 'No pages'}
                </span>
                <button
                  aria-label="Next page"
                  disabled={index + 1 >= sheets.length}
                  onClick={() => setPage(index + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
      {printSheets.length > 0 && (
        <div className="ks-print">
          <style>{`@page { size: ${sizes[size][0]}mm ${sizes[size][1]}mm; margin: 0 }`}</style>
          {printSheets.map((s, i) => (
            <div
              key={i}
              style={{
                width: sizes[size][0] + 'mm',
                height: sizes[size][1] + 'mm',
              }}
            >
              <SheetView sheet={s} />
            </div>
          ))}
        </div>
      )}
    </dialog>,
    document.body,
  )
}
