// Motivos de pausa do Chão de fábrica (servidor e telas usam a mesma lista).
// planned: parada prevista (intervalo, fim do turno), que não conta como perda.
export const PAUSE_REASONS = [
  { value: 'falta_material', label: 'Falta de material', planned: false },
  { value: 'maquina_parada', label: 'Máquina parada / manutenção', planned: false },
  { value: 'ajuste', label: 'Ajuste / preparação da máquina', planned: false },
  { value: 'aguardando_info', label: 'Aguardando informação ou desenho', planned: false },
  { value: 'problema_qualidade', label: 'Problema de qualidade', planned: false },
  { value: 'outra_tarefa', label: 'Chamado para outra tarefa', planned: false },
  { value: 'intervalo', label: 'Intervalo / refeição', planned: true },
  { value: 'fim_turno', label: 'Fim do turno', planned: true },
  { value: 'outro', label: 'Outro motivo', planned: false },
]

export const PAUSE_REASON_KEYS = PAUSE_REASONS.map((r) => r.value)
