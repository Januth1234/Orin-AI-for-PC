// Bridge: Orin AI account sign-in and Firebase token lifecycle.
// Cloud calls live here, never in the renderer. See docs/BRIDGE.md §Account.
//
// Password flow: POST /api/auth/password → { customToken, user } → Identity
// Toolkit signInWithCustomToken → { idToken, refreshToken }.
// Browser flow: /api/auth/device device grant — start → user approves on
// orinai.org → poll returns a custom token → same exchange; the profile then
// comes from the ID-token claims instead of the password endpoint.
//
// The refresh token goes to
// the OS keyring; the ID token (~1 h) stays in memory and is refreshed
// proactively when <10 min of life remains. Signed-out is a normal state:
// callers treat ensure_id_token's Err as "not signed in" and degrade locally.
use super::store;
use super::AppState;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use tauri::State;

pub const DEFAULT_API_BASE: &str = "https://orinai.org";
/// Public-safe web key from the backend's public/firebase-config.js.
const FIREBASE_WEB_API_KEY: &str = "AIzaSyB5rY4e-_GOkkl4qwDZuvHqwq0_IP9mFmA";
const SESSION_KEY: &str = "auth.session";
/// Refresh when <10 min of life remains (tokens live ~1 h).
const STALE_MS: u64 = 600_000;

pub fn api_base() -> String {
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
    let secs = json["expiresIn"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(3600);
    Ok(Tokens { id_token: id.into(), refresh_token: refresh.into(), expires_in_secs: secs })
}

fn parse_refresh(json: &serde_json::Value) -> Result<Tokens, String> {
    let id = json["id_token"].as_str().ok_or("no id_token in refresh response")?;
    let refresh = json["refresh_token"].as_str().ok_or("no refresh_token")?.to_string();
    let secs = json["expires_in"]
        .as_str()
        .and_then(|s| s.parse::<u64>().ok())
        .unwrap_or(3600);
    Ok(Tokens { id_token: id.into(), refresh_token: refresh, expires_in_secs: secs })
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

async fn post_json(url: &str, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let response = reqwest::Client::new()
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("Network error contacting Orin AI: {e}"))?;
    let status = response.status();
    let text = response.text().await.unwrap_or_default();
    let value: serde_json::Value =
        serde_json::from_str(&text).unwrap_or(serde_json::json!({ "error": text }));
    if !status.is_success() {
        let message = value["error"]["message"]
            .as_str()
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
    let raw = serde_json::to_string(session).map_err(|e| e.to_string())?;
    store::write_setting(state, SESSION_KEY, &raw)
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
        let _ = entry.delete_password();
    }
}

/// Exchange the /api/auth/password custom token for ID+refresh tokens,
/// persist session + refresh token, prime the cache. Returns the session.
async fn establish(state: &AppState, custom_token: &str, session: Session) -> Result<Session, String> {
    let tokens = exchange_custom_token(custom_token).await?;
    persist_session(state, tokens, session).await
}

async fn exchange_custom_token(custom_token: &str) -> Result<Tokens, String> {
    let exchange = post_json(
        &format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={FIREBASE_WEB_API_KEY}"
        ),
        serde_json::json!({ "token": custom_token, "returnSecureToken": true }),
    )
    .await?;
    parse_exchange(&exchange)
}

async fn persist_session(state: &AppState, tokens: Tokens, session: Session) -> Result<Session, String> {
    store_refresh(&session.uid, &tokens.refresh_token)?;
    save_session(state, &session)?;
    let mut cache = state.auth_cache.lock().map_err(|_| "cache lock poisoned")?;
    cache.id_token = Some(tokens.id_token);
    cache.expires_at_ms = Some(now_ms() + tokens.expires_in_secs * 1000);
    Ok(session)
}

