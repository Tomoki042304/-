import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from './lib/supabaseClient'
import { habitInput, listHabits, readHabit, saveHabit, validateHabit, recordHabit, undoHabitLog, todayInTokyo, type Habit, type HabitInput } from './lib/habits'

type Editor = { id: string; previous: Habit | null; input: HabitInput; dirty: boolean; needsReload: boolean }
const emptyInput: HabitInput = { name: '', note: '', status: 'active' }

export default function MemberHabits({ userId, enabled }: { userId: string; enabled: boolean }) {
  const [habits, setHabits] = useState<Habit[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [listError, setListError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [day, setDay] = useState(todayInTokyo)
  const [recordPending, setRecordPending] = useState<string | null>(null)
  const [logMessage, setLogMessage] = useState('')
  const [logError, setLogError] = useState('')
  const [logNeedsReload, setLogNeedsReload] = useState(false)
  const mounted = useRef(false)
  const editBusy = useRef(false)
  const recordBusy = useRef(false)
  const listRequest = useRef<AbortController | null>(null)
  const editRequest = useRef<AbortController | null>(null)
  const logRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; listRequest.current?.abort(); editRequest.current?.abort(); logRequest.current?.abort() }
  }, [])

  useEffect(() => {
    const updateDay = () => setDay(todayInTokyo())
    const timer = window.setInterval(updateDay, 30000)
    window.addEventListener('focus', updateDay)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', updateDay) }
  }, [])

  const load = useCallback(async (offset = 0) => {
    if (!supabase) return
    listRequest.current?.abort()
    setPhase('loading'); setListError('')
    const controller = new AbortController(); listRequest.current = controller
    const timer = window.setTimeout(() => controller.abort(), 10000)
    try {
      const page = await listHabits(supabase, userId, offset, day, controller.signal)
      if (!mounted.current || controller.signal.aborted || listRequest.current !== controller) return
      setHabits(current => offset === 0 ? page.habits : [...new Map([...current, ...page.habits].map(habit => [habit.id, habit])).values()])
      setHasMore(page.hasMore); setPhase('ready'); setLogNeedsReload(false); setLogError('')
    } catch {
      if (mounted.current && listRequest.current === controller) { setPhase('error'); setListError('習慣を読み込めませんでした。通信状態を確認して再試行してください。') }
    } finally {
      window.clearTimeout(timer)
      if (mounted.current && listRequest.current === controller && controller.signal.aborted) { setPhase('error'); setListError('習慣の読み込みを確認できませんでした。再試行してください。') }
    }
  }, [userId, day])

  useEffect(() => { if (enabled) void load() }, [enabled, load])

  function open(habit: Habit | null) {
    if (!enabled || editor || phase !== 'ready' || recordBusy.current) return
    setEditor({ id: habit?.id ?? crypto.randomUUID(), previous: habit, input: habit ? habitInput(habit) : { ...emptyInput }, dirty: false, needsReload: false })
    setMessage(''); setError('')
  }

  function change<K extends keyof HabitInput>(field: K, value: HabitInput[K]) {
    setEditor(current => current ? { ...current, input: { ...current.input, [field]: value }, dirty: true } : null)
    setMessage(''); setError('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !enabled || !editor || editor.needsReload || editBusy.current || recordBusy.current || phase === 'loading') return
    const validation = validateHabit(editor.input)
    setError(validation.error ?? ''); setMessage('')
    if (validation.error) return
    editBusy.current = true; setSaving(true)
    const controller = new AbortController(); editRequest.current = controller
    const timer = window.setTimeout(() => controller.abort(), 10000)
    try {
      const saved = await saveHabit(supabase, userId, editor.id, editor.input, editor.previous, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setEditor({ id: saved.id, previous: saved, input: habitInput(saved), dirty: false, needsReload: false })
      setMessage('習慣を保存しました。')
      // Refresh the first page without unmounting or changing the editor.
      void load()
    } catch {
      if (mounted.current) {
        setEditor(current => current ? { ...current, needsReload: true } : null)
        setError('保存を確認できませんでした。入力は保持しています。「この習慣の保存内容を確認」で確認してから再試行してください。')
      }
    } finally {
      window.clearTimeout(timer); editBusy.current = false
      if (mounted.current) {
        setSaving(false)
        if (controller.signal.aborted) {
          setEditor(current => current ? { ...current, needsReload: true } : null)
          setError('保存結果を確認できませんでした。通信が戻ったら、この習慣の保存内容を確認してください。')
        }
      }
    }
  }

  async function refreshEditor() {
    if (!supabase || !enabled || !editor || editBusy.current || recordBusy.current) return
    editBusy.current = true; setChecking(true); setError(''); setMessage('')
    const controller = new AbortController(); editRequest.current = controller
    const timer = window.setTimeout(() => controller.abort(), 10000)
    try {
      const latest = await readHabit(supabase, userId, editor.id, day, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      if (!latest && editor.previous) throw new Error('Existing habit unavailable')
      setEditor(current => current ? { ...current, previous: latest, needsReload: false,
        input: current.dirty ? current.input : latest ? habitInput(latest) : { ...emptyInput } } : null)
      setMessage('保存内容を確認しました。入力中の内容は保持しています。')
    } catch {
      if (mounted.current) {
        setEditor(current => current ? { ...current, needsReload: true } : null)
        setError('習慣の保存内容を確認できませんでした。入力は保持しています。')
      }
    } finally {
      window.clearTimeout(timer); editBusy.current = false
      if (mounted.current) {
        setChecking(false)
        if (controller.signal.aborted) {
          setEditor(current => current ? { ...current, needsReload: true } : null)
          setError('保存内容の確認がタイムアウトしました。再試行してください。')
        }
      }
    }
  }

  async function toggleRecord(habit: Habit) {
    if (!supabase || !enabled || editor || editBusy.current || recordBusy.current || phase !== 'ready' || logNeedsReload) return
    const currentDay = todayInTokyo()
    if (day !== currentDay) {
      setDay(currentDay); setLogError('日付が変わりました。更新後の一覧で記録してください。'); return
    }
    const previous = habit.logs.find(log => log.log_date === day)
    if (!previous && habit.status !== 'active') return
    recordBusy.current = true; setRecordPending(habit.id); setLogMessage(''); setLogError('')
    const controller = new AbortController(); logRequest.current = controller
    const timer = window.setTimeout(() => controller.abort(), 10000)
    try {
      let recorded = null
      if (previous) await undoHabitLog(supabase, userId, habit.id, day, previous, controller.signal)
      else recorded = await recordHabit(supabase, userId, habit, day, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      const now = todayInTokyo()
      if (now !== day) {
        setDay(now); setLogMessage(`${day}の記録処理を確認しました。日付が変わったため、最新の一覧を確認してください。`)
      } else {
        const confirmed = recorded
        setHabits(current => current.map(item => item.id === habit.id
          ? { ...item, logs: [...item.logs.filter(log => log.log_date !== day), ...(confirmed ? [confirmed] : [])] } : item))
        setLogMessage(previous ? '今日の実行記録を取り消しました。' : '今日の実行を記録しました。')
      }
      // Keep the confirmed response visible even if the subsequent refresh fails.
      void load()
    } catch {
      if (mounted.current) {
        setLogNeedsReload(true)
        setLogError('記録の結果を確認できませんでした。日付・通信状態を確認し、「習慣一覧を更新」で最新の記録を確認してください。')
      }
    } finally {
      window.clearTimeout(timer); recordBusy.current = false
      if (mounted.current) {
        setRecordPending(null)
        if (controller.signal.aborted) {
          setLogNeedsReload(true)
          setLogError('記録がタイムアウトしました。自動で再送せず、習慣一覧を更新して結果を確認してください。')
        }
      }
    }
  }

  // State stays in this component while the membership gate temporarily hides it.
  if (!enabled) return null
  const busy = saving || checking || recordPending !== null
  return <section className="profile-section habits-section" aria-labelledby="habits-heading">
    <h2 id="habits-heading">習慣・実行記録</h2>
    <p className="auth-note">毎日の習慣を記録します。現在は本人だけが閲覧できます。</p>
    <p className="field-help">今日：{day}（日本時間）。記録の追加・取り消しは今日の分だけです。</p>
    {logMessage && <p role="status">{logMessage}</p>}
    {logError && <p className="auth-error" role="alert">{logError}</p>}
    {(phase === 'idle' || phase === 'loading') && <p role="status">習慣を読み込んでいます…</p>}
    {listError && <p className="auth-error" role="alert">{listError}</p>}
    {phase === 'ready' && habits.length === 0 && <p>まだ習慣がありません。</p>}
    <ul className="habit-list">
      {habits.map(habit => <li key={habit.id}>
        <h3>{habit.name}</h3>
        <p>{habit.status === 'paused' ? '休止中' : '毎日取り組む'}</p>
        {habit.note && <p className="habit-note">{habit.note}</p>}
        <p>{habit.logs.some(log => log.log_date === day) ? '今日：実行済み' : '今日：未実行'}</p>
        <p className="field-help">最近7日の実行：{habit.logs.length}日</p>
        {habit.logs.length > 0 && <p className="habit-dates">{habit.logs.map(log => log.log_date).sort().join(' ／ ')}</p>}
        <button className="primary-button" type="button"
          disabled={!!editor || busy || phase !== 'ready' || logNeedsReload || (habit.status === 'paused' && !habit.logs.some(log => log.log_date === day))}
          aria-label={`「${habit.name}」の${habit.logs.some(log => log.log_date === day) ? '今日の記録を取り消す' : '今日の実行を記録'}`}
          onClick={() => void toggleRecord(habit)}>{recordPending === habit.id ? '確認中…' : habit.logs.some(log => log.log_date === day) ? '今日の記録を取り消す' : '今日の実行を記録'}</button>
        <button className="secondary-button" type="button" disabled={!!editor || phase !== 'ready' || busy}
          aria-label={`「${habit.name}」を編集`} onClick={() => open(habit)}>編集</button>
      </li>)}
    </ul>
    {hasMore && <button className="secondary-button" type="button" disabled={phase !== 'ready' || busy || !!editor}
      onClick={() => void load(habits.length)}>習慣をさらに表示</button>}
    <button className="secondary-button" type="button" disabled={phase === 'loading' || phase === 'idle' || busy || !!editor}
      onClick={() => void load()}>習慣一覧を更新</button>
    <button className="primary-button" type="button" disabled={!!editor || phase !== 'ready' || busy} onClick={() => open(null)}>習慣を追加</button>

    {editor && <div className="habit-editor">
      <h3>{editor.previous ? '習慣を編集' : '新しい習慣'}</h3>
      <form onSubmit={save}>
        <label htmlFor="habit-name">習慣名</label>
        <input id="habit-name" value={editor.input.name} disabled={busy} aria-describedby="habit-name-help"
          onChange={event => change('name', event.target.value)} />
        <p id="habit-name-help" className="field-help">120文字以内</p>
        <label htmlFor="habit-note">補足（任意）</label>
        <textarea id="habit-note" rows={4} value={editor.input.note} disabled={busy}
          aria-describedby="habit-note-help" onChange={event => change('note', event.target.value)} />
        <p id="habit-note-help" className="field-help">1000文字以内</p>
        <label htmlFor="habit-status">習慣の状態</label>
        <select id="habit-status" value={editor.input.status} disabled={busy}
          onChange={event => change('status', event.target.value as HabitInput['status'])}>
          <option value="active">取り組む</option><option value="paused">休止中</option>
        </select>
        <button className="primary-button" type="submit" disabled={busy || editor.needsReload || phase === 'loading'}>{saving ? '保存中…' : '習慣を保存'}</button>
      </form>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button className="secondary-button" type="button" disabled={busy} onClick={() => void refreshEditor()}>
        {checking ? '確認中…' : 'この習慣の保存内容を確認'}
      </button>
      <button className="secondary-button" type="button" disabled={busy}
        onClick={() => { setEditor(null); setMessage(''); setError('') }}>{editor.dirty ? '入力を破棄して閉じる' : '編集を閉じる'}</button>
    </div>}
  </section>
}
