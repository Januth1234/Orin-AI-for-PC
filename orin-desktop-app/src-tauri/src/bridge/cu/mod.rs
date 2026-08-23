// Computer Use commands — the observe → decide → act → verify desktop-agent
// surface. Each session captures frames, asks the configured model for exactly
// one JSON action, consults the safety policy (permission prompts when gated),
// performs the action through the provider controller, and repeats until the
// model says it is done or a limit is hit.
pub mod controller;
pub mod policy;
pub mod virtual_provider;
#[cfg(windows)]
pub mod windows_provider;

use super::ai::{AiMessage, MessagePart};
use super::ai_impl;
use super::AppState;
use controller::ComputerController;
use policy::{Decision, SessionPolicy};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

#[derive(Deserialize)]
pub struct CuTask {
    #[serde(rename = "modelId")]
    pub model_id: String,
    pub instruction: String,
    pub provider: String,
    #[serde(rename = "maxActions")]
    pub max_actions: u32,
}

/// Wire shape of an action (docs/BRIDGE.md §CuAction). Coordinates are
/// normalized 0..1000.
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CuAction {
    Click { x: f64, y: f64, button: String },
    Move { x: f64, y: f64 },
    Type { text: String },
    Key { key: String },
    Scroll { x: f64, y: f64, amount: i32 },
    Drag {
        #[serde(rename = "fromX")]
        from_x: f64,
        #[serde(rename = "fromY")]
        from_y: f64,
        #[serde(rename = "toX")]
        to_x: f64,
        #[serde(rename = "toY")]
        to_y: f64,
    },
    Wait { ms: u64 },
    OpenApp { name: String },
    FocusWindow { title: String },
}

impl CuAction {
    fn kind(&self) -> &'static str {
        match self {
            CuAction::Click { .. } => "click",
            CuAction::Move { .. } => "move",
            CuAction::Type { .. } => "type",
            CuAction::Key { .. } => "key",
            CuAction::Scroll { .. } => "scroll",
            CuAction::Drag { .. } => "drag",
            CuAction::Wait { .. } => "wait",
            CuAction::OpenApp { .. } => "open_app",
            CuAction::FocusWindow { .. } => "focus_window",
        }
    }

    /// The thing being acted on — the allowlist key for app/window actions.
    fn target(&self) -> String {
        match self {
            CuAction::OpenApp { name } => name.clone(),
            CuAction::FocusWindow { title } => title.clone(),
            _ => String::new(),
        }
    }

    fn describe(&self) -> String {
        match self {
            CuAction::Click { x, y, button } => format!("{button} click at ({x}, {y})"),
            CuAction::Move { x, y } => format!("move to ({x}, {y})"),
            CuAction::Type { text } => format!("type text ({} chars)", text.chars().count()),
            CuAction::Key { key } => format!("press {key}"),
            CuAction::Scroll { x, y, amount } => format!("scroll {amount} at ({x}, {y})"),
            CuAction::Drag { from_x, from_y, to_x, to_y } => {
                format!("drag ({from_x}, {from_y}) → ({to_x}, {to_y})")
            }
            CuAction::Wait { ms } => format!("wait {ms} ms"),
            CuAction::OpenApp { name } => format!("open “{name}”"),
            CuAction::FocusWindow { title } => format!("focus window “{title}”"),
        }
    }
}

enum Step {
    Act(CuAction),
    Done(String),
    /// The reply was not a usable action (prose, malformed JSON, unknown kind).
    /// The loop nudges the model and retries rather than ending the session.
    Unparsed,
}

/// The active controller, dispatched over the concrete providers (the
/// `ComputerController` trait uses async fns and is therefore not dyn-safe).
pub enum AnyController {
    Virtual(virtual_provider::VirtualDesktop),
    #[cfg(windows)]
    Windows(windows_provider::WindowsDesktop),
}

macro_rules! dispatch {
    ($self:expr, $method:ident $(, $arg:expr)*) => {
        match $self {
            Self::Virtual(p) => p.$method($($arg),*),
            #[cfg(windows)]
            Self::Windows(p) => p.$method($($arg),*),
        }
    };
}

