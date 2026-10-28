// Entry point (Supabase version): login with Supabase Auth, then a small adapter that gives app.js the
// same `window.claude.use('db' | 'user')` interface it used in the prototype (see main.js for the Firebase one).
// Data lives in public.documents as path + JSON; who may read or write what is decided by RLS (supabase/setup.sql).
import { supabase, SUPABASE_ENV, SUPABASE_STOP_REASON, SUPABASE_PROJECT_LABEL, SUPABASE_ON_STAGING } from "./supabase-config.js";

const $ = s => document.querySelector(s);
// 本番の Project ID の指紋（SHA-256）。supabase-config.js とは別に、ここでも独立して確かめる
const PROD_REF_SHA256 = "73f027720a32d56428ef175ed6cca9bff53b39d2fffe294d523649781d3ec278";
const LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
const MIN_PASS = 8;

// ---------- service worker (offline shell + "add to home screen") ----------
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

// ---------- second check before anything talks to Supabase ----------
// 本番かどうかを指紋で判定する。形が違う・計算できないときは「本番かもしれない」として true
async function isProdUrl(url) {
  try {
    const u = new URL(String(url)), m = /^([a-z0-9]{20})\.supabase\.co$/.exec(u.hostname);
    if (!m || u.protocol !== "https:" || u.port || (u.pathname !== "/" && u.pathname !== "") || u.search || u.hash) return true;
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(m[1]));
    return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("") === PROD_REF_SHA256;
  } catch { return true; }
}
async function stopReason() {
  if (!supabase) return SUPABASE_STOP_REASON || "接続先を確かめられませんでした。";
  const url = String(supabase.supabaseUrl || "");
  if (LOCAL && (SUPABASE_ENV !== "test" || await isProdUrl(url))) return "手元の環境から、テスト用以外の Supabase につなごうとしました。";
  if (SUPABASE_ENV === "test" && !LOCAL && !SUPABASE_ON_STAGING) return "テスト用の設定は、手元の環境かテスト公開先でしか使えません。";
  if (SUPABASE_ENV === "test" && await isProdUrl(url)) return "テスト用として、本番の Supabase につなごうとしました。";
  return "";
}
const stopped = await stopReason();

// test-only connection-error panel (dev-faults.js): localhost + test project + ?devtest=1 in this tab; null everywhere else
let faults = null;
if (!stopped && LOCAL && SUPABASE_ENV === "test") {
  let on = new URLSearchParams(location.search).get("devtest") === "1";
  try { if (on) sessionStorage.setItem("ikigai.devTest", "1"); else on = sessionStorage.getItem("ikigai.devTest") === "1"; } catch {}
  if (on) faults = (await import("./dev-faults.js")).setupFaults(SUPABASE_ENV);
}
// data reads and saves only; sign-in, sign-out and mail links never pass through here
const fault = kind => {
  if (faults && faults.fails(kind)) throw Object.assign(new Error("テスト用の失敗（通信エラーテスト）"), { code: "TEST_FAULT" });
};

// a small mark that stays on screen while the test project is in use
if (!stopped && SUPABASE_ENV === "test") {
  const b = $("#envBadge");
  b.textContent = `テスト環境（${SUPABASE_PROJECT_LABEL}）`;
  b.hidden = false;
}

// ---------- login screen ----------
let mode = "login";
const AUTH_ERRORS = {
  invalid_credentials: "メールアドレスかパスワードが違います",
  email_not_confirmed: "メールの確認がまだです。届いたメールのリンクを押してください",
  user_already_exists: "このメールアドレスはすでに登録されています。「ログイン」から入ってください",
  email_exists: "このメールアドレスはすでに登録されています。「ログイン」から入ってください",
  weak_password: `パスワードが短すぎるか、簡単すぎます（${MIN_PASS}文字以上）`,
  same_password: "今と同じパスワードです。別のパスワードにしてください",
  email_address_invalid: "メールアドレスの形を確認してください",
  validation_failed: "メールアドレスの形を確認してください",
  over_email_send_rate_limit: "メールの送信回数が上限に達しました。しばらく（1時間ほど）待ってからお試しください",
  over_request_rate_limit: "試行回数が多すぎます。しばらくしてからお試しください",
  signup_disabled: "現在、新規登録を受け付けていません"
};
const errText = e => {
  if (!e) return "うまくいきませんでした。もう一度お試しください";
  if (AUTH_ERRORS[e.code]) return AUTH_ERRORS[e.code];
  if (e.name === "AuthRetryableFetchError" || e.status === 0) return "通信できませんでした。電波の状況を確認してください";
  return "うまくいきませんでした。もう一度お試しください";
};
const say = (msg, ok) => { const el = $("#authErr"); el.textContent = msg; el.classList.toggle("ok", !!ok); };
const note = msg => { const el = $("#authNote"); el.textContent = msg || ""; el.hidden = !msg; };
const appUrl = () => location.origin + location.pathname;

