import { useEffect, useRef, useState, type ReactNode } from 'react'
import './Tooltip.css'

export type TooltipSide = 'top' | 'bottom'

interface TooltipProps {
  label: ReactNode
  children: ReactNode
  side?: TooltipSide
  /** Delay in ms before the bubble appears. */
  delay?: number
}

/** CSS-positioned hover/focus tooltip with an appearance delay. */
export function Tooltip({ label, children, side = 'top', delay = 400 }: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setVisible(true), delay)
  }

  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setVisible(false)
  }

  return (
    <span className="tooltip-wrap" onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      <span className={`tooltip-bubble side-${side} ${visible ? 'visible' : ''}`} role="tooltip">
        {label}
      </span>
    </span>
  )
}
