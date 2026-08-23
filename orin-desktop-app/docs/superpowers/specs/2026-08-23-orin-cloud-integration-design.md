# Design: Orin AI Cloud Integration (Tauri desktop app ↔ orinai.org)

Date: 2026-08-23 · Status: draft for review
Scope repo(s): `orin-desktop-app/` (primary), `D:\Orin_AI` backend (small additive changes)

## 1. Summary & goals

Make the standalone Tauri desktop app the official signed-in Orin AI client:
users sign in with their existing Orin AI account (name + email-or-phone +
password, backed by `/api/auth/password`), chat through the quota-metered Orin
Cloud route without bringing their own API key, keep BYO-key mode working, and
sync settings/chats across devices. This is phase 1 of converging three
parallel efforts (backend, Tauri app, legacy Electron pc-app) into one product;
retiring pc-app comes later.

**Goals**
- Sign-in/register inside the desktop app using the production account system.
- Chat via Orin Cloud (server-side quotas per Stripe plan) OR local BYO keys.
- Sync settings + chat history per user, opt-out-able.
- No secrets stored in plaintext; reuse existing backend endpoints wherever possible.

**Non-goals (this phase)**
- Google OAuth inside the desktop app (popup flow is broken in Electron-class shells by design; password accounts cover it — Google users add a password once).
- Remote "drive my PC from orinai.org" (executor pairing) — phase 3.
- Deleting pc-app — after phase 1 ships and proves out.

## 2. Current state (verified 2026-08-23)

Backend (`D:\Orin_AI`, staged overhaul documented in its CHANGELOG):
- `POST /api/auth/password {action:'register'|'login'|'set-password'}` → `{customToken, user}`; scrypt hashes in deny-all Firestore collections; identifier + IP rate limiting.
- Clients exchange `customToken` → ID/refresh tokens via Firebase Identity Toolkit REST (web config public-safe in `public/firebase-config.js`; projectId `orin-ai-f6798`).
- `POST /api/chat` accepts Bearer Firebase ID token, enforces per-plan quotas server-side, routes text modes → OpenRouter, media/tool modes → Gemini.
- CORS allow-list in `api/_lib/http.js` covers web origins + Capacitor; **no Tauri origins yet**.
- Executor channel (HMAC compact-JSON, long-poll) exists for paired PCs — untouched here.

Tauri app (`orin-desktop-app/`):
- Rust core commands registered in `src-tauri/lib.rs` (`generate_handler![]`); `AppState` in `bridge/mod.rs`; SQLite KV at `%APPDATA%/orin-ai/workspace.db`; provider keys already in OS keyring.
- `ai_impl.rs` implements anthropic / openai_compat / offline-mock providers behind `AiSendRequest{requestId,modelId,system,messages,max_tokens}`.
- UI stores persist via `storeGet/storeSet` keys (`settings`, `chats`, …); zero cloud references today.

## 3. Approaches considered

**A. Native sign-in in the Rust core (recommended).** New `bridge/auth.rs`
does the two REST calls itself (password endpoint, then Identity Toolkit
exchange); refresh token lives in the OS keyring; ID token cached in memory
and refreshed on expiry. A new "Orin Cloud" provider in `ai_impl.rs` routes
chat through `/api/chat` with the Bearer token. Sync via one thin new
endpoint. *Trade-offs:* ~300 lines of new Rust + reqwest calls we fully
control; no webview dependency; works offline-gracefully (falls back to mock/
BYO when signed out). Chosen: smallest permanent surface, matches the
"renderer never touches IO" architecture, and avoids re-coupling the desktop
app to web-app internals (the coupling that made pc-app fragile).

**B. Embedded web sign-in (pc-app pattern).** Load orinai.org in a child
webview, let `OrinAuthPanel.tsx` do the work, forward tokens over a JS bridge.
*Rejected:* drags the whole site into the installer UX, couples us to web DOM
structure (brittle), and adds a second auth codepath to maintain.

**C. Local-first, defer cloud.** Polish Computer Use only. *Rejected:* leaves
accounts/billing stranded in the web app and keeps the product fragmented;
the backend primitives landed today and are idle until a client uses them.

## 4. Architecture

```
┌─ ui/ React ───────────────────────────────────────────────┐
│ Settings ▸ Account card (sign-in/out, plan chip)          │
│ NavRail avatar · cloud/local model badge in composer      │
└──────────────┬────────────────────────────────────────────┘
       invoke  │ (typed bridge commands only)
┌─ src-tauri Rust core ─────────────────────────────────────┐
│ bridge/auth.rs   login/register/status/logout             │
│   ├→ POST orinai.org/api/auth/password                    │
│   └→ POST identitytoolkit signInWithCustomToken           │
│       refresh: securetoken grant_type=refresh_token       │
│   tokens: refresh→keyring · id-token→memory (≈1 h TTL)    │
│ bridge/sync.rs   sync_pull / sync_push (≤512 KB JSON)     │
│ ai_impl.rs +orin_cloud provider → POST /api/chat          │
│   (mode:'chat', Bearer id-token, same streaming shape)    │
└──────────────┬────────────────────────────────────────────┘
               │ HTTPS
┌─ D:\Orin_AI backend (additive) ───────────────────────────┐
│ ALLOWED_ORIGINS += tauri://localhost, http://tauri.localhost│
│ NEW GET/PUT /api/desktop-sync (Bearer uid-scoped blob)    │
│ existing /api/auth/password, /api/chat unchanged          │
└───────────────────────────────────────────────────────────┘
```

