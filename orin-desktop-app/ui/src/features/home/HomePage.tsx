import { useEffect, useMemo, useState } from 'react'
import { bridge } from '../../bridge/client'
import type { MessagePart, ModelInfo } from '../../bridge/types'
import type { ChatMode } from '../../stores/chatsStore'
import { useChatsStore } from '../../stores/chatsStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUiStore } from '../../stores/uiStore'
import { OrinMark } from '../../components/OrinMark'
import { Kbd } from '../../components/Kbd'
import { Composer } from '../chat/Composer'
import './HomePage.css'

function timeOfDay(date: Date): { greeting: string; headline: string } {
  const hour = date.getHours()
  if (hour < 5) return { greeting: 'Good night', headline: 'Late-night thoughts' }
  if (hour < 12) return { greeting: 'Good morning', headline: 'Morning thoughts' }
  if (hour < 18) return { greeting: 'Good afternoon', headline: 'Afternoon thoughts' }
  return { greeting: 'Good evening', headline: 'Evening thoughts' }
}

export default function HomePage() {
  const createChat = useChatsStore((state) => state.createChat)
  const sendMessage = useChatsStore((state) => state.sendMessage)
  const defaultMode = useSettingsStore((state) => state.defaultMode)
  const defaultModelId = useSettingsStore((state) => state.defaultModelId)
  const updateSettings = useSettingsStore((state) => state.update)
  const setView = useUiStore((state) => state.setView)

  const [now, setNow] = useState(() => new Date())
  const [models, setModels] = useState<ModelInfo[]>([])

  // Refresh the greeting occasionally; the page is long-lived.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    bridge
      .modelsList()
      .then((list) => {
        if (!cancelled) setModels(list)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const { greeting, headline } = useMemo(() => timeOfDay(now), [now])

  const activeModel = models.find((m) => m.id === defaultModelId)
  const modelSummary = activeModel?.label ?? defaultModelId.split('/').pop() ?? 'Model'

  const handleSend = (text: string, opts?: { imageParts?: MessagePart[] }) => {
    createChat(defaultMode as ChatMode)
    sendMessage(text, opts)
    setView('chat')
  }

  return (
    <div className="home-page">
      <div className="home-stack">
        <p className="home-greeting">{greeting}</p>
        <h1 className="home-headline">
          <OrinMark size={34} />
          <span>{headline}</span>
        </h1>

        <Composer
          key="home"
          mode={defaultMode as ChatMode}
          onModeChange={(mode) => updateSettings({ defaultMode: mode })}
          onSend={handleSend}
          autoFocus
        />

        <div className="home-hints">
          <span>{modelSummary}</span>
          <span className="home-hint-dot" aria-hidden="true" />
          <span>
            <Kbd>Enter</Kbd> to send · <Kbd>Shift</Kbd> <Kbd>Enter</Kbd> for newline
          </span>
        </div>
      </div>
    </div>
  )
}