impl AnyController {
    pub async fn screenshot_jpeg(&self) -> Result<(Vec<u8>, u32, u32), String> {
        match self {
            Self::Virtual(p) => p.screenshot_jpeg().await,
            #[cfg(windows)]
            Self::Windows(p) => p.screenshot_jpeg().await,
        }
    }
    pub fn move_mouse(&mut self, x: f64, y: f64) -> Result<(), String> {
        dispatch!(self, move_mouse, x, y)
    }
    pub fn click(&mut self, button: &str) -> Result<(), String> {
        dispatch!(self, click, button)
    }
    pub fn type_text(&mut self, text: &str) -> Result<(), String> {
        dispatch!(self, type_text, text)
    }
    pub fn press_key(&mut self, key: &str) -> Result<(), String> {
        dispatch!(self, press_key, key)
    }
    pub fn scroll(&mut self, x: f64, y: f64, amount: i32) -> Result<(), String> {
        dispatch!(self, scroll, x, y, amount)
    }
    #[allow(dead_code)]
    pub fn drag(&mut self, from: (f64, f64), to: (f64, f64)) -> Result<(), String> {
        dispatch!(self, drag, from, to)
    }
    pub fn open_app(&mut self, name: &str) -> Result<(), String> {
        dispatch!(self, open_app, name)
    }
    pub fn focus_window(&mut self, title: &str) -> Result<(), String> {
        dispatch!(self, focus_window, title)
    }
}

pub fn create_controller(provider: &str) -> Result<AnyController, String> {
    match provider {
        "virtual" => Ok(AnyController::Virtual(virtual_provider::VirtualDesktop::new())),
        #[cfg(windows)]
        "windows" => windows_provider::WindowsDesktop::new().map(AnyController::Windows),
        #[cfg(not(windows))]
        "windows" => Err("Real-desktop control is only available on Windows.".into()),
        other => Err(format!(
            "Unknown Computer Use provider “{other}”. Available: {}.",
            available_providers().join(", ")
        )),
    }
}

#[tauri::command]
pub async fn cu_start(task: CuTask, app: AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    if task.instruction.trim().is_empty() {
        return Err("Tell Orin what to do on the screen first — describe the goal.".into());
    }
    create_controller(&task.provider)?;

    let session_id = uuid::Uuid::new_v4().to_string();
    let flag = state.register_flag(&session_id);
    let approvals = state.approvals.clone();
    let openai_base = crate::bridge::store::read_setting(&state, "openai_compat/baseUrl");

    tauri::async_runtime::spawn(run_loop(
        app.clone(),
        session_id.clone(),
        task,
        flag,
        approvals,
        openai_base,
    ));
    Ok(session_id)
}

#[tauri::command]
pub fn cu_stop(session_id: String, state: State<'_, AppState>) {
    state.trip_flag(&session_id);
}

#[tauri::command]
pub fn cu_permission_respond(prompt_id: String, allowed: bool, state: State<'_, AppState>) {
    if let Ok(mut approvals) = state.approvals.lock() {
        approvals.insert(prompt_id, allowed);
    }
}

#[tauri::command]
pub fn cu_available_providers() -> Vec<String> {
    available_providers()
}

fn available_providers() -> Vec<String> {
    let mut providers = vec!["virtual".to_string()];
    if cfg!(windows) {
        providers.push("windows".to_string());
    }
    providers
}

const MIN_FRAME_INTERVAL_MS: u64 = 250;
const PERMISSION_TIMEOUT_SECS: u64 = 600;
const HARD_ACTION_CAP: u32 = 200;

