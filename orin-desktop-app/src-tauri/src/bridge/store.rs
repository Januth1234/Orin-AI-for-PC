// Persistence commands — SQLite KV (see docs/BRIDGE.md).
// One connection per call: SQLite+WAL handles concurrent opens cheaply, and
// rusqlite connections are not clonable.
use crate::bridge::AppState;
use serde_json::Value;
use std::path::PathBuf;
use tauri::State;

fn db_path(state: &AppState) -> PathBuf {
    if let Ok(guard) = state.db_path.lock() {
        if let Some(path) = guard.as_ref() {
            return path.clone();
        }
    }
    let path = dirs::data_dir()
        .expect("no data dir")
        .join("orin-ai")
        .join("workspace.db");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(mut guard) = state.db_path.lock() {
        *guard = Some(path.clone());
    }
    path
}

/// Read a KV setting from Rust code (used for provider config like base URLs).
pub fn read_setting(state: &AppState, key: &str) -> Option<String> {
    let conn = open(state).ok()?;
    let mut stmt = conn.prepare("SELECT value FROM kv WHERE key = ?1").ok()?;
    let raw: String = stmt.query_row(rusqlite::params![key], |row| row.get(0)).ok()?;
    serde_json::from_str::<Value>(&raw).ok().and_then(|v| v.as_str().map(|s| s.to_string()))
}

/// Write a KV setting from Rust code (e.g. the signed-in session record).
pub fn write_setting(state: &AppState, key: &str, value: &str) -> Result<(), String> {
    let conn = open(state)?;
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Remove a KV setting from Rust code (e.g. on sign-out).
pub fn delete_setting(state: &AppState, key: &str) -> Result<(), String> {
    let conn = open(state)?;
    conn.execute("DELETE FROM kv WHERE key = ?1", rusqlite::params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn open(state: &AppState) -> Result<rusqlite::Connection, String> {
    let conn = rusqlite::Connection::open(db_path(state)).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    )
    .map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
pub fn store_get(key: String, state: State<AppState>) -> Result<Value, String> {
    let conn = open(&state)?;
    let mut stmt = conn.prepare("SELECT value FROM kv WHERE key = ?1").map_err(|e| e.to_string())?;
    let found = stmt
        .query_row(rusqlite::params![key], |row| {
            let raw: String = row.get(0)?;
            Ok(serde_json::from_str::<Value>(&raw).unwrap_or(Value::Null))
        })
        .ok();
    Ok(found.unwrap_or(Value::Null))
}

#[tauri::command]
pub fn store_set(key: String, value: Value, state: State<AppState>) -> Result<(), String> {
    let conn = open(&state)?;
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value.to_string()],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn store_delete(key: String, state: State<AppState>) -> Result<(), String> {
    let conn = open(&state)?;
    conn.execute("DELETE FROM kv WHERE key = ?1", rusqlite::params![key])
        .map_err(|e| e.to_string())?;
    Ok(())
}
