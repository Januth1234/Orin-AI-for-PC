import { useEffect, useState, type ReactNode } from 'react'
import './settings.css'

export interface SettingsSection {
  id: string
  label: string
  content: ReactNode
}

export function SettingsLayout({
  title,
  sections,
  activeId,
  onSelect,
}: {
  title: string
  sections: SettingsSection[]
  activeId: string
  onSelect: (id: string) => void
}) {
  const active = sections.find((section) => section.id === activeId) ?? sections[0]

  return (
    <div className="settings-page">
      <h1 className="settings-title">{title}</h1>
      <div className="settings-columns">
        <nav className="settings-nav">
          {sections.map((section) => (
            <button
              key={section.id}
              className={`settings-nav-item ${section.id === active.id ? 'active' : ''}`}
              onClick={() => onSelect(section.id)}
            >
              {section.label}
            </button>
          ))}
        </nav>
        <section className="settings-content">{active.content}</section>
      </div>
    </div>
  )
}

export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="setting-row">
      <div className="setting-copy">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  )
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      className={`toggle ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="toggle-thumb" />
    </button>
  )
}

export function useLocalSection(defaultId: string, key: string): [string, (id: string) => void] {
  const [id, setId] = useState(defaultId)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(key)
      if (saved) setId(saved)
    } catch {
      // ignore
    }
  }, [key])
  const select = (next: string) => {
    setId(next)
    try {
      localStorage.setItem(key, next)
    } catch {
      // ignore
    }
  }
  return [id, select]
}
