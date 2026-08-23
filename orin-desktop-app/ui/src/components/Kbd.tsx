import type { ReactNode } from 'react'
import './Kbd.css'

/** Small keycap, e.g. <Kbd>⏎</Kbd> or <Kbd>Shift ↵</Kbd>. */
export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}