async fn run_loop(
    app: AppHandle,
    session_id: String,
    task: CuTask,
    flag: Arc<AtomicBool>,
    approvals: Arc<Mutex<HashMap<String, bool>>>,
    openai_base: Option<String>,
) {
    let emit_status = |phase: &str, detail: &str| {
        let _ = app.emit("cu-status", json!({ "sessionId": session_id, "phase": phase, "detail": detail }));
    };
    let emit_error = |error: String| {
        let _ = app.emit("cu-error", json!({ "sessionId": session_id, "error": error }));
    };
    let stopped = |summary: &str| {
        let _ = app.emit("cu-done", json!({ "sessionId": session_id, "summary": summary }));
    };

    let mut controller = match create_controller(&task.provider) {
        Ok(c) => c,
        Err(error) => {
            emit_error(error);
            return;
        }
    };
    if task.model_id.starts_with("mock/") {
        emit_error(
            "Computer Use needs a vision-capable model (screenshots drive every step). \
             Connect Anthropic or an OpenAI-compatible vision model in Settings → Models."
                .into(),
        );
        return;
    }
    let mut policy = SessionPolicy::new(&task.provider);

    emit_status("observing", "Looking at the screen");
    let mut recent_actions: Vec<String> = Vec::new();
    let mut last_frame = Instant::now() - Duration::from_millis(MIN_FRAME_INTERVAL_MS);
    let mut performed: u32 = 0;
    let mut unparsed_streak: u32 = 0;

    loop {
        if flag.load(Ordering::Relaxed) {
            stopped("Session stopped.");
            return;
        }
        if performed >= task.max_actions.clamp(1, HARD_ACTION_CAP) {
            stopped(&format!(
                "Stopped after {performed} actions — the safety cap for this session."
            ));
            return;
        }

        // --- Observe ---------------------------------------------------------
        let since_last = last_frame.elapsed();
        if since_last < Duration::from_millis(MIN_FRAME_INTERVAL_MS) {
            tokio::time::sleep(Duration::from_millis(MIN_FRAME_INTERVAL_MS) - since_last).await;
        }
        let (jpeg, width, height) = match controller.screenshot_jpeg().await {
            Ok(frame) => frame,
            Err(error) => {
                emit_error(error);
                return;
            }
        };
        last_frame = Instant::now();
        use base64::Engine as _;
        let frame_b64 = base64::engine::general_purpose::STANDARD.encode(jpeg);
        let _ = app.emit(
            "cu-frame",
            json!({
                "sessionId": session_id,
                "jpegBase64": frame_b64,
                "width": width,
                "height": height,
            }),
        );

        // --- Decide ----------------------------------------------------------
        emit_status("planning", "Determining the next action");
        // Unique requestId ("cu-{session}-{n}") so streamed chunks never
        // collide with chat traffic.
        let request_id = format!("cu-{session_id}-{performed}");
        let message = vision_message(&task.instruction, &task.provider, &recent_actions, &frame_b64);
        let reply = match ai_impl::generate(
            &app,
            &request_id,
            &task.model_id,
            &Some(cu_system_prompt()),
            &[message],
            flag.clone(),
            openai_base.clone(),
        )
        .await
        {
            Ok(text) => text,
            Err(error) if error == "aborted" => {
                stopped("Session stopped.");
                return;
            }
            Err(error) => {
                emit_error(error);
                return;
            }
        };

        let action = match parse_step(&reply) {
            Step::Done(summary) => {
                let summary = if summary.trim().is_empty() {
                    "The model finished without further instructions.".to_string()
                } else {
                    summary
                };
                let _ = app.emit("cu-done", json!({ "sessionId": session_id, "summary": summary }));
                return;
            }
            Step::Act(action) => {
                unparsed_streak = 0;
                action
            }
            // Prose / malformed JSON: nudge the model by looping with the
            // skipped note in recent_actions; give up after 3 in a row.
            Step::Unparsed => {
                unparsed_streak += 1;
                if unparsed_streak >= 3 {
                    let _ = app.emit(
                        "cu-done",
                        json!({
                            "sessionId": session_id,
                            "summary": "Stopped — the model kept replying in prose instead of a JSON action."
                        }),
                    );
                    return;
                }
                emit_status("planning", "That reply wasn't a usable action — trying again");
                recent_actions.push("skipped — reply was not a valid action".into());
                if recent_actions.len() > 6 {
                    recent_actions.remove(0);
                }
                performed += 1;
                continue;
            }
        };

        // --- Permission gate -------------------------------------------------
        if let Decision::Ask(need) = policy.decide(action.kind(), &action.target()) {
            emit_status("waiting", "Waiting for your permission");
            let prompt_id = uuid::Uuid::new_v4().to_string();
            let _ = app.emit(
                "cu-permission",
                json!({
                    "sessionId": session_id,
                    "promptId": prompt_id,
                    "title": need.title,
                    "detail": need.detail,
                    "destructive": need.destructive,
                }),
            );
            match wait_permission(&approvals, &prompt_id, &flag).await {
                Some(true) => policy.grant(action.kind(), &action.target()),
                Some(false) | None => {
                    let result = if flag.load(Ordering::Relaxed) {
                        "skipped — session was stopped"
                    } else {
                        "skipped — permission not granted"
                    };
                    let _ = app.emit(
                        "cu-action",
                        json!({ "sessionId": session_id, "action": &action, "result": result }),
                    );
                    recent_actions.push(format!("{} ({result})", action.describe()));
                    performed += 1;
                    continue;
                }
            }
        }

        // --- Act -------------------------------------------------------------
        emit_status("acting", &action.describe());
        if let Err(error) = perform(&mut controller, &action).await {
            emit_error(error);
            return;
        }
        let _ = app.emit(
            "cu-action",
            json!({ "sessionId": session_id, "action": &action, "result": "ok" }),
        );
        recent_actions.push(action.describe());
        if recent_actions.len() > 6 {
            recent_actions.remove(0);
        }
        performed += 1;
    }
}

