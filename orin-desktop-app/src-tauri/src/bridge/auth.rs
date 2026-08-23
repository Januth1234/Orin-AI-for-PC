// Bridge: Orin AI account sign-in and Firebase token lifecycle.
// Cloud calls live here, never in the renderer. See docs/BRIDGE.md §Account.
//
// Flow: POST /api/auth/password → { customToken } → Identity Toolkit
// signInWithCustomToken → { idToken, refreshToken }. The refresh token goes to
// the OS keyring; the ID token (~1 h) stays in memory and is refreshed
// proactively when <10 min of life remains. Signed-out is a normal state:
// callers treat ensure_id_token's Err as "not signed in" and degrade locally.
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
    let exchange = post_json(
        &format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key={FIREBASE_WEB_API_KEY}"
        ),
        serde_json::json!({ "token": custom_token, "returnSecureToken": true }),
    )
    .await?;
    let tokens = parse_exchange(&exchange)?;
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
}
