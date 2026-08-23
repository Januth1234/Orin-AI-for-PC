import { useEffect, useMemo, useRef, useState } from 'react'
import { Monitor, MousePointer, Keyboard, Globe, AppWindow, TerminalSquare, FolderOpen } from 'lucide-react'
import { bridge } from '../../bridge/client'
import { OrinMark } from '../../components/OrinMark'
import { useSettingsStore } from '../../stores/settingsStore'
import type { EventPayloads } from '../../bridge/types'
import './computer.css'

type Phase = 'idle' | 'observing' | 'planning' | 'acting' | 'verifying' | 'done' | 'error'

interface StatusLine {
  id: string
  phase: string
  detail: string
}

interface PermissionPrompt {
  sessionId: string
  promptId: string
  title: string
  detail: string
  destructive: boolean
}

const ACTIVITY_TABS = [
  { id: 'screen', label: 'Screen', icon: Monitor },
  { id: 'mouse', label: 'Mouse', icon: MousePointer },
  { id: 'keyboard', label: 'Keyboard', icon: Keyboard },
  { id: 'browser', label: 'Browser', icon: Globe },
  { id: 'apps', label: 'Applications', icon: AppWindow },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { id: 'files', label: 'Files', icon: FolderOpen },
]

// Maps coarse phases onto the activity bar so the user always sees what Orin
// is currently doing (spec §47).
function activeTabFor(phase: Phase): string {
  switch (phase) {
    case 'planning':
      return 'apps'
    case 'acting':
      return 'mouse'
    case 'verifying':
      return 'screen'
    default:
      return 'screen'
  }
}

