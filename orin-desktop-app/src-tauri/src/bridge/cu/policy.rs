// Session-level safety policy for Computer Use. Kept deliberately simple but
// real: ordinary input is "normal", launching/focusing apps consults a session
// allowlist, and everything on the real Windows desktop waits for one explicit
// session-wide approval.

pub struct PermissionNeed {
    pub title: String,
    pub detail: String,
    pub destructive: bool,
}

pub enum Decision {
    Allow,
    Ask(PermissionNeed),
}

pub struct SessionPolicy {
    /// "virtual" or "windows".
    pub provider: String,
    /// Set once the user pre-approves ordinary mouse/keyboard input for the
    /// rest of the session.
    pub allow_all: bool,
    /// Apps/windows the user has explicitly approved this session. Starts
    /// empty, so open_app/focus_window always ask first.
    pub allowed_apps: Vec<String>,
}

impl SessionPolicy {
    pub fn new(provider: &str) -> Self {
        Self {
            provider: provider.to_string(),
            allow_all: false,
            allowed_apps: Vec::new(),
        }
    }

    pub fn decide(&self, action: &str, target: &str) -> Decision {
        if matches!(action, "open_app" | "focus_window") {
            let key = target.trim().to_lowercase();
            let approved = self.allow_all || self.allowed_apps.iter().any(|a| a.trim().to_lowercase() == key);
            if approved {
                return Decision::Allow;
            }
            return if action == "open_app" {
                Decision::Ask(PermissionNeed {
                    title: format!("Open “{target}”?"),
                    detail: format!(
                        "Orin wants to launch the app “{target}” on your {} desktop.",
                        self.provider
                    ),
                    destructive: true,
                })
            } else {
                Decision::Ask(PermissionNeed {
                    title: format!("Focus window “{target}”?"),
                    detail: "Orin wants to bring a window to the foreground.".into(),
                    destructive: false,
                })
            };
        }

        // Ordinary input (click/type/key/scroll/move/drag/wait): simulated and
        // harmless on the virtual provider; on the real desktop it waits for a
        // single session approval.
        if self.provider == "windows" && !self.allow_all {
            return Decision::Ask(PermissionNeed {
                title: "Allow control of your desktop?".into(),
                detail: "Orin wants to move the mouse and type on your real desktop. \
                         Approving once allows input for the rest of this session."
                    .into(),
                destructive: false,
            });
        }
        Decision::Allow
    }

    /// Remember an approval so later actions of the same shape flow through
    /// without re-prompting.
    pub fn grant(&mut self, action: &str, target: &str) {
        match action {
            "open_app" | "focus_window" => {
                let key = target.trim().to_lowercase();
                if !key.is_empty() && !self.allowed_apps.iter().any(|a| a.trim().to_lowercase() == key) {
                    self.allowed_apps.push(key);
                }
            }
            _ => self.allow_all = true,
        }
    }
}
