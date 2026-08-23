self.onmessage = event => {
  const { id, prompt, role = 'main' } = event.data
  const intro = role === 'subagent'
    ? `Subagent review complete: I inspected the task “${prompt}”. `
    : `I’m working on “${prompt}”. `
  const body = role === 'subagent'
    ? 'I recommend checking the affected files, isolating the smallest change, and reporting the result back to the parent agent.'
    : 'I will inspect the project context, make a focused change, and keep the code panel updated as work progresses.'
  const text = intro + body
  let index = 0
  const timer = setInterval(() => {
    index = Math.min(text.length, index + 5)
    self.postMessage({ id, type: 'chunk', content: text.slice(0, index) })
    if (index === text.length) { clearInterval(timer); self.postMessage({ id, type: 'done' }) }
  }, 30)
}
