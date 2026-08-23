# Orin AI — QA checklist against the product spec

Working gate for every phase: `cargo check` (src-tauri) exit 0 · `npm run typecheck` exit 0 ·
`npm run lint` exit 0 · `npm run build` succeeds · `npm run app:dev` boots to a usable window.

## Shell & home (spec §1–3, §38)
- [ ] Frameless window: custom title bar drags; min/max/close work; snap layouts work.
- [ ] Nav rail collapses (Ctrl+B); collapsed icons show tooltips.
- [ ] Home: greeting + bolt mark, vast negative space, composer centered; no dashboard clutter.
- [ ] Light theme renders correctly; dark is default.

## Composer & conversations (§4–8, §19–21, §30)
- [ ] Enter sends, Shift+Enter newlines; textarea grows past ~10 rows then scrolls.
- [ ] Attach via button, drag-drop, paste image → chips with remove; image parts reach the model.
- [ ] Slash menu at line start; mode selector (Chat/Cowork/Agent) switches per conversation.
- [ ] Model dropdown lists configurable catalog with speed/intelligence/context; selection persists.
- [ ] Streaming renders incrementally; Stop cancels; errors show friendly card + Retry + technical details.
- [ ] History: rename/pin/archive/delete/move-to-project via hover menus; fuzzy search works.
- [ ] New chat resets context, keeps project binding; templates offered.

## Projects & knowledge (§9–10, §27)
- [ ] Create/open/rename/remove project; open-folder flow reads a real tree.
- [ ] Knowledge files list with name/type/size/added/status; remove works.
- [ ] Custom instructions persist and are injected into project chats.

## Artifacts (§11–12, §31–32)
- [ ] Artifact created from chat appears in panel + library page.
- [ ] Preview | Code | Console tabs; HTML preview sandboxed and interactive.
- [ ] Desktop/Tablet/Mobile width toggles; refresh; copy; download; rename.
- [ ] Versions append with AI summaries; switching versions stages content; Restore creates v(n+1).

## IDE (§13, §15–16)
- [ ] Explorer tree with folders/files/filter + git status dots from real repo.
- [ ] Multi-tab Monaco editing; Ctrl+S writes through fs_write_file; dirty markers.
- [ ] ConPTY terminal: prompt appears, commands execute, ANSI stripped, ↑ history, Ctrl+C works.
- [ ] AI panel runs agent task: plan timeline ✓/●, tool cards expandable, diffs Accept/Reject wired to approvals.

## Agent & tasks (§14–17, §28–29)
- [ ] Agent loop edits files only after approval; Reject skips cleanly; loop ends with summary.
- [ ] Destructive commands always ask; Stop kills mid-run.
- [ ] Toast notifications appear for completion/failures; no raw exception text in UI.

## Computer Use (§45–49)
- [ ] Mode switchable; CU workspace shows screen stage + right panel + bottom activity bar.
- [ ] Virtual provider completes a scripted demo task end-to-end with visible frame changes.
- [ ] Windows provider: capture shows the real screen; normalized coordinates click/type accurately at 100%/150% DPI.
- [ ] Permission prompts gate app launches/destructive actions; Stop aborts instantly.
- [ ] Status strings shown ("Looking at the screen"…) — never hidden reasoning.

## Platform (§22–26, §33–37)
- [ ] Ctrl+K search across conversations/projects/artifacts/files with typed results.
- [ ] Command palette lists core actions; executes them.
- [ ] Settings two-column layout; Models tab stores keys in OS credential manager (verify keyring entry exists).
- [ ] Customize: theme/accent/density/font size/code font apply live and persist across restart.
- [ ] Skills create/toggle/persist; Connectors show honest "Not connected".
- [ ] Every empty state polished (projects/artifacts/knowledge/terminal/search-no-results).
- [ ] Responsive: ≤900px adjustments; IDE degrades gracefully.

## Packaging (§40, §44)
- [ ] State survives app restart (chats/projects/artifacts/settings/layout).
- [ ] `npm run app:build` produces NSIS installer with Orin branding; install → launch → smoke pass.
