import type { ReactNode } from 'react'
import { Archive, FileText, Image as ImageIcon, X } from 'lucide-react'
import './FileChip.css'

export type ChipKind = 'image' | 'doc' | 'code' | 'archive'

export interface FileChipProps {
  name: string
  size?: number
  kind?: ChipKind
  /** Data URL for image previews (shown as a small thumbnail). */
  dataUrl?: string
  onRemove?: () => void
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exp = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** exp
  return `${value >= 100 || exp === 0 ? Math.round(value) : value.toFixed(1)} ${units[exp]}`
}

const KIND_ICONS: Record<ChipKind, ReactNode> = {
  image: <ImageIcon size={12} />,
  doc: <FileText size={12} />,
  code: <FileText size={12} />,
  archive: <Archive size={12} />,
}

/** Attachment pill with kind icon (or image thumb) and a remove affordance. */
export function FileChip({ name, size, kind = 'doc', dataUrl, onRemove }: FileChipProps) {
  return (
    <span className={`file-chip kind-${kind}`} title={`${name}${size != null ? ` · ${formatBytes(size)}` : ''}`}>
      {kind === 'image' && dataUrl ? (
        <img className="file-chip-thumb" src={dataUrl} alt="" />
      ) : (
        <span className="file-chip-icon">{KIND_ICONS[kind]}</span>
      )}
      <span className="file-chip-name">{name}</span>
      {size != null && <span className="file-chip-size">{formatBytes(size)}</span>}
      {onRemove && (
        <button type="button" className="file-chip-remove" aria-label={`Remove ${name}`} onClick={onRemove}>
          <X size={11} />
        </button>
      )}
    </span>
  )
}
