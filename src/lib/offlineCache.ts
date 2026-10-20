/** Nomes definidos em vite.config.ts (runtimeCaching do service worker). */
const CACHES = ['corecut-app-code', 'corecut-offline-data']

/** Apaga o que o service worker guardou para uso sem internet (troca de usuário no mesmo aparelho). */
export async function clearOfflineCache() {
  if (typeof caches === 'undefined') return
  await Promise.all(CACHES.map((name) => caches.delete(name).catch(() => false)))
}
