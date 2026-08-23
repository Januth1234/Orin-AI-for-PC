import type { CSSProperties } from 'react'
import './Skeleton.css'

/** Shimmering placeholder block. Pass explicit dimensions via style or className. */
export function Skeleton({ style, className }: { style?: CSSProperties; className?: string }) {
  return <span className={`skeleton ${className ?? ''}`} style={style} aria-hidden="true" />
}