export default function ComputerUsePage() {
  const modelId = useSettingsStore((state) => state.defaultModelId)
  const [instruction, setInstruction] = useState('')
  const [provider, setProvider] = useState<'virtual' | 'windows'>('virtual')
  const [providersAvailable, setProvidersAvailable] = useState<string[]>(['virtual'])
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [statuses, setStatuses] = useState<StatusLine[]>([])
  const [frame, setFrame] = useState<{ data: string; width: number; height: number } | null>(null)
  const [actionCount, setActionCount] = useState(0)
  const [permission, setPermission] = useState<PermissionPrompt | null>(null)
  const [summary, setSummary] = useState<string | null>(null)
  const disposers = useRef<Array<() => void>>([])

  useEffect(() => {
    bridge.cuProviders().then(setProvidersAvailable).catch(() => {})
    return () => {
      disposers.current.forEach((off) => off())
    }
  }, [])

  const running = phase !== 'idle' && phase !== 'done' && phase !== 'error'

  const start = async () => {
    if (!instruction.trim() || running) return
    setPhase('observing')
    setStatuses([])
    setFrame(null)
    setActionCount(0)
    setSummary(null)
    try {
      const id = await bridge.cuStart({
        modelId,
        instruction: instruction.trim(),
        provider,
        maxActions: 40,
      })
      setSessionId(id)

      const on = <K extends keyof EventPayloads>(event: K, handler: (payload: EventPayloads[K]) => void) => {
        bridge.on(event, (payload) => {
          if ((payload as { sessionId?: string }).sessionId !== id) return
          handler(payload as EventPayloads[K])
        }).then((off) => disposers.current.push(off))
      }

      on('cu-status', (payload) => {
        setPhase(mapPhase(payload.phase))
        setStatuses((prev) =>
          [...prev, { id: crypto.randomUUID(), phase: payload.phase, detail: payload.detail }].slice(-40),
        )
      })
      on('cu-frame', (payload) => {
        setFrame({ data: payload.jpegBase64, width: payload.width, height: payload.height })
      })
      on('cu-action', () => setActionCount((count) => count + 1))
      on('cu-permission', (payload) => {
        setPermission({
          sessionId: id,
          promptId: payload.promptId,
          title: payload.title,
          detail: payload.detail,
          destructive: payload.destructive,
        })
      })
      on('cu-done', (payload) => {
        setPhase('done')
        setSummary(payload.summary)
      })
      on('cu-error', (payload) => {
        setPhase('error')
        setSummary(payload.error)
      })
    } catch (error) {
      setPhase('error')
      setSummary(String(error))
    }
  }

  const stop = async () => {
    if (sessionId) await bridge.cuStop(sessionId).catch(() => {})
    setPhase('done')
    setSummary('Stopped.')
  }

  const respond = async (allowed: boolean) => {
    if (!permission) return
    await bridge.cuPermissionRespond(permission.promptId, allowed).catch(() => {})
    setStatuses((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        phase: allowed ? 'allowed' : 'denied',
        detail: allowed ? `Allowed: ${permission.title}` : `Denied: ${permission.title}`,
      },
    ])
    setPermission(null)
  }

  const activeActivity = useMemo(() => activeTabFor(phase), [phase])

  return (
    <div className="cu-page">
      <main className="cu-stage">
        <header className="cu-stage-header">
          <span className="cu-title">Computer Use</span>
          <span className={`cu-phase cu-phase-${phase}`}>{phaseLabel(phase)}</span>
        </header>
        <div className="cu-screen">
          {frame ? (
            <img
              className="cu-frame"
              src={`data:image/jpeg;base64,${frame.data}`}
              alt="Controlled desktop"
              style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
            />
          ) : (
            <div className="cu-screen-placeholder">
              <Monitor size={44} strokeWidth={1.2} />
              <strong>{provider === 'windows' ? 'Your Windows desktop' : 'Virtual desktop'}</strong>
              <span>
                {running
                  ? 'Waiting for the first frame…'
                  : 'Describe a task below. Orin observes the screen, decides, acts, and verifies — one step at a time.'}
              </span>
            </div>
          )}
        </div>
        <footer className="cu-activity-bar">
          {ACTIVITY_TABS.map((tab) => (
            <span key={tab.id} className={`cu-activity ${tab.id === activeActivity && running ? 'active' : ''}`}>
              <tab.icon size={13} /> {tab.label}
            </span>
          ))}
        </footer>
      </main>

      <aside className="cu-panel">
        <div className="cu-panel-head">
          <OrinMark size={22} state={running ? 'thinking' : 'idle'} />
          <div>
            <strong>Orin</strong>
            <span>{running ? 'Operating the computer' : 'Ready for a task'}</span>
          </div>
        </div>

        <textarea
          className="cu-instruction"
          placeholder='Tell Orin what to do — e.g. "Open Notepad and write a note about tomorrow"'
          value={instruction}
          onChange={(event) => setInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              start()
            }
          }}
          disabled={running}
        />

        <div className="cu-controls">
          <select
            className="cu-provider"
            value={provider}
            onChange={(event) => setProvider(event.target.value as 'virtual' | 'windows')}
            disabled={running}
          >
            <option value="virtual">Virtual desktop (safe)</option>
            <option value="windows" disabled={!providersAvailable.includes('windows')}>
              My Windows desktop{providersAvailable.includes('windows') ? '' : ' (unavailable)'}
            </option>
          </select>
          {running ? (
            <button className="cu-stop" onClick={stop}>
              Stop
            </button>
          ) : (
            <button className="cu-run" disabled={!instruction.trim()} onClick={start}>
              Start task
            </button>
          )}
        </div>

        <div className="cu-timeline">
          {statuses.length === 0 && !running && (
            <p className="cu-timeline-empty">
              Every action appears here — screens observed, moves made, results verified. Destructive
              steps always ask first.
            </p>
          )}
          {statuses.map((line) => (
            <p key={line.id} className={`cu-line cu-line-${line.phase}`}>
              {line.detail}
            </p>
          ))}
          {running && (
            <p className="cu-line cu-line-working">
              <span className="cu-pulse" /> Working…
            </p>
          )}
        </div>

        {summary && <div className={`cu-summary cu-summary-${phase}`}>{summary}</div>}
        {actionCount > 0 && (
          <div className="cu-count">
            {actionCount} action{actionCount === 1 ? '' : 's'} performed
          </div>
        )}
      </aside>

      {permission && (
        <div className="cu-modal-overlay">
          <div className="cu-modal">
            <h3>{permission.title}</h3>
            <p>{permission.detail}</p>
            {permission.destructive && <p className="cu-modal-warn">This action may be destructive.</p>}
            <div className="cu-modal-actions">
              <button className="cu-deny" onClick={() => respond(false)}>
                Don't allow
              </button>
              <button className="cu-allow" onClick={() => respond(true)}>
                Allow once
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function mapPhase(raw: string): Phase {
  if (raw === 'done') return 'done'
  if (raw === 'error') return 'error'
  if (raw === 'planning') return 'planning'
  if (raw === 'acting' || raw === 'clicking' || raw === 'typing') return 'acting'
  if (raw === 'verifying') return 'verifying'
  return 'observing'
}

function phaseLabel(phase: Phase): string {
  switch (phase) {
    case 'observing':
      return 'Looking at the screen'
    case 'planning':
      return 'Deciding the next step'
    case 'acting':
      return 'Performing an action'
    case 'verifying':
      return 'Verifying the result'
    case 'done':
      return 'Task complete'
    case 'error':
      return 'Something went wrong'
    default:
      return 'Idle'
  }
}
