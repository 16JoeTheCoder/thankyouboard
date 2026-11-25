import { useEffect, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  PenLine,
  Send,
  MailCheck,
} from 'lucide-react'

export function RoleChoice() {
  return (
    <div className="gate-copy role-choice">
      <h1>
        Teacher
        <br />
        <em>Appreciation</em>
        <br />
        Wall<span>.</span>
      </h1>
      <p>Are you a student or a teacher?</p>
      <div className="role-links">
        <a
          href="/student"
          aria-labelledby="entry-student"
          aria-describedby="help-student"
        >
          <PenLine aria-hidden="true" />
          <span>
            <strong id="entry-student">I'm a student</strong>
            <small id="help-student">Write a thank-you note</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </a>
        <a
          href="/teacher"
          aria-labelledby="entry-teacher"
          aria-describedby="help-teacher"
        >
          <BookOpen aria-hidden="true" />
          <span>
            <strong id="entry-teacher">I'm a teacher</strong>
            <small id="help-teacher">Open the appreciation wall</small>
          </span>
          <ArrowRight aria-hidden="true" />
        </a>
      </div>
    </div>
  )
}

export function StudentForm() {
  const [teachers, setTeachers] = useState<string[] | null>(null)
  const [teacher, setTeacher] = useState(''),
    [text, setText] = useState('')
  const [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false),
    [sent, setSent] = useState(false)
  const [id, setId] = useState(() => crypto.randomUUID())
  useEffect(() => {
    const controller = new AbortController()
    setError('')
    fetch('/api/student/teachers', {
      signal: controller.signal,
      cache: 'no-store',
    })
      .then(async (r) => {
        if (!r.ok) throw Error()
        const data = await r.json()
        setTeachers(data.teachers)
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError('The teacher list could not load. Please try again.')
      })
    return () => controller.abort()
  }, [attempt])
  async function send(event: FormEvent) {
    event.preventDefault()
    if (busy || !teacher || !text.trim()) return
    setBusy(true)
    setError('')
    try {
      const response = await fetch('/api/student/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, teacher, text }),
      })
      if (!response.ok)
        throw Error(
          (await response.json()).error || 'Your note could not be sent.',
        )
      setText('')
      setSent(true)
    } catch (e) {
      setError(
        e instanceof TypeError
          ? 'Connection lost. Your note is still here. Try sending it again.'
          : e instanceof Error
            ? e.message
            : 'Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="gate-copy student-letter">
      <a className="entry-back" href="/">
        <ArrowLeft size={15} /> Back to entrance
      </a>
      {sent ? (
        <div role="status">
          <MailCheck size={32} />
          <h1>
            Your note is <em>in review.</em>
          </h1>
          <p>
            Student Council will read your note for {teacher} before it appears
            on the wall.
          </p>
          <button
            className="wall-primary"
            onClick={() => {
              setSent(false)
              setTeacher('')
              setId(crypto.randomUUID())
            }}
          >
            Write another note
          </button>
        </div>
      ) : (
        <>
          <h1>
            Write a <em>thank-you.</em>
          </h1>
          <p>
            Tell a teacher what stayed with you. Student Council reviews each
            note before sharing it on the wall.
          </p>
          <form onSubmit={send}>
            <label htmlFor="student-teacher">Teacher</label>
            <select
              id="student-teacher"
              value={teacher}
              required
              disabled={busy || !teachers?.length}
              onChange={(e) => {
                setTeacher(e.target.value)
                setId(crypto.randomUUID())
              }}
            >
              <option value="">
                {!teachers
                  ? 'Loading teachers…'
                  : teachers.length
                    ? 'Choose your teacher'
                    : 'No teachers available yet'}
              </option>
              {teachers?.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <label htmlFor="student-note">Your note</label>
            <textarea
              id="student-note"
              rows={5}
              maxLength={4000}
              required
              value={text}
              disabled={busy}
              onChange={(e) => {
                setText(e.target.value)
                setId(crypto.randomUUID())
              }}
            />
            <div className="student-count">
              {text.length.toLocaleString()} / 4,000
            </div>
            {error && (
              <p role="alert" className="wall-error">
                {error}
              </p>
            )}
            {error && !teachers && (
              <button
                type="button"
                className="wall-ghost"
                onClick={() => setAttempt((a) => a + 1)}
              >
                Reload teachers
              </button>
            )}
            <button
              className="wall-primary gate-cta"
              disabled={busy || !teacher || !text.trim()}
            >
              {busy ? 'Sending…' : 'Send for review'}
              <Send size={16} />
            </button>
          </form>
        </>
      )}
    </div>
  )
}
