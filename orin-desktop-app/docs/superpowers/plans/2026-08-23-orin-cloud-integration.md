# Orin Cloud Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign the Tauri desktop app into orinai.org accounts, add an "Orin Cloud" chat provider routed through the backend's quota system, and sync settings/chats per user.

**Architecture:** New `bridge/auth.rs` and `bridge/sync.rs` modules in the Rust core perform all cloud IO (renderer never touches network). A new `orin_cloud` provider arm in `ai_impl.rs` routes `orin/*` models through `POST /api/chat`. Backend gets one new endpoint (`/api/desktop-sync`) plus two CORS origins; everything else reuses the existing password-auth + chat endpoints unchanged.

**Tech Stack:** Rust (tauri v2, reqwest, serde_json, keyring — all already dependencies), TypeScript/React 19 (zustand stores, existing bridge client), Vercel serverless (Node).

**Spec:** `docs/superpowers/specs/2026-08-23-orin-cloud-integration-design.md` (same docs tree)

## Global Constraints

- No new Cargo or npm dependencies. Existing crates cover everything.
- Signed-out state is first-class: every cloud feature degrades to today's local behavior; browser-dev mock mode (`npm run dev`) keeps working.
- API base: `https://orinai.org`, overridable at runtime via env var `ORIN_API_BASE`.
- Firebase web API key (public-safe, from backend `public/firebase-config.js`): `AIzaSyB5rY4e-_GOkkl4qwDZuvHqwq0_IP9mFmA`; project `orin-ai-f6798`.
- Refresh tokens live ONLY in the OS keyring (service `"orin-ai"`); ID tokens memory-only; sessions (non-secret) in SQLite KV key `auth.session`.
- Backend edits are in `D:\Orin_AI`, which holds the owner's staged-but-uncommitted overhaul: **make edits but do NOT commit there** — leave them in the working tree for the owner to fold into their commit decision.
- `/api/chat` plain-chat contract (verified): body `{ prompt, history: [{role, content}], ... }`, Bearer Firebase ID token, response `{ text }` (non-streaming).
- Token exchange endpoints (Firebase Identity Toolkit):
  - `POST https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=<KEY>` body `{"token":"<customToken>","returnSecureToken":true}` → `{idToken, refreshToken, expiresIn}`
  - `POST https://securetoken.googleapis.com/v1/token?key=<KEY>` body `{"grant_type":"refresh_token","refresh_token":"<rt>"}` → `{id_token, refresh_token, expires_in, user_id}`

---

### Task 1: Backend — CORS origins + `/api/desktop-sync`

**Files:**
- Modify: `D:\Orin_AI\api\_lib\http.js` (ALLOWED_ORIGINS block)
- Create: `D:\Orin_AI\api\desktop-sync.js`
- Modify: `D:\Orin_AI\firestore.rules` (append)
- Create: `D:\Orin_AI\scripts\test-desktop-sync-contract.mjs` (run later against a deploy)

**Interfaces:**
- Produces: `GET /api/desktop-sync → {blob: object|null, schemaVersion: number|null, updatedAt: string|null}` and `PUT /api/desktop-sync {blob: object, schemaVersion?: number} → {ok:true}`, both requiring `Authorization: Bearer <Firebase ID token>` (handled by `_lib/firebase.js#requireUser`). Tasks 2 and 4 consume these shapes verbatim.

- [ ] **Step 1: Add Tauri origins to the CORS allow-list**

In `D:\Orin_AI\api\_lib\http.js`, find the `ALLOWED_ORIGINS` set and add two entries after the Capacitor lines:

```js
const ALLOWED_ORIGINS = new Set([
  'https://orinai.org',
  'https://www.orinai.org',
  'https://orin-ai.vercel.app',
  // local dev servers
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
  // Capacitor / native WebViews
  'capacitor://localhost',
  'ionic://localhost',
  // Tauri v2 desktop shell (WebView2 production origin + custom protocol)
  'tauri://localhost',
  'http://tauri.localhost',
]);
```

- [ ] **Step 2: Create the endpoint**

Create `D:\Orin_AI\api\desktop-sync.js`:

```js
/**
 * GET  /api/desktop-sync — caller's desktop sync blob (or nulls if none).
 * PUT  /api/desktop-sync — replaces it. Body: { blob: object, schemaVersion? } ≤ 512 KB.
 * Auth: Firebase ID token via _lib/firebase requireUser.
 * Storage: Firestore collection `desktop_sync`, doc id = uid. Last-write-wins v1.
 */
import { db, TS, requireUser, httpError } from './_lib/firebase.js';
import { apiHandler } from './_lib/http.js';

export const config = { maxDuration: 15 };

const MAX_BYTES = 512 * 1024;

async function handler(req, res) {
  const decoded = await requireUser(req);
  const uid = decoded.uid;
  const ref = db().collection('desktop_sync').doc(uid);

  if (req.method === 'GET') {
    const snap = await ref.get();
    if (!snap.exists) return res.status(200).json({ blob: null, schemaVersion: null, updatedAt: null });
    const d = snap.data();
    return res.status(200).json({
      blob: d.blob ?? null,
      schemaVersion: d.schemaVersion ?? 1,
      updatedAt: d.updatedAt ?? null,
    });
  }

  if (req.method === 'PUT') {
    const blob = (req.body || {}).blob;
    if (!blob || typeof blob !== 'object' || Array.isArray(blob)) {
      throw httpError(400, 'body.blob must be a JSON object');
    }
    const serialized = JSON.stringify(blob);
    if (serialized.length > MAX_BYTES) {
      throw httpError(413, `Sync payload too large (${serialized.length} > ${MAX_BYTES} bytes)`);
    }
    await ref.set({
      blob,
      schemaVersion: Number((req.body || {}).schemaVersion) || 1,
      sizeBytes: serialized.length,
      updatedAt: TS(),
    });
    return res.status(200).json({ ok: true });
  }

  throw httpError(405, 'GET or PUT only');
}

export default apiHandler(handler);
```

