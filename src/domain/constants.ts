export interface Opt {
  value: string
  label: string
  color?: string
}

const C = {
  gray: '#7d838c',
  blue: '#2f6f9f',
  amber: '#b7791f',
  green: '#2e7d4f',
  red: '#c23b3b',
  brand: '#700618',
  purple: '#6b5fa8',
  teal: '#2f8f8a',
  oak: '#a67b52',
  orange: '#c06a2b',
}
export const palette = C

export const optLabel = (opts: Opt[], value?: string | null) => opts.find((o) => o.value === value)?.label ?? value ?? '—'
export const optColor = (opts: Opt[], value?: string | null) => opts.find((o) => o.value === value)?.color ?? C.gray

export const LEAD_STAGES: Opt[] = [
  { value: 'novo', label: 'Novo', color: C.gray },
  { value: 'contato', label: 'Em contato', color: C.blue },
  { value: 'visita', label: 'Visita / medição', color: C.purple },
  { value: 'proposta', label: 'Proposta enviada', color: C.amber },
  { value: 'negociacao', label: 'Negociação', color: C.orange },
  { value: 'ganho', label: 'Ganho', color: C.green },
  { value: 'perdido', label: 'Perdido', color: C.red },
]

export const LEAD_ORIGINS: Opt[] = [
  { value: 'instagram', label: 'Instagram' },
  { value: 'indicacao', label: 'Indicação' },
  { value: 'google', label: 'Google' },
  { value: 'cliente_antigo', label: 'Cliente antigo' },
  { value: 'arquiteto', label: 'Arquiteto / designer' },
  { value: 'feira', label: 'Feira / evento' },
  { value: 'outro', label: 'Outro' },
]

export const CLIENT_TYPES: Opt[] = [
  { value: 'PF', label: 'Pessoa física' },
  { value: 'PJ', label: 'Pessoa jurídica' },
]
export const CLIENT_SEGMENTS: Opt[] = [
  { value: 'residencial', label: 'Residencial' },
  { value: 'corporativo', label: 'Corporativo' },
  { value: 'construtora', label: 'Construtora / incorporadora' },
  { value: 'arquiteto', label: 'Arquiteto / designer' },
  { value: 'revenda', label: 'Revenda / lojista' },
]
export const ACTIVE_STATUS: Opt[] = [
  { value: 'ativo', label: 'Ativo', color: C.green },
  { value: 'inativo', label: 'Inativo', color: C.gray },
]

export const PROJECT_PRIORITIES: Opt[] = [
  { value: 'baixa', label: 'Baixa', color: C.gray },
  { value: 'media', label: 'Média', color: C.blue },
  { value: 'alta', label: 'Alta', color: C.amber },
  { value: 'urgente', label: 'Urgente', color: C.red },
]

export const TASK_PRIORITIES: Opt[] = [
  { value: 'urgente', label: 'Urgente', color: C.red },
  { value: 'alta', label: 'Alta', color: C.amber },
  { value: 'normal', label: 'Normal', color: C.blue },
  { value: 'baixa', label: 'Baixa', color: C.gray },
]

export const BUDGET_STATUS: Opt[] = [
  { value: 'rascunho', label: 'Rascunho', color: C.gray },
  { value: 'enviado', label: 'Enviado', color: C.blue },
  { value: 'aprovado', label: 'Aprovado', color: C.green },
  { value: 'recusado', label: 'Recusado', color: C.red },
  { value: 'expirado', label: 'Expirado', color: C.amber },
]

export const BUDGET_ITEM_KINDS: Opt[] = [
  { value: 'ambiente', label: 'Ambiente' },
  { value: 'modulo', label: 'Módulo / ficha técnica' },
  { value: 'material', label: 'Material' },
  { value: 'ferragem', label: 'Ferragem' },
  { value: 'servico', label: 'Serviço' },
  { value: 'outro', label: 'Outro' },
]

