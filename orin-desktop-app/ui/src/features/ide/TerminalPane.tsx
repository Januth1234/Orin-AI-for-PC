import { useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { bridge } from '../../bridge/client'

const ANSI_PATTERNS = [/\x1b\[[0-9;?]*[A-Za-z]/g, /\x1b\][^\x07]*\x07/g, /\r/g]

function stripAnsi(text: string): string {
  return ANSI_PATTERNS.reduce((acc, pattern) => acc.replace(pattern, ''), text)
}

export function TerminalPane({ root }: { root: string | null }) {
  const [tab, setTab] = useState<'terminal' | 'problems' | 'output' | 'tests'>('terminal')
  const [collapsed, setCollapsed] = useState(false)
  const [lines, setLines] = useState('')
  const [input, setInput] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const terminalId = useRef<string | null>(null)
  const history = useRef<string[]>([])
  const historyIndex = useRef(-1)
  const preRef = useRef<HTMLPreElement>(null)

  // Lazy-create the PTY the first time the terminal becomes visible.
  useEffect(() => {
    if (tab !== 'terminal' || collapsed || terminalId.current || notice) return
    let disposed = false
    const disposers: Array<() => void> = []
    bridge
      .termCreate(root ?? undefined)
      .then(async (id) => {
        if (disposed) {
          bridge.termKill(id).catch(() => {})
          return
        }
        terminalId.current = id
        const off = await bridge.on('term-data', (payload) => {
          if (payload.terminalId !== id) return
          setLines((prev) => (prev + stripAnsi(payload.data)).slice(-80_000))
        })
        disposers.push(off)
        const offExit = await bridge.on('term-exit', (payload) => {
          if (payload.terminalId === id) setNotice('Shell exited.')
        })
        disposers.push(offExit)
      })
      .catch(() => setNotice('Terminal requires the desktop runtime (npm run app:dev).'))
    return () => {
      disposed = true
      disposers.forEach((off) => off())
      if (terminalId.current) bridge.termKill(terminalId.current).catch(() => {})
      terminalId.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, collapsed])

  // Autoscroll unless the user scrolled up to read.
  useEffect(() => {
    const pre = preRef.current
    if (!pre) return
    const nearBottom = pre.scrollHeight - pre.scrollTop - pre.clientHeight < 60
    if (nearBottom) pre.scrollTop = pre.scrollHeight
  }, [lines])

  const send = () => {
    const value = input
    if (!value.trim() || !terminalId.current) return
    bridge.termWrite(terminalId.current, `${value}\n`).catch(() => {})
    if (value.trim()) history.current = [...history.current.slice(-49), value]
    historyIndex.current = -1
    setInput('')
  }

  const recall = (direction: -1 | 1) => {
    if (history.current.length === 0) return
    let index = historyIndex.current + direction
    index = Math.max(-1, Math.min(history.current.length - 1, index))
    historyIndex.current = index
    setInput(index === -1 ? '' : history.current[index])
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      send()
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      recall(-1)
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      recall(1)
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'c' && document.activeElement === event.currentTarget && !window.getSelection()?.toString()) {
      event.preventDefault()
      if (input) setInput('')
      else if (terminalId.current) bridge.termWrite(terminalId.current, '\x03').catch(() => {})
    }
  }

  return (
    <div className={`ide-bottom ${collapsed ? 'collapsed' : ''}`}>
      <div className="ide-bottom-tabs">
        {(['terminal', 'problems', 'output', 'tests'] as const).map((id) => (
          <button key={id} className={`ide-bottom-tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
            {id[0].toUpperCase() + id.slice(1)}
          </button>
        ))}
        <span className="ide-bottom-spacer" />
        <button className="icon-ghost" aria-label={collapsed ? 'Expand pane' : 'Collapse pane'} onClick={() => setCollapsed(!collapsed)}>
          {collapsed ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {!collapsed && tab === 'terminal' && (
        <div className="ide-terminal">
          {notice ? (
            <p className="ide-terminal-notice">{notice}</p>
          ) : (
            <>
              <pre ref={preRef} className="ide-terminal-output">
                {lines || ''}
              </pre>
              <div className="ide-terminal-input-row">
                <span className="ide-terminal-chevron">❯</span>
                <input
                  className="ide-terminal-input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={onKeyDown}
                  placeholder="Type a command…"
                  spellCheck={false}
                />
              </div>
            </>
          )}
        </div>
      )}

      {!collapsed && tab === 'problems' && <EmptyPane icon="◎" text="No problems detected" />}
      {!collapsed && tab === 'output' && <EmptyPane icon="▤" text="No output yet" />}
      {!collapsed && tab === 'tests' && <EmptyPane icon="✓" text="No test runs yet" />}
    </div>
  )
}

function EmptyPane({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="ide-empty-pane">
      <span>{icon}</span>
      <p>{text}</p>
    </div>
  )
}