/// A valid Firebase ID token for cloud calls, refreshing proactively.
/// A rare double-refresh race is acceptable: the server treats it as idempotent.
pub async fn ensure_id_token(state: &AppState) -> Result<String, String> {
    {
        let cache = state.auth_cache.lock().map_err(|_| "cache lock poisoned")?;
        if let (Some(token), Some(exp)) = (&cache.id_token, cache.expires_at_ms) {
            if !is_stale(exp, now_ms()) {
                return Ok(token.clone());
            }
        }
    }
    let session = load_session(state).ok_or("signed-out")?;
    let refresh = load_refresh(&session.uid)
        .ok_or("signed-in but no stored credential — sign in again")?;
    let result = post_json(
        &format!("https://securetoken.googleapis.com/v1/token?key={FIREBASE_WEB_API_KEY}"),
        serde_json::json!({ "grant_type": "refresh_token", "refresh_token": refresh }),
    )
    .await?;
    let tokens = parse_refresh(&result)?;
    store_refresh(&session.uid, &tokens.refresh_token)?;
    let mut cache = state.auth_cache.lock().map_err(|_| "cache lock poisoned")?;
    cache.id_token = Some(tokens.id_token.clone());
    cache.expires_at_ms = Some(now_ms() + tokens.expires_in_secs * 1000);
    Ok(tokens.id_token)
}

/// Cheap signed-in check for gating UI (no network).
pub fn has_session(state: &AppState) -> bool {
    load_session(state).is_some()
}

#[tauri::command]
pub async fn auth_login(
    identifier: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<Session, String> {
    if identifier.trim().is_empty() || password.is_empty() {
        return Err("Enter your email/phone and password.".into());
    }
    let reply = post_json(
        &format!("{}/api/auth/password", api_base()),
        login_body(identifier.trim(), &password),
    )
    .await?;
    let custom = reply["customToken"]
        .as_str()
        .ok_or("no customToken returned")?
        .to_string();
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
pub async fn auth_register(
    name: String,
    identifier: String,
    password: String,
    state: State<'_, AppState>,
) -> Result<Session, String> {
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
    )
    .await?;
    let custom = reply["customToken"]
        .as_str()
        .ok_or("no customToken returned")?
        .to_string();
    let s = &reply["user"];
    let session = Session {
        uid: s["id"].as_str().unwrap_or_default().to_string(),
        name: s["name"]
            .as_str()
            .unwrap_or_else(|| name.trim())
            .to_string(),
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
    store::delete_setting(&state, SESSION_KEY)?;
    let mut cache = state.auth_cache.lock().map_err(|_| "cache lock poisoned")?;
    *cache = TokenCache::default();
    Ok(())
}

// ── Device flow (browser sign-in handoff) ────────────────────────────────────
//
// Mirrors /api/auth/device: start → open orinai.org in the system browser →
// the user signs in there and approves the matching code → polling picks up a
// custom token, which goes through the same Identity Toolkit exchange as the
// password flow.

fn open_in_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        // explorer.exe opens the default browser without a console flash.
        let _ = std::process::Command::new("explorer").arg(url).spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
}

/// Open a URL in the system browser (account creation lives on orinai.org,
/// never in this app). Only http(s) — arbitrary schemes are refused.
#[tauri::command]
pub fn open_external(url: String) -> Result<(), String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("Only http(s) URLs can be opened.".into());
    }
    open_in_browser(&url);
    Ok(())
}

/// Decode one base64url JWT segment.
fn b64url_decode(segment: &str) -> Option<Vec<u8>> {
    URL_SAFE_NO_PAD.decode(segment).ok()
}

/// Device-flow approval returns only a custom token — rebuild the profile from
/// the ID-token claims (uid/email always; name falls back to email local-part).
fn session_from_id_token(id_token: &str) -> Session {
    let fallback =
        |name: &str| Session { uid: String::new(), name: name.into(), email: String::new(), phone: String::new() };
    let payload = id_token
        .split('.')
        .nth(1)
        .and_then(b64url_decode)
        .and_then(|raw| serde_json::from_slice::<serde_json::Value>(&raw).ok());
    let Some(payload) = payload else { return fallback("Orin user") };
    let email = payload["email"].as_str().unwrap_or_default().to_string();
    let uid = payload["user_id"]
        .as_str()
        .or_else(|| payload["sub"].as_str())
        .unwrap_or_default()
        .to_string();
    let name = payload["name"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            email.split('@').next().filter(|s| !s.is_empty()).unwrap_or("Orin user").to_string()
        });
    Session {
        uid,
        name,
        email,
        phone: payload["phone_number"].as_str().unwrap_or_default().to_string(),
    }
}

