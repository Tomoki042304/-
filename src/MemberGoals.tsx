import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { supabase } from './lib/supabaseClient'
import { goalInput, listGoals, readGoal, saveGoal, validateGoal, type Goal, type GoalInput } from './lib/goals'

type Editor = { id: string; previous: Goal | null; input: GoalInput; dirty: boolean; needsReload: boolean }
const emptyInput: GoalInput = { title: '', description: '', targetDate: '', status: 'in_progress' }

export default function MemberGoals({ userId, enabled }: { userId: string; enabled: boolean }) {
  const [goals, setGoals] = useState<Goal[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [listError, setListError] = useState('')
  const [editor, setEditor] = useState<Editor | null>(null)
  const [saving, setSaving] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const listBusy = useRef(false)
  const editBusy = useRef(false)
  const listRequest = useRef<AbortController | null>(null)
  const editRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; listRequest.current?.abort(); editRequest.current?.abort() }
  }, [])

  const load = useCallback(async (offset = 0) => {
    if (!supabase || listBusy.current) return
    listBusy.current = true
    setPhase('loading'); setListError('')
    const controller = new AbortController(); listRequest.current = controller
    const timer = window.setTimeout(() => controller.abort(), 10000)
    try {
      const page = await listGoals(supabase, userId, offset, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setGoals(current => offset === 0 ? page.goals : [...new Map([...current, ...page.goals].map(goal => [goal.id, goal])).values()])
      setHasMore(page.hasMore); setPhase('ready')
    } catch {
      if (mounted.current) { setPhase('error'); setListError('目標を読み込めませんでした。通信状態を確認して再試行してください。') }
    } finally {
      window.clearTimeout(timer); listBusy.current = false
      if (mounted.current && controller.signal.aborted) { setPhase('error'); setListError('目標の読み込みを確認できませんでした。再試行してください。') }
    }
  }, [userId])

  useEffect(() => { if (enabled && phase === 'idle') void load() }, [enabled, phase, load])

  function open(goal: Goal | null) {
    if (!enabled || editor || phase !== 'ready') return
    setEditor({ id: goal?.id ?? crypto.randomUUID(), previous: goal, input: goal ? goalInput(goal) : { ...emptyInput }, dirty: false, needsReload: false })
    setMessage(''); setError('')
  }

  function change<K extends keyof GoalInput>(field: K, value: GoalInput[K]) {
    setEditor(current => current ? { ...current, input: { ...current.input, [field]: value }, dirty: true } : null)
    setMessage(''); setError('')
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !enabled || !editor || editor.needsReload || editBusy.current || phase === 'loading') return
    const validation = validateGoal(editor.input)
    setError(validation.error ?? ''); setMessage('')
    if (validation.error) return
    editBusy.current = true; setSaving(true)
    const controller = new AbortController(); editRequest.current = controller
    const timer = window.setTimeout(() => controller.abort(), 10000)
    try {
      const saved = await saveGoal(supabase, userId, editor.id, editor.input, editor.previous, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      setEditor({ id: saved.id, previous: saved, input: goalInput(saved), dirty: false, needsReload: false })
      setMessage('目標を保存しました。')
      // Refresh the first page without unmounting or changing the editor.
      void load()
    } catch {
      if (mounted.current) {
        setEditor(current => current ? { ...current, needsReload: true } : null)
        setError('保存を確認できませんでした。入力は保持しています。「この目標の保存内容を確認」で確認してから再試行してください。')
      }
    } finally {
      window.clearTimeout(timer); editBusy.current = false
      if (mounted.current) {
        setSaving(false)
        if (controller.signal.aborted) {
          setEditor(current => current ? { ...current, needsReload: true } : null)
          setError('保存結果を確認できませんでした。通信が戻ったら、この目標の保存内容を確認してください。')
        }
      }
    }
  }

  async function refreshEditor() {
    if (!supabase || !enabled || !editor || editBusy.current) return
    editBusy.current = true; setChecking(true); setError(''); setMessage('')
    const controller = new AbortController(); editRequest.current = controller
    const timer = window.setTimeout(() => controller.abort(), 10000)
    try {
      const latest = await readGoal(supabase, userId, editor.id, controller.signal)
      if (!mounted.current || controller.signal.aborted) return
      if (!latest && editor.previous) throw new Error('Existing goal unavailable')
      setEditor(current => current ? { ...current, previous: latest, needsReload: false,
        input: current.dirty ? current.input : latest ? goalInput(latest) : { ...emptyInput } } : null)
      setMessage('保存内容を確認しました。入力中の内容は保持しています。')
    } catch {
      if (mounted.current) {
        setEditor(current => current ? { ...current, needsReload: true } : null)
        setError('目標の保存内容を確認できませんでした。入力は保持しています。')
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

  // State stays in this component while the membership gate temporarily hides it.
  if (!enabled) return null
  const busy = saving || checking
  return <section className="profile-section goals-section" aria-labelledby="goals-heading">
    <h2 id="goals-heading">夢・目標</h2>
    <p className="auth-note">現在は本人だけが閲覧できます。</p>
    {(phase === 'idle' || phase === 'loading') && <p role="status">目標を読み込んでいます…</p>}
    {listError && <p className="auth-error" role="alert">{listError}</p>}
    {phase === 'ready' && goals.length === 0 && <p>まだ目標がありません。</p>}
    <ul className="goal-list">
      {goals.map(goal => <li key={goal.id}>
        <h3>{goal.title}</h3>
        <p>{goal.status === 'achieved' ? '達成' : '取り組み中'}{goal.target_date ? ` ／ 目標日：${goal.target_date}` : ''}</p>
        {goal.description && <p className="goal-description">{goal.description}</p>}
        <button className="secondary-button" type="button" disabled={!!editor || phase !== 'ready'}
          aria-label={`「${goal.title}」を編集`} onClick={() => open(goal)}>編集</button>
      </li>)}
    </ul>
    {hasMore && <button className="secondary-button" type="button" disabled={phase !== 'ready' || busy || !!editor}
      onClick={() => void load(goals.length)}>目標をさらに表示</button>}
    <button className="secondary-button" type="button" disabled={phase === 'loading' || phase === 'idle' || busy || !!editor}
      onClick={() => void load()}>目標一覧を更新</button>
    <button className="primary-button" type="button" disabled={!!editor || phase !== 'ready'} onClick={() => open(null)}>目標を追加</button>

    {editor && <div className="goal-editor">
      <h3>{editor.previous ? '目標を編集' : '新しい目標'}</h3>
      <form onSubmit={save}>
        <label htmlFor="goal-title">目標のタイトル</label>
        <input id="goal-title" value={editor.input.title} disabled={busy} aria-describedby="goal-title-help"
          onChange={event => change('title', event.target.value)} />
        <p id="goal-title-help" className="field-help">120文字以内</p>
        <label htmlFor="goal-description">補足（任意）</label>
        <textarea id="goal-description" rows={4} value={editor.input.description} disabled={busy}
          aria-describedby="goal-description-help" onChange={event => change('description', event.target.value)} />
        <p id="goal-description-help" className="field-help">2000文字以内</p>
        <label htmlFor="goal-date">目標日（任意）</label>
        <input id="goal-date" type="date" min="0001-01-01" max="9999-12-31" value={editor.input.targetDate}
          disabled={busy} onChange={event => change('targetDate', event.target.value)} />
        <label htmlFor="goal-status">目標の状態</label>
        <select id="goal-status" value={editor.input.status} disabled={busy}
          onChange={event => change('status', event.target.value as GoalInput['status'])}>
          <option value="in_progress">取り組み中</option><option value="achieved">達成</option>
        </select>
        <button className="primary-button" type="submit" disabled={busy || editor.needsReload || phase === 'loading'}>{saving ? '保存中…' : '目標を保存'}</button>
      </form>
      {error && <p className="auth-error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      <button className="secondary-button" type="button" disabled={busy} onClick={() => void refreshEditor()}>
        {checking ? '確認中…' : 'この目標の保存内容を確認'}
      </button>
      <button className="secondary-button" type="button" disabled={busy}
        onClick={() => { setEditor(null); setMessage(''); setError('') }}>{editor.dirty ? '入力を破棄して閉じる' : '編集を閉じる'}</button>
    </div>}
  </section>
}
