import { create } from 'zustand'
import { loadState, saveState } from '../services/persistence.js'
import { startAgent } from '../services/agentService.js'

const uid = prefix => `${prefix}-${crypto.randomUUID()}`
const now = () => new Date().toISOString()
const welcomeProject = {
  id: 'welcome-project', name: 'Welcome project', rootPath: '', files: [],
  chats: [{ id: 'welcome-chat', title: 'Build something new', messages: [{ id: 'welcome-message', role: 'assistant', content: 'Welcome to Orin. Connect a project or ask me to help you start one.', createdAt: now() }], subAgents: [] }],
}

let saveTimer
const queueSave = get => {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { projects, activeProjectId, activeChatId, selectedFilePath, ui } = get()
    saveState({ projects, activeProjectId, activeChatId, selectedFilePath, ui })
  }, 350)
}

export const useOrinStore = create((set, get) => ({
  projects: [welcomeProject], activeProjectId: welcomeProject.id, activeChatId: 'welcome-chat', selectedFilePath: null,
  agents: {}, ui: { editorTab: 'code', sidebarCollapsed: false, theme: 'dark' },
  hydrate: async () => { const saved = await loadState(); if (saved?.projects?.length) set({ ...saved }) },
  selectProject: id => { const project = get().projects.find(item => item.id === id); if (!project) return; set({ activeProjectId: id, activeChatId: project.chats[0]?.id || null }); queueSave(get) },
  selectChat: (projectId, chatId) => { set({ activeProjectId: projectId, activeChatId: chatId }); queueSave(get) },
  createChat: projectId => { const chat = { id: uid('chat'), title: 'New conversation', messages: [], subAgents: [] }; set(state => ({ projects: state.projects.map(project => project.id === projectId ? { ...project, chats: [...project.chats, chat] } : project), activeProjectId: projectId, activeChatId: chat.id })); queueSave(get) },
  openProject: async () => { const result = await window.orin?.chooseFolder?.(); if (!result) return; const project = { id: uid('project'), name: result.name, rootPath: result.rootPath, files: result.files, chats: [{ id: uid('chat'), title: 'Project setup', messages: [], subAgents: [] }] }; set(state => ({ projects: [...state.projects, project], activeProjectId: project.id, activeChatId: project.chats[0].id })); queueSave(get) },
  selectFile: async filePath => { set({ selectedFilePath: filePath }); const file = findFile(get().projects, filePath); if (!file || file.content !== undefined || !window.orin?.readFile) return; try { const content = await window.orin.readFile(filePath); set(state => ({ projects: patchFile(state.projects, filePath, { content }) })); } catch { /* Binary or unreadable files stay unavailable. */ } },
  updateFile: (filePath, content) => { set(state => ({ projects: patchFile(state.projects, filePath, { content }) })); queueSave(get) },
  saveFile: async filePath => { const file = findFile(get().projects, filePath); if (file && window.orin?.writeFile) await window.orin.writeFile(filePath, file.content || '') },
  setEditorTab: editorTab => set(state => ({ ui: { ...state.ui, editorTab } })),
  sendMessage: (text, role = 'main', parentAgentId = null) => {
    const state = get(); const project = currentProject(state); const chat = currentChat(state); if (!project || !chat || !text.trim()) return
    const agentId = uid(role === 'subagent' ? 'subagent' : 'agent'); const responseId = uid('message')
    const userMessage = { id: uid('message'), role: 'user', content: text, createdAt: now() }
    const response = { id: responseId, role: 'assistant', content: '', createdAt: now(), agentId, pending: true }
    set(s => ({ projects: patchChat(s.projects, project.id, chat.id, value => ({ ...value, messages: [...value.messages, userMessage, response], subAgents: role === 'subagent' ? [...value.subAgents, agentId] : value.subAgents })), agents: { ...s.agents, [agentId]: { id: agentId, chatId: chat.id, projectId: project.id, parentAgentId, role, status: 'thinking', prompt: text, tokenUsage: 0 } } }))
    const stop = startAgent({ id: agentId, prompt: text, role, onChunk: content => set(s => ({ projects: patchMessage(s.projects, project.id, chat.id, responseId, { content }), agents: { ...s.agents, [agentId]: { ...s.agents[agentId], status: 'working', tokenUsage: content.length } } })), onDone: () => { set(s => ({ projects: patchMessage(s.projects, project.id, chat.id, responseId, { pending: false }), agents: { ...s.agents, [agentId]: { ...s.agents[agentId], status: 'idle', stop: undefined } } })); queueSave(get) }, onError: error => set(s => ({ projects: patchMessage(s.projects, project.id, chat.id, responseId, { content: `Agent error: ${error}`, pending: false }), agents: { ...s.agents, [agentId]: { ...s.agents[agentId], status: 'error' } } })) })
    set(s => ({ agents: { ...s.agents, [agentId]: { ...s.agents[agentId], stop } } }))
  },
  spawnSubagent: prompt => get().sendMessage(prompt || 'Review the current project and report concise recommendations.', 'subagent'),
  stopAgent: agentId => { const agent = get().agents[agentId]; agent?.stop?.(); set(s => ({ agents: { ...s.agents, [agentId]: { ...s.agents[agentId], status: 'stopped', stop: undefined } } })) },
}))

const currentProject = state => state.projects.find(project => project.id === state.activeProjectId)
const currentChat = state => currentProject(state)?.chats.find(chat => chat.id === state.activeChatId)
const patchChat = (projects, projectId, chatId, patch) => projects.map(project => project.id !== projectId ? project : { ...project, chats: project.chats.map(chat => chat.id !== chatId ? chat : patch(chat)) })
const patchMessage = (projects, projectId, chatId, messageId, patch) => patchChat(projects, projectId, chatId, chat => ({ ...chat, messages: chat.messages.map(message => message.id === messageId ? { ...message, ...patch } : message) }))
const patchFile = (projects, filePath, patch) => projects.map(project => ({ ...project, files: walkFiles(project.files, filePath, patch) }))
const walkFiles = (files, filePath, patch) => files.map(file => file.type === 'folder' ? { ...file, children: walkFiles(file.children || [], filePath, patch) } : file.path === filePath ? { ...file, ...patch } : file)
const findFile = (projects, filePath) => { for (const project of projects) { const found = findInTree(project.files, filePath); if (found) return found } }
const findInTree = (files, filePath) => { for (const file of files) { if (file.path === filePath) return file; const found = file.children && findInTree(file.children, filePath); if (found) return found } }