- [ ] **Step 3: Add the Firestore rule**

Append to the end of `D:\Orin_AI\firestore.rules`:

```
// Desktop app sync blobs (Tauri client) — private per user.
match /desktop_sync/{uid} {
  allow read, write: if request.auth != null && request.auth.uid == uid;
}
```

- [ ] **Step 4: Syntax-check both JS files**

Run: `node --check "D:\Orin_AI\api\desktop-sync.js" && node --check "D:\Orin_AI\api\_lib\http.js"`
Expected: no output, exit 0.

- [ ] **Step 5: Write the deploy-time contract test (not runnable locally)**

Create `D:\Orin_AI\scripts\test-desktop-sync-contract.mjs`:

```js
// Contract test for /api/desktop-sync against a DEPLOYED environment.
// Usage: node scripts/test-desktop-sync-contract.mjs <baseUrl> <idToken>
const [base, token] = process.argv.slice(2);
if (!base || !token) { console.error('usage: node test-desktop-sync-contract.mjs <baseUrl> <idToken>'); process.exit(1); }
const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
const r1 = await fetch(`${base}/api/desktop-sync`, { headers });
console.log('GET empty →', r1.status, await r1.json());
const blob = { settings: { theme: 'dark' }, chats: [], schemaVersion: 1 };
const r2 = await fetch(`${base}/api/desktop-sync`, { method: 'PUT', headers, body: JSON.stringify({ blob }) });
console.log('PUT →', r2.status, await r2.json());
if (r2.status !== 200) process.exit(1);
const r3 = await fetch(`${base}/api/desktop-sync`, { headers });
const out = await r3.json();
console.log('GET roundtrip →', r3.status, JSON.stringify(out).slice(0, 120));
if (!out.blob || out.blob.settings.theme !== 'dark') { console.error('ROUNDTRIP MISMATCH'); process.exit(1); }
console.log('CONTRACT OK');
```

- [ ] **Step 6: Do NOT commit in D:\Orin_AI**

Leave the three edited/created files in the working tree next to the owner's staged overhaul. State this in the task report.

---

### Task 2: Rust core — `bridge/auth.rs` (sign-in, token lifecycle)

**Files:**
- Create: `orin-desktop-app/src-tauri/src/bridge/auth.rs`
- Modify: `orin-desktop-app/src-tauri/src/bridge/mod.rs` (module decl + AppState field)
- Modify: `orin-desktop-app/src-tauri/src/lib.rs` (register 4 commands)

**Interfaces:**
- Consumes: `bridge::store::{read_setting, write_setting}` (SQLite KV), keyring service `"orin-ai"`.
- Produces (commands): `auth_login(identifier: String, password: String) -> Session`, `auth_register(name: String, identifier: String, password: String) -> Session`, `auth_status() -> AuthStatus`, `auth_logout() -> ()`; internal fns used by Task 3/4: `auth::ensure_id_token(&AppState) -> Result<String, String>` and `auth::has_session(&AppState) -> bool`.
- Types: `Session { uid: String, name: String, email: String, phone: String }` (serde camelCase not needed — field names already single-word), `AuthStatus { signed_in: bool, session: Option<Session> }`.

- [ ] **Step 1: Add the AppState cache field and module declaration**

In `src-tauri/src/bridge/mod.rs`, add `pub mod auth;` to the module list and add the cache field:

```rust
pub mod agent;
pub mod ai;
pub mod ai_impl;
pub mod auth;
pub mod cu;
// ... rest unchanged

#[derive(Default)]
pub struct AppState {
    pub db_path: Mutex<Option<std::path::PathBuf>>,
    pub flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
    pub approvals: Arc<Mutex<HashMap<String, bool>>>,
    pub terminals: Mutex<HashMap<String, term::TermHandle>>,
    /// Cached short-lived Firebase ID token for cloud calls.
    pub auth_cache: std::sync::Mutex<auth::TokenCache>,
}
```

(`#[derive(Default)]` keeps working because `TokenCache` derives Default.)

- [ ] **Step 2: Write auth.rs with failing tests first**

Create `src-tauri/src/bridge/auth.rs`. Write it including the `#[cfg(test)]` block below, run tests BEFORE implementing bodies where practical; minimum: run once expecting failures on the pure functions, then fill in.

