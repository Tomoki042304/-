import { useEffect, useState, type FormEvent } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabaseClient'
import { isActiveMembership, type Membership } from './lib/membership'
import MemberProfile from './MemberProfile'

type Access =
  | { state: 'checking' }
  | { state: 'allowed'; membership: Membership }
  | { state: 'denied' | 'error'; message: string }

export default function MemberAccess() {
  const [session, setSession] = useState<Session | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [access, setAccess] = useState<Access>({ state: 'checking' })
  const [refresh, setRefresh] = useState(0)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) return
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setAccess({ state: 'checking' })
      setSession(nextSession)
      setAuthReady(true)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !session) return
    const client = supabase
    const controller = new AbortController()
    setAccess({ state: 'checking' })
    const timer = window.setTimeout(() => {
      controller.abort()
      setAccess({ state: 'error', message: '会員情報の確認がタイムアウトしました。再試行してください。' })
    }, 10000)

    async function verify() {
      try {
        const { data: { user }, error: userError } = await client.auth.getUser()
        if (controller.signal.aborted) return
        if (userError || !user || user.id !== session?.user.id) {
          setAccess({ state: 'error', message: 'ログイン状態を確認できませんでした。ログインし直してください。' })
          return
        }
        const { data, error: membershipError } = await client.from('shidoroku_memberships')
          .select('user_id,member_id,role,status').eq('user_id', user.id)
          .abortSignal(controller.signal).maybeSingle()
        if (controller.signal.aborted) return
        if (membershipError) {
          setAccess({ state: 'error', message: '会員情報を確認できませんでした。通信状態を確認して再試行してください。' })
        } else if (isActiveMembership(data, user.id)) {
          setAccess({ state: 'allowed', membership: data })
        } else {
          setAccess({ state: 'denied', message: 'このアカウントは現在ご利用いただけません。運営にお問い合わせください。' })
        }
      } catch {
        if (!controller.signal.aborted) {
          setAccess({ state: 'error', message: '会員情報を確認できませんでした。再試行してください。' })
        }
      } finally {
        window.clearTimeout(timer)
      }
    }
    void verify()
    return () => { controller.abort(); window.clearTimeout(timer) }
  }, [session, refresh])

  useEffect(() => {
    if (!session) return
    const recheck = () => {
      setAccess({ state: 'checking' })
      setRefresh(value => value + 1)
    }
    const visibility = () => {
      if (document.visibilityState === 'visible') recheck()
      else setAccess({ state: 'checking' })
    }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', visibility)
    const timer = window.setInterval(recheck, 60000)
    return () => {
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', visibility)
      window.clearInterval(timer)
    }
  }, [session])

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || busy) return
    setBusy(true)
    setError('')
    try {
      const { error: loginError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (loginError) {
        setError('ログインできませんでした。入力内容と通信状態を確認してください。')
      } else {
        setPassword('')
        window.location.hash = '/member'
      }
    } catch {
      setError('通信できませんでした。時間をおいて再度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    if (!supabase || busy) return
    setBusy(true)
    setAccess({ state: 'checking' })
    setPassword('')
    try {
      // Invalidate this session only, not other sessions in the shared Auth project.
      await supabase.auth.signOut({ scope: 'local' })
    } catch {
      // A network failure must not prevent clearing the memory-only browser session.
    } finally {
      // Auth is memory-only. Reload also clears it when server logout fails.
      window.location.replace(window.location.pathname + '#/login')
      window.location.reload()
    }
  }

  if (!supabase) {
    return <main className="auth-page"><section className="auth-card">
      <h1>会員ログイン</h1>
      <p role="status">ログインの準備が整っていません。時間をおいてお試しください。</p>
      <a href="#/">トップへ戻る</a>
    </section></main>
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <a className="eyebrow brand" href="#/">SHIDOROKU</a>
        {!authReady ? <><h1>確認中</h1><p role="status">ログイン状態を確認しています…</p></> : !session ? <>
          <h1>会員ログイン</h1>
          <p className="auth-intro">登録済みのメールアドレスでログインしてください。</p>
          <form onSubmit={login}>
            <label htmlFor="email">メールアドレス</label>
            <input id="email" type="email" autoComplete="username" required maxLength={254}
              value={email} onChange={event => setEmail(event.target.value)} disabled={busy} />
            <label htmlFor="password">パスワード</label>
            <input id="password" type="password" autoComplete="current-password" required
              value={password} onChange={event => setPassword(event.target.value)} disabled={busy} />
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="primary-button" type="submit" disabled={busy}>{busy ? '確認中…' : 'ログイン'}</button>
          </form>
          <p className="auth-note">会員登録やパスワードのお問い合わせは運営へご連絡ください。</p>
          <p className="auth-note">現在、再読み込みや画面を閉じた後は再ログインが必要です。</p>
        </> : <>
          <h1>{access.state === 'allowed' ? '会員ホーム' : '会員確認'}</h1>
          {access.state === 'checking' && <p role="status">会員情報を確認しています…</p>}
          {access.state === 'allowed' && <>
            <p>志動録へようこそ。</p>
            <p className="member-id">会員ID：{access.membership.member_id}</p>
          </>}
          <MemberProfile key={session.user.id} userId={session.user.id} enabled={access.state === 'allowed'} />
          {(access.state === 'denied' || access.state === 'error') && <p role="alert">{access.message}</p>}
          {access.state === 'error' && <button className="primary-button" type="button"
            onClick={() => { setAccess({ state: 'checking' }); setRefresh(value => value + 1) }}>再試行</button>}
          <button className="secondary-button" type="button" onClick={() => void logout()} disabled={busy}>
            {busy ? '処理中…' : 'ログアウト'}
          </button>
        </>}
      </section>
    </main>
  )
}