export const CONTRACT_STATUS: Opt[] = [
  { value: 'rascunho', label: 'Rascunho', color: C.gray },
  { value: 'enviado', label: 'Enviado p/ assinatura', color: C.blue },
  { value: 'assinado', label: 'Assinado', color: C.green },
  { value: 'em_execucao', label: 'Em execução', color: C.brand },
  { value: 'concluido', label: 'Concluído', color: C.teal },
  { value: 'cancelado', label: 'Cancelado', color: C.red },
]

export const BOM_CATEGORIES: Opt[] = [
  { value: 'balcao', label: 'Balcão / base' },
  { value: 'aereo', label: 'Aéreo' },
  { value: 'torre', label: 'Torre' },
  { value: 'gaveteiro', label: 'Gaveteiro' },
  { value: 'roupeiro', label: 'Roupeiro / armário' },
  { value: 'painel', label: 'Painel / revestimento' },
  { value: 'bancada', label: 'Bancada / tampo' },
  { value: 'porta', label: 'Porta / frente' },
  { value: 'outro', label: 'Outro' },
]

export const OP_STATUS: Opt[] = [
  { value: 'planejada', label: 'Planejada', color: C.gray },
  { value: 'liberada', label: 'Liberada', color: C.blue },
  { value: 'em_producao', label: 'Em produção', color: C.brand },
  { value: 'qualidade', label: 'Em qualidade', color: C.amber },
  { value: 'concluida', label: 'Concluída', color: C.green },
  { value: 'pausada', label: 'Pausada', color: C.orange },
  { value: 'cancelada', label: 'Cancelada', color: C.red },
]

export const OPERATION_STATUS: Opt[] = [
  { value: 'pendente', label: 'Pendente', color: C.gray },
  { value: 'em_andamento', label: 'Em andamento', color: C.brand },
  { value: 'pausada', label: 'Pausada', color: C.orange },
  { value: 'concluida', label: 'Concluída', color: C.green },
]

export const QUALITY_KINDS: Opt[] = [
  { value: 'retrabalho', label: 'Retrabalho' },
  { value: 'refugo', label: 'Refugo' },
  { value: 'defeito_material', label: 'Defeito de material' },
  { value: 'erro_projeto', label: 'Erro de projeto' },
  { value: 'dano_transporte', label: 'Dano no transporte' },
  { value: 'reclamacao_cliente', label: 'Reclamação do cliente' },
]
export const SEVERITY: Opt[] = [
  { value: 'baixa', label: 'Baixa', color: C.gray },
  { value: 'media', label: 'Média', color: C.blue },
  { value: 'alta', label: 'Alta', color: C.amber },
  { value: 'critica', label: 'Crítica', color: C.red },
]
export const QUALITY_STATUS: Opt[] = [
  { value: 'aberta', label: 'Aberta', color: C.red },
  { value: 'em_analise', label: 'Em análise', color: C.amber },
  { value: 'em_tratamento', label: 'Em tratamento', color: C.blue },
  { value: 'concluida', label: 'Concluída', color: C.green },
]

export const MAINT_KINDS: Opt[] = [
  { value: 'preventiva', label: 'Preventiva' },
  { value: 'corretiva', label: 'Corretiva' },
  { value: 'preditiva', label: 'Preditiva' },
]
export const MAINT_STATUS: Opt[] = [
  { value: 'agendada', label: 'Agendada', color: C.blue },
  { value: 'em_andamento', label: 'Em andamento', color: C.amber },
  { value: 'concluida', label: 'Concluída', color: C.green },
  { value: 'cancelada', label: 'Cancelada', color: C.gray },
]

