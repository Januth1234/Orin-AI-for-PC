# Orin AI

Orin AI is a free AI code editor - a rebrand and extension of
[Void](https://github.com/voideditor/void) (a VS Code fork with a built-in
AI layer instead of relying on extensions). This repo tracks that work:
stripping Void's branding, redesigning the UI, and extending the model
layer with custom backend/MCP/Ollama support.

Status: early. This repo currently holds the rebrand patch and the new UI
components, not yet a merged, buildable copy of the full editor source.
See [Status](#status) below before expecting a working build.

## What Orin AI is

- A free, full AI-native code editor (not an extension bolted onto VS Code)
- Two top-level modes: **Chat** and **Agent** (Agent edits code directly and
  shows the changes live, similar to how Void's existing diff/checkpoint
  system already works under `editCodeService`)
- Model-agnostic: bring your own API key (OpenAI, Anthropic, Gemini,
  Mistral, Groq, etc. - Void already wires most of these up), run fully
  local via **Ollama**, or point it at a custom backend once that's ready
- Custom **MCP server** support (Void already ships an MCP service; Orin
  keeps and extends it)
- A UI redesigned around a Claude-Desktop-style layout: a collapsible
  sidebar with Recents, a centered greeting + input on an empty thread,
  and a Chat/Agent pill toggle instead of a mode dropdown

## Status

| Piece | State |
|---|---|
| Branding (`product.json`, icons, installer metadata) | Drafted in `patches/product-json/product.json` - placeholders (win32 GUIDs, repo URLs) still need real values |
| Sidebar UI (`OrinHome`, `ChatModePills`, `OrinMark`) | Built, not yet wired into a live build - see `docs/INTEGRATION.md` |
| Logomark + "thinking" animation | Built (`OrinMark.tsx`) |
| Merge with full Void source tree | Not done yet |
| Custom backend as a model provider | Not started - waiting on the backend's own API redesign |
| Packaged installer (.exe/.dmg) | Not built - needs a full Electron build via a CI pipeline (e.g. a fork of `voideditor/void-builder`), not something buildable from a patch repo alone |

## Repo layout

```
patches/product-json/   Rebranded product.json (drop-in replacement for Void's)
src/.../sidebar-tsx/    New UI components (OrinHome, ChatModePills, OrinMark)
docs/INTEGRATION.md     Exact steps + file locations to wire these into a Void checkout
```

## Building

There's no standalone build yet - these files patch on top of a full Void
checkout. To try it:

1. Clone [voideditor/void](https://github.com/voideditor/void)
2. Copy `patches/product-json/product.json` over the root `product.json`,
   filling in the placeholders (win32 GUIDs, repo URLs)
3. Copy everything under `src/.../sidebar-tsx/` into the matching path in
   your Void checkout
4. Follow `docs/INTEGRATION.md` for the two small edits needed in
   `Sidebar.tsx`/`SidebarChat.tsx`
5. `npm install`, then `npm run gulp vscode-win32-x64` (or the equivalent
   target for your platform) for a local build, or point a
   `void-builder`-style CI pipeline at the result for a signed installer

## License

MIT, matching Void's own license.

## Author

Januth Nimnal
