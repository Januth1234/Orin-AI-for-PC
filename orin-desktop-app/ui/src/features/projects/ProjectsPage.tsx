import { useEffect, useState } from 'react'
import { FolderOpen, Loader2, Plus, Zap } from 'lucide-react'
import {
  selectActiveProject,
  useProjectsStore,
  type Project,
} from '../../stores/projectsStore'
import { useChatsStore } from '../../stores/chatsStore'
import { EmptyState } from '../../components/EmptyState'
import { ProjectDetail } from './ProjectDetail'
import { timeAgo } from './timeAgo'
import './projects.css'

export default function ProjectsPage() {
  const hydrate = useProjectsStore((state) => state.hydrate)
  const projects = useProjectsStore((state) => state.projects)
  const active = useProjectsStore(selectActiveProject)
  const createProject = useProjectsStore((state) => state.createProject)
  const openFromFolder = useProjectsStore((state) => state.openFromFolder)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const conversations = useChatsStore((state) => state.conversations)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Once hydration lands, open the remembered active project by default.
  const [didAutoSelect, setDidAutoSelect] = useState(false)
  useEffect(() => {
    if (didAutoSelect) return
    if (projects.length === 0) return
    setDidAutoSelect(true)
    if (!selectedId && active) setSelectedId(active.id)
  }, [didAutoSelect, projects, selectedId, active])

  if (selectedId) {
    const selected = projects.find((project) => project.id === selectedId)
    if (selected) return <ProjectDetail project={selected} onBack={() => setSelectedId(null)} />
  }

  const openFolder = async () => {
    setOpening(true)
    try {
      const created = await openFromFolder()
      if (created) setSelectedId(created.id)
    } catch (error) {
      console.warn('Could not open folder', error)
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="projects-page">
      <header className="page-header">
        <h1 className="page-title">Projects</h1>
        <div className="page-actions">
          <button className="button-secondary" onClick={() => void openFolder()} disabled={opening}>
            {opening ? <Loader2 size={14} className="spin" /> : <FolderOpen size={14} />} Open folder…
          </button>
          <button
            className="button-primary"
            onClick={() => {
              const created = createProject()
              setSelectedId(created.id)
            }}
          >
            <Plus size={14} /> New project
          </button>
        </div>
      </header>

      {projects.length === 0 ? (
        <EmptyState
          icon={<Zap size={30} />}
          title="Start a project"
          hint="Keep your files, instructions, conversations, and artifacts together."
          action={
            <button className="button-primary" onClick={() => setSelectedId(createProject().id)}>
              <Plus size={14} /> New project
            </button>
          }
        />
      ) : (
        <div className="project-grid">
          {projects.map((project: Project) => {
            const chatCount = conversations.filter((chat) => chat.projectId === project.id).length
            return (
              <button key={project.id} className="project-card" onClick={() => setSelectedId(project.id)}>
                <span className="project-card-name">{project.name}</span>
                <span className="project-card-desc">
                  {project.description || 'No description yet.'}
                </span>
                <span className="project-card-path mono">{project.rootPath || 'No folder linked'}</span>
                <span className="project-card-meta">
                  {chatCount} chat{chatCount === 1 ? '' : 's'} · {project.knowledge.length} knowledge file
                  {project.knowledge.length === 1 ? '' : 's'} · updated {timeAgo(project.updatedAt)}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
