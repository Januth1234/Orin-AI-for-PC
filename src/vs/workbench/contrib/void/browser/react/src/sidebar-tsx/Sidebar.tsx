/*--------------------------------------------------------------------------------------
 *  Copyright 2025 Glass Devtools, Inc. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useFullChatThreadsStreamState, useIsDark } from '../util/services.js';
// import { SidebarThreadSelector } from './SidebarThreadSelector.js';
// import { SidebarChat } from './SidebarChat.js';

import '../styles.css'
import { SidebarChat } from './SidebarChat.js';
import ErrorBoundary from './ErrorBoundary.js';
import { OrinMark } from './OrinMark.js';

export const Sidebar = ({ className }: { className: string }) => {

	const isDark = useIsDark()
	const streamState = useFullChatThreadsStreamState()
	const isWorking = Object.values(streamState).some(state => state?.isRunning === 'LLM' || state?.isRunning === 'tool' || state?.isRunning === 'idle')
	return <div
		className={`@@void-scope ${isDark ? 'dark' : ''}`}
		style={{ width: '100%', height: '100%' }}
	>
		<div
			// default background + text styles for sidebar
			className={`
				w-full h-full
				bg-void-bg-2
				text-void-fg-1
			`}
		>

			<div className={`w-full h-full flex flex-col`}>
				<header className="flex items-center justify-between px-4 py-3 border-b border-void-border-3/70 bg-void-bg-2-alt">
					<div className="flex items-center gap-2 min-w-0">
						<OrinMark state={isWorking ? 'thinking' : 'idle'} size={22} />
						<div className="flex flex-col leading-tight">
							<span className="text-sm font-semibold tracking-[0.01em] text-void-fg-1">Orin AI</span>
							<span className="text-[10px] text-void-fg-3">{isWorking ? 'Agent working' : 'Ready to help'}</span>
						</div>
					</div>
					<span className="text-[10px] uppercase tracking-[0.14em] text-orin-accent">Agent</span>
				</header>
				<div className="min-h-0 flex-1">
				<ErrorBoundary>
					<SidebarChat />
				</ErrorBoundary>
				</div>
			</div>
		</div>
	</div>


}

