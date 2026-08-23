import { useEffect, useState } from 'react'
import { bridge } from '../../bridge/client'
import { useUiStore } from '../../stores/uiStore'
import { Toggle } from './SettingsLayout'
import './settings.css'

interface Skill {
  id: string
  name: string
  description: string
  instructions?: string
  enabled: boolean
  builtin: boolean
}

const BUILTIN_SKILLS: Skill[] = [
  { id: 'code-reviewer', name: 'Code reviewer', description: 'Reviews changes for bugs, clarity, and tests before you commit.', enabled: true, builtin: true },
  { id: 'ui-designer', name: 'UI designer', description: 'Applies calm, premium interface principles to generated UI.', enabled: true, builtin: true },
  { id: 'tech-writer', name: 'Technical writer', description: 'Turns diffs and decisions into clear documentation.', enabled: false, builtin: true },
  { id: 'data-analyst', name: 'Data analyst', description: 'Explores CSV/JSON data with summaries and caveats.', enabled: false, builtin: true },
]

const SKILLS_KEY = 'skills'

export default function SkillsPage() {
  const toast = useUiStore((state) => state.toast)
  const [skills, setSkills] = useState<Skill[]>(BUILTIN_SKILLS)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', description: '', instructions: '' })

  useEffect(() => {
    bridge
      .storeGet<Skill[]>(SKILLS_KEY)
      .then((saved) => {
        if (Array.isArray(saved) && saved.length) {
          // Merge: builtins keep their defaults unless the user toggled them.
          const merged = BUILTIN_SKILLS.map((builtin) => saved.find((s) => s.id === builtin.id) ?? builtin)
          const custom = saved.filter((s) => !s.builtin)
          setSkills([...merged, ...custom])
        }
      })
      .catch(() => {})
  }, [])

  const persist = (next: Skill[]) => {
    setSkills(next)
    bridge.storeSet(SKILLS_KEY, next).catch(() => {})
  }

  const toggle = (id: string) =>
    persist(skills.map((skill) => (skill.id === id ? { ...skill, enabled: !skill.enabled } : skill)))

  const create = () => {
    if (!draft.name.trim()) return
    persist([
      ...skills,
      {
        id: `custom-${crypto.randomUUID()}`,
        name: draft.name.trim(),
        description: draft.description.trim() || 'Custom skill.',
        instructions: draft.instructions.trim(),
        enabled: true,
        builtin: false,
      },
    ])
    setDraft({ name: '', description: '', instructions: '' })
    setCreating(false)
    toast('success', 'Skill created')
  }

  const remove = (id: string) => persist(skills.filter((skill) => skill.id !== id))

  return (
    <div className="settings-page">
      <h1 className="settings-title">Skills</h1>
      <p className="settings-note" style={{ marginTop: 0 }}>
        Skills are reusable instruction packages Orin applies when relevant. Enabled skills shape
        responses; they never run tools on their own.
      </p>
      <div className="card-list" style={{ marginTop: 18 }}>
        {skills.map((skill) => (
          <div className="item-card" key={skill.id}>
            <span className="glyph">{skill.name.slice(0, 1)}</span>
            <div className="item-copy">
              <strong>{skill.name}</strong>
              <span>{skill.instructions || skill.description}</span>
            </div>
            {!skill.builtin && (
              <button className="status-pill status-disconnected" onClick={() => remove(skill.id)}>
                Remove
              </button>
            )}
            <Toggle checked={skill.enabled} onChange={() => toggle(skill.id)} />
          </div>
        ))}
      </div>

      {creating ? (
        <div className="item-card" style={{ alignItems: 'stretch', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          <input
            className="text-input"
            style={{ minWidth: 0 }}
            placeholder="Skill name"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <input
            className="text-input"
            style={{ minWidth: 0 }}
            placeholder="Short description"
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
          />
          <textarea
            className="text-input"
            style={{ minWidth: 0, minHeight: 90, resize: 'vertical' }}
            placeholder="Instructions Orin should follow when this skill applies…"
            value={draft.instructions}
            onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
          />
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="connect-button" onClick={create}>
              Create skill
            </button>
            <button className="status-pill status-disconnected" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button className="connect-button" style={{ marginTop: 16 }} onClick={() => setCreating(true)}>
          New skill
        </button>
      )}
    </div>
  )
}
