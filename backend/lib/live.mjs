/**
 * Avisos ao vivo (Server-Sent Events). O servidor só conta QUAL coleção mudou na empresa; cada tela
 * recarrega pela rota normal, com as permissões e a redação de sempre. Nenhum dado viaja por aqui.
 */
export function createLiveHub({ heartbeatMs = 25_000, debounceMs = 250 } = {}) {
  const clients = new Set()
  const pending = new Map() // tenant -> Set(collections)
  let timer = null

  const flush = () => {
    timer = null
    for (const [tenant, names] of pending) {
      for (const client of clients) {
        if (client.tenant !== tenant) continue
        const visible = [...names].filter((name) => client.canRead(name))
        if (visible.length) client.res.write(`data: ${JSON.stringify({ changed: visible })}\n\n`)
      }
    }
    pending.clear()
  }

  /** Registra uma alteração; avisos próximos são agrupados num só envio. */
  function changed(tenant, name) {
    if (!clients.size) return
    const key = tenant ?? null
    if (!pending.has(key)) pending.set(key, new Set())
    pending.get(key).add(name)
    timer ??= setTimeout(flush, debounceMs)
  }

  /** Abre o canal para um usuário. `alive()` é conferido a cada batida (sessão encerrada fecha o canal). */
  function connect(req, res, { tenant, canRead, alive }) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    res.write(`retry: 5000\ndata: ${JSON.stringify({ hello: true })}\n\n`)
    const client = { res, tenant: tenant ?? null, canRead }
    clients.add(client)
    const beat = setInterval(() => {
      if (!alive()) return close()
      res.write(': ping\n\n')
    }, heartbeatMs)
    beat.unref?.()
    function close() {
      clearInterval(beat)
      clients.delete(client)
      if (!res.writableEnded) res.end()
    }
    req.on('close', close)
    return close
  }

  return { changed, connect, size: () => clients.size }
}
