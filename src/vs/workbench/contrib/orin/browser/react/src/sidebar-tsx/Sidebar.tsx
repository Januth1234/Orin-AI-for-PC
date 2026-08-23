/*--------------------------------------------------------------------------------------
 *  Copyright 2026 Orin AI. All rights reserved.
 *  Licensed under the Apache License, Version 2.0. See LICENSE.txt for more information.
 *--------------------------------------------------------------------------------------*/

import { useAccessor, useActiveURI, useChatThreadsState, useFullChatThreadsStreamState, useIsDark } from '../util/services.js';
import '../styles.css';
import { SidebarChat } from './SidebarChat.js';
import { PastThreadsList } from './SidebarThreadSelector.js';
import ErrorBoundary from './ErrorBoundary.js';
import { OrinMark } from './OrinMark.js';

const shortName = (value: string | undefined) => value?.split(/[\\/]/).filter(Boolean).pop() || 'No folder connected';

const ProjectsPane = () => {
	const accessor = useAccessor();
	const chatThreadsService = accessor.get('IChatThreadService');
	const activeURI = useActiveURI();
	const threadsState = useChatThreadsState();
	return <aside className="orin-workspace-projects">
		<div className="orin-pane-title"><span>Projects</span><button onClick={() => chatThreadsService.openNewThread()} title="New conversation">+</button></div>
		<div className="orin-connected-project"><span className="orin-project-dot" /><div><strong>{shortName(activeURI?.fsPath)}</strong><small>Folder connected</small></div></div>
		<div className="orin-thread-heading"><span>Conversations</span><span>{Object.keys(threadsState.allThreads).length}</span></div>
		<ErrorBoundary><PastThreadsList className="orin-workspace-threads" /></ErrorBoundary>
		<button className="orin-new-chat" onClick={() => chatThreadsService.openNewThread()}>+ New conversation</button>
	</aside>;
};

const ActivityPane = () => {
	const accessor = useAccessor();
	const chatThreadsService = accessor.get('IChatThreadService');
	const streamState = useFullChatThreadsStreamState();
	const activeURI = useActiveURI();
	const activeProcesses = Object.entries(streamState).filter(([, state]) => !!state?.isRunning);
	return <aside className="orin-workspace-activity">
		<div className="orin-pane-title"><span>Workspace</span><button title="Run current project">▶</button></div>
		<div className="orin-code-card"><span className="orin-code-label">Live code</span><strong>{shortName(activeURI?.fsPath)}</strong><small>{activeURI ? 'Open in the editor to the right' : 'Select a file to begin'}</small></div>
		<div className="orin-thread-heading"><span>Active processes</span><span>{activeProcesses.length}</span></div>
		<div className="orin-process-list">
			{activeProcesses.length === 0 ? <div className="orin-empty-process"><span>✓</span><p>No active work</p><small>Start a conversation or launch a subagent.</small></div> : activeProcesses.map(([threadId, state]) => <div className="orin-process" key={threadId}><span className="orin-process-pulse" /><div><strong>{state?.isRunning === 'tool' ? 'Editing project files' : 'Orin agent thinking'}</strong><small>{state?.isRunning === 'tool' ? 'Running a tool' : 'Streaming a response'}</small></div></div>)}
		</div>
		<button className="orin-subagent" onClick={() => { /* Subagent orchestration is exposed as a separate conversation. */ chatThreadsService.openNewThread(); }}>
			<span>ϟ</span><div><strong>Deploy subagent</strong><small>Open a parallel agent task</small></div>
		</button>
	</aside>;
};

export const Sidebar = ({ className }: { className: string }) => {
	const isDark = useIsDark();
	const streamState = useFullChatThreadsStreamState();
	const isWorking = Object.values(streamState).some(state => state?.isRunning === 'LLM' || state?.isRunning === 'tool' || state?.isRunning === 'idle');
	return <div className={`@@orin-scope ${isDark ? 'dark' : ''} orin-agent-shell ${className || ''}`}>
		<header className="orin-agent-header">
			<div className="orin-agent-brand"><OrinMark state={isWorking ? 'thinking' : 'idle'} size={28} /><div><strong>Orin AI</strong><small>{isWorking ? 'Agent working' : 'Ready to build'}</small></div></div>
			<div className="orin-agent-header-status"><span className={isWorking ? 'is-live' : ''} />{isWorking ? 'Working' : 'Agent'}</div>
		</header>
		<div className="orin-agent-workspace">
			<ProjectsPane />
			<section className="orin-workspace-chat"><ErrorBoundary><SidebarChat /></ErrorBoundary></section>
			<ActivityPane />
		</div>
	</div>;
};
