import type { ReactNode } from 'react'
import {
  AccessTimeIcon,
  AccountBalanceIcon,
  AssignmentIcon,
  AttachFileIcon,
  BuildIcon,
  BusinessIcon,
  ContentCutIcon,
  DashboardIcon,
  DirectionsCarIcon,
  EventIcon,
  FactoryIcon,
  GroupsIcon,
  HandymanIcon,
  HistoryIcon,
  InsightsIcon,
  Inventory2Icon,
  LocalShippingIcon,
  PaidIcon,
  ReceiptLongIcon,
  PeopleAltIcon,
  PrecisionManufacturingIcon,
  RequestQuoteIcon,
  SettingsIcon,
  ShoppingCartIcon,
  StorefrontIcon,
  SupportAgentIcon,
  TaskAltIcon,
  VerifiedIcon,
  ViewInArIcon,
  DescriptionIcon,
  FolderIcon,
} from '../components/icons'
import type { ModuleKey } from '../types'

export interface NavItem {
  label: string
  path: string
  module: ModuleKey
  icon: ReactNode
  section: string
}

export const NAV: NavItem[] = [
  { section: 'Geral', label: 'Painel', path: '/painel', module: 'dashboard', icon: <DashboardIcon /> },
  { section: 'Geral', label: 'Meu trabalho', path: '/tarefas', module: 'tasks', icon: <TaskAltIcon /> },
  { section: 'Geral', label: 'Agenda', path: '/agenda', module: 'agenda', icon: <EventIcon /> },

  { section: 'Comercial', label: 'Leads', path: '/leads', module: 'leads', icon: <PeopleAltIcon /> },
  { section: 'Comercial', label: 'Clientes', path: '/clientes', module: 'clients', icon: <BusinessIcon /> },
  { section: 'Comercial', label: 'Orçamentos', path: '/orcamentos', module: 'budgets', icon: <RequestQuoteIcon /> },
  { section: 'Comercial', label: 'Contratos', path: '/contratos', module: 'contracts', icon: <DescriptionIcon /> },

  { section: 'Projetos', label: 'Projetos', path: '/projetos', module: 'projects', icon: <AssignmentIcon /> },

  { section: 'Produção', label: 'Ordens de produção', path: '/producao', module: 'production', icon: <FactoryIcon /> },
  { section: 'Produção', label: 'Chão de fábrica', path: '/chao-de-fabrica', module: 'shopfloor', icon: <PrecisionManufacturingIcon /> },
  { section: 'Produção', label: 'Plano de corte', path: '/plano-de-corte', module: 'cutplan', icon: <ContentCutIcon /> },
  { section: 'Produção', label: 'Fichas técnicas', path: '/fichas-tecnicas', module: 'bom', icon: <ViewInArIcon /> },
  { section: 'Produção', label: 'Qualidade', path: '/qualidade', module: 'quality', icon: <VerifiedIcon /> },
  { section: 'Produção', label: 'Manutenção', path: '/manutencao', module: 'maintenance', icon: <BuildIcon /> },

  { section: 'Logística', label: 'Entregas e instalações', path: '/entregas', module: 'logistics', icon: <LocalShippingIcon /> },
  { section: 'Logística', label: 'Garantias', path: '/garantias', module: 'warranty', icon: <SupportAgentIcon /> },

  { section: 'Suprimentos', label: 'Estoque e catálogo', path: '/estoque', module: 'inventory', icon: <Inventory2Icon /> },
  { section: 'Suprimentos', label: 'Compras', path: '/compras', module: 'purchases', icon: <ShoppingCartIcon /> },
  { section: 'Suprimentos', label: 'Fornecedores', path: '/fornecedores', module: 'suppliers', icon: <StorefrontIcon /> },

  { section: 'Financeiro', label: 'Financeiro', path: '/financeiro', module: 'financial', icon: <AccountBalanceIcon /> },
  { section: 'Financeiro', label: 'Notas fiscais', path: '/notas-fiscais', module: 'financial', icon: <ReceiptLongIcon /> },
  { section: 'Financeiro', label: 'Comissões', path: '/comissoes', module: 'financial', icon: <PaidIcon /> },

  { section: 'Gestão', label: 'Equipe', path: '/equipe', module: 'team', icon: <GroupsIcon /> },
  { section: 'Gestão', label: 'Ponto', path: '/ponto', module: 'timeclock', icon: <AccessTimeIcon /> },
  { section: 'Gestão', label: 'Veículos', path: '/veiculos', module: 'vehicles', icon: <DirectionsCarIcon /> },
  { section: 'Gestão', label: 'Relatórios', path: '/relatorios', module: 'reports', icon: <InsightsIcon /> },
  { section: 'Gestão', label: 'Arquivos', path: '/arquivos', module: 'files', icon: <FolderIcon /> },
  { section: 'Gestão', label: 'Logs de acesso', path: '/logs', module: 'audit', icon: <HistoryIcon /> },
  { section: 'Gestão', label: 'Configurações', path: '/configuracoes', module: 'settings', icon: <SettingsIcon /> },
]

// Ícones usados em outros pontos da interface
export { AttachFileIcon, HandymanIcon }
