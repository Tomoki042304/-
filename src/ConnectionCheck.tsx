import { useState } from 'react'
import { checkSupabaseConnection } from './lib/checkSupabaseConnection'
import { supabaseConfiguration } from './lib/supabaseClient'

export default function ConnectionCheck() {
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('ボタンを押すと接続を確認します。')

  async function check() {
    if (checking) return
    setChecking(true)
    setMessage('確認しています…')
    try {
      const result = await checkSupabaseConnection(supabaseConfiguration)
      setMessage(result.message)
    } finally {
      setChecking(false)
    }
  }

  return (
    <main className="welcome">
      <p className="eyebrow">SHIDOROKU</p>
      <h1>接続確認</h1>
      <p className="concept">ログインやデータの取得・変更は行いません。</p>
      <button className="connection-check" type="button" onClick={check} disabled={checking}>
        {checking ? '確認中…' : '接続を確認'}
      </button>
      <p className="notice" role="status" aria-live="polite">{message}</p>
    </main>
  )
}
