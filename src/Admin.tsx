import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import './admin.css'

type Note = {
  id: string
  teacher: string
  text: string
  slot: number | null
  preferredSlot: number | null
  visible: boolean
  revision: number
}
type Change = {
  id: number
  noteId: string
  actor: string
  action: string
  at: string
  before: Note | null
  after: Note | null
}
type Data = {
  identity: string
  role?: 'manager' | 'admin' | 'viewer'
  demo: boolean
  revision: number
  notes: Note[]
  history: Change[]
  sessions: number
  teachers?: string[]
}
type Impact = {
  revision: number
  added: string[]
  changed: string[]
  removed: string[]
  republished: string[]
}
type Draft = {
  id: string
  teacher: string
  text: string
  visible: boolean
  base: Note | null
}
type Mutation = (
  path: string,
  payload: Record<string, unknown>,
) => Promise<void>
type IconName =
  | 'overview'
  | 'notes'
  | 'teachers'
  | 'history'
  | 'backup'
  | 'access'
  | 'out'
  | 'collapse'
  | 'expand'
  | 'menu'
  | 'arrow'
  | 'plus'
  | 'search'
  | 'close'
  | 'download'
  | 'copy'
  | 'check'
  | 'archive'
const drawings: Record<IconName, ReactNode> = {
  overview: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  notes: (
    <>
      <path d="M5 3h14v13l-5 5H5z" />
      <path d="M14 21v-5h5M8 8h8m-8 4h6" />
    </>
  ),
  teachers: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M3 20v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m1 3a5 5 0 0 1 4 5v2" />
    </>
  ),
  history: (
    <>
      <path d="M3 10a9 9 0 1 1 1 7M3 4v6h6m3-4v6l4 2" />
    </>
  ),
  backup: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v13c0 4 16 4 16 0V5M4 11c0 4 16 4 16 0" />
    </>
  ),
  access: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" />
    </>
  ),
  out: (
    <>
      <path d="M13 4h7v7m0-7-11 11M9 5H4v15h15v-5" />
    </>
  ),
  collapse: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16m7-12-4 4 4 4" />
    </>
  ),
  expand: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16m4-12 4 4-4 4" />
    </>
  ),
  menu: <path d="M3 6h18M3 12h18M3 18h18" />,
  arrow: <path d="M4 12h15m-6-6 6 6-6 6" />,
  plus: <path d="M12 4v16m-8-8h16" />,
  search: (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m15 15 6 6" />
    </>
  ),
  close: <path d="m5 5 14 14m0-14L5 19" />,
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="13" rx="2" />
      <path d="M15 8V3H3v13h5" />
    </>
  ),
  check: <path d="m4 12 5 5L20 6" />,
  archive: (
    <>
      <path d="M3 4h18v5H3zm2 5v12h14V9m-10 4h6" />
    </>
  ),
}
function Icon({ name }: { name: IconName }) {
  return (
    <svg
      className="adm-icon"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {drawings[name]}
    </svg>
  )
}
function Mark() {
  return (
    <span className="adm-mark" aria-hidden="true">
      <i />
      <i />
      <i />
    </span>
  )
}
const sections = [
  ['overview', 'Overview', 'overview'],
  ['notes', 'Notes', 'notes'],
  ['teachers', 'Teachers', 'teachers'],
  ['history', 'Change history', 'history'],
  ['backup', 'Backup & restore', 'backup'],
  ['access', 'Access', 'access'],
] as const
type Route = (typeof sections)[number][0]
const descriptions: Record<Route, string> = {
  overview: 'A live view of the Teacher Appreciation Wall.',
  notes: 'Read, edit and moderate the notes on the wall.',
  teachers: 'Review each teacher’s notes and visible coverage.',
  history: 'Inspect changes and recover an earlier version of a note.',
  backup: 'Download a private snapshot or preview a recovery.',
  access: 'Manage teacher sessions and council administrator access.',
}
function apiRoute() {
  const segment = location.pathname.split('/')[2] || 'overview'
  return sections.find(([key]) => key === segment)?.[0] || 'overview'
}
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public demo: boolean,
  ) {
    super(message)
  }
}
async function api<T>(
  path: string,
  payload?: Record<string, unknown>,
): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      method: payload ? 'POST' : 'GET',
      headers: payload ? { 'Content-Type': 'application/json' } : {},
      body: payload ? JSON.stringify(payload) : undefined,
    })
  } catch {
    throw new Error(
      'Connection lost. Reconnect and retry. Your draft is still here.',
    )
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok)
    throw new ApiError(
      body.error || 'The server could not complete this request.',
      response.status,
      !!body.demo,
    )
  return body as T
}
const emptyMessage = (err: unknown) =>
  err instanceof Error ? err.message : 'The request could not be completed.'
const time = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
const changeTitle = (change: Change) =>
  change.action.replace(/[_-]/g, ' ').replace(/^\w/, (s) => s.toUpperCase())