fn cu_system_prompt() -> String {
    "You are Orin's computer-use agent. You look at screenshots of a desktop and choose \
     exactly one next action to reach the user's goal. Reply with ONE JSON object and \
     nothing else — no prose, no markdown fences."
        .into()
}

fn vision_message(instruction: &str, provider: &str, recent: &[String], frame_b64: &str) -> AiMessage {
    let recent_block = if recent.is_empty() {
        "(none yet — this is your first observation)".to_string()
    } else {
        recent.iter().map(|a| format!("- {a}")).collect::<Vec<_>>().join("\n")
    };
    let text = format!(
        "GOAL: {instruction}\n\n\
         Desktop: {provider}. Coordinates are normalized 0..1000 across the whole screen \
         (top-left corner is 0,0).\n\n\
         Recent actions:\n{recent_block}\n\n\
         Reply with exactly one JSON object choosing the next action:\n\
         {{\"action\":\"click\",\"x\":500,\"y\":300,\"button\":\"left\"}}   (button: left | right | double)\n\
         {{\"action\":\"move\",\"x\":500,\"y\":300}}\n\
         {{\"action\":\"type\",\"text\":\"hello\"}}\n\
         {{\"action\":\"key\",\"key\":\"enter\"}}   (combos like \"ctrl+s\" are allowed)\n\
         {{\"action\":\"scroll\",\"x\":500,\"y\":300,\"amount\":3}}\n\
         {{\"action\":\"drag\",\"fromX\":100,\"fromY\":100,\"toX\":400,\"toY\":400}}\n\
         {{\"action\":\"open_app\",\"name\":\"notepad\"}}\n\
         {{\"action\":\"focus_window\",\"title\":\"Settings\"}}\n\
         {{\"action\":\"wait\",\"ms\":500}}\n\n\
         When the goal has been reached, reply instead with:\n\
         {{\"action\":\"done\",\"summary\":\"what you accomplished\"}}"
    );
    AiMessage {
        role: "user".into(),
        parts: vec![
            MessagePart {
                kind: "image".into(),
                text: String::new(),
                media_type: "image/jpeg".into(),
                base64: frame_b64.to_string(),
            },
            MessagePart {
                kind: "text".into(),
                text,
                media_type: String::new(),
                base64: String::new(),
            },
        ],
    }
}

