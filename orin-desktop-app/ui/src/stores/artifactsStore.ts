import { create } from 'zustand'
import { bridge } from '../bridge/client'

export type ArtifactKind = 'html' | 'markdown' | 'code' | 'json' | 'svg'

export interface ArtifactVersion {
  n: number
  summary: string
  content: string
  createdAt: string
}

export interface Artifact {
  id: string
  title: string
  kind: ArtifactKind
  language?: string
  content: string
  versions: ArtifactVersion[]
  createdAt: string
  updatedAt: string
}

interface ArtifactsState {
  artifacts: Artifact[]
  hydrated: boolean
  hydrate: () => Promise<void>
  create: (partial?: Partial<Omit<Artifact, 'id' | 'createdAt' | 'updatedAt' | 'versions'>>) => Artifact
  updateContent: (id: string, content: string, summary?: string) => void
  rename: (id: string, title: string) => void
  remove: (id: string) => void
  restoreVersion: (id: string, n: number) => void
}

const ARTIFACTS_KEY = 'artifacts'
let saveTimer: ReturnType<typeof setTimeout> | undefined

// Debounced persist of the artifacts collection.
function persistArtifacts(artifacts: Artifact[]) {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => bridge.storeSet(ARTIFACTS_KEY, artifacts).catch(() => {}), 350)
}

const now = () => new Date().toISOString()
const uid = () => crypto.randomUUID()
const MAX_VERSIONS = 20

export const useArtifactsStore = create<ArtifactsState>((set, get) => ({
  artifacts: [],
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return
    try {
      const saved = await bridge.storeGet<Artifact[]>(ARTIFACTS_KEY)
      if (Array.isArray(saved)) set({ artifacts: saved, hydrated: true })
    } catch {
      // First launch or storage unavailable — defaults are fine.
    }
    set({ hydrated: true })
  },

  create: (partial) => {
    const artifact: Artifact = {
      id: uid(),
      title: partial?.title ?? 'Untitled artifact',
      kind: partial?.kind ?? 'html',
      language: partial?.language,
      content: partial?.content ?? '',
      versions: [{ n: 1, summary: 'Created', content: partial?.content ?? '', createdAt: now() }],
      createdAt: now(),
      updatedAt: now(),
    }
    set((state) => ({ artifacts: [artifact, ...state.artifacts] }))
    return artifact
  },

  // Pushes a new version only when the content actually changed; keeps at most
  // the last MAX_VERSIONS entries (index 0 is the newest).
  updateContent: (id, content, summary) => {
    set((state) => ({
      artifacts: state.artifacts.map((artifact) => {
        if (artifact.id !== id || artifact.content === content) return artifact
        const nextN = (artifact.versions[0]?.n ?? 0) + 1
        const version: ArtifactVersion = {
          n: nextN,
          summary: summary?.trim() || `Updated to v${nextN}`,
          content,
          createdAt: now(),
        }
        return {
          ...artifact,
          content,
          versions: [version, ...artifact.versions].slice(0, MAX_VERSIONS),
          updatedAt: now(),
        }
      }),
    }))
  },

  rename: (id, title) =>
    set((state) => ({
      artifacts: state.artifacts.map((artifact) =>
        artifact.id === id ? { ...artifact, title: title.trim() || artifact.title, updatedAt: now() } : artifact,
      ),
    })),

  remove: (id) => set((state) => ({ artifacts: state.artifacts.filter((artifact) => artifact.id !== id) })),

  restoreVersion: (id, n) =>
    set((state) => ({
      artifacts: state.artifacts.map((artifact) => {
        if (artifact.id !== id) return artifact
        const source = artifact.versions.find((version) => version.n === n)
        if (!source || source.content === artifact.content) return artifact
        const nextN = (artifact.versions[0]?.n ?? 0) + 1
        const version: ArtifactVersion = {
          n: nextN,
          summary: `Restored v${n}`,
          content: source.content,
          createdAt: now(),
        }
        return {
          ...artifact,
          content: source.content,
          versions: [version, ...artifact.versions].slice(0, MAX_VERSIONS),
          updatedAt: now(),
        }
      }),
    })),
}))

useArtifactsStore.subscribe((state, prev) => {
  if (state.artifacts !== prev.artifacts) persistArtifacts(state.artifacts)
})
