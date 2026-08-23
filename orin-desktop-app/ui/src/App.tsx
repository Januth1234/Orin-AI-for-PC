import { useEffect } from 'react'
import Layout from './app/Layout'
import { useUiStore } from './stores/uiStore'

export default function App() {
  const hydrateAll = useUiStore((state) => state.hydrateAll)

  useEffect(() => {
    hydrateAll()
  }, [hydrateAll])

  return (
    <div className="app-root">
      <Layout />
    </div>
  )
}
