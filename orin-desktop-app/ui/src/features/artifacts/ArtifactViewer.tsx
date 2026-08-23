import { useEffect, useState } from 'react'
import { ArrowLeft, Code2, Copy, Download, Info, Monitor, Pencil, RotateCcw, Smartphone, SquareTerminal, Tablet, Terminal, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { Artifact } from '../../stores/artifactsStore'
import { useArtifactsStore } from '../../stores/artifactsStore'
import { copyText, downloadFileName, downloadText, renderMarkdown, withConsoleBridge } from './preview'
import { timeAgo } from './timeAgo'

type ViewerTab = 'preview' | 'code' | 'console'
type DevicePreset = 'desktop' | 'tablet' | 'mobile'

interface ConsoleEntry {
  level: 'log' | 'info' | 'warn' | 'error'
  text: string
}

const DEVICE_WIDTHS: Record<DevicePreset, string> = {
  desktop: '100%',
  tablet: '768px',
  mobile: '390px',
}

const DEVICE_ICONS: Record<DevicePreset, LucideIcon> = {
  desktop: Monitor,
  tablet: Tablet,
  mobile: Smartphone,
}

const TABS: Array<{ id: ViewerTab; label: string; icon: LucideIcon }> = [
  { id: 'preview', label: 'Preview', icon: SquareTerminal },
  { id: 'code', label: 'Code', icon: Code2 },
  { id: 'console', label: 'Console', icon: Terminal },
]

export function ArtifactViewer({ artifact, onBack }: { artifact: Artifact; onBack: () => void }) {
  const updateContent = useArtifactsStore((state) => state.updateContent)
  const rename = useArtifactsStore((state) => state.rename)
  const restoreVersion = useArtifactsStore((state) => state.restoreVersion)
  const remove = useArtifactsStore((state) => state.remove)

  const [tab, setTab] = useState<ViewerTab>('preview')
  const [device, setDevice] = useState<DevicePreset>('desktop')
  const [stagedN, setStagedN] = useState<number | null>(null)
  const [consoleEntries, setConsoleEntries] = useState<ConsoleEntry[]>([])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [nameDraft, setNameDraft] = useState(artifact.title)
  const [copied, setCopied] = useState(false)

  // Reset transient viewer state when switching artifacts.
  useEffect(() => {
    setStagedN(null)
    setConsoleEntries([])
    setEditing(false)
    setNameDraft(artifact.title)
  }, [artifact.id, artifact.title])

  // Mirror console output posted from the sandboxed preview iframe.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { __orinPreview?: boolean; level?: string; text?: string } | null
      if (!data || data.__orinPreview !== true) return
      const level =
        data.level === 'warn' || data.level === 'error' || data.level === 'info' ? data.level : ('log' as const)
      setConsoleEntries((entries) => [...entries.slice(-499), { level, text: String(data.text ?? '') }])
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const currentN = artifact.versions[0]?.n ?? 0
  const stagedVersion = stagedN != null ? artifact.versions.find((version) => version.n === stagedN) : undefined
  const displayContent = stagedVersion ? stagedVersion.content : artifact.content

  const startRenaming = () => {
    setNameDraft(artifact.title)
    setRenaming(true)
  }

  const commitRename = () => {
    rename(artifact.id, nameDraft)
    setRenaming(false)
  }

  const saveDraft = () => {
    updateContent(artifact.id, draft, 'Manual edit')
    setEditing(false)
  }

  return (
    <div className="artifacts-page">
      <header className="page-header viewer-header">
        <button className="back-button" onClick={onBack}>
          <ArrowLeft size={13} /> Artifacts
        </button>

        {renaming ? (
          <input
            className="field-input rename-input"
            value={nameDraft}
            autoFocus
            aria-label="Artifact title"
            onChange={(event) => setNameDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <h1 className="page-title viewer-title" onClick={startRenaming} title="Click to rename">
            {artifact.title}
          </h1>
        )}

        <span className={`kind-badge kind-${artifact.kind}`}>{artifact.kind}</span>

        <div className="page-actions">
          {!renaming && (
            <button className="icon-ghost" aria-label="Rename" title="Rename" onClick={startRenaming}>
              <Pencil size={14} />
            </button>
          )}
          <button
            className="icon-ghost"
            aria-label="Copy content"
            title="Copy"
            onClick={() => void copyText(displayContent)}
          >
            <Copy size={14} />
          </button>
          <button
            className="icon-ghost"
            aria-label="Download"
            title="Download"
            onClick={() =>
              downloadText(downloadFileName(artifact.title, artifact.kind, artifact.language), displayContent)
            }
          >
            <Download size={14} />
          </button>
          <button
            className="icon-ghost danger-hover"
            aria-label="Delete artifact"
            title="Delete"
            onClick={() => {
              remove(artifact.id)
              onBack()
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </header>

      <div className="viewer-body">
        {/* --------------------------------------------------- main pane */}
        <section className="viewer-main">
          <div className="viewer-tabs-row">
            <div className="tab-strip" role="tablist" aria-label="Viewer tabs">
              {TABS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  className={`tab ${tab === id ? 'active' : ''}`}
                  onClick={() => setTab(id)}
                >
                  <Icon size={13} /> {label}
                  {id === 'console' && consoleEntries.length > 0 && (
                    <span className="tab-count">{consoleEntries.length}</span>
                  )}
                </button>
              ))}
            </div>

            {tab === 'preview' && (
              <div className="device-toggles">
                {(Object.keys(DEVICE_WIDTHS) as DevicePreset[]).map((preset) => {
                  const Icon = DEVICE_ICONS[preset]
                  return (
                    <button
                      key={preset}
                      className={`device-toggle ${device === preset ? 'active' : ''}`}
                      title={`Preview width: ${DEVICE_WIDTHS[preset]}`}
                      onClick={() => setDevice(preset)}
                    >
                      <Icon size={12} />
                      {preset === 'desktop' ? 'Desktop' : DEVICE_WIDTHS[preset]}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          <div className="viewer-content">
            {tab === 'preview' && (
              <PreviewBody artifact={artifact} content={displayContent} maxWidth={DEVICE_WIDTHS[device]} />
            )}

            {tab === 'code' && (
              <div className="code-pane">
                {editing ? (
                  <div className="edit-pane">
                    <textarea
                      className="edit-area mono-font"
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      spellCheck={false}
                    />
                    <div className="edit-actions">
                      <button className="button-secondary" onClick={() => setEditing(false)}>
                        Cancel
                      </button>
                      <button className="button-primary" onClick={saveDraft}>
                        Save version
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="code-toolbar">
                      <button
                        className="button-secondary"
                        onClick={() => {
                          setDraft(displayContent)
                          setEditing(true)
                        }}
                      >
                        Edit
                      </button>
                    </div>
                    <pre className="code-view mono-font">
                      <code>{displayContent}</code>
                    </pre>
                  </>
                )}
              </div>
            )}

            {tab === 'console' && (
              <div className="console-pane">
                {consoleEntries.length === 0 && (
                  <p className="console-note">
                    {artifact.kind === 'html' || artifact.kind === 'svg'
                      ? 'No output yet. console.log() calls from the preview appear here.'
                      : 'Console captures output from HTML/SVG previews.'}
                  </p>
                )}
                {consoleEntries.length > 0 && (
                  <>
                    <div className="console-clear-row">
                      <button className="button-secondary" onClick={() => setConsoleEntries([])}>
                        Clear
                      </button>
                    </div>
                    <div className="console-list mono-font">
                      {consoleEntries.map((entry, index) => (
                        <div key={index} className={`console-entry console-${entry.level}`}>
                          <span className="console-level">{entry.level}</span>
                          <span className="console-text">{entry.text}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ------------------------------------------------- version rail */}
        <aside className="version-rail">
          <h3 className="rail-heading-inline">Versions</h3>
          <ul className="version-list">
            {artifact.versions.map((version) => (
              <li key={version.n}>
                <button
                  className={`version-row ${version.n === currentN ? 'current' : ''} ${
                    stagedN === version.n ? 'staged' : ''
                  }`}
                  onClick={() => setStagedN(version.n)}
                >
                  <span className="version-n mono-font">v{version.n}</span>
                  <span className="version-info">
                    <span className="version-summary">{version.summary}</span>
                    <span className="version-time">{timeAgo(version.createdAt)}</span>
                  </span>
                  {version.n === currentN && <span className="version-current-chip">current</span>}
                </button>
              </li>
            ))}
          </ul>
          <button
            className="button-secondary restore-button"
            disabled={stagedN == null}
            onClick={() => {
              if (stagedN != null) {
                restoreVersion(artifact.id, stagedN)
                setStagedN(null)
              }
            }}
          >
            <RotateCcw size={13} />
            Restore{stagedN != null ? ` v${stagedN}` : ''}
          </button>
        </aside>
      </div>
    </div>
  )
}

function PreviewBody({
  artifact,
  content,
  maxWidth,
}: {
  artifact: Artifact
  content: string
  maxWidth: string
}) {
  if (artifact.kind === 'html' || artifact.kind === 'svg') {
    return (
      <div className="preview-stage">
        <iframe
          className="preview-frame"
          style={{ width: maxWidth }}
          sandbox="allow-scripts"
          title={artifact.title}
          srcDoc={withConsoleBridge(content)}
        />
      </div>
    )
  }

  if (artifact.kind === 'markdown') {
    return (
      <div className="preview-stage preview-scroll">
        <div
          className="markdown-body"
          style={{ maxWidth }}
          dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
        />
      </div>
    )
  }

  return (
    <div className="preview-stage">
      <div className="preview-notice">
        <Info size={16} />
        <p>Preview available for HTML/SVG — switch to Code.</p>
      </div>
    </div>
  )
}