```rust
// Bridge: Orin AI account sign-in and Firebase token lifecycle.
// Cloud calls live here (never in the renderer). See docs/BRIDGE.md §Account.
use super::store;
use super::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

pub const DEFAULT_API_BASE: &str = "https://orinai.org";
/// Public-safe web key from the backend's public/firebase-config.js.
const FIREBASE_WEB_API_KEY: &str = "AIzaSyB5rY4e-_GOkkl4qwDZuvHqwq0_IP9mFmA";
const SESSION_KEY: &str = "auth.session";
/// Refresh when <10 min of life remains (tokens live ~1 h).
const STALE_MS: u64 = 600_000;

fn api_base() -> String {
    std::env::var("ORIN_API_BASE").unwrap_or_else(|_| DEFAULT_API_BASE.to_string())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Session {
    pub uid: String,
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub phone: String,
}

#[derive(Serialize)]
pub struct AuthStatus {
    #[serde(rename = "signedIn")]
    pub signed_in: bool,
    pub session: Option<Session>,
}

#[derive(Default)]
pub struct TokenCache {
    pub id_token: Option<String>,
    pub expires_at_ms: Option<u64>,
}

pub fn is_stale(expires_at_ms: u64, now_ms: u64) -> bool {
    now_ms + STALE_MS >= expires_at_ms
}

fn login_body(identifier: &str, password: &str) -> serde_json::Value {
    serde_json::json!({ "action": "login", "identifier": identifier, "password": password })
}

fn register_body(name: &str, identifier: &str, password: &str) -> serde_json::Value {
    serde_json::json!({ "action": "register", "name": name, "identifier": identifier, "password": password })
}

struct Tokens {
    id_token: String,
    refresh_token: String,
    expires_in_secs: u64,
}

fn parse_exchange(json: &serde_json::Value) -> Result<Tokens, String> {
    let id = json["idToken"].as_str().ok_or("no idToken in exchange response")?;
    let refresh = json["refreshToken"].as_str().ok_or("no refreshToken")?;
    let secs = json["expiresIn"].as_str().and_then(|s| s.parse::<u64>().ok()).unwrap_or(3600);
    Ok(Tokens { id_token: id.into(), refresh_token: refresh.into(), expires_in_secs: secs })
}

fn parse_refresh(json: &serde_json::Value) -> Result<Tokens, String> {
    let id = json["id_token"].as_str().ok_or("no id_token in refresh response")?;
    let refresh = json["refresh_token"].as_str().ok_or("no refresh_token")?.to_string();
    let secs = json["expires_in"].as_str().and_then(|s| s.parse::<u64>().ok()).unwrap_or(3600);
    Ok(Tokens { id_token: id.into(), refresh_token: refresh, expires_in_secs: secs })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

async fn post_json(url: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let response = reqwest::Client::new().post(url).json(&body).send().await
        .map_err(|e| format!("Network error contacting Orin AI: {e}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let value: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or(serde_json::json!({ "error": text }));
    if !status.is_success() {
        let message = value["error"]["message"].as_str()
            .or(value["error"].as_str())
            .unwrap_or("request failed");
        return Err(friendly_error(status.as_u16(), message));
    }
    Ok(value)
}

fn friendly_error(status: u16, message: &str) -> String {
    match status {
        400 | 401 => "Invalid email/phone or password.".into(),
        409 => message.to_string(),
        429 => "Too many attempts. Try again later.".into(),
        _ => format!("Sign-in failed ({status}). {message}"),
    }
}

fn load_session(state: &AppState) -> Option<Session> {
    store::read_setting(state, SESSION_KEY).and_then(|raw| serde_json::from_str(&raw).ok())
}

fn save_session(state: &AppState, session: &Session) -> Result<(), String> {
    store::write_setting(state, SESSION_KEY, &serde_json::to_string(session).map_err(|e| e.to_string())?)
}

fn keyring_slot(uid: &str) -> String {
    format!("refresh:{uid}")
}

fn store_refresh(uid: &str, refresh_token: &str) -> Result<(), String> {
    keyring::Entry::new("orin-ai", &keyring_slot(uid))
        .and_then(|entry| entry.set_password(refresh_token))
        .map_err(|e| e.to_string())
}

fn load_refresh(uid: &str) -> Option<String> {
    keyring::Entry::new("orin-ai", &keyring_slot(uid))
        .ok()
        .and_then(|entry| entry.get_password().ok())
}

fn clear_refresh(uid: &str) {
    if let Ok(entry) = keyring::Entry::new("orin-ai", &keyring_slot(uid)) {
        let _ = entry.delete_credential();
    }
}

/// Exchange the /api/auth/password custom token for ID+refresh tokens,
/// persist the session + refresh token, and prime the cache. Returns the session.
async fn establish(state: &AppState, custom_token: &str, session: Session) -> Result<Session, String> {
    let exchange = post_json(
        &format!("https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={FIREBASE_WEB_API_KEY}"),
        serde_json::json!({ "token": custom_token, "returnSecureToken": true }),
    ).await?;
    let tokens = parse_exchange(&exchange)?;
    store_refresh(&session.uid, &tokens.refresh_token)?;
    save_session(state, &session)?;
    let mut cache = state.auth_cache.lock().map_err(|_| "cache lock")?;
    cache.id_token = Some(tokens.id_token);
    cache.expires_at_ms = Some(now_ms() + tokens.expires_in_secs * 1000);
    Ok(session)
}

/// A valid Firebase ID token for cloud calls, refreshing proactively.
pub async fn ensure_id_token(state: &AppState) -> Result<String, String> {
    {
        let cache = state.auth_cache.lock().map_err(|_| "cache lock")?;
        if let (Some(token), Some(exp)) = (&cache.id_token, cache.expires_at_ms) {
            if !is_stale(exp, now_ms()) {
                return Ok(token.clone());
            }
        }
    }
    let session = load_session(state).ok_or("signed-out")?;
    let refresh = load_refresh(&session.uid).ok_or("signed-in but no stored credential — sign in again")?;
    let result = post_json(
        &format!("https://securetoken.googleapis.com/v1/token?key={FIREBASE_WEB_API_KEY}"),
        serde_json::json!({ "grant_type": "refresh_token", "refresh_token": refresh }),
    ).await?;
    let tokens = parse_refresh(&result)?;
    store_refresh(&session.uid, &tokens.refresh_token)?;
    let mut cache = state.auth_cache.lock().map_err(|_| "cache lock")?;
    cache.id_token = Some(tokens.id_token.clone());
    cache.expires_at_ms = Some(now_ms() + tokens.expires_in_secs * 1000);
    Ok(tokens.id_token)
}

pub fn has_session(state: &AppState) -> bool {
    load_session(state).is_some()
}

#[tauri::command]
pub async fn auth_login(identifier: String, password: String, state: State<'_, AppState>) -> Result<Session, String> {
    if identifier.trim().is_empty() || password.is_empty() {
        return Err("Enter your email/phone and password.".into());
    }
    let reply = post_json(&format!("{}/api/auth/password", api_base()), login_body(identifier.trim(), &password)).await?;
    let custom = reply["customToken"].as_str().ok_or("no customToken returned")?.to_string();
    let s = &reply["user"];
    let session = Session {
        uid: s["id"].as_str().unwrap_or_default().to_string(),
        name: s["name"].as_str().unwrap_or_default().to_string(),
        email: s["email"].as_str().unwrap_or_default().to_string(),
        phone: s["phone"].as_str().unwrap_or_default().to_string(),
    };
    establish(state.inner(), &custom, session).await
}

#[tauri::command]
pub async fn auth_register(name: String, identifier: String, password: String, state: State<'_, AppState>) -> Result<Session, String> {
    if name.trim().is_empty() {
        return Err("Enter your name.".into());
    }
    if identifier.trim().is_empty() || password.is_empty() {
        return Err("Enter an email/phone and a password.".into());
    }
    if password.len() < 8 {
        return Err("Password must be at least 8 characters.".into());
    }
    let reply = post_json(
        &format!("{}/api/auth/password", api_base()),
        register_body(name.trim(), identifier.trim(), &password),
    ).await?;
    let custom = reply["customToken"].as_str().ok_or("no customToken returned")?.to_string();
    let s = &reply["user"];
    let session = Session {
        uid: s["id"].as_str().unwrap_or_default().to_string(),
        name: s["name"].as_str().unwrap_or(name.trim()).to_string(),
        email: s["email"].as_str().unwrap_or_default().to_string(),
        phone: s["phone"].as_str().unwrap_or_default().to_string(),
    };
    establish(state.inner(), &custom, session).await
}

#[tauri::command]
pub fn auth_status(state: State<'_, AppState>) -> AuthStatus {
    match load_session(&state) {
        Some(session) => AuthStatus { signed_in: true, session: Some(session) },
        None => AuthStatus { signed_in: false, session: None },
    }
}

#[tauri::command]
pub fn auth_logout(state: State<'_, AppState>) -> Result<(), String> {
    if let Some(session) = load_session(&state) {
        clear_refresh(&session.uid);
    }
    let conn = store::open(&state).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM kv WHERE key = ?1", rusqlite::params![SESSION_KEY]).map_err(|e| e.to_string())?;
    let mut cache = state.auth_cache.lock().map_err(|_| "cache lock")?;
    *cache = TokenCache::default();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staleness_boundary() {
        assert!(!is_stale(3_600_000, 0));                 // fresh
        assert!(is_stale(3_600_000, 3_600_000 - 500_000)); // <10 min left → stale
        assert!(is_stale(3_600_000, 4_000_000));           // expired
    }

    #[test]
    fn bodies_carry_action_and_credentials() {
        let b = login_body("a@b.co", "pw123456");
        assert_eq!(b["action"], "login");
        assert_eq!(b["identifier"], "a@b.co");
        let r = register_body("Januth", "+94771234567", "pw123456");
        assert_eq!(r["action"], "register");
        assert_eq!(r["name"], "Januth");
    }

    #[test]
    fn parses_identity_toolkit_shapes() {
        let ex = serde_json::json!({ "idToken": "abc", "refreshToken": "zzz", "expiresIn": "3600" });
        let t = parse_exchange(&ex).unwrap();
        assert_eq!(t.id_token, "abc");
        assert_eq!(t.refresh_token, "zzz");
        assert_eq!(t.expires_in_secs, 3600);
        let rf = serde_json::json!({ "id_token": "def", "refresh_token": "yyy", "expires_in": "1800" });
        let t2 = parse_refresh(&rf).unwrap();
        assert_eq!(t2.id_token, "def");
        assert_eq!(t2.expires_in_secs, 1800);
    }
}
```

