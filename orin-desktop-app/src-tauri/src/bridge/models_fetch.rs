// Dynamic model discovery per provider — hits the provider's real models
// endpoint and returns the live catalog (including free tiers) for the selector.
use super::ai::ModelInfo;
use super::presets;
use crate::bridge::AppState;

fn tier_and_dots(id: &str, key_required: bool) -> (&'static str, u8, u8) {
    let lower = id.to_lowercase();
    if lower.contains("free") {
        ("fast", 3, 2)
    } else if lower.contains("opus") || lower.contains("ultra") || lower.contains("max") || lower.contains("r1") || lower.contains("reason") {
        ("reasoning", 1, 3)
    } else if lower.contains("mini") || lower.contains("flash") || lower.contains("haiku") || lower.contains("small") || lower.contains("nano") || lower.contains("8b") || lower.contains("7b") {
        ("fast", 3, 2)
    } else if key_required {
        ("balanced", 2, 2)
    } else {
        ("balanced", 2, 2)
    }
}

fn to_info(preset_id: &str, model_id: &str, label: &str, key_required: bool) -> ModelInfo {
    let (tier, speed, intelligence) = tier_and_dots(model_id, key_required);
    ModelInfo {
        id: format!("{preset_id}/{model_id}"),
        provider: preset_id.into(),
        label: label.into(),
        tier: tier.into(),
        speed,
        intelligence,
        context_tokens: 128_000,
    }
}

/// Fetch the live model list for one preset. Never fails hard — errors come
/// back as a friendly string for the UI to show inline.
pub async fn fetch_for_preset(state: &AppState, preset_id: &str) -> Result<Vec<ModelInfo>, String> {
    let preset = presets::find(preset_id)
        .ok_or_else(|| format!("Unknown provider “{preset_id}”."))?
        ;

    let base = presets::resolve_base_url(
        preset_id,
        &super::store::read_setting(state, "openai_compat/baseUrl"),
    );
    let key = super::ai::keyring_read(preset_id);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let mut request = match preset.list_kind {
        "ollama" => client.get(format!("http://localhost:11434/api/tags")),
        _ => client.get(format!("{base}/models")),
    };
    if preset.key_required {
        if let Some(key) = &key {
            request = request.bearer_auth(key);
        }
    }
    let response = request.send().await.map_err(|error| format!("Could not reach {label}: {error}", label = preset.label))?;
    if !response.status().is_success() {
        return Err(format!(
            "{} returned HTTP {}.{}",
            preset.label,
            response.status().as_u16(),
            if preset.key_required && key.is_none() { " Add an API key first." } else { "" }
        ));
    }

    let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let mut models: Vec<ModelInfo> = Vec::new();
    let push = |models: &mut Vec<ModelInfo>, id: String| {
        if id.is_empty() { return; }
        models.push(to_info(preset_id, &id, &id, preset.key_required));
    };

    // OpenAI shape: {"data":[{"id":…}]} · Ollama shape: {"models":[{"name":…}]}
    if let Some(items) = body["data"].as_array() {
        for item in items {
            if let Some(id) = item["id"].as_str() {
                push(&mut models, id.to_string());
            }
        }
    } else if let Some(items) = body["models"].as_array() {
        for item in items {
            if let Some(id) = item["name"].as_str().or_else(|| item["model"].as_str()) {
                push(&mut models, id.to_string());
            }
        }
    }

    models.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(models)
}