function showAuth(which) {
  const sp = $("#splash");
  setTimeout(() => { if (sp) sp.hidden = true; $("#authScreen").hidden = false; }, 300);
  $("#authForm").hidden = which !== "login";
  $("#pwForm").hidden = which !== "password";
}
// Google login is not set up in Supabase yet
$("#authGoogle").hidden = true;
document.querySelectorAll("#authScreen .auth-alt").forEach(x => { x.hidden = true; });
$("#authPass").placeholder = `${MIN_PASS}文字以上`;

document.querySelectorAll("[data-mode]").forEach(b => b.onclick = () => {
  mode = b.dataset.mode;
  document.querySelectorAll("[data-mode]").forEach(x => x.setAttribute("aria-selected", x === b));
  $("#authSubmit").textContent = mode === "login" ? "ログイン" : "新規登録";
  $("#authPass").autocomplete = mode === "login" ? "current-password" : "new-password";
  say(""); note("");
});

if (stopped) {
  // no client, no requests: explain why and do not load the app
  const w = $("#cfgWarn");
  w.textContent = "接続を停止しました：" + stopped;
  w.hidden = false;
  showAuth("none");
} else {
  start();
}

function start() {
  const auth = supabase.auth;
  // GitHub uses the existing button styling; keep the Google provider hidden.
  const githubButton = $("#authGitHub");
  const githubIntent = "ikigai.oauth.github";
  let githubBusy = false, githubControls = [];
  // iOS may give Safari and an installed home-screen app separate login storage.
  // Guide installation before the first login; never copy sessions between contexts.
  const appleMobile = /iPad|iPhone|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const homeScreen = navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches;
  const homeGuide = $("#homeLoginGuide"), homeNote = $("#homeLoginNote");
  if (homeGuide) homeGuide.hidden = !appleMobile || homeScreen;
  if (homeNote) homeNote.hidden = !appleMobile || !homeScreen;
  if (appleMobile && !homeScreen) {
    githubButton.lastChild.textContent = "GitHubでログイン（ブラウザで利用）";
  }
  githubButton.hidden = false;
  document.querySelectorAll("#authScreen .auth-alt").forEach(x => { x.hidden = false; });
  if (SUPABASE_ENV === "production") {
    document.querySelectorAll("#authForm .auth-tabs, #authForm .field, #authSubmit, #authReset, #authResend, #authForm .auth-alt").forEach(element => { element.hidden = true; });
  }
  const restoreGitHub = () => {
    githubBusy = false;
    githubControls.forEach(([element, disabled]) => { element.disabled = disabled; });
    githubControls = [];
  };
  window.addEventListener("pageshow", event => {
    if (!event.persisted) return;
    restoreGitHub();
    try { sessionStorage.removeItem(githubIntent); } catch {}
  });
  githubButton.onclick = async () => {
    if (githubBusy) return;
    githubBusy = true;
    githubControls = [...document.querySelectorAll("#authForm button, #authForm input")].map(element => [element, element.disabled]);
    githubControls.forEach(([element]) => { element.disabled = true; });
    say(""); note(""); $("#authResend").hidden = true;
    let leaving = false;
    try {
      sessionStorage.setItem(githubIntent, "1");
      const { data, error } = await auth.signInWithOAuth({ provider: "github", options: { redirectTo: appUrl(), skipBrowserRedirect: true } });
      if (error) throw error;
      const target = new URL(data.url), expected = new URL(supabase.supabaseUrl);
      if (target.origin !== expected.origin || target.pathname !== "/auth/v1/authorize" || target.searchParams.get("provider") !== "github") throw new Error("Unexpected OAuth target");
      location.assign(target.href);
      leaving = true;
    } catch (error) {
      try { sessionStorage.removeItem(githubIntent); } catch {}
      say(errText(error));
    } finally {
      if (!leaving) restoreGitHub();
    }
  };
  // opened from the password-reset mail (index.html notes this before the link is consumed)
  let started = false, recovering = window.__recoveryLink === true;

  $("#authForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (githubBusy) return;
    try { sessionStorage.removeItem(githubIntent); } catch {}
    const email = $("#authEmail").value.trim(), pass = $("#authPass").value;
    say(""); note(""); $("#authResend").hidden = true;
    if (!email) { say("メールアドレスを入れてください"); return; }
    if (!pass) { say("パスワードを入力してください"); return; }
    if (mode === "signup" && pass.length < MIN_PASS) { say(`パスワードは${MIN_PASS}文字以上にしてください`); return; }
    const btn = $("#authSubmit"); btn.disabled = true;
    try {
      if (mode === "login") {
        const { error } = await auth.signInWithPassword({ email, password: pass });
        if (error) { say(errText(error)); if (error.code === "email_not_confirmed") $("#authResend").hidden = false; }
      } else {
        const { data, error } = await auth.signUp({ email, password: pass, options: { emailRedirectTo: appUrl() } });
        if (error) say(errText(error));
        else if (!data.session) {
          // also shown when the address is already registered, so nobody can probe which addresses exist
          note("確認メールを送りました。メールのリンクを押すと登録が完了します。届かないときは迷惑メールも確かめてください。");
          $("#authResend").hidden = false;
        }
      }
    } catch (err) { say(errText(err)); }
    finally { btn.disabled = false; }
  });

  $("#authResend").onclick = async () => {
    const email = $("#authEmail").value.trim();
    if (!email) { say("メールアドレスを入れてから押してください"); return; }
    const { error } = await auth.resend({ type: "signup", email, options: { emailRedirectTo: appUrl() } });
    if (error) say(errText(error)); else note("確認メールをもう一度送りました。");
  };

  $("#authReset").onclick = async () => {
    const email = $("#authEmail").value.trim();
    say(""); note("");
    if (!email) { say("メールアドレスを入れてから押してください"); return; }
    const { error } = await auth.resetPasswordForEmail(email, { redirectTo: appUrl() });
    if (error) say(errText(error));
    else note("パスワード再設定のメールを送りました（登録されているアドレスの場合）。メールのリンクを押してください。");
  };

  // opened from the password-reset mail: choose a new password before entering the app
  $("#pwForm").addEventListener("submit", async e => {
    e.preventDefault();
    const a = $("#pwNew").value, b = $("#pwNew2").value, err = $("#pwErr");
    err.textContent = "";
    if (a.length < MIN_PASS) { err.textContent = `パスワードは${MIN_PASS}文字以上にしてください`; return; }
    if (a !== b) { err.textContent = "2つのパスワードが一致していません"; return; }
    const btn = $("#pwSubmit"); btn.disabled = true;
    const { error } = await auth.updateUser({ password: a });
    btn.disabled = false;
    if (error) { err.textContent = errText(error); return; }
    recovering = false;
    $("#pwNew").value = $("#pwNew2").value = "";
    $("#pwForm").hidden = true;
    const { data } = await auth.getSession();
    if (data.session) launch(data.session.user);
  });

  // ---------- adapter: public.documents behind the prototype's db / user interface ----------
  const T = "documents";
  const lastPart = p => p.slice(p.lastIndexOf("/") + 1);
  const wrapDoc = (path, row) => ({ id: lastPart(path), exists: !!row, data: () => (row ? row.data : undefined), metadata: {} });
  const wrapQuery = rows => {
    const docs = rows.map(r => wrapDoc(r.path, r));
    return { docs, size: docs.length, empty: !docs.length, metadata: {} };
  };
  const fail = error => { if (error) throw error; };
  async function readDoc(path) {
    fault("read");
    const { data, error } = await supabase.from(T).select("path,data").eq("path", path).maybeSingle();
    fail(error); return data;
  }
  async function writeDoc(path, data) {
    fault("write");
    const { error } = await supabase.from(T).upsert({ path, data, updated_at: new Date().toISOString() }, { onConflict: "path" });
    fail(error);
  }
  async function readCol(path) {
    fault("read");
    const { data, error } = await supabase.from(T).select("path,data").eq("coll", path).order("path");
    fail(error); return data || [];
  }
  // live updates: on any change, read again (the payload itself is not trusted or used)
  let chan = 0;
  function watch(filter, reload, error) {
    let timer = 0, alive = true;
    const run = () => { clearTimeout(timer); timer = setTimeout(() => alive && reload().catch(e => error && error(e)), 250); };
    const ch = supabase.channel("docs-" + (++chan))
      .on("postgres_changes", { event: "*", schema: "public", table: T, filter }, run)
      .subscribe();
    const onVis = () => { if (document.visibilityState === "visible") run(); };
    document.addEventListener("visibilitychange", onVis);
    reload().catch(e => error && error(e));
    return () => { alive = false; clearTimeout(timer); document.removeEventListener("visibilitychange", onVis); supabase.removeChannel(ch); };
  }
  function docRef(path) {
    return {
      id: lastPart(path), path,
      get: async () => wrapDoc(path, await readDoc(path)),
      set: data => writeDoc(path, data),
      update: async data => { const cur = await readDoc(path); await writeDoc(path, Object.assign({}, cur ? cur.data : {}, data)); },
      delete: async () => { fault("write"); const { error } = await supabase.from(T).delete().eq("path", path); fail(error); },
      onSnapshot: (next, error) => watch(`path=eq.${path}`, async () => next(wrapDoc(path, await readDoc(path))), error),
      collection: sub => colRef(path + "/" + sub)
    };
  }
  function colRef(path) {
    return {
      path,
      doc: id => docRef(path + "/" + (id || crypto.randomUUID())),
      get: async () => wrapQuery(await readCol(path)),
      onSnapshot: (next, error) => watch(`coll=eq.${path}`, async () => next(wrapQuery(await readCol(path))), error),
      add: async data => { const r = docRef(path + "/" + crypto.randomUUID()); await r.set(data); return r; }
    };
  }
  const dbApi = { doc: docRef, collection: colRef };

  let currentUser = null;
  const rpcBool = async name => { const { data, error } = await supabase.rpc(name); return !error && data === true; };
  const userApi = {
    // the id always comes from the signed-in session, never from the screen
    id: async () => (currentUser ? currentUser.id : null),
    me: async () => ({ id: currentUser?.id || null, name: "", email: currentUser?.email || null }),
    isOwner: () => rpcBool("is_host"),          // hosts are listed in public.admins (added in the SQL Editor)
    isMember: () => rpcBool("is_member"),       // approved by a host (hosts count as approved)
    canEdit: () => rpcBool("is_host"),
    profiles: async ids => Object.fromEntries(ids.map(id => [id, { name: "" }])),
    // The RPC checks is_host() on the server and returns only the roster's current check status.
    adminMembers: {
      list: async () => {
        fault("read");
        const { data, error } = await supabase.rpc("ikigai_admin_member_status_v1");
        fail(error);
        if (!Array.isArray(data)) throw new Error("Invalid administrator roster response");
        return data;
      }
    },
    // host-only: RLS refuses these for everyone else
    approvals: {
      list: async () => {
        const { data, error } = await supabase.from("approved_members").select("user_id,approved_at");
        fail(error); return data || [];
      },
      approve: async uid => {
        const { error } = await supabase.from("approved_members").upsert({ user_id: uid }, { onConflict: "user_id", ignoreDuplicates: true });
        fail(error);
      },
      // Conditional DELETE targets one declined application only; never Auth or private data.
      removeDeclined: async uid => {
        fault("write");
        if (typeof uid !== "string" || !/^[0-9a-f-]{36}$/i.test(uid)) throw new Error("invalid user id");
        if ((await userApi.approvals.list()).some(row => row.user_id === uid)) return false;
        const { data, error } = await supabase.from(T).delete()
          .eq("path", "applications/" + uid).eq("data->>status", "declined").select("path");
        fail(error); return !!data?.length;
      },
      revoke: async uid => {
        const { error } = await supabase.from("approved_members").delete().eq("user_id", uid);
        fail(error);
      }
    }
  };

  // hooks app.js calls for logout and account deletion
  window.appAuth = {
    // app.js: load only this account's records, never this browser's leftovers, and never fall back to them
    strict: true,
    email: () => currentUser?.email || "",
    shinAi: async (payload,{signal}={}) => {
      const {data,error}=await auth.getSession();
      if(error||!data.session?.access_token)throw Error("ログインし直してください。");
      const response=await fetch("/api/shin-ai",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+data.session.access_token},body:JSON.stringify(payload),signal,cache:"no-store",redirect:"error"});
      let result;try{result=await response.json()}catch{throw Error("SHIN AIの接続準備中です。")}
      if(!response.ok)throw Error(typeof result.message==="string"?result.message:"回答を取得できませんでした。");
      if(typeof result.reply!=="string")throw Error("回答を取得できませんでした。");
      return result.reply;
    },
    signOut: () => auth.signOut(),
    // removing the login itself needs a server-side step (Netlify Functions) that is not built yet
    deleteAccount: async () => ({ ok: false, code: "needs-server" })
  };

  function launch(user) {
    currentUser = user;
    $("#authScreen").hidden = true;
    if (started) return;
    started = true;
    window.claude = { use: async name => (name === "db" ? dbApi : name === "user" ? userApi : null) };
    const s = document.createElement("script");
    s.src = "app.js";
    document.body.appendChild(s);
  }

  // came back from a mail link: report what happened (success or the reason it failed), never the token itself
  const link = window.__authLink || {};
  const LINK_ERRORS = {
    otp_expired: "確認リンクの有効期限が切れているか、すでに使われています。",
    access_denied: "確認リンクを使えませんでした。",
    flow_state_not_found: "確認リンクを、登録したときと別のブラウザで開いた可能性があります。",
    bad_code_verifier: "確認リンクを、登録したときと別のブラウザで開いた可能性があります。"
  };
  let githubReturn = false;
  try {
    githubReturn = sessionStorage.getItem(githubIntent) === "1";
    if (link.fromMail) sessionStorage.removeItem(githubIntent);
  } catch {}
  const linkChecked = link.fromMail ? auth.initialize().then(async ({ error }) => {
    const { data } = await auth.getSession();
    const ok = !!data.session && !error && !link.errorCode;
    if (githubReturn) {
      if (ok) return;
      say(errText(error));
      note(""); $("#authResend").hidden = true;
      history.replaceState(history.state, "", location.pathname);
      return;
    }
    console.info(`[認証] メールのリンク：${ok ? "成功（ログインしました）" : "失敗（" + (link.errorCode || error?.code || error?.name || "セッションなし") + "）"}`);
    if (ok) return;
    const code = link.errorCode || error?.code || "";
    say((LINK_ERRORS[code] || "確認リンクを処理できませんでした。") + `（理由：${code || error?.message || "不明"}）`);
    note("メールの確認が済んでいれば、メールアドレスとパスワードで「ログイン」できます。入れないときは、メールアドレスを入れて「確認メールをもう一度送る」を押してください。");
    $("#authResend").hidden = false;
    // drop the error marks from the address so a reload does not show this again
    history.replaceState(history.state, "", location.pathname);
  }) : Promise.resolve();

  auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY") { recovering = true; showAuth("password"); return; }
    if (!session) {
      if (started) { location.reload(); return; }   // signed out while the app was running
      showAuth("login");
      return;
    }
    currentUser = session.user;
    if (recovering) { showAuth("password"); return; }   // choose the new password first
    // run outside the auth callback (supabase-js asks not to await other calls inside it)
    setTimeout(() => launch(session.user), 0);
  });
}