Note: `store::write_setting` and `store::open` must exist in `bridge/store.rs`. Read that file first; `read_setting` exists (verified). If `write_setting`/`open` have different names/signatures, adapt the calls to what's actually there rather than adding helpers elsewhere.

- [ ] **Step 3: Register commands in lib.rs**

Add inside `generate_handler![...]` after the `provider_has_key` line:

```rust
            bridge::auth::auth_login,
            bridge::auth::auth_register,
            bridge::auth::auth_status,
            bridge::auth::auth_logout,
```

- [ ] **Step 4: Run the unit tests**

Run: `cd orin-desktop-app/src-tauri && cargo test auth::`
Expected: 3 passed. Fix compile errors by adapting to actual sibling APIs (see note above).

- [ ] **Step 5: Commit (fork repo only)**

```bash
git add src-tauri/src/bridge/auth.rs src-tauri/src/bridge/mod.rs src-tauri/src/lib.rs
git commit -m "feat(desktop): account sign-in core — password auth + Firebase token lifecycle"
```

---

### Task 3: Rust core — `orin_cloud` provider

**Files:**
- Modify: `orin-desktop-app/src-tauri/src/bridge/ai_impl.rs` (dispatch arm + module + catalog)
- Modify: `orin-desktop-app/src-tauri/src/bridge/ai.rs` (`generate` call site passes state; `models_list` becomes auth-aware)

**Interfaces:**
- Consumes: `auth::ensure_id_token(&AppState)`, `auth::has_session(&AppState)` (Task 2).
- Produces: model ids `orin/orin-pro`, `orin/orin-flash` present in `models_list` only while signed in; provider name `orin_cloud`.

- [ ] **Step 1: Dispatch arm — `generate` signature stays UNCHANGED**

The provider reaches `AppState` through the `AppHandle` it already receives
(`app.state::<AppState>()` inside the module), so no call-site changes are
needed in `ai.rs` for `ai_send`. In `ai_impl.rs`, change only the match inside
`generate`:

```rust
    match model_id.split('/').next().unwrap_or("mock") {
        "anthropic" => anthropic::stream(model_id, system, messages, abort, &emit_chunk).await,
        "mock" => mock::stream(messages, abort, &emit_chunk).await,
        "orin" => orin_cloud::stream(app, request_id, system, messages, abort).await,
        preset => {
            openai_compat::stream(preset, model_id, openai_base_url, system, messages, abort, &emit_chunk).await
        }
    }
```

(All other arms byte-identical to today.)

- [ ] **Step 2: Implement orin_cloud with a tested payload builder**

Append to `ai_impl.rs` (this is the complete module — no earlier draft exists):

