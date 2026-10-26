import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from './lib/supabaseClient'
import { readMotto, saveMotto, validateMotto, type Motto } from './lib/motto'

export default function MemberMotto({ userId, enabled }: { userId: string; enabled: boolean }) {
  const [motto, setMotto] = useState<Motto | null>(null)
  const [draft, setDraft] = useState('')
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [saving, setSaving] = useState(false)
  const [needsReload, setNeedsReload] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const dirty = useRef(false)
  const inFlight = useRef(false)
  const request = useRef<AbortController | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; request.current?.abort() }
  }, [])

  const load = useCallback(async () => {
    if (!supabase || inFlight.current) return
    inFlight.current = true
    setPhase('loading')
    setError('')
    setMessage('')
    const controller = new AbortController()
    request.current = controller
    const timer = window.setTimeout(() => controller.abort(), 10000)
    try {
      const latest = await readMotto(supabase, userId, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setMotto(latest)
      if (!dirty.current) setDraft(latest?.content ?? '')
      else setMessage('最新の保存内容を確認しました。入力中の内容は保持しています。')
      setNeedsReload(false)
      setPhase('ready')
    } catch {
      if (mounted.current) {
        setPhase('error')
        setError('志言を読み込めませんでした。通信状態を確認して再試行してください。')
      }
    } finally {
      window.clearTimeout(timer)
      inFlight.current = false
      if (mounted.current && controller.signal.aborted) {
        setPhase('error')
        setError('読み込みを確認できませんでした。再試行してください。')
      }
    }
  }, [userId])

  useEffect(() => {
    if (enabled && phase === 'idle') void load()
  }, [enabled, phase, load])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !enabled || phase !== 'ready' || needsReload || inFlight.current) return
    const validation = validateMotto(draft)
    setMessage('')
    setError(validation.error ?? '')
    if (validation.error) return
    inFlight.current = true
    setSaving(true)
    const controller = new AbortController()
    request.current = controller
    const timer = window.setTimeout(() => controller.abort(), 10000)
    try {
      const saved = await saveMotto(supabase, userId, draft, motto, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setMotto(saved)
      setDraft(saved.content)
      dirty.current = false
      setMessage('志言を保存しました。')
    } catch {
      if (mounted.current) {
        setNeedsReload(true)
        setError('保存を確認できませんでした。入力内容は保持しています。「志言の最新情報を確認」で保存済みの内容を確認してください。')
      }
    } finally {
      window.clearTimeout(timer)
      inFlight.current = false
      if (mounted.current) {
        setSaving(false)
        if (controller.signal.aborted) {
          setNeedsReload(true)
          setError('保存結果を確認できませんでした。通信が戻ったら「志言の最新情報を確認」を押してください。')
        }
      }
    }
  }

  // Keep draft state across the parent's periodic membership check, but never
  // render private content or accept a save until access is confirmed again.
  if (!enabled) return null

  return <section className="profile-section motto-section" aria-labelledby="motto-heading">
    <h2 id="motto-heading">志言</h2>
    {(phase === 'idle' || phase === 'loading') && <p role="status">志言を読み込んでいます…</p>}
    {phase === 'ready' && <>
      <p className="auth-note">{motto ? '保存済みの志言' : '大切にしている言葉を登録してください。'}</p>
      {motto && <blockquote className="motto-text">{motto.content}</blockquote>}
      <form onSubmit={save}>
        <label htmlFor="motto-content">志言</label>
        <textarea id="motto-content" rows={5} aria-describedby="motto-content-help"
          value={draft} disabled={saving} onChange={event => {
            setDraft(event.target.value); dirty.current = true; setMessage(''); setError('')
          }} />
        <p id="motto-content-help" className="field-help">{Array.from(draft.trim()).length} / 500文字。現在は本人だけが閲覧できます。</p>
        <button className="primary-button" type="submit" disabled={saving || needsReload}>
          {saving ? '保存中…' : '志言を保存'}
        </button>
      </form>
    </>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <button className="secondary-button" type="button" disabled={saving || phase === 'loading' || phase === 'idle'}
      onClick={() => void load()}>志言の最新情報を確認</button>
  </section>
}
