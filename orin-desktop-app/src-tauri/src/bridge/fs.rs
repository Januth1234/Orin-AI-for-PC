// Filesystem, folder picking, git status, and text search commands.
use serde::Serialize;
use std::path::Path;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Clone)]
pub struct FolderPick {
    pub name: String,
    pub path: String,
}

#[tauri::command]
pub async fn dialog_pick_folder(app: AppHandle) -> Result<Option<FolderPick>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel::<Option<std::path::PathBuf>>();
    app.dialog()
        .file()
        .pick_folder(move |file_path| {
            let picked = file_path.and_then(|p| p.into_path().ok());
            let _ = tx.send(picked);
        });
    Ok(rx.await.unwrap_or(None).and_then(|path| {
        let name = path.file_name()?.to_string_lossy().to_string();
        Some(FolderPick { name, path: path.to_string_lossy().to_string() })
    }))
}

#[derive(Serialize, Clone)]
pub struct FileNode {
    pub name: String,
    #[serde(rename = "type")]
    pub kind: String, // "file" | "folder"
    pub size: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub children: Option<Vec<FileNode>>,
}

fn ignored(name: &str) -> bool {
    matches!(
        name,
        "node_modules" | ".git" | "target" | "dist" | "build" | ".next" | ".venv" | "__pycache__" | ".vs" | "out"
    )
}

fn walk(dir: &Path, depth: u32, budget: &mut usize) -> Vec<FileNode> {
    let mut nodes = Vec::new();
    if depth == 0 || *budget == 0 {
        return nodes;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return nodes };
    let mut entries: Vec<_> = entries.flatten().collect();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        if *budget == 0 {
            break;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(file_type) = entry.file_type() else { continue };
        let path = entry.path();
        if file_type.is_dir() {
            if ignored(&name) {
                continue;
            }
            *budget -= 1;
            let children = walk(&path, depth - 1, budget);
            nodes.push(FileNode { name, kind: "folder".into(), size: 0, children: Some(children) });
        } else {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            *budget -= 1;
            nodes.push(FileNode { name, kind: "file".into(), size, children: None });
        }
    }
    nodes
}

const SKIP_BINARY_EXT: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "exe", "dll", "so", "dylib",
    "zip", "gz", "tar", "7z", "rar", "pdf", "woff", "woff2", "ttf", "otf", "eot",
    "mp3", "mp4", "mov", "avi", "mkv", "wasm", "pdb", "lib", "a", "class", "jar",
];

#[tauri::command]
pub fn fs_read_dir(path: String, depth: u32) -> Result<Vec<FileNode>, String> {
    let mut budget = 800usize;
    Ok(walk(Path::new(&path), depth.clamp(1, 4), &mut budget))
}

#[tauri::command]
pub async fn fs_read_file(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        if meta.len() > 4 * 1024 * 1024 {
            return Err("File is too large to open in the editor (over 4 MB).".into());
        }
        let ext = Path::new(&path)
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if SKIP_BINARY_EXT.contains(&ext.as_str()) {
            return Err(format!("“{}” is a binary file and can't be shown as text.", file_name_of(&path)));
        }
        std::fs::read_to_string(&path).map_err(|e| format!("Could not read {}: {}", file_name_of(&path), friendly_io_error(&e)))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_write_file(path: String, content: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(parent) = Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, content).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn fs_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[derive(Serialize)]
pub struct GitStatusMap(pub std::collections::HashMap<String, char>);

#[tauri::command]
pub async fn git_status(root: String) -> Result<GitStatusMap, String> {
    use std::process::Command;
    let root2 = root.clone();
    let output = tauri::async_runtime::spawn_blocking(move || {
        Command::new("git")
            .args(["-C", &root2, "status", "--porcelain"])
            .output()
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|_| "not a git repository".to_string())?;

    if !output.status.success() {
        return Err("not a git repository".into());
    }
    let mut map = std::collections::HashMap::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        if line.len() < 4 {
            continue;
        }
        let code = line.as_bytes()[0] as char;
        let code2 = line.as_bytes()[1] as char;
        let status_char = match (code, code2) {
            ('?', _) => '?',
            ('A', _) | (_, 'A') => 'A',
            ('D', _) | (_, 'D') => 'D',
            ('U', _) | (_, 'U') | ('A', 'A') => 'U',
            _ => 'M',
        };
        map.insert(line[3..].trim().to_string(), status_char);
    }
    Ok(GitStatusMap(map))
}

#[derive(Serialize)]
pub struct SearchHit {
    pub path: String,
    pub line: u32,
    pub text: String,
}

#[tauri::command]
pub async fn search_workspace(root: String, query: String, max_results: u32) -> Result<Vec<SearchHit>, String> {
    if query.trim().is_empty() {
        return Ok(vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || search_sync(Path::new(&root), &query, max_results))
        .await
        .map_err(|e| e.to_string())
}

fn search_sync(root: &Path, query: &str, max_results: u32) -> Vec<SearchHit> {
    let needle = query.to_lowercase();
    let mut hits = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if hits.len() >= max_results as usize {
            break;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if path.is_dir() {
                if !ignored(&name) {
                    stack.push(path);
                }
                continue;
            }
            if SKIP_BINARY_EXT.iter().any(|ext| name.to_lowercase().ends_with(ext)) {
                continue;
            }
            let Ok(content) = std::fs::read(&path) else { continue };
            if content.len() > 1024 * 1024 {
                continue;
            }
            let text = String::from_utf8_lossy(&content);
            for (index, line) in text.lines().enumerate() {
                if line.to_lowercase().contains(&needle) {
                    hits.push(SearchHit {
                        path: path.to_string_lossy().to_string(),
                        line: (index + 1) as u32,
                        text: line.trim().chars().take(200).collect(),
                    });
                    if hits.len() >= max_results as usize {
                        return hits;
                    }
                    break; // one hit per file keeps results diverse
                }
            }
        }
    }
    hits
}

fn file_name_of(path: &str) -> String {
    Path::new(path)
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string())
}

fn friendly_io_error(error: &std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => "it no longer exists".into(),
        std::io::ErrorKind::PermissionDenied => "access was denied".into(),
        _ => error.to_string(),
    }
}