```rust
pub mod orin_cloud {
    use super::*;
    use crate::bridge::auth;

    pub async fn stream(
        app: &AppHandle,
        request_id: &str,
        system: &Option<String>,
        messages: &[AiMessage],
        abort: Arc<AtomicBool>,
    ) -> StreamResult {
        let _ = system; // v1: the server applies its own tone/memory instructions
        let state = app.state::<crate::bridge::AppState>();
        let token = auth::ensure_id_token(&state).await
            .map_err(|_| "Sign in to Settings \u{2192} Account to use Orin Cloud models.".to_string())?;

        if abort.load(Ordering::Relaxed) {
            return Err("aborted".into());
        }
        let response = reqwest::Client::new()
            .post(format!("{}/api/chat", auth::api_base()))
            .bearer_auth(token)
            .json(&chat_payload(messages))
            .send()
            .await
            .map_err(|error| format!("Network error contacting Orin AI: {error}"))?;

        let status = response.status().as_u16();
        if status == 401 {
            return Err("Your session expired. Open Settings \u{2192} Account and sign in again.".into());
        }
        if status == 429 {
            return Err("You've hit your Orin AI plan limit for now. It resets daily.".into());
        }
        if !(200..300).contains(&status) {
            let detail = response.text().await.unwrap_or_default();
            return Err(format!("Orin AI error {status}. {detail}"));
        }
        let value: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
        let text = value["text"].as_str().unwrap_or_default().to_string();

        // Upstream is non-streaming today: deliver the finished answer as one chunk.
        let _ = app.emit("ai-chunk", serde_json::json!({ "requestId": request_id, "delta": text }));
        Ok(text)
    }

    /// Plain-chat contract (verified against api/chat.js): latest user turn is
    /// `prompt`; every prior non-empty turn becomes `history` verbatim.
    pub fn chat_payload(messages: &[AiMessage]) -> serde_json::Value {
        let turns: Vec<(String, String)> = messages.iter().filter_map(|m| {
            let content = m.parts.iter()
                .filter(|part| part.kind == "text")
                .map(|part| part.text.clone())
                .collect::<Vec<_>>()
                .join("\n");
            (!content.is_empty()).then(|| (m.role.clone(), content))
        }).collect();
        let prompt = turns.last().filter(|(role, _)| role == "user")
            .map(|(_, content)| content.clone()).unwrap_or_default();
        let mut history = turns;
        if !prompt.is_empty() {
            history.pop();
        }
        let history: Vec<serde_json::Value> = history.into_iter()
            .map(|(role, content)| serde_json::json!({ "role": role, "content": content }))
            .collect();
        serde_json::json!({ "mode": "chat", "prompt": prompt, "history": history })
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        fn msg(role: &str, text: &str) -> AiMessage {
            AiMessage {
                role: role.into(),
                parts: vec![MessagePart {
                    kind: "text".into(),
                    text: text.into(),
                    media_type: String::new(),
                    base64: String::new(),
                }],
            }
        }

        #[test]
        fn payload_matches_backend_contract() {
            let payload = chat_payload(&[msg("user", "hi"), msg("assistant", "hello"), msg("user", "bye")]);
            assert_eq!(payload["mode"], "chat");
            assert_eq!(payload["prompt"], "bye");
            assert_eq!(payload["history"].as_array().unwrap().len(), 2);
            assert_eq!(payload["history"][0]["role"], "user");
            assert_eq!(payload["history"][0]["content"], "hi");
            assert_eq!(payload["history"][1]["role"], "assistant");
            assert_eq!(payload["history"][1]["content"], "hello");
        }

        #[test]
        fn empty_history_when_only_prompt() {
            let payload = chat_payload(&[msg("assistant", "welcome"), msg("user", "go")]);
            assert_eq!(payload["prompt"], "go");
            assert_eq!(payload["history"].as_array().unwrap().len(), 1); // welcome kept
            let solo = chat_payload(&[msg("user", "only")]);
            assert_eq!(solo["history"].as_array().unwrap().len(), 0);
        }
    }
}
```

Note: write `\u{2192}` as the literal `→` character in the Rust source strings (shown escaped here only for transport), or substitute `" - "` if you prefer ASCII.

- [ ] **Step 3: Catalog + models_list gating**

In `ai_impl.rs`, make catalog conditional:

```rust
pub fn catalog(signed_in: bool) -> Vec<ModelInfo> {
    let mut models = vec![ /* existing entries unchanged */ ];
    if signed_in {
        models.push(ModelInfo { id: "orin/orin-pro".into(), provider: "orin_cloud".into(), label: "Orin Pro · Cloud".into(), tier: "balanced".into(), speed: 3, intelligence: 3, context_tokens: 128_000 });
        models.push(ModelInfo { id: "orin/orin-flash".into(), provider: "orin_cloud".into(), label: "Orin Flash · Cloud".into(), tier: "fast".into(), speed: 3, intelligence: 2, context_tokens: 128_000 });
    }
    models
}
```

Keep the existing eight entries verbatim inside `models`. In `ai.rs`:

```rust
#[tauri::command]
pub fn models_list(state: State<'_, AppState>) -> Vec<ModelInfo> {
    super::ai_impl::catalog(super::auth::has_session(&state))
}
```

Browser-dev mock (`client.ts`) is untouched — signed-out mock list matches.

- [ ] **Step 4: Run tests**

Run: `cd orin-desktop-app/src-tauri && cargo test`
Expected: prior 3 pass + `payload_matches_backend_contract` passes.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/bridge/ai_impl.rs src-tauri/src/bridge/ai.rs
git commit -m "feat(desktop): Orin Cloud provider — quota-metered chat via orinai.org"
```

---

### Task 4: Rust core — `bridge/sync.rs`

**Files:**
- Create: `orin-desktop-app/src-tauri/src/bridge/sync.rs`
- Modify: `orin-desktop-app/src-tauri/src/bridge/mod.rs` (`pub mod sync;`)
- Modify: `orin-desktop-app/src-tauri/src/lib.rs` (register 2 commands)

**Interfaces:**
- Consumes: `auth::ensure_id_token`, `auth::DEFAULT_API_BASE`, env override pattern (duplicate the small `api_base()` helper here or expose `auth::api_base()` as pub — choose: make `auth::api_base()` `pub`).
- Produces: `sync_pull() -> Value|null`, `sync_push(blob: Value, schema_version: Option<u32>) -> ()` (errors as strings).

- [ ] **Step 1: Implement**

```rust
// Bridge: per-user settings/chat sync via the backend /api/desktop-sync endpoint.
use super::auth;
use super::AppState;
use serde_json::Value;
use tauri::State;

