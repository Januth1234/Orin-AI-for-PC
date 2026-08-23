import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'
import { DropdownItem, DropdownSeparator } from './Dropdown'
import './Dropdown.css'
import './ContextMenu.css'

export interface ContextMenuItem {
  id: string
  label: ReactNode
  icon?: ReactNode
  danger?: boolean
  disabled?: boolean
  /** Renders a divider line above this item. */
  dividerBefore?: boolean
  onSelect?: () => void
  /** Nested list shown beside the item on hover (one level deep). */
  submenu?: ContextMenuItem[]
}

interface ContextMenuProps {
  items: ContextMenuItem[]
  children: ReactNode
  /** Right-click at cursor (default) or left-click anchored under the child. */
  trigger?: 'contextmenu' | 'click'
  className?: string
  title?: string
}

interface Point {
  x: number
  y: number
}

const PANEL_WIDTH_ESTIMATE = 230

function clampPosition(pos: Point): Point {
  const margin = 8
  const x = Math.min(Math.max(pos.x, margin), Math.max(margin, window.innerWidth - PANEL_WIDTH_ESTIMATE - margin))
  const y = Math.min(Math.max(pos.y, margin), Math.max(margin, window.innerHeight - 80))
  return { x, y }
}

/** Right-click (or click) menu with icons, dividers and one level of submenu. */
export function ContextMenu({ items, children, trigger = 'contextmenu', className, title }: ContextMenuProps) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<Point>({ x: 0, y: 0 })
  const [submenu, setSubmenu] = useState<{ id: string; point: Point; items: ContextMenuItem[] } | null>(null)
  const anchorRef = useRef<HTMLSpanElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    setSubmenu(null)
  }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement
      if (!target.closest('.ctx-panel')) close()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    const onDismiss = () => close()
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('blur', onDismiss)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('blur', onDismiss)
    }
  }, [open, close])

  const openAt = (point: Point) => {
    setPos(clampPosition(point))
    setSubmenu(null)
    setOpen(true)
  }

  return (
    <span ref={anchorRef} className={`ctx-anchor ${className ?? ''}`}>
      {trigger === 'click' ? (
        <button
          type="button"
          className="ctx-click-target"
          title={title}
          aria-haspopup="menu"
          onClick={() => {
            const rect = anchorRef.current?.getBoundingClientRect()
            openAt(rect ? { x: rect.left, y: rect.bottom + 4 } : pos)
          }}
        >
          {children}
        </button>
      ) : (
        children
      )}

      {open &&
        createPortal(
          <div className="dropdown-panel ctx-panel" role="menu" style={{ left: pos.x, top: pos.y }}>
            {items.map((item, index) => (
              <ContextMenuEntry
                key={item.id}
                item={item}
                leadingDivider={index > 0 && item.dividerBefore === true}
                onOpenSubmenu={(point, subItems) =>
                  setSubmenu(subItems.length > 0 ? { id: item.id, point, items: subItems } : null)
                }
                onClose={close}
              />
            ))}
            {submenu && (
              <div
                className="dropdown-panel ctx-panel ctx-submenu"
                role="menu"
                style={{ left: submenu.point.x, top: submenu.point.y }}
              >
                {submenu.items.map((item) => (
                  <ContextMenuEntry
                    key={item.id}
                    item={item}
                    leadingDivider={false}
                    onOpenSubmenu={() => {}}
                    onClose={close}
                  />
                ))}
              </div>
            )}
          </div>,
          document.body,
        )}
    </span>
  )
}

function ContextMenuEntry({
  item,
  leadingDivider,
  onOpenSubmenu,
  onClose,
}: {
  item: ContextMenuItem
  leadingDivider: boolean
  onOpenSubmenu: (point: Point, items: ContextMenuItem[]) => void
  onClose: () => void
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  // Measure the row once so the submenu lands inside the viewport.
  const [submenuPoint, setSubmenuPoint] = useState<Point>({ x: 0, y: 0 })
  useLayoutEffect(() => {
    if (!item.submenu || !rowRef.current) return
    const rect = rowRef.current.getBoundingClientRect()
    const flip = rect.right + 6 + PANEL_WIDTH_ESTIMATE > window.innerWidth
    setSubmenuPoint(clampPosition({ x: flip ? rect.left - PANEL_WIDTH_ESTIMATE - 4 : rect.right + 2, y: rect.top - 5 }))
  }, [item.submenu])

  const entry = (
    <div
      ref={rowRef}
      onMouseEnter={() => {
        if (item.submenu) onOpenSubmenu(submenuPoint, item.submenu)
      }}
    >
      <DropdownItem
        icon={item.icon ?? (item.submenu?.length ? <ChevronRight size={13} /> : undefined)}
        label={item.label}
        danger={item.danger}
        disabled={item.disabled}
        onSelect={
          item.disabled
            ? undefined
            : () => {
                item.onSelect?.()
                onClose()
              }
        }
      />
    </div>
  )

  return leadingDivider ? (
    <>
      <DropdownSeparator />
      {entry}
    </>
  ) : (
    entry
  )
}
