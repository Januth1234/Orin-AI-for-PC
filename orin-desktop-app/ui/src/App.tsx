import { useEffect, useState } from 'react'
import Layout from './app/Layout'
import WelcomePage from './features/welcome/WelcomePage'
import { bridge } from './bridge/client'
import { useUiStore } from './stores/uiStore'
import { useAuthStore } from './stores/authStore'

type Phase = 'booting' | 'welcome' | 'app'

export default function App() {
  const hydrateAll = useUiStore((state) => state.hydrateAll)
  const [phase, setPhase] = useState<Phase>('booting')

  useEffect(() => {
    let alive = true
    ;(async () => {
      await hydrateAll()
      // Auth is not part of hydrateAll — the welcome gate needs it first.
      await useAuthStore.getState().hydrate()
      const signedIn = useAuthStore.getState().status?.signedIn ?? false
      const hasKey =
        (await bridge.providerHasKey('anthropic').catch(() => false)) ||
        (await bridge.providerHasKey('openai_compat').catch(() => false))
      const dismissed = await bridge
        .storeGet<number>('onboarding.dismissed')
        .then((value) => value === 1)
        .catch(() => false)
      if (!alive) return
      setPhase(!signedIn && !hasKey && !dismissed ? 'welcome' : 'app')
    })().catch(() => {
      if (alive) setPhase('app') // never trap the user behind a boot failure
    })
    return () => {
      alive = false
    }
  }, [hydrateAll])

  if (phase === 'booting') {
    return (
      <div className="app-root" aria-busy="true">
        <div className="boot-splash">
          <div className="boot-mark">⚡</div>
        </div>
      </div>
    )
  }

  if (phase === 'welcome') {
    return <WelcomePage onEnterApp={() => setPhase('app')} />
  }

  return (
    <div className="app-root">
      <Layout />
    </div>
  )
}
