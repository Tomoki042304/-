import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from './lib/supabaseClient'
import { readProfile, saveProfile, validateDisplayName, type Profile } from './lib/profile'

export default function MemberProfile({ userId, enabled }: { userId: string; enabled: boolean }) {
  const [profile, setProfile] = useState<Profile | null>(null)
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
      const latest = await readProfile(supabase, userId, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setProfile(latest)
      if (!dirty.current) setDraft(latest?.display_name ?? '')
      else setMessage('最新の保存内容を確認しました。入力中の内容は保持しています。')
      setNeedsReload(false)
      setPhase('ready')
    } catch {
      if (mounted.current) {
        setPhase('error')
        setError('プロフィールを読み込めませんでした。通信状態を確認して再試行してください。')
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
    const validation = validateDisplayName(draft)
    setMessage('')
    setError(validation.error ?? '')
    if (validation.error) return
    inFlight.current = true
    setSaving(true)
    const controller = new AbortController()
    request.current = controller
    const timer = window.setTimeout(() => controller.abort(), 10000)
    try {
      const saved = await saveProfile(supabase, userId, draft, profile, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setProfile(saved)
      setDraft(saved.display_name)
      dirty.current = false
      setMessage('表示名を保存しました。')
    } catch {
      if (mounted.current) {
        setNeedsReload(true)
        setError('保存を確認できませんでした。入力内容は保持しています。「最新情報を確認」で保存済みの内容を確認してください。')
      }
    } finally {
      window.clearTimeout(timer)
      inFlight.current = false
      if (mounted.current) {
        setSaving(false)
        if (controller.signal.aborted) {
          setNeedsReload(true)
          setError('保存結果を確認できませんでした。通信が戻ったら「最新情報を確認」を押してください。')
        }
      }
    }
  }

  // Keep draft state across the parent's periodic membership check, but never
  // render private content or accept a save until access is confirmed again.
  if (!enabled) return null

  return <section className="profile-section" aria-labelledby="profile-heading">
    <h2 id="profile-heading">プロフィール</h2>
    {(phase === 'idle' || phase === 'loading') && <p role="status">プロフィールを読み込んでいます…</p>}
    {phase === 'ready' && <>
      <p className="auth-note">{profile ? `保存済みの表示名：${profile.display_name}` : '表示名を登録してください。'}</p>
      <form onSubmit={save}>
        <label htmlFor="display-name">表示名</label>
        <input id="display-name" type="text" autoComplete="nickname" aria-describedby="display-name-help"
          value={draft} disabled={saving} onChange={event => {
            setDraft(event.target.value); dirty.current = true; setMessage(''); setError('')
          }} />
        <p id="display-name-help" className="field-help">80文字以内。現在は本人だけが閲覧できます。</p>
        <button className="primary-button" type="submit" disabled={saving || needsReload}>
          {saving ? '保存中…' : '表示名を保存'}
        </button>
      </form>
    </>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    {message && <p role="status">{message}</p>}
    <button className="secondary-button" type="button" disabled={saving || phase === 'loading' || phase === 'idle'}
      onClick={() => void load()}>最新情報を確認</button>
  </section>
}