const MAX_BYTES: usize = 512 * 1024;

#[tauri::command]
pub async fn sync_pull(state: State<'_, AppState>) -> Result<Value, String> {
    let token = auth::ensure_id_token(&state).await.map_err(|_| "signed-out".to_string())?;
    let response = reqwest::Client::new()
        .get(format!("{}/api/desktop-sync", auth::api_base()))
        .bearer_auth(token)
        .send().await
        .map_err(|error| format!("Sync network error: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Sync failed ({})", response.status()));
    }
    Ok(response.json::<Value>().await.map_err(|e| e.to_string())?)
}

#[tauri::command]
pub async fn sync_push(blob: Value, schema_version: Option<u32>, state: State<'_, AppState>) -> Result<(), String> {
    let serialized = serde_json::to_string(&blob).map_err(|e| e.to_string())?;
    if serialized.len() > MAX_BYTES {
        return Err(format!("Sync payload too large ({} bytes)", serialized.len()));
    }
    let token = auth::ensure_id_token(&state).await.map_err(|_| "signed-out".to_string())?;
    let response = reqwest::Client::new()
        .put(format!("{}/api/desktop-sync", auth::api_base()))
        .bearer_auth(token)
        .json(&serde_json::json!({
            "blob": blob,
            "schemaVersion": schema_version.unwrap_or(1),
        }))
        .send().await
        .map_err(|error| format!("Sync network error: {error}"))?;
    if !response.status().is_success() {
        return Err(format!("Sync push failed ({})", response.status()));
    }
    Ok(())
}
```

- [ ] **Step 2: Register + commit**

lib.rs additions after the auth commands:

```rust
            bridge::sync::sync_pull,
            bridge::sync::sync_push,
```

mod.rs: `pub mod sync;` (alphabetical, after store).

```bash
git add src-tauri/src/bridge/sync.rs src-tauri/src/bridge/mod.rs src-tauri/src/lib.rs
git commit -m "feat(desktop): per-user settings/chat sync bridge commands"
```

---

### Task 5: UI bridge — types, client entries, mocks

**Files:**
- Modify: `orin-desktop-app/ui/src/bridge/types.ts`
- Modify: `orin-desktop-app/ui/src/bridge/client.ts`

**Interfaces:**
- Produces: `AuthSession`, `AuthStatus` types; `bridge.authLogin(identifier, password)`, `bridge.authRegister(name, identifier, password)`, `bridge.authStatus()`, `bridge.authLogout()`, `bridge.syncPull<T>()`, `bridge.syncPush(blob, schemaVersion?)`.

- [ ] **Step 1: types.ts additions**

```ts
export interface AuthSession {
  uid: string
  name: string
  email: string
  phone: string
}

export interface AuthStatus {
  signedIn: boolean
  session: AuthSession | null
}
```

- [ ] **Step 2: client.ts bridge entries (real runtime section)**

Next to the `storeGet/storeSet` group add an `// account + sync` group:

```ts
  authLogin: (identifier: string, password: string) =>
    invoke<AuthSession>('auth_login', { identifier, password }),
  authRegister: (name: string, identifier: string, password: string) =>
    invoke<AuthSession>('auth_register', { name, identifier, password }),
  authStatus: () => invoke<AuthStatus>('auth_status'),
  authLogout: () => invoke<void>('auth_logout'),
  syncPull: <T = unknown>() => invoke<{ blob: T | null; updatedAt: string | null }>('sync_pull'),
  syncPush: (blob: unknown, schemaVersion?: number) =>
    invoke<void>('sync_push', { blob, schemaVersion: schemaVersion ?? 1 }),
```

Import `AuthSession, AuthStatus` alongside existing type imports.

- [ ] **Step 3: mockInvoke cases (keep browser dev fully usable)**

Inside the `switch (command)`, before `default:`:

```ts
    case 'auth_status':
      return Promise.resolve({ signedIn: false, session: null } as T)
    case 'auth_logout':
      return Promise.resolve(undefined as T)
    case 'sync_pull':
      return Promise.resolve({ blob: null, updatedAt: null } as T)
    case 'sync_push':
      return Promise.resolve(undefined as T)
```

Leave `auth_login`/`auth_register` falling to default reject (browser dev has no real accounts; error copy comes from the UI catch).

- [ ] **Step 4: Typecheck + commit**

Run: `cd orin-desktop-app && npm run typecheck`
Expected: clean.

```bash
git add ui/src/bridge/types.ts ui/src/bridge/client.ts
git commit -m "feat(ui): account + sync bridge surface with browser-dev mocks"
```

---

### Task 6: UI — authStore + real Account settings section

**Files:**
- Create: `orin-desktop-app/ui/src/stores/authStore.ts`
- Modify: `orin-desktop-app/ui/src/features/settings/SettingsPage.tsx` (replace the placeholder `account` section content)

**Interfaces:**
- Consumes: Task 5 bridge methods.
- Produces: `useAuthStore` — `{ status: AuthStatus | null, busy: boolean, hydrate(): Promise<void>, login(identifier, password): Promise<string | null>, register(name, identifier, password): Promise<string | null>, logout(): Promise<void> }` where actions return an error message string on failure, null on success.

- [ ] **Step 1: authStore.ts**