#[derive(Serialize)]
pub struct DeviceStart {
    #[serde(rename = "deviceCode")]
    pub device_code: String,
    #[serde(rename = "userCode")]
    pub user_code: String,
    #[serde(rename = "verifyUrl")]
    pub verify_url: String,
    #[serde(rename = "expiresInSecs")]
    pub expires_in_secs: u64,
}

#[tauri::command]
pub async fn auth_device_start() -> Result<DeviceStart, String> {
    let reply =
        post_json(&format!("{}/api/auth/device", api_base()), serde_json::json!({ "action": "start" }))
            .await?;
    let start = DeviceStart {
        device_code: reply["device_code"].as_str().ok_or("no device_code returned")?.to_string(),
        user_code: reply["user_code"].as_str().ok_or("no user_code returned")?.to_string(),
        verify_url: reply["verify_url"].as_str().unwrap_or(DEFAULT_API_BASE).to_string(),
        expires_in_secs: reply["expires_in"].as_u64().unwrap_or(600),
    };
    if device_code_valid(&start.device_code) {
        open_in_browser(&start.verify_url);
    }
    Ok(start)
}

fn device_code_valid(code: &str) -> bool {
    code.len() == 64 && code.chars().all(|c| c.is_ascii_hexdigit())
}

#[tauri::command]
pub async fn auth_device_wait(device_code: String, state: State<'_, AppState>) -> Result<Session, String> {
    if !device_code_valid(&device_code) {
        return Err("Start a new sign-in from this app first.".into());
    }
    // Cover the full 10-minute server-side TTL plus network slack.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10 * 60 + 30);
    loop {
        let reply = post_json(
            &format!("{}/api/auth/device", api_base()),
            serde_json::json!({ "action": "token", "device_code": device_code.clone() }),
        )
        .await?;
        match reply["status"].as_str().unwrap_or_default() {
            "approved" => {
                let custom = reply["custom_token"].as_str().ok_or("no custom token returned")?;
                let tokens = exchange_custom_token(custom).await?;
                let session = session_from_id_token(&tokens.id_token);
                return persist_session(state.inner(), tokens, session).await;
            }
            "denied" => return Err("Sign-in was denied in the browser.".into()),
            "expired" => return Err("The sign-in request expired — start again.".into()),
            _ => {} // pending — keep polling
        }
        if std::time::Instant::now() >= deadline {
            return Err("Timed out waiting for approval — start again.".into());
        }
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staleness_boundary() {
        assert!(!is_stale(3_600_000, 0)); // fresh token
        assert!(is_stale(3_600_000, 3_600_000 - 500_000)); // <10 min left → stale
        assert!(is_stale(3_600_000, 4_000_000)); // expired
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

    fn b64url(input: &str) -> String {
        use base64::engine::general_purpose::URL_SAFE_NO_PAD;
        use base64::Engine as _;
        URL_SAFE_NO_PAD.encode(input)
    }

    #[test]
    fn session_from_id_token_parses_claims() {
        let payload = serde_json::json!({
            "user_id": "uid-123", "email": "ann@example.com",
            "name": "Ann", "phone_number": "+94770000000"
        });
        let token = format!("hdr.{}.sig", b64url(&payload.to_string()));
        let s = session_from_id_token(&token);
        assert_eq!(s.uid, "uid-123");
        assert_eq!(s.name, "Ann");
        assert_eq!(s.email, "ann@example.com");
        assert_eq!(s.phone, "+94770000000");

        // No name → email local-part. No claims at all → safe fallback.
        let minimal = serde_json::json!({ "user_id": "u9", "email": "bo@x.io" });
        let s2 = session_from_id_token(&format!("h.{}.s", b64url(&minimal.to_string())));
        assert_eq!(s2.name, "bo");
        let s3 = session_from_id_token("not-a-jwt");
        assert_eq!(s3.name, "Orin user");
    }

    #[test]
    fn device_code_shape_is_enforced() {
        let good = "a".repeat(64);
        assert!(device_code_valid(&good));
        assert!(!device_code_valid("short"));
        assert!(!device_code_valid(&format!("{}z", "f".repeat(63)))); // z is not hex
    }
}
