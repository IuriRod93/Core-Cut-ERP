/** Encerra o servidor de teste e espera ele sair (só então a pasta de dados pode ser apagada). */
export async function stopServer(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolve) => child.once('exit', resolve).kill())
}