export const INSTALL_KINDS: Opt[] = [
  { value: 'entrega', label: 'Entrega' },
  { value: 'instalacao', label: 'Instalação' },
  { value: 'visita_tecnica', label: 'Visita técnica' },
  { value: 'medicao', label: 'Medição' },
]
export const INSTALL_STATUS: Opt[] = [
  { value: 'agendada', label: 'Agendada', color: C.blue },
  { value: 'em_rota', label: 'Em rota', color: C.purple },
  { value: 'em_andamento', label: 'Em andamento', color: C.amber },
  { value: 'concluida', label: 'Concluída', color: C.green },
  { value: 'reagendada', label: 'Reagendada', color: C.orange },
  { value: 'cancelada', label: 'Cancelada', color: C.gray },
]

export const WARRANTY_STATUS: Opt[] = [
  { value: 'aberta', label: 'Aberta', color: C.red },
  { value: 'em_analise', label: 'Em análise', color: C.amber },
  { value: 'agendada', label: 'Visita agendada', color: C.blue },
  { value: 'resolvida', label: 'Resolvida', color: C.green },
  { value: 'negada', label: 'Fora da garantia', color: C.gray },
]

export const MATERIAL_CATEGORIES: Opt[] = [
  { value: 'chapa', label: 'Chapas (MDF/MDP)', color: C.oak },
  { value: 'fita_borda', label: 'Fita de borda', color: C.teal },
  { value: 'ferragem', label: 'Ferragens', color: C.blue },
  { value: 'insumo', label: 'Insumos e consumíveis', color: C.purple },
  { value: 'vidro', label: 'Vidros e espelhos', color: C.gray },
  { value: 'pedra', label: 'Pedras e tampos', color: C.gray },
  { value: 'outro', label: 'Outros', color: C.gray },
]

export const UNITS: Opt[] = [
  { value: 'un', label: 'un' },
  { value: 'chapa', label: 'chapa' },
  { value: 'm', label: 'm' },
  { value: 'm2', label: 'm²' },
  { value: 'kg', label: 'kg' },
  { value: 'l', label: 'l' },
  { value: 'cx', label: 'cx' },
  { value: 'pç', label: 'pç' },
  { value: 'h', label: 'h' },
]

export const PURCHASE_STATUS: Opt[] = [
  { value: 'rascunho', label: 'Rascunho', color: C.gray },
  { value: 'solicitado', label: 'Solicitado', color: C.blue },
  { value: 'cotacao', label: 'Em cotação', color: C.purple },
  { value: 'aprovado', label: 'Aprovado', color: C.amber },
  { value: 'reprovado', label: 'Reprovado', color: C.red },
  { value: 'pedido', label: 'Pedido ao fornecedor', color: C.brand },
  { value: 'parcial', label: 'Recebido parcial', color: C.orange },
  { value: 'recebido', label: 'Recebido', color: C.green },
  { value: 'cancelado', label: 'Cancelado', color: C.red },
]

export const SUPPLIER_CATEGORIES: Opt[] = [
  { value: 'chapas', label: 'Chapas e painéis' },
  { value: 'ferragens', label: 'Ferragens' },
  { value: 'insumos', label: 'Insumos' },
  { value: 'vidros', label: 'Vidros e espelhos' },
  { value: 'pedras', label: 'Pedras e tampos' },
  { value: 'servicos', label: 'Serviços' },
  { value: 'logistica', label: 'Logística' },
  { value: 'outro', label: 'Outro' },
]

export const CONTRACTOR_SPECIALTIES: Opt[] = [
  { value: 'montador', label: 'Montador' },
  { value: 'eletricista', label: 'Eletricista' },
  { value: 'marmorista', label: 'Marmorista' },
  { value: 'vidraceiro', label: 'Vidraceiro' },
  { value: 'pintor', label: 'Pintor / laqueador' },
  { value: 'transportador', label: 'Transportador' },
  { value: 'outro', label: 'Outro' },
]

export const FINANCE_STATUS: Opt[] = [
  { value: 'pendente', label: 'Pendente', color: C.amber },
  { value: 'pago', label: 'Pago', color: C.green },
  { value: 'atrasado', label: 'Atrasado', color: C.red },
  { value: 'cancelado', label: 'Cancelado', color: C.gray },
]

