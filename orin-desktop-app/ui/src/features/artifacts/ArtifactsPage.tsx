import { useEffect, useState } from 'react'
import { Shapes } from 'lucide-react'
import { useArtifactsStore, type Artifact } from '../../stores/artifactsStore'
import { EmptyState } from '../../components/EmptyState'
import { ArtifactViewer } from './ArtifactViewer'
import { timeAgo } from './timeAgo'
import './artifacts.css'

const HELLO_HTML = [
  '<!doctype html>',
  '<html>',
  '  <head>',
  '    <meta charset="utf-8" />',
  '    <style>',
  '      body { font-family: system-ui, sans-serif; background: #161513; color: #ece7de;',
  '             display: grid; place-items: center; height: 100vh; margin: 0 }',
  '      h1 { color: #e08a3c; font-weight: 650 }',
  '    </style>',
  '  </head>',
  '  <body>',
  '    <main><h1>Hello from Orin</h1><p>Edit this artifact or ask Orin to build something.</p></main>',
  '  </body>',
  '</html>',
].join('\n')

export default function ArtifactsPage() {
  const hydrate = useArtifactsStore((state) => state.hydrate)
  const artifacts = useArtifactsStore((state) => state.artifacts)
  const create = useArtifactsStore((state) => state.create)

  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  if (selectedId) {
    const selected = artifacts.find((artifact) => artifact.id === selectedId)
    if (selected) return <ArtifactViewer artifact={selected} onBack={() => setSelectedId(null)} />
  }

  return (
    <div className="artifacts-page">
      <header className="page-header">
        <h1 className="page-title">
          Artifacts <span className="count-chip">{artifacts.length}</span>
        </h1>
        <div className="page-actions">
          <button
            className="button-primary"
            onClick={() => {
              const created = create({ title: 'Untitled artifact', kind: 'html', content: HELLO_HTML })
              setSelectedId(created.id)
            }}
          >
            New artifact
          </button>
        </div>
      </header>

      {artifacts.length === 0 ? (
        <EmptyState
          icon={<Shapes size={30} />}
          title="Your creations will appear here."
          hint="HTML pages, documents, diagrams, and code snippets you build with Orin."
        />
      ) : (
        <div className="artifact-grid">
          {artifacts.map((artifact: Artifact) => (
            <button key={artifact.id} className="artifact-card" onClick={() => setSelectedId(artifact.id)}>
              <span className="artifact-card-top">
                <span className={`kind-badge kind-${artifact.kind}`}>{artifact.kind}</span>
                <span className="artifact-card-versions">{artifact.versions.length} versions</span>
              </span>
              <span className="artifact-card-title">{artifact.title}</span>
              <span className="artifact-card-updated">updated {timeAgo(artifact.updatedAt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
