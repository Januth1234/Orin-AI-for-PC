import { useState } from 'react'
import { Github, HardDrive, MessageSquare, FileText } from 'lucide-react'
import { useUiStore } from '../../stores/uiStore'
import './settings.css'

interface Connector {
  id: string
  name: string
  description: string
  icon: typeof Github
}

const CONNECTORS: Connector[] = [
  { id: 'github', name: 'GitHub', description: 'Repositories, issues, and pull requests in your projects.', icon: Github },
  { id: 'gdrive', name: 'Google Drive', description: 'Attach docs and sheets as project knowledge.', icon: HardDrive },
  { id: 'slack', name: 'Slack', description: 'Search workspace conversations for context.', icon: MessageSquare },
  { id: 'notion', name: 'Notion', description: 'Sync spec pages into project knowledge.', icon: FileText },
]

export default function ConnectorsPage() {
  const toast = useUiStore((state) => state.toast)
  // Honest state: nothing is connected until real OAuth exists (spec §25).
  const [connecting, setConnecting] = useState<string | null>(null)

  const attemptConnect = (connector: Connector) => {
    setConnecting(connector.id)
    setTimeout(() => {
      setConnecting(null)
      toast(
        'info',
        `${connector.name} isn't connectable yet`,
        'OAuth connectors arrive with cloud sync. Local file access already works today.',
      )
    }, 500)
  }

  return (
    <div className="settings-page">
      <h1 className="settings-title">Integrations</h1>
      <p className="settings-note" style={{ marginTop: 0 }}>
        Connectors extend Orin with external services. Nothing below is connected until you complete a
        real sign-in — statuses here never pretend.
      </p>
      <div className="card-list" style={{ marginTop: 18 }}>
        {CONNECTORS.map((connector) => (
          <div className="item-card" key={connector.id}>
            <span className="glyph">
              <connector.icon size={17} />
            </span>
            <div className="item-copy">
              <strong>{connector.name}</strong>
              <span>{connector.description}</span>
            </div>
            <span className="status-pill status-disconnected">Not connected</span>
            <button
              className="connect-button"
              disabled={connecting === connector.id}
              onClick={() => attemptConnect(connector)}
            >
              {connecting === connector.id ? '…' : 'Connect'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