export const INCOME_CATEGORIES = ['Venda de projetos', 'Entrada / sinal', 'Parcelas de contrato', 'Assistência técnica', 'Outras receitas']
export const EXPENSE_CATEGORIES = [
  'Matéria-prima',
  'Ferragens e insumos',
  'Folha de pagamento',
  'Encargos e impostos',
  'Aluguel e condomínio',
  'Energia e água',
  'Manutenção de máquinas',
  'Frete e logística',
  'Veículos e combustível',
  'Marketing e vendas',
  'Serviços de terceiros',
  'Outras despesas',
]

export const PAYMENT_METHODS: Opt[] = [
  { value: 'pix', label: 'PIX' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'transferencia', label: 'Transferência' },
  { value: 'cartao', label: 'Cartão' },
  { value: 'dinheiro', label: 'Dinheiro' },
  { value: 'cheque', label: 'Cheque' },
]

export const VEHICLE_KINDS: Opt[] = [
  { value: 'caminhao', label: 'Caminhão' },
  { value: 'van', label: 'Van' },
  { value: 'utilitario', label: 'Utilitário' },
  { value: 'carro', label: 'Carro' },
  { value: 'moto', label: 'Moto' },
]
export const VEHICLE_STATUS: Opt[] = [
  { value: 'ativo', label: 'Ativo', color: C.green },
  { value: 'manutencao', label: 'Em manutenção', color: C.amber },
  { value: 'inativo', label: 'Inativo', color: C.gray },
]

export const EVENT_KINDS: Opt[] = [
  { value: 'reuniao', label: 'Reunião', color: C.blue },
  { value: 'medicao', label: 'Medição', color: C.purple },
  { value: 'visita', label: 'Visita', color: C.teal },
  { value: 'entrega', label: 'Entrega', color: C.orange },
  { value: 'instalacao', label: 'Instalação', color: C.green },
  { value: 'prazo', label: 'Prazo', color: C.red },
  { value: 'outro', label: 'Outro', color: C.gray },
]

export const CLOCK_TYPES: Opt[] = [
  { value: 'entrada', label: 'Entrada', color: C.green },
  { value: 'saida_intervalo', label: 'Saída para intervalo', color: C.amber },
  { value: 'volta_intervalo', label: 'Volta do intervalo', color: C.blue },
  { value: 'saida', label: 'Saída', color: C.brand },
]

export const FILE_VISIBILITY: Opt[] = [
  { value: 'interno', label: 'Interno' },
  { value: 'compartilhado', label: 'Compartilhado' },
  { value: 'financeiro', label: 'Financeiro (restrito)' },
]

export const BR_STATES = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'].map(
  (s) => ({ value: s, label: s }),
)

export const LABEL_COLORS = ['#700618', '#a67b52', '#2f6f9f', '#2f8f8a', '#b7791f', '#6b5fa8', '#c06a2b', '#3f7a4f', '#7d838c', '#4c5a67']

export const ENVIRONMENTS: Opt[] = [
  { value: 'cozinha', label: 'Cozinha', color: '#a8582f' },
  { value: 'closet', label: 'Closet', color: '#6b5fa8' },
  { value: 'dormitorio', label: 'Dormitório', color: '#4f7ea8' },
  { value: 'sala', label: 'Sala e living', color: '#2f8f8a' },
  { value: 'banheiro', label: 'Banheiro', color: '#3f7a4f' },
  { value: 'area_gourmet', label: 'Área gourmet', color: '#c06a2b' },
  { value: 'escritorio', label: 'Escritório', color: '#4c5a67' },
  { value: 'comercial', label: 'Comercial / corporativo', color: '#700618' },
  { value: 'lote_seriado', label: 'Lote seriado', color: '#a67b52' },
  { value: 'outro', label: 'Outro', color: '#7d838c' },
]
