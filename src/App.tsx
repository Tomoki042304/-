import './App.css'
import './lib/supabaseClient'
import ConnectionCheck from './ConnectionCheck'

function App() {
  if (new URLSearchParams(window.location.search).get('check') === 'connection') {
    return <ConnectionCheck />
  }

  return (
    <main className="welcome">
      <p className="eyebrow">SHIDOROKU</p>
      <h1>志動録</h1>
      <p className="concept">志を言葉にし、行動で証明する</p>
      <p className="notice">ただいま準備中です。</p>
    </main>
  )
}

export default App
