# Orin AI desktop app

An agent-first desktop code workspace: projects and files on the left, conversation in the center, and Monaco code/activity on the right.

## Implemented

- Safe Electron IPC for choosing folders and reading/saving text files
- Project file tree and Monaco editor
- Multiple persistent chats per project (IndexedDB)
- Independent worker-backed agent runs per chat
- Subagents that run in parallel and appear in the parent chat/activity view
- Streaming local agent mock, stop controls, dark responsive UI, and Orin branding

## Compile

```powershell
cd "C:\Users\janut\Downloads\Orin AI - PC\orin-desktop-app"
npm run build
```

## Package a Windows installer

```powershell
npm run electron:build
```

The worker is deliberately a local mock until a model provider is selected. Connect a local model or an API behind `src/services/agentService.js` without changing the UI/store contracts.
