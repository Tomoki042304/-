// ============================================================
// Supabase の接続設定（志動録 / IKIGAI）
//
// ここに書くのは「公開してよい値」だけです。
//   ・Project URL
//   ・Publishable key（sb_publishable_ で始まる鍵）
// 「Secret key（sb_secret_ で始まる鍵）」や service_role の鍵は、
// このファイルにも、ほかのどのファイルにも絶対に書かないでください。
// （秘密の鍵は、あとで Netlify の管理画面の環境変数にだけ登録します）
// ============================================================

// Supabase 公式の JavaScript クライアント（バージョン固定）は、接続してよいと確かめられたときだけ下で読み込みます
const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.3/+esm";

// ==== 本番の接続先：ここから（公開用フォルダのテスト版では、tools/build-dist.py がこの間を空の値にします） ====
export const SUPABASE_URL = "https://ebozxwiuujrnvmxienat.supabase.co";

// ↓↓↓ ここに Publishable key を貼り付けてください（" " の中だけを置き換えます）↓↓↓
export const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_mJ6vFykk8ykbAmm2LaEEuA_Ea5n4yp8";
// ↑↑↑ sb_publishable_ で始まる鍵です。sb_secret_ で始まる鍵は貼らないでください ↑↑↑
// ==== 本番の接続先：ここまで ====

// ------------------------------------------------------------
// 接続先の決め方（確かめられないときは、どこにもつながずに止まる）
//   ・手元（localhost / 127.0.0.1）… テスト用（supabase-config.local.js）だけ。本番には切り替えない
//   ・PRODUCTION_HOSTS に書いた公開先 … 本番（上の2つの値）
//   ・STAGING_HOSTS に書いたテスト公開先 … テスト用（下の「テスト公開先の接続先」）だけ。https のときだけ
//   ・それ以外の場所 ……………………… 接続しない
// ------------------------------------------------------------
// 本番とテストの見分けは「指紋」（SHA-256）で行う。指紋から Project ID や鍵を割り出すことはできない
const PROD_REF_SHA256 = "73f027720a32d56428ef175ed6cca9bff53b39d2fffe294d523649781d3ec278";
const PROD_KEY_SHA256 = "b121f1518ca854eacbe93df51928514b3c92fd557b411916a3187da73862abe9";
// 手元から接続してよいテスト環境（imge…）の指紋。これと一致しないテスト環境には接続しない
const TEST_REF_SHA256 = "0939b29384c6442b04d4413f3917d085f484abc611e6079ad9a6d231d9d1680e";
const LOCAL_HOSTS = ["localhost", "127.0.0.1"];
// 本番として扱う公開先のホスト名。公開先が決まるまでは空のまま（＝どこからも本番につながらない）
const PRODUCTION_HOSTS = ["ikigai-shidoroku.pages.dev"];

// ==== テスト公開先の接続先：ここから（元のファイルでは空。tools/build-dist.py --staging のときだけ値が入る） ====
const STAGING_HOSTS = [];
const STAGING_SUPABASE_URL = "";
const STAGING_SUPABASE_PUBLISHABLE_KEY = "";
// ==== テスト公開先の接続先：ここまで ====

// "https://<20文字>.supabase.co" の形のときだけ Project ID を返す（それ以外は null）
function projectRef(url) {
  try {
    const u = new URL(String(url)), m = /^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
    return m && u.protocol === "https:" && !u.port && (u.pathname === "/" || u.pathname === "") && !u.search && !u.hash ? m[1] : null;
  } catch { return null; }
}
// 計算できない環境では null（呼び出し側は止まる）
async function sha256(text) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
  } catch { return null; }
}

// テスト環境の接続先を確かめる（手元とテスト公開先で同じ確かめをする）
async function checkTest(url, key, stop) {
  if (!/^https:\/\/[a-z0-9]{20}\.supabase\.co$/.test(url)) return stop("テスト用の Project URL の形が正しくありません。");
  const ref = projectRef(url), refHash = ref && await sha256(ref), keyHash = await sha256(key);
  if (!refHash || !keyHash) return stop("接続先を確かめる計算ができませんでした。");
  if (refHash === PROD_REF_SHA256) return stop("テスト用の設定に、本番の Project URL が入っています。");
  if (refHash !== TEST_REF_SHA256) return stop("許可されていないテスト環境です。");
  if (!key.startsWith("sb_publishable_")) return stop("テスト用の鍵が sb_publishable_ で始まっていません。");
  if (keyHash === PROD_KEY_SHA256) return stop("テスト用の設定に、本番の鍵が入っています。");
  return { env: "test", url, key };
}

async function resolveTarget() {
  const host = location.hostname;
  const stop = reason => ({ stop: reason });

  if (LOCAL_HOSTS.includes(host)) {
    let t;
    // ?v=… : read the file itself every time, never an old copy the browser kept
    const localFile = `./supabase-config.local.js?v=${Date.now()}`;
    // tell "the local server is not running" apart from "the file is missing"
    try {
      const res = await fetch(localFile, { method: "HEAD", cache: "no-store" });
      if (!res.ok) return stop("テスト用の設定ファイル（supabase-config.local.js）がありません。.env.local を用意して tools/make-local-config.py を実行してください。");
    } catch { return stop("手元のサーバー（localhost:8765）につながりません。サーバーを起動してから、ページを再読み込みしてください。"); }
    try { t = await import(localFile); }
    catch { return stop("テスト用の設定ファイル（supabase-config.local.js）がありません。.env.local を用意して tools/make-local-config.py を実行してください。"); }
    return checkTest(String(t.TEST_SUPABASE_URL || ""), String(t.TEST_SUPABASE_PUBLISHABLE_KEY || ""), stop);
  }
  if (STAGING_HOSTS.includes(host)) {
    if (location.protocol !== "https:") return stop("テスト公開先は https のときだけ接続します。");
    if (PRODUCTION_HOSTS.includes(host)) return stop("同じ場所が、本番とテスト公開先の両方に書かれています。");
    return checkTest(STAGING_SUPABASE_URL, STAGING_SUPABASE_PUBLISHABLE_KEY, stop);
  }
  if (PRODUCTION_HOSTS.includes(host) && location.protocol === "https:") {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return stop("この公開用ファイルには本番の接続先が入っていません。");
    return { env: "production", url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY };
  }
  return stop(`この場所（${host || "ファイルを直接開いた状態"}）からの接続は許可されていません。`);
}

const target = await resolveTarget();

// "test" / "production"、止まったときは null
export const SUPABASE_ENV = target.env || null;
// 止まった理由（つながったときは空）
export const SUPABASE_STOP_REASON = target.stop || "";
// テスト公開先でテスト環境につないだとき true
export const SUPABASE_ON_STAGING = target.env === "test" && STAGING_HOSTS.includes(location.hostname);
// 画面に出す短い目印（例：imge…）
export const SUPABASE_PROJECT_LABEL = target.url ? new URL(target.url).host.slice(0, 4) + "…" : "";

export const supabaseConfigured = !!target.url;

// アプリ全体で1つだけ使う Supabase の接続口（止まったときは作らない）
export const supabase = target.url
  ? (await import(SUPABASE_JS)).createClient(target.url, target.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    })
  : null;