```ts
import { create } from 'zustand'
import { bridge, type AuthStatus } from '../bridge/client'

interface AuthStore {
  status: AuthStatus | null
  busy: boolean
  hydrate: () => Promise<void>
  login: (identifier: string, password: string) => Promise<string | null>
  register: (name: string, identifier: string, password: string) => Promise<string | null>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthStore>((set) => ({
  status: null,
  busy: false,

  hydrate: async () => {
    try {
      set({ status: await bridge.authStatus() })
    } catch {
      set({ status: { signedIn: false, session: null } })
    }
  },

  login: async (identifier, password) => {
    set({ busy: true })
    try {
      const session = await bridge.authLogin(identifier, password)
      set({ status: { signedIn: true, session }, busy: false })
      return null
    } catch (error) {
      set({ busy: false })
      return error instanceof Error ? error.message : String(error)
    }
  },

  register: async (name, identifier, password) => {
    set({ busy: true })
    try {
      const session = await bridge.authRegister(name, identifier, password)
      set({ status: { signedIn: true, session }, busy: false })
      return null
    } catch (error) {
      set({ busy: false })
      return error instanceof Error ? error.message : String(error)
    }
  },

  logout: async () => {
    try {
      await bridge.authLogout()
    } finally {
      set({ status: { signedIn: false, session: null } })
    }
  },
}))
```

(If `AuthStatus` is not exported from client.ts, import both from `../bridge/types`.)

- [ ] **Step 2: Replace the account section in SettingsPage.tsx**

Add imports at top:

```tsx
import { useAuthStore } from '../../stores/authStore'
```

Add a component above `SettingsPage`:

```tsx
function AccountSection() {
  const { status, busy, login, register, logout } = useAuthStore()

  useEffect(() => {
    useAuthStore.getState().hydrate()
  }, [])

  if (status?.signedIn && status.session) {
    const who = status.session.email || status.session.phone
    return (
      <div>
        <SettingRow label="Signed in as" hint={`Orin AI account · ${status.session.name}`}>
          <span className="status-pill status-connected">{who}</span>
        </SettingRow>
        <SettingRow label="Plan" hint="Cloud models are metered by your orinai.org plan.">
          <span className="status-pill status-connected">Linked</span>
        </SettingRow>
        <button className="btn btn-subtle" onClick={() => void logout()}>Sign out</button>
      </div>
    )
  }

  return <SignInForm busy={busy} onSubmit={login} />
}

function SignInForm({
  busy,
  onSubmit,
}: {
  busy: boolean
  onSubmit: (identifier: string, password: string) => Promise<string | null>
}) {
  const [tab, setTab] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setError(null)
    const err =
      tab === 'login'
        ? await onSubmit(identifier.trim(), password)
        : await useAuthStore.getState().register(name.trim(), identifier.trim(), password)
    if (err) setError(err)
  }

  return (
    <div className="account-auth">
      <div className="account-tabs">
        <button className={tab === 'login' ? 'active' : ''} onClick={() => setTab('login')}>Sign in</button>
        <button className={tab === 'register' ? 'active' : ''} onClick={() => setTab('register')}>Create account</button>
      </div>
      {tab === 'register' && (
        <label>Name
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" />
        </label>
      )}
      <label>Email or phone
        <input value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="you@example.com or +94…" />
      </label>
      <label>Password{tab === 'register' ? ' (8+ characters)' : ''}
        <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </label>
      {error && <p className="account-error">{error}</p>}
      <button className="btn btn-primary" disabled={busy || !identifier.trim() || !password} onClick={() => void submit()}>
        {busy ? 'Working…' : tab === 'login' ? 'Sign in' : 'Create account'}
      </button>
      <p className="setting-hint">Same account as orinai.org. Password never leaves this form unencrypted.</p>
    </div>
  )
}
```

Replace the placeholder account section object with:

```tsx
    {
      id: 'account',
      label: 'Account',
      content: <AccountSection />,
    },
```

Add styles to `ui/src/features/settings/settings.css`:

```css
.account-auth { display: flex; flex-direction: column; gap: 12px; max-width: 360px; }
.account-auth label { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--text-dim); }
.account-auth input { background: var(--panel-raised); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; color: var(--text); font-size: 13px; }
.account-tabs { display: flex; gap: 4px; }
.account-tabs button { flex: 1; padding: 6px 0; border-radius: 8px; border: 1px solid transparent; background: transparent; color: var(--text-dim); cursor: pointer; }
.account-tabs button.active { background: var(--panel-raised); border-color: var(--line); color: var(--text); }
.account-error { color: #e5484d; font-size: 12px; margin: 0; }
```

