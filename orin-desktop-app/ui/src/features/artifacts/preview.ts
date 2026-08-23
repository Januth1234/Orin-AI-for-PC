import DOMPurify from 'dompurify'
import { marked } from 'marked'
import type { ArtifactKind } from '../../stores/artifactsStore'

// Injected at the top of every preview document so the Console tab can mirror
// the sandboxed iframe's console output through postMessage.
const CONSOLE_BRIDGE = `<script>(function(){
  function fmt(v){ try { return typeof v === 'string' ? v : JSON.stringify(v) } catch (e) { return String(v) } }
  function send(level, args){
    try { parent.postMessage({ __orinPreview: true, level: level, text: Array.prototype.map.call(args, fmt).join(' ') }, '*') } catch (e) {}
  }
  ['log','info','warn','error'].forEach(function(k){
    var original = console[k] ? console[k].bind(console) : function(){};
    console[k] = function(){ send(k === 'warn' ? 'warn' : k, arguments); original.apply(null, arguments) }
  })
  window.addEventListener('error', function(e){ send('error', [e.message || 'Script error']) })
  window.addEventListener('unhandledrejection', function(e){ send('error', ['Unhandled rejection: ' + e.reason]) })
})()</script>`

export function withConsoleBridge(content: string): string {
  return CONSOLE_BRIDGE + '\n' + content
}

export function renderMarkdown(source: string): string {
  const html = marked.parse(source, { async: false }) as string
  return DOMPurify.sanitize(html)
}

const LANGUAGE_EXTENSIONS: Record<string, string> = {
  typescript: 'ts',
  javascript: 'js',
  python: 'py',
  rust: 'rs',
  go: 'go',
  css: 'css',
  scss: 'scss',
  html: 'html',
  json: 'json',
  yaml: 'yml',
  markdown: 'md',
  shell: 'sh',
  sql: 'sql',
}

export function downloadFileName(title: string, kind: ArtifactKind, language?: string): string {
  const safeBase = title.replace(/[^\w.-]+/g, '_') || 'artifact'
  let ext = 'txt'
  if (kind === 'html') ext = 'html'
  else if (kind === 'svg') ext = 'svg'
  else if (kind === 'json') ext = 'json'
  else if (kind === 'markdown') ext = 'md'
  else if (language && LANGUAGE_EXTENSIONS[language]) ext = LANGUAGE_EXTENSIONS[language]
  return /\.[a-z0-9]{1,6}$/i.test(safeBase) ? safeBase : `${safeBase}.${ext}`
}

export function downloadText(fileName: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    // Clipboard API unavailable — fall back to a hidden textarea.
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
      return true
    } catch {
      return false
    }
  }
}