/// Parse exactly one JSON object out of the model reply (markdown fences are
/// tolerated). Anything that isn't a usable action returns Unparsed so the
/// loop can nudge the model instead of dying on chatty replies.
fn parse_step(reply: &str) -> Step {
    let fallback = || Step::Unparsed;
    let trimmed = reply.trim();
    let Some(start) = trimmed.find('{') else { return fallback() };
    let Some(end_rel) = trimmed.rfind('}') else { return fallback() };
    if end_rel < start {
        return fallback();
    }
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&trimmed[start..=end_rel]) else {
        return fallback();
    };
    let kind = value
        .get("action")
        .or_else(|| value.get("type"))
        .and_then(|v| v.as_str())
        .unwrap_or("done")
        .trim()
        .to_lowercase();
    let num = |keys: &[&str]| keys.iter().find_map(|k| value.get(*k).and_then(|v| v.as_f64()));
    let txt = |keys: &[&str]| {
        keys.iter().find_map(|k| value.get(*k).and_then(|v| v.as_str()).map(str::to_string))
    };

    use controller::clamp_norm;
    match kind.as_str() {
        "click" => Step::Act(CuAction::Click {
            x: clamp_norm(num(&["x"]).unwrap_or(500.0)),
            y: clamp_norm(num(&["y"]).unwrap_or(500.0)),
            button: txt(&["button"]).unwrap_or_else(|| "left".into()),
        }),
        "move" => Step::Act(CuAction::Move {
            x: clamp_norm(num(&["x"]).unwrap_or(500.0)),
            y: clamp_norm(num(&["y"]).unwrap_or(500.0)),
        }),
        "type" | "write" => match txt(&["text", "value"]) {
            Some(text) => Step::Act(CuAction::Type { text }),
            None => fallback(),
        },
        "key" | "press" => match txt(&["key"]) {
            Some(key) => Step::Act(CuAction::Key { key }),
            None => fallback(),
        },
        "scroll" => Step::Act(CuAction::Scroll {
            x: clamp_norm(num(&["x"]).unwrap_or(500.0)),
            y: clamp_norm(num(&["y"]).unwrap_or(500.0)),
            amount: num(&["amount", "delta"]).unwrap_or(3.0).clamp(-20.0, 20.0) as i32,
        }),
        "drag" => Step::Act(CuAction::Drag {
            from_x: clamp_norm(num(&["fromX", "from_x", "x1"]).unwrap_or(0.0)),
            from_y: clamp_norm(num(&["fromY", "from_y", "y1"]).unwrap_or(0.0)),
            to_x: clamp_norm(num(&["toX", "to_x", "x2"]).unwrap_or(0.0)),
            to_y: clamp_norm(num(&["toY", "to_y", "y2"]).unwrap_or(0.0)),
        }),
        "wait" => Step::Act(CuAction::Wait {
            ms: num(&["ms", "milliseconds"]).unwrap_or(500.0).clamp(50.0, 5000.0) as u64,
        }),
        "open_app" | "open" | "launch" => match txt(&["name", "app"]) {
            Some(name) => Step::Act(CuAction::OpenApp { name }),
            None => fallback(),
        },
        "focus_window" | "focus" | "activate" => match txt(&["title", "window"]) {
            Some(title) => Step::Act(CuAction::FocusWindow { title }),
            None => fallback(),
        },
        "done" | "finish" | "finished" | "complete" | "completed" | "stop" => {
            Step::Done(txt(&["summary", "text", "message"]).unwrap_or_default())
        }
        _ => fallback(),
    }
}

/// Poll `state.approvals` until `cu_permission_respond` lands a decision.
async fn wait_permission(
    approvals: &Arc<Mutex<HashMap<String, bool>>>,
    prompt_id: &str,
    flag: &Arc<AtomicBool>,
) -> Option<bool> {
    let deadline = Instant::now() + Duration::from_secs(PERMISSION_TIMEOUT_SECS);
    loop {
        if let Ok(mut map) = approvals.lock() {
            if let Some(decision) = map.remove(prompt_id) {
                return Some(decision);
            }
        }
        if flag.load(Ordering::Relaxed) {
            return None;
        }
        if Instant::now() >= deadline {
            return None;
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

async fn perform(controller: &mut AnyController, action: &CuAction) -> Result<(), String> {
    match action {
        CuAction::Move { x, y } => controller.move_mouse(*x, *y),
        CuAction::Click { x, y, button } => {
            controller.move_mouse(*x, *y)?;
            controller.click(button)
        }
        CuAction::Type { text } => controller.type_text(text),
        CuAction::Key { key } => controller.press_key(key),
        CuAction::Scroll { x, y, amount } => controller.scroll(*x, *y, *amount),
        CuAction::Drag { from_x, from_y, to_x, to_y } => {
            controller.drag((*from_x, *from_y), (*to_x, *to_y))
        }
        CuAction::Wait { ms } => {
            tokio::time::sleep(Duration::from_millis((*ms).min(5000))).await;
            Ok(())
        }
        CuAction::OpenApp { name } => controller.open_app(name),
        CuAction::FocusWindow { title } => controller.focus_window(title),
    }
}
