// Provider preset registry — one OpenAI-compatible streaming engine serves
// every router/provider below; each preset carries its endpoint and key policy.
// Model ids are namespaced `<preset>/<model>` and dispatch on the first segment.

pub struct Preset {
    pub id: &'static str,
    pub label: &'static str,
    pub base_url: &'static str,
    pub key_required: bool,
    /// How to list models: "openai" (GET {base}/models) or "ollama" (GET {base}/../api/tags).
    pub list_kind: &'static str,
}

pub const PRESETS: &[Preset] = &[
    Preset { id: "openrouter", label: "OpenRouter", base_url: "https://openrouter.ai/api/v1", key_required: true, list_kind: "openai" },
    Preset { id: "groq", label: "Groq", base_url: "https://api.groq.com/openai/v1", key_required: true, list_kind: "openai" },
    Preset { id: "deepseek", label: "DeepSeek", base_url: "https://api.deepseek.com/v1", key_required: true, list_kind: "openai" },
    Preset { id: "mistral", label: "Mistral", base_url: "https://api.mistral.ai/v1", key_required: true, list_kind: "openai" },
    Preset { id: "together", label: "Together", base_url: "https://api.together.xyz/v1", key_required: true, list_kind: "openai" },
    Preset { id: "fireworks", label: "Fireworks", base_url: "https://api.fireworks.ai/inference/v1", key_required: true, list_kind: "openai" },
    Preset { id: "xai", label: "xAI (Grok)", base_url: "https://api.x.ai/v1", key_required: true, list_kind: "openai" },
    Preset { id: "openai", label: "OpenAI", base_url: "https://api.openai.com/v1", key_required: true, list_kind: "openai" },
    Preset { id: "gemini", label: "Google Gemini", base_url: "https://generativelanguage.googleapis.com/v1beta/openai", key_required: true, list_kind: "openai" },
    Preset { id: "ollama", label: "Ollama (local)", base_url: "http://localhost:11434/v1", key_required: false, list_kind: "ollama" },
    Preset { id: "lmstudio", label: "LM Studio (local)", base_url: "http://localhost:1234/v1", key_required: false, list_kind: "openai" },
    Preset { id: "vllm", label: "vLLM (local)", base_url: "http://localhost:8000/v1", key_required: false, list_kind: "openai" },
    Preset { id: "litellm", label: "LiteLLM proxy", base_url: "http://localhost:4000/v1", key_required: false, list_kind: "openai" },
];

pub fn find(preset_id: &str) -> Option<&'static Preset> {
    PRESETS.iter().find(|preset| preset.id == preset_id)
}

/// Which keyring slot stores this preset's API key. The legacy generic slot
/// "openai_compat" is kept for backward compatibility.
pub fn keyring_user(preset_id: &str) -> String {
    if preset_id == "openai_compat" || preset_id == "openai" {
        "openai_compat".to_string()
    } else {
        preset_id.to_string()
    }
}

/// Resolve the base URL for a preset: per-preset KV override → preset default.
/// `custom` carries the legacy generic override ("openai_compat/baseUrl").
pub fn resolve_base_url(preset_id: &str, custom: &Option<String>) -> String {
    if let Some(custom_url) = custom {
        if !custom_url.trim().is_empty() && (preset_id == "openai_compat" || preset_id == "custom") {
            return custom_url.trim().trim_end_matches('/').to_string();
        }
    }
    find(preset_id)
        .map(|preset| preset.base_url.to_string())
        .unwrap_or_else(|| "https://openrouter.ai/api/v1".to_string())
}

pub fn is_openai_compatible(preset_id: &str) -> bool {
    preset_id != "anthropic" && preset_id != "mock"
}