Data flow (chat): composer → `ai_send(modelId='orin/pro')` → ai_impl sees
provider `orin_cloud` → checks `auth.rs` session (refresh if >50 min old) →
POSTs to `/api/chat` (mode:'chat', Bearer id-token). Note: `/api/chat` is
**non-streaming** today (returns `{text}` as complete JSON — verified in the
source), so the core emits the finished text as one assistant-message event;
chatsStore renders it unchanged. Cosmetic word-chunking can fake streaming in
the UI later; true server streaming (SSE) stays a backend follow-up.

## 5. Backend changes (small, additive)

1. `api/_lib/http.js`: add `tauri://localhost` + `http://tauri.localhost` to
   `ALLOWED_ORIGINS` (WebView2 production + dev custom protocol).
2. New `api/desktop-sync.js`: `GET` returns caller's blob; `PUT` validates
   Bearer token, JSON ≤512 KB, stores at `desktop_sync/{uid}` (new rule line:
   read/write own doc only); naive ETag `updatedAt` for conflict detection —
   last-write-wins v1, per-field merge deferred.
3. `.env.example`: document nothing new (uses standard Firebase env already loaded).

## 6. Rust core additions

New module `bridge/auth.rs` (commands): `auth_login(identifier, password)`,
`auth_register(name, identifier, password)`, `auth_status()`,
`auth_logout()`. Session struct `{uid,name,email,phone,plan?}` persisted
(non-secret parts) to SQLite KV key `auth.session`; refresh token keyed
`orin-refresh:<uid>` in keyring. Token refresh is single-flight (Mutex) and
proactive (>50 min). Network errors surface as typed errors the UI maps to
friendly copy; signed-out is a first-class state — every cloud call degrades
to local behavior.

New provider in `ai_impl.rs`: `orin_cloud` — maps `modelId` `orin/*` to
`/api/chat` `mode:'chat'`; the non-streaming `{text}` response is emitted as a
single assistant-message event so chatsStore needs no changes. `models_list`
gains
cloud models **only while signed in** (labelled "Orin Cloud", speed/intelligence tiers mirror the web pricing page).

New module `bridge/sync.rs`: `sync_push(payload)` / `sync_pull()` wrapping
the endpoint; called from the UI hydrate/persist paths (debounced push ≤1/30 s,
pull on launch + on window focus). Payload = `{settings, chats}` blobs exactly
as stored locally today, plus `schemaVersion:1`.

## 7. UI surfaces

- Settings ▸ new **Account** section: email/phone + password form (reusing
  Button/Input/Modal primitives; register ⇄ login tabs like OrinAuthPanel),
  plan badge, usage note ("metered by your Orin AI plan"), sign-out.
- Composer model dropdown: "Orin Cloud" group appears when signed in; a small
  cloud/offline indicator explains which route a model uses.
- Sync toggle in Settings ▸ Customize ("Sync across devices", default ON when
  signed in); signing out offers keep-local vs wipe-local choice for synced data.

## 8. Security considerations

Refresh token only in OS keyring (never SQLite/JSON); ID token memory-only.
All traffic HTTPS to orinai.org; no third-party SDK added. CORS stays an
allow-list (Tauri origins added explicitly). Server remains authoritative for
plan/quota — client cannot self-upgrade. Rate limits inherited from the
password endpoint. Sync endpoint size-capped and schema-versioned to blunt
abuse; blobs are private per-uid by Firestore rules.

## 9. Testing

- Rust unit tests: token-refresh single-flight, expiry math, error mapping
  (mirror `_lib` assertions style used in the backend pass).
- Mock-mode parity: signed-out + `mock/orin-offline` must remain the complete
  browser-dev experience (`npm run dev`) — CI typecheck/lint stays green.
- Contract test script (Node, against staging deploy): register → exchange →
  chat quota bump → sync PUT/GET roundtrip → logout.
- Manual matrix: signed-out cold start, expired-token mid-chat, airplane-mode
  start, keyring-denied (Linux CI parity not needed; Windows manual).

## 10. Rollout

Phase 1a (this spec's build): auth + Orin Cloud provider + Account UI.
Phase 1b: settings/chat sync behind the toggle.
Phase 2: plan-gated feature surfaces in-app (usage page).
Phase 3: executor pairing from the Tauri app → retire pc-app.

## 11. Open questions (for review)

1. Sync scope v1: settings+chats only, or also artifacts/projects metadata?
   *(Recommendation: settings+chats; artifacts stay local until they earn sync.)*
2. Should cloud chat history ALSO land in Firestore for the web app to show?
   *(Recommendation: no for v1 — desktop_sync blob keeps the two surfaces independent.)*
3. Model naming for cloud tier (`orin/pro` vs passthrough OpenRouter ids)?
   *(Recommendation: friendly `orin/*` ids mapped server-side later.)*
