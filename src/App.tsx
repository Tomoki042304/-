import './App.css'
import './lib/supabaseClient'
import ConnectionCheck from './ConnectionCheck'
import { useEffect, useState } from 'react'
import MemberAccess from './MemberAccess'

function App() {
  const [route, setRoute] = useState(window.location.hash)
  useEffect(() => {
    const navigate = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', navigate)
    return () => window.removeEventListener('hashchange', navigate)
  }, [])

  if (new URLSearchParams(window.location.search).get('check') === 'connection') {
    return <ConnectionCheck />
  }

  if (route === '#/login' || route === '#/member') return <MemberAccess />

  return (
    <main className="welcome">
      <p className="eyebrow">SHIDOROKU</p>
      <h1>志動録</h1>
      <p className="concept">志を言葉にし、行動で証明する</p>
      <p className="notice">ただいま準備中です。</p>
      <a className="login-link" href="#/login">会員ログイン</a>
    </main>
  )
}

export default App