function useMutation(
  refresh: () => Promise<void>,
  invalidate: () => void,
): Mutation {
  const attempts = useRef(new Map<string, string>())
  return async (path, payload) => {
    const signature = JSON.stringify([path, payload])
    const requestId = attempts.current.get(signature) || crypto.randomUUID()
    attempts.current.set(signature, requestId)
    try {
      await api(path, { ...payload, requestId })
    } catch (err) {
      if (err instanceof ApiError && [401, 403].includes(err.status))
        invalidate()
      throw err
    }
    try {
      await refresh()
    } catch {
      throw new Error(
        'The server confirmed the change, but the latest data could not be loaded. Reconnect and retry to verify it.',
      )
    }
    attempts.current.delete(signature)
  }
}
function Dialog({
  title,
  children,
  onClose,
  sheet = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  sheet?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = ref.current
    el?.showModal()
    return () => el?.close()
  }, [])
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={'adm-dialog' + (sheet ? ' adm-sheet' : '')}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div className="adm-dialog-head">
        <h2>{title}</h2>
        <button className="adm-iconbtn" aria-label="Close" onClick={onClose}>
          <Icon name="close" />
        </button>
      </div>
      {children}
    </dialog>
  )
}
function RowLink({
  title,
  detail,
  onClick,
}: {
  title: string
  detail?: string
  onClick: () => void
}) {
  return (
    <button className="adm-rowlink" onClick={onClick}>
      <span>
        <strong>{title}</strong>
        {detail && <small>{detail}</small>}
      </span>
      <Icon name="arrow" />
    </button>
  )
}
function Status({ visible }: { visible: boolean }) {
  return (
    <span className={'adm-status ' + (visible ? '' : 'adm-hidden')}>
      <i />
      {visible ? 'Visible' : 'Hidden'}
    </span>
  )
}
function StateError({ message }: { message: string }) {
  return message ? (
    <p role="alert" className="adm-error">
      {message}
    </p>
  ) : null
}
function Blank({ children }: { children: ReactNode }) {
  return <p className="adm-blank">{children}</p>
}
function Counts({ data, teachers }: { data: Data; teachers: string[] }) {
  const occupied = new Set(
    data.notes.filter((n) => n.visible).map((n) => n.slot),
  )
  const visible = data.notes.filter((n) => n.visible).length
  const zeroBased = occupied.has(0) || !occupied.has(500)
  return (
    <section className="adm-capacity" aria-label="Wall capacity">
      <div className="adm-capinfo">
        <h2>Wall capacity</h2>
        <div className="adm-fraction">
          {visible}
          <span> / 500</span>
        </div>
        <p>visible notes</p>
      </div>
      <div className="adm-mapcol">
        <div className="adm-slotmap" aria-hidden="true">
          {Array.from({ length: 500 }, (_, i) => (
            <i
              key={i}
              className={occupied.has(zeroBased ? i : i + 1) ? 'filled' : ''}
            />
          ))}
        </div>
        <div className="adm-maplegend">
          <span>{500 - visible} open slots</span>
          <span>{teachers.length} teachers</span>
        </div>
      </div>
    </section>
  )
}
function Overview({
  data,
  teachers,
  coverage,
  go,
}: {
  data: Data
  teachers: string[]
  coverage: Map<string, number>
  go: (r: Route, query?: Record<string, string>) => void
}) {
  const low = teachers.filter((t) => (coverage.get(t) || 0) < 3),
    hidden = data.notes.filter((n) => !n.visible)
  return (
    <>
      <Counts data={data} teachers={teachers} />
      <div className="adm-columns">
        <section className="adm-panel">
          <h2>Moderation desk</h2>
          {low.slice(0, 2).map((t) => (
            <RowLink
              key={t}
              title={t}
              detail={`${coverage.get(t) || 0} visible notes · Below three`}
              onClick={() => go('notes', { teacher: t })}
            />
          ))}
          {low.length > 2 && (
            <RowLink
              title={`Review all ${low.length} teachers below three`}
              onClick={() => go('teachers', { coverage: 'low' })}
            />
          )}
          {hidden.length > 0 && (
            <RowLink
              title={`Review ${hidden.length} hidden ${hidden.length === 1 ? 'note' : 'notes'}`}
              onClick={() => go('notes', { status: 'hidden' })}
            />
          )}
          {!low.length && !hidden.length && (
            <div className="adm-clear">
              <Icon name="check" />
              <div>
                <strong>All notes accounted for</strong>
                <p>
                  Every teacher has at least three visible notes. The hidden
                  list is empty.
                </p>
              </div>
            </div>
          )}
          <RowLink title="Find a note" onClick={() => go('notes')} />
        </section>
        <section className="adm-panel">
          <h2>Recent activity</h2>
          {data.history.length ? (
            data.history
              .slice(0, 3)
              .map((h) => (
                <RowLink
                  key={h.id}
                  title={changeTitle(h)}
                  detail={`${h.after?.teacher || h.before?.teacher || h.noteId} · ${time(h.at)}`}
                  onClick={() => go('history', { change: String(h.id) })}
                />
              ))
          ) : (
            <Blank>New edits, hides and restorations will appear here.</Blank>
          )}
          <RowLink title="View change history" onClick={() => go('history')} />
        </section>
      </div>
    </>
  )
}
function Search({
  value,
  onChange,
  label,
}: {
  value: string
  onChange: (s: string) => void
  label: string
}) {
  return (
    <label className="adm-search">
      <Icon name="search" />
      <input
        type="search"
        placeholder={label}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  )
}
function Notes({
  notes,
  teachers,
  params,
  onEdit,
}: {
  notes: Note[]
  teachers: string[]
  params: URLSearchParams
  onEdit: (n: Note) => void
}) {
  const [search, setSearch] = useState(params.get('q') || ''),
    [teacher, setTeacher] = useState(params.get('teacher') || ''),
    [status, setStatus] = useState(params.get('status') || ''),
    [page, setPage] = useState(0)
  const query = search.trim().toLowerCase()
  const found = notes.filter(
    (n) =>
      (!teacher || n.teacher === teacher) &&
      (!status || n.visible === (status === 'visible')) &&
      (!query ||
        [n.id, n.text, n.teacher, n.visible ? 'visible' : 'hidden'].some((s) =>
          s.toLowerCase().includes(query),
        )),
  )
  const current = Math.min(page, Math.max(0, Math.ceil(found.length / 20) - 1))
  return (
    <>
      <div className="adm-tools">
        <Search
          value={search}
          label="Search note, teacher or ID"
          onChange={(s) => {
            setSearch(s)
            setPage(0)
          }}
        />
        <select
          aria-label="Filter by teacher"
          value={teacher}
          onChange={(e) => {
            setTeacher(e.target.value)
            setPage(0)
          }}
        >
          <option value="">All teachers</option>
          {teachers.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(0)
          }}
        >
          <option value="">All statuses</option>
          <option value="visible">Visible</option>
          <option value="hidden">Hidden</option>
        </select>
      </div>
      <div className="adm-datatable">
        <table>
          <caption>
            {found.length} {found.length === 1 ? 'note' : 'notes'}
          </caption>
          <thead>
            <tr>
              <th>Teacher / note ID</th>
              <th>Message</th>
              <th>Status</th>
              <th>
                <span className="adm-sr">Edit note</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {found.slice(current * 20, (current + 1) * 20).map((n) => (
              <tr key={n.id}>
                <td>
                  <button className="adm-textlink" onClick={() => onEdit(n)}>
                    {n.teacher}
                  </button>
                  <small>{n.id}</small>
                </td>
                <td>
                  <span className="adm-excerpt">{n.text}</span>
                </td>
                <td>
                  <Status visible={n.visible} />
                </td>
                <td>
                  <button
                    className="adm-iconbtn"
                    aria-label={'Edit ' + n.id}
                    onClick={() => onEdit(n)}
                  >
                    <Icon name="arrow" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!found.length && (
          <Blank>No matching notes. Try another search or filter.</Blank>
        )}
      </div>
      {found.length > 20 && (
        <div className="adm-pages">
          <button disabled={!current} onClick={() => setPage(current - 1)}>
            Previous
          </button>
          <span>
            Page {current + 1} of {Math.ceil(found.length / 20)}
          </span>
          <button
            disabled={(current + 1) * 20 >= found.length}
            onClick={() => setPage(current + 1)}
          >
            Next
          </button>
        </div>
      )}
    </>
  )
}
function Teachers({
  teachers,
  notes,
  coverage,
  initialLow,
  open,
}: {
  teachers: string[]
  notes: Note[]
  coverage: Map<string, number>
  initialLow: boolean
  open: (t: string) => void
}) {
  const [search, setSearch] = useState(''),
    [low, setLow] = useState(initialLow)
  const found = teachers.filter(
    (t) =>
      t.toLowerCase().includes(search.trim().toLowerCase()) &&
      (!low || (coverage.get(t) || 0) < 3),
  )
  return (
    <>
      <div className="adm-tools">
        <Search label="Search teachers" value={search} onChange={setSearch} />
        <label className="adm-check">
          <input
            type="checkbox"
            checked={low}
            onChange={(e) => setLow(e.target.checked)}
          />{' '}
          Below three visible notes
        </label>
      </div>
      <div className="adm-datatable">
        <table>
          <caption>{found.length} teachers</caption>
          <thead>
            <tr>
              <th>Teacher</th>
              <th>Visible</th>
              <th>Hidden</th>
              <th>
                <span className="adm-sr">Open notes</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {found.map((t) => (
              <tr key={t}>
                <td>
                  <button className="adm-textlink" onClick={() => open(t)}>
                    {t}
                  </button>
                </td>
                <td>
                  <span className={(coverage.get(t) || 0) < 3 ? 'adm-low' : ''}>
                    {coverage.get(t) || 0}
                    {(coverage.get(t) || 0) < 3 ? ' · Below three' : ''}
                  </span>
                </td>
                <td>
                  {notes.filter((n) => n.teacher === t && !n.visible).length}
                </td>
                <td>
                  <button
                    className="adm-iconbtn"
                    aria-label={'View notes for ' + t}
                    onClick={() => open(t)}
                  >
                    <Icon name="arrow" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!found.length && <Blank>No teachers match this filter.</Blank>}
      </div>
    </>
  )
}
function NoteVersion({ label, note }: { label: string; note: Note | null }) {
  return (
    <section className="adm-version">
      <h3>{label}</h3>
      {note ? (
        <>
          <strong>{note.teacher}</strong> <Status visible={note.visible} />
          <p>{note.text}</p>
          <small>Revision {note.revision}</small>
        </>
      ) : (
        <p>No note in this version.</p>
      )}
    </section>
  )
}
function Editor({
  initial,
  teachers,
  coverage,
  data,
  mutate,
  refresh,
  close,
  saved,
}: {
  initial: Draft
  teachers: string[]
  coverage: Map<string, number>
  data: Data
  mutate: Mutation
  refresh: () => Promise<void>
  close: () => void
  saved: () => void
}) {
  const [draft, setDraft] = useState(initial),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false),
    [discard, setDiscard] = useState(false)
  const current = data.notes.find((n) => n.id === draft.id)
  const conflict = !!draft.base && current?.revision !== draft.base.revision
  const full =
    data.notes.filter((n) => n.visible).length >= 500 &&
    draft.visible &&
    !draft.base?.visible
  const coverageWarning =
    draft.base?.visible &&
    (draft.base.teacher !== draft.teacher || !draft.visible) &&
    (coverage.get(draft.base.teacher) || 0) <= 3
  const dirty =
    draft.text !== initial.text ||
    draft.teacher !== initial.teacher ||
    draft.visible !== initial.visible
  function requestClose() {
    if (pending) return
    if (dirty) setDiscard(true)
    else close()
  }
  async function save() {
    setError('')
    setPending(true)
    try {
      await mutate('/api/admin/notes', {
        id: draft.id,
        expectedRevision: draft.base?.revision || 0,
        teacher: draft.teacher,
        text: draft.text,
        visible: draft.visible,
      })
      saved()
    } catch (err) {
      setError(emptyMessage(err))
      if (err instanceof ApiError && err.status === 409)
        await refresh().catch(() => {})
    } finally {
      setPending(false)
    }
  }
  return (
    <Dialog
      title={draft.base ? 'Edit note' : 'Add note'}
      sheet
      onClose={requestClose}
    >
      <form
        className="adm-form"
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {draft.base && (
          <div className="adm-metadata">
            {draft.id} <span>Revision {draft.base.revision}</span>
          </div>
        )}
        <label>
          Teacher
          <input
            required
            value={draft.teacher}
            list="adm-teachers"
            placeholder="Choose or enter a teacher"
            onChange={(e) => setDraft({ ...draft, teacher: e.target.value })}
          />
        </label>
        <datalist id="adm-teachers">
          {teachers.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <label>
          Message
          <textarea
            required
            rows={9}
            value={draft.text}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          />
        </label>
        <label>
          Wall status
          <select
            value={draft.visible ? 'visible' : 'hidden'}
            onChange={(e) =>
              setDraft({ ...draft, visible: e.target.value === 'visible' })
            }
          >
            <option value="visible">Visible</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
        {coverageWarning && (
          <p className="adm-warn">
            {draft.base!.teacher} will have fewer than three visible notes. You
            can still save this change.
          </p>
        )}
        {full && (
          <p className="adm-warn">
            All 500 slots are filled. Hide a visible note to free a slot, or
            save this note as hidden.
          </p>
        )}
        {conflict && (
          <div className="adm-warn">
            <strong>The saved revision changed.</strong>
            {current ? (
              <>
                <NoteVersion label="Latest saved note" note={current} />
                <button
                  type="button"
                  onClick={() => {
                    setDraft({ ...draft, base: current })
                    setError('')
                  }}
                >
                  Keep my draft against revision {current.revision}
                </button>
              </>
            ) : (
              <p>This note was removed during recovery.</p>
            )}
          </div>
        )}
        <StateError message={error} />
        {error && (
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              void refresh().catch((err) => setError(emptyMessage(err)))
            }
          >
            Refresh saved data
          </button>
        )}
        <div className="adm-actions">
          <button
            type="submit"
            className="adm-primary"
            disabled={
              pending ||
              full ||
              conflict ||
              !draft.text.trim() ||
              !draft.teacher.trim()
            }
          >
            {pending ? 'Saving…' : error ? 'Retry save' : 'Save note'}
          </button>
          <button type="button" onClick={requestClose} disabled={pending}>
            Cancel
          </button>
        </div>
        {discard && (
          <div className="adm-warn">
            <p>Discard the unsaved changes to this note?</p>
            <div className="adm-actions">
              <button type="button" onClick={() => setDiscard(false)}>
                Keep editing
              </button>
              <button type="button" onClick={close}>
                Discard changes
              </button>
            </div>
          </div>
        )}
      </form>
    </Dialog>
  )
}
function History({
  data,
  initialChange,
  mutate,
  notify,
  refresh,
}: {
  data: Data
  initialChange: string | null
  mutate: Mutation
  notify: (s: string) => void
  refresh: () => Promise<void>
}) {
  const initialEntry = data.history.find((h) => String(h.id) === initialChange)
  const [selected, setSelected] = useState<number | null>(
      initialChange ? Number(initialChange) : null,
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(''),
    [limit, setLimit] = useState(30),
    [confirm, setConfirm] = useState(false),
    [side, setSide] = useState<'before' | 'after'>(
      initialEntry?.before ? 'before' : 'after',
    )
  const filtered = data.history.filter((h) =>
    [h.noteId, h.actor, h.action, h.before?.teacher, h.after?.teacher].some(
      (s) => s?.toLowerCase().includes(search.toLowerCase()),
    ),
  )
  const entry = data.history.find((h) => h.id === selected),
    current = data.notes.find((n) => n.id === entry?.noteId)
  const target = entry?.[side]
  const under = !!(
    current?.visible &&
    target &&
    (!target.visible || target.teacher !== current.teacher) &&
    data.notes.filter((n) => n.teacher === current.teacher && n.visible)
      .length <= 3
  )
  async function restore() {
    if (!entry) return
    setBusy(true)
    setError('')
    try {
      await mutate('/api/admin/revision', {
        id: entry.noteId,
        expectedRevision: current?.revision || 0,
        historyId: entry.id,
        side,
      })
      setSelected(null)
      notify('Revision restored.')
    } catch (err) {
      setError(emptyMessage(err))
      setConfirm(false)
      await refresh().catch(() => {})
    } finally {
      setBusy(false)
    }
  }
  function open(h: Change) {
    setSide(h.before ? 'before' : 'after')
    setSelected(h.id)
    setConfirm(false)
    setError('')
  }
  return (
    <>
      <div className="adm-tools">
        <Search
          value={search}
          onChange={setSearch}
          label="Search changes by teacher, ID or actor"
        />
      </div>
      <div className="adm-panel">
        <h2>Revision log</h2>
        {filtered.slice(0, limit).map((h) => (
          <RowLink
            key={h.id}
            title={`${changeTitle(h)} · ${h.after?.teacher || h.before?.teacher || h.noteId}`}
            detail={`${h.noteId} · ${time(h.at)} · ${h.actor}`}
            onClick={() => open(h)}
          />
        ))}
        {!filtered.length && (
          <Blank>
            {data.history.length
              ? 'No changes match this search.'
              : 'The first moderation change will appear here.'}
          </Blank>
        )}
        {filtered.length > limit && (
          <button onClick={() => setLimit(limit + 30)}>
            Show more revisions
          </button>
        )}
      </div>
      {entry && (
        <Dialog
          title="Revision details"
          sheet
          onClose={() => {
            if (!busy) setSelected(null)
          }}
        >
          <p className="adm-sub">
            {entry.noteId} · {time(entry.at)}
            <br />
            {entry.actor}
          </p>
          <NoteVersion label="Before change" note={entry.before} />
          <NoteVersion label="After change" note={entry.after} />
          {!confirm && (
            <label className="adm-restore-choice">
              Version to restore
              <select
                value={side}
                onChange={(e) => setSide(e.target.value as 'before' | 'after')}
              >
                {entry.before && <option value="before">Before change</option>}
                {entry.after && <option value="after">After change</option>}
              </select>
            </label>
          )}
          {confirm && (
            <>
              <NoteVersion
                label="Current saved version"
                note={current || null}
              />
              <p className="adm-warn">
                Restore the “
                {side === 'before' ? 'Before change' : 'After change'}” version
                above? This creates a new revision.
                {under &&
                  ' This will leave the current teacher with fewer than three visible notes.'}
              </p>
            </>
          )}
          <StateError message={error} />
          <div className="adm-actions">
            {target && (
              <button
                className="adm-primary"
                disabled={busy}
                onClick={() => (confirm ? void restore() : setConfirm(true))}
              >
                {busy
                  ? 'Restoring…'
                  : confirm
                    ? 'Confirm restore'
                    : 'Restore this revision'}
              </button>
            )}
            {confirm && (
              <button disabled={busy} onClick={() => setConfirm(false)}>
                Cancel
              </button>
            )}
          </div>
        </Dialog>
      )}
    </>
  )
}
function Backup({
  mutate,
  notify,
}: {
  mutate: Mutation
  notify: (s: string) => void
}) {
  const [backup, setBackup] = useState<Record<string, unknown> | null>(null),
    [impact, setImpact] = useState<Impact | null>(null),
    [approved, setApproved] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [filename, setFilename] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  async function download() {
    setBusy(true)
    setError('')
    try {
      const snapshot = await api<Record<string, unknown>>('/api/admin/backup')
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(snapshot, null, 2)], {
          type: 'application/json',
        }),
      )
      const a = document.createElement('a')
      a.href = url
      a.download =
        'teacher-wall-backup-' + new Date().toISOString().slice(0, 10) + '.json'
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      notify('Backup downloaded. Store it privately.')
    } catch (err) {
      setError(emptyMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function preview(value: Record<string, unknown>) {
    setBusy(true)
    setError('')
    setImpact(null)
    setConfirmed(false)
    setApproved([])
    try {
      setImpact(
        await api<Impact>('/api/admin/restore/preview', { backup: value }),
      )
    } catch (err) {
      setError(emptyMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function read(file?: File) {
    setBackup(null)
    setImpact(null)
    setError('')
    setFilename(file?.name || '')
    if (!file) return
    try {
      const value = JSON.parse(await file.text())
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('Choose a valid JSON wall backup.')
      setBackup(value)
      await preview(value)
    } catch (err) {
      setError(
        err instanceof SyntaxError
          ? 'The file contains invalid JSON. Choose a wall backup and try again.'
          : emptyMessage(err),
      )
    }
  }
  async function restore() {
    if (
      !impact ||
      !backup ||
      !confirmed ||
      approved.length !== impact.republished.length
    )
      return
    setBusy(true)
    setError('')
    try {
      await mutate('/api/admin/restore', {
        backup,
        expectedRevision: impact.revision,
        confirmRepublished: approved,
      })
      setImpact(null)
      setBackup(null)
      setFilename('')
      if (fileRef.current) fileRef.current.value = ''
      notify('Backup restored. The wall now uses the recovered data.')
    } catch (err) {
      setError(emptyMessage(err))
      if (err instanceof ApiError && err.status === 409) {
        setImpact(null)
        setConfirmed(false)
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <div className="adm-columns">
        <section className="adm-panel">
          <h2>Download a backup</h2>
          <p>
            Save a versioned JSON file containing the current notes, visibility
            and slot assignments. Keep this file private.
          </p>
          <button
            className="adm-primary"
            disabled={busy}
            onClick={() => void download()}
          >
            <Icon name="download" /> Download backup
          </button>
        </section>
        <section className="adm-panel">
          <h2>Restore from backup</h2>
          <p>
            Choose a wall backup to compare it with the current collection
            before applying changes.
          </p>
          <label className="adm-file">
            Wall backup (.json)
            <input
              ref={fileRef}
              type="file"
              accept=".json,application/json"
              disabled={busy}
              onChange={(e) => void read(e.target.files?.[0])}
            />
          </label>
          {backup && !impact && !busy && (
            <button onClick={() => void preview(backup)}>Preview again</button>
          )}
        </section>
      </div>
      <StateError message={error} />
      {impact && (
        <section className="adm-panel adm-recovery">
          <h2>Recovery preview</h2>
          <p>
            {filename} · Compared with wall revision {impact.revision}
          </p>
          {(['added', 'changed', 'removed', 'republished'] as const).map(
            (k) => (
              <details key={k}>
                <summary>
                  {impact[k].length} {k} notes
                </summary>
                {impact[k].length ? <p>{impact[k].join(', ')}</p> : <p>None</p>}
              </details>
            ),
          )}
          {impact.republished.length > 0 && (
            <fieldset>
              <legend>Approve each hidden note to republish</legend>
              {impact.republished.map((id) => (
                <label className="adm-check" key={id}>
                  <input
                    type="checkbox"
                    checked={approved.includes(id)}
                    onChange={(e) =>
                      setApproved(
                        e.target.checked
                          ? [...approved, id]
                          : approved.filter((v) => v !== id),
                      )
                    }
                  />
                  {id}
                </label>
              ))}
            </fieldset>
          )}
          <label className="adm-check">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            I have reviewed the changes and confirm this restore.
          </label>
          <button
            className="adm-danger"
            disabled={
              busy ||
              !confirmed ||
              approved.length !== impact.republished.length
            }
            onClick={() => void restore()}
          >
            {busy ? 'Restoring…' : 'Apply restore'}
          </button>
        </section>
      )}
    </>
  )
}
type AccessInfo = {
  role: 'manager' | 'admin' | 'viewer'
  email: string
  managers?: string[]
  admins?: string[]
  members?: { email: string; addedBy: string; addedAt: string }[]
  passphrase?: { source: 'app' | 'deployment'; updatedBy?: string; updatedAt?: string }
  sync?: boolean
}
const passphraseAlphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
function generatePassphrase() {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(
    bytes,
    (b) => passphraseAlphabet[b % passphraseAlphabet.length],
  ).join('')
}
function saveBlob(blob: Blob, name: string) {
  const href = URL.createObjectURL(blob),
    a = document.createElement('a')
  a.href = href
  a.download = name
  document.body.append(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 2000)
}
function Access({
  data,
  mutate,
  notify,
}: {
  data: Data
  mutate: Mutation
  notify: (s: string) => void
}) {
  const [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [qr, setQr] = useState(''),
    [info, setInfo] = useState<AccessInfo | null>(null),
    [infoError, setInfoError] = useState(''),
    [newEmail, setNewEmail] = useState(''),
    [memberError, setMemberError] = useState(''),
    [removing, setRemoving] = useState(''),
    [pass, setPass] = useState(''),
    [passError, setPassError] = useState(''),
    [passConfirm, setPassConfirm] = useState<'set' | 'reset' | ''>(''),
    [shown, setShown] = useState(''),
    [revealed, setRevealed] = useState(''),
    [revealError, setRevealError] = useState('')
  const url = new URL('/', location.origin).href
  const manager = info?.role === 'manager'
  const readOnly = (data.role || info?.role) === 'viewer'
  const loadInfo = useCallback(async () => {
    try {
      setInfo(await api<AccessInfo>('/api/admin/access'))
      setInfoError('')
    } catch (err) {
      setInfoError(emptyMessage(err))
    }
  }, [])
  useEffect(() => {
    void loadInfo()
  }, [loadInfo])
  useEffect(() => {
    let live = true
    import('qrcode')
      .then((lib) =>
        lib.toDataURL(url, {
          width: 180,
          margin: 4,
          color: { dark: '#173d32', light: '#ffffff' },
        }),
      )
      .then((src) => {
        if (live) setQr(src)
      })
      .catch(() => {})
    return () => {
      live = false
    }
  }, [url])
  async function downloadQr(kind: 'svg' | 'png') {
    setError('')
    try {
      const lib = await import('qrcode'),
        options = { margin: 4, color: { dark: '#173d32', light: '#ffffff' } }
      if (kind === 'svg')
        saveBlob(
          new Blob([await lib.toString(url, { ...options, type: 'svg' })], {
            type: 'image/svg+xml',
          }),
          'teacher-wall-qr.svg',
        )
      else {
        const src = await lib.toDataURL(url, { ...options, width: 2048 }),
          raw = atob(src.split(',')[1]),
          bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0))
        saveBlob(
          new Blob([bytes], { type: 'image/png' }),
          'teacher-wall-qr-2048.png',
        )
      }
      notify('QR code downloaded as ' + kind.toUpperCase() + '.')
    } catch {
      setError('The QR code could not be created. Please retry.')
    }
  }
  async function revoke() {
    setBusy(true)
    setError('')
    try {
      await mutate('/api/admin/sessions/revoke', {})
      setConfirm(false)
      notify('Teacher sessions revoked. Teachers must unlock the wall again.')
    } catch (err) {
      setError(emptyMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function addMember() {
    setBusy(true)
    setMemberError('')
    try {
      await api('/api/admin/members/add', { email: newEmail })
      notify(newEmail.trim().toLowerCase() + ' can now view the council desk.')
      setNewEmail('')
      await loadInfo()
    } catch (err) {
      setMemberError(emptyMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function removeMember() {
    setBusy(true)
    setMemberError('')
    try {
      await api('/api/admin/members/remove', { email: removing })
      notify(removing + ' was removed.')
      setRemoving('')
      await loadInfo()
    } catch (err) {
      setMemberError(emptyMessage(err))
    } finally {
      setBusy(false)
    }
  }
  async function reveal() {
    setRevealError('')
    try {
      setRevealed((await api<{ passphrase: string }>('/api/admin/passphrase')).passphrase)
    } catch (err) {
      setRevealError(emptyMessage(err))
    }
  }
  async function savePassphrase() {
    setBusy(true)
    setPassError('')
    setRevealed('')
    setRevealError('')
    try {
      if (passConfirm === 'reset') {
        await api('/api/admin/passphrase/reset', {})
        notify('Teachers now use the deployment passphrase again.')
      } else {
        await api('/api/admin/passphrase', { passphrase: pass })
        setShown(pass)
        notify('New passphrase saved. Teachers were signed out.')
      }
      setPass('')
      setPassConfirm('')
      await loadInfo()
    } catch (err) {
      setPassError(emptyMessage(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="adm-columns">
      <section className="adm-panel">
        <h2>Teacher access</h2>
        <p>
          Teachers use the shared passphrase to open the read-only wall. Browser
          sessions last 30 days.
        </p>
        <div className="adm-qr">
          {qr && (
            <img
              src={qr}
              width="106"
              height="106"
              alt="QR code linking to the teacher wall"
            />
          )}
          <div>
            <h3>Teacher wall link</h3>
            <a href={url}>{url}</a>
            <button
              onClick={() =>
                navigator.clipboard
                  .writeText(url)
                  .then(() => notify('Teacher link copied.'))
                  .catch(() => setError('Copy the teacher link shown above.'))
              }
            >
              <Icon name="copy" />
              Copy link
            </button>
          </div>
        </div>
        <div className="adm-actions" aria-label="Download the QR code">
          <button onClick={() => void downloadQr('svg')}>Download SVG</button>
          <button onClick={() => void downloadQr('png')}>
            Download PNG (2048 px)
          </button>
        </div>
        <div className="adm-rule">
          <h3>Teacher passphrase</h3>
          {!manager ? (
            <p>
              {infoError ||
                'Access managers create and change the passphrase here.'}
            </p>
          ) : (
            <>
              <p>
                {info?.passphrase?.source === 'app'
                  ? 'Set in this desk by ' +
                    info.passphrase.updatedBy +
                    (info.passphrase.updatedAt
                      ? ', ' + time(info.passphrase.updatedAt)
                      : '') +
                    '. It is stored encrypted and only access managers can view it.'
                  : 'Using the passphrase configured at deployment.'}
              </p>
              <div className="adm-actions">
                <button
                  onClick={() =>
                    revealed ? setRevealed('') : void reveal()
                  }
                >
                  {revealed ? 'Hide passphrase' : 'View passphrase'}
                </button>
              </div>
              {revealed && (
                <p className="adm-identity" role="status">
                  <span>
                    <small>Current teacher passphrase</small>
                    <strong>{revealed}</strong>
                  </span>
                  <button
                    onClick={() =>
                      navigator.clipboard
                        .writeText(revealed)
                        .then(() => notify('Passphrase copied.'))
                        .catch(() => {})
                    }
                  >
                    <Icon name="copy" />
                    Copy
                  </button>
                </p>
              )}
              <StateError message={revealError} />
              {shown && (
                <p className="adm-identity" role="status">
                  <span>
                    <small>New passphrase (shown once)</small>
                    <strong>{shown}</strong>
                  </span>
                  <button
                    onClick={() =>
                      navigator.clipboard
                        .writeText(shown)
                        .then(() => notify('Passphrase copied.'))
                        .catch(() => {})
                    }
                  >
                    <Icon name="copy" />
                    Copy
                  </button>
                </p>
              )}
              <label>
                New passphrase
                <input
                  value={pass}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => {
                    setPass(e.target.value)
                    setPassError('')
                  }}
                />
              </label>
              <div className="adm-actions">
                <button
                  onClick={() => {
                    setPass(generatePassphrase())
                    setPassError('')
                  }}
                >
                  Generate
                </button>
                <button
                  className="adm-danger"
                  disabled={busy || pass.length < 8}
                  onClick={() => {
                    setPassError('')
                    setPassConfirm('set')
                  }}
                >
                  Save passphrase
                </button>
                {info?.passphrase?.source === 'app' && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      setPassError('')
                      setPassConfirm('reset')
                    }}
                  >
                    Use deployment passphrase
                  </button>
                )}
              </div>
              <StateError message={passConfirm ? '' : passError} />
            </>
          )}
        </div>
        <div className="adm-rule">
          <h3>Teacher sessions</h3>
          <p>
            {data.sessions} active browser{' '}
            {data.sessions === 1 ? 'session' : 'sessions'}
          </p>
          <button
            className="adm-danger"
            disabled={readOnly}
            onClick={() => {
              setError('')
              setConfirm(true)
            }}
          >
            Revoke teacher sessions
          </button>
        </div>
        <StateError message={confirm ? '' : error} />
      </section>
      <section className="adm-panel">
        <h2>Council administrators</h2>
        <p>
          Named Google accounts reach the council desk through Cloudflare
          Access. Council members you add can monitor the desk and view the
          wall, but cannot change anything.
        </p>
        <div className="adm-identity">
          <span className="adm-avatar">
            <Icon name="access" />
          </span>
          <div>
            <small>
              Signed in as{' '}
              {info
                ? { manager: 'access manager', admin: 'administrator', viewer: 'read-only member' }[
                    info.role
                  ]
                : ''}
            </small>
            <strong>{data.identity}</strong>
          </div>
        </div>
        <p>
          <a href="/admin/wall">View the wall</a> as a council member.
        </p>
        {readOnly && (
          <p role="status">
            You have read-only access. You can browse everything, but changes
            are turned off.
          </p>
        )}
        {manager && (
          <>
            <div className="adm-rule">
              <h3>Add a council member</h3>
              {!info?.sync && !data.demo && (
                <p role="alert" className="adm-error">
                  Cloudflare Access sync is not configured on this deployment,
                  so members cannot be added or removed yet.
                </p>
              )}
              <label>
                Google email
                <input
                  type="email"
                  value={newEmail}
                  autoComplete="off"
                  placeholder="name@stjbs.sch.id"
                  onChange={(e) => {
                    setNewEmail(e.target.value)
                    setMemberError('')
                  }}
                />
              </label>
              <div className="adm-actions">
                <button
                  disabled={busy || !newEmail.trim() || (!info?.sync && !data.demo)}
                  onClick={() => void addMember()}
                >
                  {busy && !removing ? 'Adding…' : 'Add member'}
                </button>
              </div>
              <StateError message={removing ? '' : memberError} />
            </div>
            <div className="adm-rule">
              <h3>Council members ({info?.members?.length ?? 0})</h3>
              {info?.members?.length ? (
                <ul>
                  {info.members.map((m) => (
                    <li key={m.email}>
                      {m.email}{' '}
                      <small>
                        added by {m.addedBy}, {time(m.addedAt)}
                      </small>{' '}
                      <button
                        className="adm-danger"
                        disabled={busy || (!info.sync && !data.demo)}
                        onClick={() => {
                          setMemberError('')
                          setRemoving(m.email)
                        }}
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p>No read-only members yet.</p>
              )}
            </div>
            <details>
              <summary>Full administrators ({info?.admins?.length ?? 0})</summary>
              <ul>
                {(info?.admins || []).map((e) => (
                  <li key={e}>
                    {e}
                    {info?.managers?.includes(e) ? ' (access manager)' : ''}
                  </li>
                ))}
              </ul>
              <p>
                Full administrators and access managers are set by the
                deployment’s ADMIN_EMAILS and ACCESS_MANAGERS settings.
              </p>
            </details>
          </>
        )}
        <StateError message={manager ? '' : infoError} />
      </section>
      {confirm && (
        <Dialog
          title="Revoke teacher sessions?"
          onClose={() => {
            if (!busy) setConfirm(false)
          }}
        >
          <p>
            All signed-in teachers will need the passphrase to reopen the wall.
          </p>
          <StateError message={error} />
          <div className="adm-actions">
            <button
              className="adm-danger"
              disabled={busy}
              onClick={() => void revoke()}
            >
              {busy ? 'Revoking…' : 'Revoke sessions'}
            </button>
            <button disabled={busy} onClick={() => setConfirm(false)}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
      {passConfirm && (
        <Dialog
          title={
            passConfirm === 'reset'
              ? 'Use the deployment passphrase?'
              : 'Change the teacher passphrase?'
          }
          onClose={() => {
            if (!busy) setPassConfirm('')
          }}
        >
          <p>
            Every teacher will be signed out and must enter the{' '}
            {passConfirm === 'reset' ? 'deployment' : 'new'} passphrase to open
            the wall again. Share it with staff privately.
          </p>
          <StateError message={passError} />
          <div className="adm-actions">
            <button
              className="adm-danger"
              disabled={busy}
              onClick={() => void savePassphrase()}
            >
              {busy ? 'Saving…' : 'Change passphrase'}
            </button>
            <button disabled={busy} onClick={() => setPassConfirm('')}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
      {removing && (
        <Dialog
          title="Remove this council member?"
          onClose={() => {
            if (!busy) setRemoving('')
          }}
        >
          <p>
            {removing} will lose access to the council desk and the wall
            preview.
          </p>
          <StateError message={memberError} />
          <div className="adm-actions">
            <button
              className="adm-danger"
              disabled={busy}
              onClick={() => void removeMember()}
            >
              {busy ? 'Removing…' : 'Remove member'}
            </button>
            <button disabled={busy} onClick={() => setRemoving('')}>
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </div>
  )
}
export default function Admin() {
  const [data, setData] = useState<Data | null>(null),
    [gate, setGate] = useState<{ message: string; demo: boolean } | null>(null),
    [checking, setChecking] = useState(false),
    [warning, setWarning] = useState(''),
    [notice, setNotice] = useState(''),
    [locationKey, setLocationKey] = useState(location.href),
    [drawer, setDrawer] = useState(false),
    [draft, setDraft] = useState<Draft | null>(null)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('council-sidebar') === 'compact'
    } catch {
      return false
    }
  })
  const sequence = useRef(0),
    mainRef = useRef<HTMLElement>(null)
  const route = apiRoute(),
    params = new URL(locationKey).searchParams,
    label = sections.find((s) => s[0] === route)![1]
  const refresh = useCallback(async () => {
    const seq = ++sequence.current
    try {
      const next = await api<Data>('/api/admin')
      if (seq === sequence.current) {
        setData(next)
        setGate(null)
        setWarning('')
      }
    } catch (err) {
      if (seq === sequence.current) {
        if (err instanceof ApiError && [401, 403].includes(err.status)) {
          setData(null)
          setDraft(null)
          setGate({ message: err.message, demo: err.demo })
        } else {
          setGate({ message: emptyMessage(err), demo: false })
          setWarning(
            'The latest data could not be loaded. Refresh to try again.',
          )
        }
      }
      throw err
    }
  }, [])
  useEffect(() => {
    const read = () => {
      if (document.visibilityState === 'visible') void refresh().catch(() => {})
    }
    void refresh().catch(() => {})
    window.addEventListener('focus', read)
    document.addEventListener('visibilitychange', read)
    const timer = window.setInterval(read, 60000)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', read)
      document.removeEventListener('visibilitychange', read)
    }
  }, [refresh])
  useEffect(() => {
    const handle = () => {
      setLocationKey(location.href)
      setDrawer(false)
      setDraft(null)
      setNotice('')
    }
    window.addEventListener('popstate', handle)
    return () => window.removeEventListener('popstate', handle)
  }, [])
  useEffect(() => {
    document.title = label + ' · Council desk · STJBS'
  }, [label])
  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(''), 6500)
    return () => clearTimeout(timer)
  }, [notice])
  const mutate = useMutation(refresh, () => void refresh().catch(() => {}))
  const teachers = useMemo(
    () =>
      Array.from(
        new Set([
          ...(data?.teachers || []),
          ...(data?.notes || []).map((n) => n.teacher),
          ...(data?.history || []).flatMap((h) =>
            [h.before?.teacher, h.after?.teacher].filter(
              (x): x is string => !!x,
            ),
          ),
        ]),
      ).sort((a, b) => a.localeCompare(b)),
    [data],
  )
  const coverage = useMemo(() => {
    const counts = new Map<string, number>()
    for (const n of data?.notes || []) {
      if (n.visible) counts.set(n.teacher, (counts.get(n.teacher) || 0) + 1)
    }
    return counts
  }, [data])
  function go(r: Route, query: Record<string, string> = {}) {
    const p = new URLSearchParams(query),
      next =
        '/admin' +
        (r === 'overview' ? '' : '/' + r) +
        (p.size ? '?' + p.toString() : '')
    history.pushState(null, '', next)
    setLocationKey(location.href)
    setDrawer(false)
    setDraft(null)
    setNotice('')
    window.scrollTo(0, 0)
    mainRef.current?.focus()
  }
  function toggle() {
    try {
      localStorage.setItem('council-sidebar', collapsed ? 'wide' : 'compact')
    } catch {
      /* preference is optional */
    }
    setCollapsed(!collapsed)
  }
  async function enter() {
    setChecking(true)
    try {
      await api('/api/demo/admin', {})
      await refresh()
    } catch (err) {
      setGate({ message: emptyMessage(err), demo: true })
    } finally {
      setChecking(false)
    }
  }
  const navigation = (
    <nav aria-label="Council navigation">
      {sections.map(([key, title, icon]) => (
        <a
          key={key}
          href={'/admin' + (key === 'overview' ? '' : '/' + key)}
          aria-current={route === key ? 'page' : undefined}
          aria-label={title}
          data-tip={title}
          onClick={(e) => {
            if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
              e.preventDefault()
              go(key)
            }
          }}
        >
          <Icon name={icon} />
          <span>{title}</span>
        </a>
      ))}
    </nav>
  )
  if (!data)
    return (
      <main className="adm adm-gate">
        <section>
          <div className="adm-gatebrand">
            <Mark />
            STJBS Student Council
          </div>
          <h1>Council desk</h1>
          {gate ? (
            <>
              <h2>{gate.demo ? 'Local demo' : 'Administrator access'}</h2>
              <p>
                {gate.demo
                  ? 'Open the council workspace with an isolated demonstration identity. The wall uses synthetic notes.'
                  : gate.message}
              </p>
              <div className="adm-actions">
                {gate.demo ? (
                  <button
                    className="adm-primary"
                    disabled={checking}
                    onClick={() => void enter()}
                  >
                    {checking ? 'Opening…' : 'Enter demo admin'}
                    <Icon name="arrow" />
                  </button>
                ) : (
                  <button
                    className="adm-primary"
                    onClick={() => location.reload()}
                  >
                    Retry access
                  </button>
                )}
                <a href="/">Teacher wall</a>
              </div>
              {gate.demo &&
                checking === false &&
                gate.message &&
                !/unauthori|sign in|authenti|admin.*required|admin.*access/i.test(
                  gate.message,
                ) && <StateError message={gate.message} />}
            </>
          ) : (
            <p aria-live="polite">Checking administrator access…</p>
          )}
        </section>
      </main>
    )
  return (
    <div className={'adm adm-shell' + (collapsed ? ' adm-compact' : '')}>
      <a className="adm-skip" href="#adm-main">
        Skip to workspace
      </a>
      <aside className="adm-side">
        <div className="adm-brand">
          <Mark />
          <span>
            STJBS<small>Student Council</small>
          </span>
        </div>
        {navigation}
        <div className="adm-sidefoot">
          <a href="/" data-tip="Teacher wall" aria-label="View teacher wall">
            <Icon name="out" />
            <span>View teacher wall</span>
          </a>
          <button
            data-tip={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={toggle}
          >
            <Icon name={collapsed ? 'expand' : 'collapse'} />
            <span>Collapse sidebar</span>
          </button>
        </div>
      </aside>
      <div className="adm-body">
        <header className="adm-top">
          <div>
            <button
              className="adm-mobile-toggle adm-iconbtn"
              aria-label="Open navigation"
              onClick={() => setDrawer(true)}
            >
              <Icon name="menu" />
            </button>
            <span>Council desk</span>
            <i>/</i>
            <strong>{label}</strong>
          </div>
          <div>
            {data.demo && <span className="adm-demo">Local demo</span>}
            <span className="adm-topidentity" title={data.identity}>
              <Icon name="access" />
              <span>Council admin</span>
            </span>
          </div>
        </header>
        <main id="adm-main" ref={mainRef} tabIndex={-1} className="adm-main">
          <div className="adm-pagehead">
            <div>
              <h1>{label}</h1>
              <p>{descriptions[route]}</p>
            </div>
            {(route === 'overview' || route === 'notes') && (
              <button
                className="adm-primary"
                onClick={() =>
                  setDraft({
                    id: crypto.randomUUID(),
                    teacher: params.get('teacher') || '',
                    text: '',
                    visible: true,
                    base: null,
                  })
                }
              >
                <Icon name="plus" />
                Add note
              </button>
            )}
          </div>
          {warning && (
            <div role="alert" className="adm-warn">
              {warning}{' '}
              <button onClick={() => void refresh().catch(() => {})}>
                Refresh
              </button>
            </div>
          )}
          {notice && (
            <p className="adm-notice" role="status">
              <Icon name="check" />
              {notice}
            </p>
          )}
          {route === 'overview' && (
            <Overview
              data={data}
              teachers={teachers}
              coverage={coverage}
              go={go}
            />
          )}
          {route === 'notes' && (
            <Notes
              key={locationKey}
              notes={data.notes}
              teachers={teachers}
              params={params}
              onEdit={(n) =>
                setDraft({
                  id: n.id,
                  text: n.text,
                  teacher: n.teacher,
                  visible: n.visible,
                  base: n,
                })
              }
            />
          )}
          {route === 'teachers' && (
            <Teachers
              key={locationKey}
              notes={data.notes}
              teachers={teachers}
              coverage={coverage}
              initialLow={params.get('coverage') === 'low'}
              open={(t) => go('notes', { teacher: t })}
            />
          )}
          {route === 'history' && (
            <History
              key={locationKey}
              data={data}
              initialChange={params.get('change')}
              mutate={mutate}
              notify={setNotice}
              refresh={refresh}
            />
          )}
          {route === 'backup' && <Backup mutate={mutate} notify={setNotice} />}
          {route === 'access' && (
            <Access data={data} mutate={mutate} notify={setNotice} />
          )}
        </main>
      </div>
      {draft && (
        <Editor
          initial={draft}
          teachers={teachers}
          coverage={coverage}
          data={data}
          mutate={mutate}
          refresh={refresh}
          close={() => setDraft(null)}
          saved={() => {
            setDraft(null)
            setNotice('Note saved. The wall has been updated.')
          }}
        />
      )}
      {drawer && (
        <Dialog title="Council navigation" onClose={() => setDrawer(false)}>
          <div className="adm-drawnav">
            {navigation}
            <a href="/">
              <Icon name="out" />
              View teacher wall
            </a>
          </div>
        </Dialog>
      )}
    </div>
  )
}
