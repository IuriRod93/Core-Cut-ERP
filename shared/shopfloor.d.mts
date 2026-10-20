export type PauseReason =
  | 'falta_material' | 'maquina_parada' | 'ajuste' | 'aguardando_info' | 'problema_qualidade'
  | 'outra_tarefa' | 'intervalo' | 'fim_turno' | 'outro'

export const PAUSE_REASONS: { value: PauseReason; label: string; planned: boolean }[]
export const PAUSE_REASON_KEYS: PauseReason[]
