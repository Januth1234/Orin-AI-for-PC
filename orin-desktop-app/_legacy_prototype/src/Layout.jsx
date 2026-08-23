import { useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import { useOrinStore } from './stores/useOrinStore.js'
import './Layout.css'

const Bolt = () => <svg className="bolt" viewBox="0 0 120 120" aria-label="Orin"><rect x="4" y="4" width="112" height="112" rx="26" fill="#1c1c1a" /><path d="M69 20 38 66h20l-8 34 36-46H64l5-34z" fill="#e08a3c" /></svg>
const fileName = path => path?.split(/[\\/]/).pop() || 'Untitled'
const languageFor = path => path?.endsWith('.py') ? 'python' : path?.endsWith('.json') ? 'json' : path?.endsWith('.css') ? 'css' : path?.endsWith('.html') ? 'html' : 'typescript'

function FileTree({ files, selected, onSelect, depth = 0 }) {
  const [open, setOpen] = useState(true)
  return files?.map(file => file.type === 'folder' ? <div className="tree-node" key={file.path}><button className="tree-row folder" style={{ paddingLeft: 10 + depth * 14 }} onClick={() => setOpen(value => !value)}><span>{open ? '⌄' : '›'}</span>{file.name}</button>{open && <FileTree files={file.children} selected={selected} onSelect={onSelect} depth={depth + 1} />}</div> : <button className={`tree-row file ${selected === file.path ? 'selected' : ''}`} style={{ paddingLeft: 28 + depth * 14 }} key={file.path} onClick={() => onSelect(file.path)}><span>·</span>{file.name}</button>)
}

function Sidebar() {
  const { projects, activeProjectId, activeChatId, selectProject, selectChat, createChat, openProject, selectedFilePath, selectFile } = useOrinStore()
  return <aside className="project-rail"><div className="rail-brand"><Bolt /><strong>Orin</strong><button onClick={openProject} title="Open project">+</button></div><div className="rail-heading"><span>Projects</span><button onClick={openProject}>Open</button></div><div className="project-list">{projects.map(project => <section className="project-block" key={project.id}><button className={`project-name ${project.id === activeProjectId ? 'active' : ''}`} onClick={() => selectProject(project.id)}><span className="project-dot" />{project.name}</button>{project.id === activeProjectId && <><div className="chat-list">{project.chats.map(chat => <button className={`chat-link ${chat.id === activeChatId ? 'active' : ''}`} key={chat.id} onClick={() => selectChat(project.id, chat.id)}><span>◌</span>{chat.title}</button>)}<button className="new-chat-link" onClick={() => createChat(project.id)}>+ New conversation</button></div>{project.files?.length > 0 && <div className="files-section"><div className="section-label">Files</div><FileTree files={project.files} selected={selectedFilePath} onSelect={selectFile} /></div>}</>}</section>)}</div><div className="rail-footer"><span className="local-badge">Local-first</span><span>Free model support</span></div></aside>
}

function ChatPane({ project, chat }) {
  const { sendMessage, spawnSubagent, agents, stopAgent } = useOrinStore()
  const [draft, setDraft] = useState('')
  const bottom = useRef(null)
  const chatAgents = Object.values(agents).filter(agent => agent.chatId === chat.id)
  const running = chatAgents.filter(agent => agent.status === 'thinking' || agent.status === 'working')
  useEffect(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), [chat.messages.length, running.length])
  const submit = () => { if (!draft.trim()) return; sendMessage(draft); setDraft('') }
  return <main className="chat-pane"><header className="pane-header"><div><span className="eyebrow">{project.name}</span><h1>{chat.title}</h1></div><div className="header-actions"><button className="outline-button" onClick={() => spawnSubagent('Review the current project and report concise recommendations.')}>+ Subagent</button>{running.map(agent => <button className="icon-button" title="Stop agent" onClick={() => stopAgent(agent.id)} key={agent.id}>■</button>)}</div></header><div className="chat-scroll"><div className="conversation">{chat.messages.length === 0 && <div className="empty-conversation"><Bolt /><h2>What are we building?</h2><p>Ask Orin to explore the project, create code, or delegate a parallel task.</p></div>}{chat.messages.map(message => <article className={`message ${message.role}`} key={message.id}><div className="message-avatar">{message.role === 'assistant' ? <Bolt /> : 'You'}</div><div className="message-body"><span className="message-label">{message.role === 'assistant' ? 'Orin' : 'You'}</span><div className="message-text">{message.content || (message.pending ? <span className="typing"><i /><i /><i /></span> : '')}</div></div></article>)}{chat.subAgents?.length > 0 && <div className="subagent-summary"><span>Parallel agents</span>{chatAgents.filter(agent => agent.role === 'subagent').map(agent => <div key={agent.id}><Bolt /> <strong>Subagent</strong><small>{agent.status}</small></div>)}</div>}<div ref={bottom} /></div></div><div className="composer-wrap"><div className="composer"><textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit() } }} placeholder="Ask Orin to build, edit, or explain…" rows={2} /><div className="composer-bottom"><span className="mode-pill">Agent mode</span><button className="send-button" disabled={!draft.trim()} onClick={submit}>↑</button></div></div><small>Enter to send · Shift+Enter for a new line</small></div></main>
}