(CSS variable names follow `design/tokens.css` conventions; adjust any name that doesn't exist there to its actual counterpart.)

- [ ] **Step 3: Verify in browser dev, then typecheck + lint**

Run: `npm run dev` → Settings → Account shows tabs; submitting shows the friendly "not available in browser dev mode" error path (acceptable in mock).
Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add ui/src/stores/authStore.ts ui/src/features/settings/SettingsPage.tsx ui/src/features/settings/settings.css
git commit -m "feat(ui): account sign-in/register in Settings with linked-plan state"
```

---

### Task 7: Sync wiring (settings + chats behind a toggle)

**Files:**
- Create: `orin-desktop-app/ui/src/stores/cloudSync.ts` (single canonical push/pull helper)
- Modify: `orin-desktop-app/ui/src/stores/settingsStore.ts`
- Modify: `orin-desktop-app/ui/src/stores/chatsStore.ts`
- Modify: `orin-desktop-app/ui/src/features/settings/SettingsPage.tsx` (toggle row)

**Interfaces:**
- Consumes: `bridge.syncPull/syncPush`, `bridge.authStatus()`, `useSettingsStore`, `useChatsStore`.
- Produces: `cloudSync.scheduleCloudSync()` (debounced 30 s whole-payload push), `cloudSync.pullAndMerge()` (remote-wins merge into both stores), and a new settings field `cloudSync: boolean` (default true).

- [ ] **Step 1: Create the shared sync module**

Create `ui/src/stores/cloudSync.ts`:

```ts
import { bridge } from '../bridge/client'
import { useSettingsStore } from './settingsStore'
import { useChatsStore } from './chatsStore'

// Whole-workspace snapshot pushed on every change (≤512 KB enforced server-side).
function buildPayload() {
  const s = useSettingsStore.getState()
  return {
    schemaVersion: 1,
    blob: {
      settings: {
        theme: s.theme,
        accent: s.accent,
        density: s.density,
        fontSize: s.fontSize,
        codeFont: s.codeFont,
        defaultModelId: s.defaultModelId,
        defaultMode: s.defaultMode,
        cloudSync: s.cloudSync,
      },
      chats: useChatsStore.getState().conversations,
    },
  }
}

let timer: ReturnType<typeof setTimeout> | undefined
export function scheduleCloudSync() {
  clearTimeout(timer)
  timer = setTimeout(async () => {
    try {
      const { signedIn } = await bridge.authStatus()
      if (!signedIn || !useSettingsStore.getState().cloudSync) return
      await bridge.syncPush(buildPayload().blob, buildPayload().schemaVersion)
    } catch {
      // best-effort — local state remains authoritative until next push
    }
  }, 30_000)
}

// Remote wins v1. Called from settingsStore.hydrate after the local load.
export async function pullAndMerge() {
  if (!useSettingsStore.getState().cloudSync) return
  const { signedIn } = await bridge.authStatus()
  if (!signedIn) return
  const remote = await bridge.syncPull<{
    settings?: Partial<ReturnType<typeof useSettingsStore.getState>>
    chats?: unknown[] | undefined
  }>()
  if (!remote?.blob) return
  if (remote.blob.settings) useSettingsStore.setState(remote.blob.settings)
  const chats = remote.blob.chats
  if (Array.isArray(chats) && chats.length > 0) {
    useChatsStore.setState({ conversations: chats as never })
  }
}
```

⚠️ Adapt two names to what actually exists in those stores before compiling: the zustand hook names (`useSettingsStore` verified; confirm `useChatsStore`) and the conversations field (`conversations` — verified in the chatsStore brief). If chats are stored under different keys, map them here — this file is the ONLY place that knows the sync shape.

- [ ] **Step 2: Wire stores**

In `settingsStore.ts`:
1. Add `cloudSync: boolean` to the interface and `true` to defaults.
2. At the end of `hydrate`, replace the trailing theme-application lines with:

```ts
    try {
      await (await import('./cloudSync')).pullAndMerge()
    } catch { /* offline / signed out */ }
    document.documentElement.dataset.theme = get().theme
    document.documentElement.style.setProperty('--accent', get().accent)
```

3. In `update`, after the existing debounced `storeSet`, call:

```ts
    import('./cloudSync').then(({ scheduleCloudSync }) => scheduleCloudSync())
```

In `chatsStore.ts`: add one line at every mutation terminal point (end of `createChat`, rename/pin/archive/delete handlers, and after streaming completes in `sendMessage`):

```ts
    void import('./cloudSync').then(({ scheduleCloudSync }) => scheduleCloudSync())
```

(If chatsStore has a single private `persist()` helper all mutations already funnel through, put the call there once instead — check first.)

- [ ] **Step 3: Toggle row in Settings ▸ Account**

Inside the signed-in branch of `AccountSection` in SettingsPage.tsx add:

```tsx
        <SettingRow label="Sync across devices" hint="Settings and chats follow your Orin AI account.">
          <Toggle checked={useSettingsStore.getState().cloudSync}
                  onChange={(value) => { update({ cloudSync: value }) }} />
        </SettingRow>
```

using whatever local aliases SettingsPage already uses for the settings store's state/updater (`update` is its action name; adapt destructure style). `Toggle` is exported by `./SettingsLayout`.

- [ ] **Step 4: Typecheck/lint/dev smoke + commit**

Run: `npm run typecheck && npm run lint && npm run dev`
Expected: clean; toggle absent when signed out (mock), no errors in console.

```bash
git add ui/src/stores/cloudSync.ts ui/src/stores/settingsStore.ts ui/src/stores/chatsStore.ts ui/src/features/settings/SettingsPage.tsx
git commit -m "feat(ui): opt-out cloud sync for settings and chats"
```

---

### Task 8: Docs + end-to-end verification

**Files:**
- Modify: `orin-desktop-app/docs/BRIDGE.md` (Account + Sync command tables)
- Modify: `orin-desktop-app/README.md` (one feature bullet)

**Interfaces:** documentation only.

- [ ] **Step 1: BRIDGE.md tables**

Under a new `### Account (orinai.org sign-in)` heading:

```markdown
| Command | Args | Returns |
|---|---|---|
| `auth_login` | `identifier: string, password: string` | `Session` |
| `auth_register` | `name: string, identifier: string, password: string` | `Session` |
| `auth_status` | — | `{ signedIn: bool, session: Session \| null }` |
| `auth_logout` | — | `null` |

Session = `{uid,name,email,phone}`. Refresh tokens live in the OS keyring;
ID tokens never leave the Rust process. Cloud errors degrade to local mode.
```

Under `### Sync`:

```markdown
| Command | Args | Returns |
|---|---|---|
| `sync_pull` | — | `{ blob: object \| null, updatedAt: string \| null }` |
| `sync_push` | `blob: object (≤512 KB), schemaVersion?: number` | `null` |

Backend endpoint: `/api/desktop-sync` (last-write-wins, per-user).
```

- [ ] **Step 2: README bullet** under Architecture/features: `- Orin AI accounts: sign in with your orinai.org account for quota-metered cloud models and cross-device sync (BYO keys stay local).`

- [ ] **Step 3: Full verification sweep**

Run: `cd orin-desktop-app/src-tauri && cargo test` → all green.
Run: `npm run typecheck && npm run lint` → clean.
Run: `npm run app:dev` (requires Rust toolchain) → sign in with a real orinai.org account → Orin Pro/Flash appear in the model dropdown → send a chat → verify reply arrives and usage increments on orinai.org → enable/disable sync toggle → sign out → app returns to fully-local mode.

- [ ] **Step 4: Commit docs**

```bash
git add docs/BRIDGE.md README.md
git commit -m "docs: bridge contract + README for Orin Cloud accounts and sync"
```

---

## Deferred (explicitly out of scope)

- True SSE streaming for `/api/chat` (backend follow-up; desktop currently emits whole answers).
- Google OAuth in the desktop shell (use password accounts; Google users add a password on web once).
- Executor pairing / remote control (spec phase 3), pc-app retirement.
