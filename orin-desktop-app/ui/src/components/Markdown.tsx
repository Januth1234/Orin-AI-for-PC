import { useMemo, type MouseEvent } from 'react'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import './Markdown.css'

// One shared parser: GitHub-flavored markdown, chat-friendly line breaks.
const parser = new Marked({ gfm: true, breaks: true })

/**
 * Wrap every fenced code block in a card with a language label + Copy button.
 * Runs on already-sanitized HTML, so the injected chrome needs no further care.
 */
function decorateCodeBlocks(html: string): string {
  const pattern = /<pre><code(?:\s+class="language-([\w+#.-]+)")?>/g
  return html.replace(pattern, (_match, lang?: string) => {
    const language = lang ?? 'text'
    return (
      `<div class="md-code"><div class="md-code-head">` +
      `<span class="md-code-lang">${language}</span>` +
      `<button type="button" class="md-copy" data-md-copy aria-label="Copy code">` +
      `<span class="md-copy-label">Copy</span></button>` +
      `</div><pre><code>`
    )
  })
}

/** Render markdown safely: parsed with marked, sanitized with DOMPurify. */
export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => {
    const raw = parser.parse(text) as string
    const clean = DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
    return decorateCodeBlocks(clean)
  }, [text])

  const onClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement

    // Links never navigate the workspace shell.
    const anchor = target.closest('a')
    if (anchor) {
      event.preventDefault()
      const href = anchor.getAttribute('href') ?? ''
      if (/^(https?:|mailto:)/i.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
      return
    }

    const copyButton = target.closest<HTMLButtonElement>('button[data-md-copy]')
    if (copyButton) {
      const pre = copyButton.closest('.md-code')?.querySelector('pre')
      const source = pre?.textContent ?? ''
      navigator.clipboard?.writeText(source).then(
        () => {
          const label = copyButton.querySelector('.md-copy-label')
          if (!label) return
          label.textContent = 'Copied'
          window.setTimeout(() => {
            label.textContent = 'Copy'
          }, 1400)
        },
        () => {},
      )
    }
  }

  return <div className={`markdown ${className ?? ''}`} onClick={onClick} dangerouslySetInnerHTML={{ __html: html }} />
}
