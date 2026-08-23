export function startAgent({ id, prompt, role, onChunk, onDone, onError }) {
  const worker = new Worker(new URL('./agent.worker.js', import.meta.url), { type: 'module' })
  worker.onmessage = event => {
    const message = event.data
    if (message.id !== id) return
    if (message.type === 'chunk') onChunk(message.content)
    if (message.type === 'done') { worker.terminate(); onDone() }
  }
  worker.onerror = error => { worker.terminate(); onError(error.message || 'Agent worker failed') }
  worker.postMessage({ id, prompt, role })
  return () => worker.terminate()
}
