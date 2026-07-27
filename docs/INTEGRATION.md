# Wiring OrinHome + ChatModePills into the sidebar

Drop both files into:
`src/vs/workbench/contrib/void/browser/react/src/sidebar-tsx/`

## 1. Add the accent color token

`browser/react/tailwind.config.js` only defines `void-*` tokens today. Add one
line next to them (around line 67, near `void-warning`):

```js
'orin-accent': 'var(--orin-accent)',
```

Then define `--orin-accent` alongside the other `--void-*` CSS vars wherever
those are declared for light/dark (search for `--void-warning` to find the
file - it's set per-theme, not in the React tree). Pick your accent hex there;
everything else in these two components already rides the existing
`void-bg-*` / `void-fg-*` tokens, so once the base Void theme is retextured
the rest of the UI updates automatically.

## 2. Show OrinHome only when a thread is empty

In `Sidebar.tsx`, `SidebarChat` currently always renders. Gate it on whether
the current thread has messages, based on `useChatThreadsState()` (same hook
`SidebarThreadSelector.tsx` already uses for `allThreads`):

```tsx
import { useChatThreadsState } from '../util/services.js';
import { OrinHome } from './OrinHome.js';

const threadsState = useChatThreadsState();
const currentThread = threadsState.allThreads[threadsState.currentThreadId];
const isEmpty = !currentThread || currentThread.messages.length === 0;

return isEmpty
	? <OrinHome name={/* wire to a real profile value later */ undefined}>
			<SidebarChat />
		</OrinHome>
	: <SidebarChat />
```

Double check the exact field names on `ThreadsState` /
`chatThreadServiceTypes.ts` before wiring this in - I inferred
`currentThreadId` from `chatThreadService.ts` naming conventions but didn't
have the full type in front of me when writing this.

## 3. Swap the mode control

In `SidebarChat.tsx`, replace the `ChatModeDropdown` usage:

```diff
- {featureName === 'Chat' && <ChatModeDropdown className='...' />}
+ {featureName === 'Chat' && <ChatModePills />}
```

You can leave the old `ChatModeDropdown` function in place (or delete it) -
`ChatModePills` reads/writes the same `globalSettings.chatMode` setting, so
nothing else in the app needs to change.

## Still open from the rebrand pass

- `product.json`: `nameShort`/`nameLong` -> "Orin AI", `applicationName`,
  `dataFolderName` (`.void-editor` -> `.orin`), `win32*` keys,
  `darwinBundleIdentifier`, `linuxIconName`, `urlProtocol`,
  `linkProtectionTrustedDomains`
- App icons/resources under `resources/`
- The "Code" section (live AI edits) - this reuses `editCodeService.ts`'s
  existing diff/checkpoint system; next step once you're ready for it