function ActivityPane({ project }) {
  const { agents, stopAgent, selectedFilePath, updateFile, saveFile, ui, setEditorTab } = useOrinStore()
  const file = findFile(project.files, selectedFilePath)
  const processes = Object.values(agents).filter(agent => agent.projectId === project.id)
  return <aside className="code-pane"><header className="pane-header"><div><span className="eyebrow">Workspace</span><h2>{file ? fileName(file.path) : 'Code & activity'}</h2></div>{file && <button className="run-button" onClick={() => saveFile(file.path)}>Save</button>}</header><div className="code-tabs"><button className={ui.editorTab === 'code' ? 'active' : ''} onClick={() => setEditorTab('code')}>Code</button><button className={ui.editorTab === 'activity' ? 'active' : ''} onClick={() => setEditorTab('activity')}>Activity <span>{processes.length}</span></button></div>{ui.editorTab === 'code' ? <>{file ? <div className="monaco-wrapper"><Editor height="100%" language={languageFor(file.path)} theme="vs-dark" value={file.content || ''} onChange={value => updateFile(file.path, value || '')} options={{ minimap: { enabled: false }, fontSize: 13, lineNumbers: 'on', automaticLayout: true, scrollBeyondLastLine: false, padding: { top: 18, bottom: 18 } }} /></div> : <div className="empty-editor"><Bolt /><strong>Select a project file</strong><span>Your agent changes will appear here.</span></div>}</> : <div className="process-list">{processes.length === 0 ? <div className="empty-editor"><Bolt /><strong>No active agents</strong><span>Use “Subagent” to work in parallel.</span></div> : processes.map(agent => <div className="process-card" key={agent.id}><Bolt /><div><strong>{agent.role === 'subagent' ? 'Subagent' : 'Main agent'}</strong><span>{agent.prompt}</span><small>{agent.status} · {agent.tokenUsage} chars</small></div>{(agent.status === 'thinking' || agent.status === 'working') && <button onClick={() => stopAgent(agent.id)}>Stop</button>}</div>)}</div>}</aside>
}

export default function Layout() {
  const { projects, activeProjectId, activeChatId, hydrate } = useOrinStore()
  useEffect(() => { hydrate() }, [hydrate])
  const project = useMemo(() => projects.find(item => item.id === activeProjectId) || projects[0], [projects, activeProjectId])
  const chat = project?.chats.find(item => item.id === activeChatId) || project?.chats[0]
  if (!project || !chat) return null
  return <div className="orin-layout"><Sidebar /><ChatPane project={project} chat={chat} /><ActivityPane project={project} /><footer className="global-status"><span><i /> Orin desktop · local-first</span><span>{project.rootPath || 'Connect a folder to begin'}</span></footer></div>
}

function findFile(files = [], path) { for (const file of files) { if (file.path === path) return file; const nested = file.children && findFile(file.children, path); if (nested) return nested } }
