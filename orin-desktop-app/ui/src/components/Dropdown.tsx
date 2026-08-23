import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import './Dropdown.css'

export type DropdownAlign = 'start' | 'center' | 'end'

interface DropdownProps {
  /** Trigger content; wrapped in a toggle button. */
  trigger: ReactNode
  /** Menu content; receives `close()` so items can dismiss the panel. */
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: DropdownAlign
  /** Extra class on the wrapper (for anchoring context). */
  className?: string
  /** Extra class on the floating panel. */
  panelClassName?: string
  title?: string
  disabled?: boolean
}

/** Generic trigger + floating menu. Closes on outside click and Escape. */
export function Dropdown({
  trigger,
  children,
  align = 'start',
  className,
  panelClassName,
  title,
  disabled,
}: DropdownProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const close = useCallback(() => setOpen(false), [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={rootRef} className={`dropdown ${className ?? ''}`}>
      <button
        type="button"
        className={`dropdown-trigger ${open ? 'open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger}
      </button>
      {open && (
        <div className={`dropdown-panel align-${align} ${panelClassName ?? ''}`} role="menu">
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </div>
  )
}

/** Standard menu row. `selected` shows an accent check; `danger` tints red. */
export function DropdownItem({
  icon,
  label,
  hint,
  selected,
  danger,
  disabled,
  onSelect,
}: {
  icon?: ReactNode
  label: ReactNode
  hint?: ReactNode
  selected?: boolean
  danger?: boolean
  disabled?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`dropdown-item ${danger ? 'danger' : ''} ${disabled ? 'disabled' : ''}`}
      disabled={disabled}
      onClick={onSelect}
    >
      {icon != null ? <span className="dropdown-item-icon">{icon}</span> : <span className="dropdown-item-icon" />}
      <span className="dropdown-item-label">{label}</span>
      {hint != null && <span className="dropdown-item-hint">{hint}</span>}
      {selected && <span className="dropdown-item-check">✓</span>}
    </button>
  )
}

export function DropdownSeparator() {
  return <div className="dropdown-sep" role="separator" />
}

export function DropdownSectionLabel({ children }: { children: ReactNode }) {
  return <div className="dropdown-section">{children}</div>
}
