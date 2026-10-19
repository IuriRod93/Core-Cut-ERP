import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Checkbox,
  FormControlLabel,
  IconButton,
  Tab,
  Tabs,
  TextField,
  Typography,
  Button,
} from '@mui/material'
import { Stack } from '../components/Stack'
import { CrudPage, type CrudConfig } from '../components/CrudPage'
import { StatusChip, UserAvatar } from '../components/ui'
import { CloseIcon, AddIcon } from '../components/icons'
import {
  BusinessIcon,
  StorefrontIcon,
  DirectionsCarIcon,
  VerifiedIcon,
  BuildIcon,
  SupportAgentIcon,
  LocalShippingIcon,
  EngineeringIcon,
  CheckCircleIcon,
  AssignmentIcon,
  RequestQuoteIcon,
} from '../components/icons'
import {
  ACTIVE_STATUS,
  BR_STATES,
  CLIENT_SEGMENTS,
  CLIENT_TYPES,
  CONTRACTOR_SPECIALTIES,
  INSTALL_KINDS,
  INSTALL_STATUS,
  MAINT_KINDS,
  MAINT_STATUS,
  PROJECT_PRIORITIES,
  QUALITY_KINDS,
  QUALITY_STATUS,
  SEVERITY,
  SUPPLIER_CATEGORIES,
  VEHICLE_KINDS,
  VEHICLE_STATUS,
  WARRANTY_STATUS,
  optLabel,
} from '../domain/constants'
import { brl, daysUntil, fmtDate, todayISO, uid, addDaysISO } from '../lib/format'
import { PageHeader } from '../components/ui'
import { DeliveryRoutePanel } from '../components/DeliveryRoutePanel'
import { useCollection } from '../lib/store'
import { useToast } from '../components/feedback'
import { PhotoField } from '../components/PhotoField'

const Two = ({ primary, secondary }: { primary: ReactNode; secondary?: ReactNode }) => (
  <Box sx={{ minWidth: 0 }}>
    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
      {primary}
    </Typography>
    {secondary ? (
      <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
        {secondary}
      </Typography>
    ) : null}
  </Box>
)

// ---------------------------------------------------------------- Clientes
export function ClientsPage() {
  const navigate = useNavigate()
  const config: CrudConfig = {
    collection: 'clients',
    module: 'clients',
    title: 'Clientes',
    subtitle: 'Cadastro de clientes, contatos e endereços de obra.',
    singular: 'cliente',
    icon: <BusinessIcon />,
    lookups: ['projects'],
    initialSort: { key: 'name', dir: 'asc' },
    defaults: () => ({ type: 'PF', status: 'ativo', segment: 'residencial', state: 'SP' }),
    searchText: (r) => [r.name, r.code, r.document, r.email, r.phone, r.city, r.contactName],
    filters: [
      { name: 'status', label: 'Situação', options: ACTIVE_STATUS, get: (r) => r.status },
      { name: 'segment', label: 'Segmento', options: CLIENT_SEGMENTS, get: (r) => r.segment },
    ],
    stats: (rows, ctx) => {
      const withProject = new Set((ctx.data.projects ?? []).map((p) => p.clientId))
      return [
        { label: 'Clientes', value: rows.length, icon: <BusinessIcon /> },
        { label: 'Ativos', value: rows.filter((r) => r.status === 'ativo').length, tone: 'success' },
        { label: 'Com projetos', value: rows.filter((r) => withProject.has(r.id)).length, tone: 'brand' },
        { label: 'Pessoa jurídica', value: rows.filter((r) => r.type === 'PJ').length },
      ]
    },
    columns: (ctx) => [
      { key: 'name', header: 'Cliente', sort: (r) => r.name, render: (r) => <Two primary={r.name} secondary={r.code} /> },
      { key: 'document', header: 'CPF / CNPJ', hideBelow: 'md', sort: (r) => r.document, render: (r) => r.document || '—' },
      { key: 'contact', header: 'Contato', hideBelow: 'sm', render: (r) => <Two primary={r.phone || '—'} secondary={r.email} /> },
      { key: 'city', header: 'Cidade', hideBelow: 'lg', sort: (r) => r.city, render: (r) => [r.city, r.state].filter(Boolean).join(' / ') || '—' },
      { key: 'segment', header: 'Segmento', hideBelow: 'lg', render: (r) => optLabel(CLIENT_SEGMENTS, r.segment) },
      {
        key: 'projects',
        header: 'Projetos',
        align: 'right',
        sort: (r) => (ctx.data.projects ?? []).filter((p) => p.clientId === r.id).length,
        render: (r) => (ctx.data.projects ?? []).filter((p) => p.clientId === r.id).length,
      },
      { key: 'status', header: 'Situação', sort: (r) => r.status, render: (r) => <StatusChip options={ACTIVE_STATUS} value={r.status} /> },
    ],
    fields: [
      { name: 'name', label: 'Nome / razão social', type: 'text', required: true, span: 8 },
      { name: 'type', label: 'Tipo', type: 'select', options: CLIENT_TYPES, required: true, span: 4 },
      { name: 'document', label: 'CPF / CNPJ', type: 'document', span: 4 },
      { name: 'segment', label: 'Segmento', type: 'select', options: CLIENT_SEGMENTS, span: 4 },
      { name: 'status', label: 'Situação', type: 'select', options: ACTIVE_STATUS, required: true, span: 4 },
      { name: 'contactName', label: 'Pessoa de contato', type: 'text', span: 4, section: 'Contato' },
      { name: 'phone', label: 'Telefone / WhatsApp', type: 'phone', span: 4 },
      { name: 'email', label: 'E-mail', type: 'email', span: 4 },
      { name: 'zip', label: 'CEP', type: 'text', span: 3, section: 'Endereço' },
      { name: 'address', label: 'Endereço (rua)', type: 'text', span: 6 },
      { name: 'number', label: 'Número', type: 'text', span: 3 },
      { name: 'district', label: 'Bairro', type: 'text', span: 4 },
      { name: 'city', label: 'Cidade', type: 'text', span: 5 },
      { name: 'state', label: 'UF', type: 'select', options: BR_STATES, span: 3 },
      { name: 'ie', label: 'Inscrição estadual (para nota fiscal)', type: 'text', span: 6, helper: 'Deixe em branco se o cliente não for contribuinte.' },
      { name: 'notes', label: 'Observações', type: 'textarea' },
    ],
    rowActions: (row) => [
      { label: 'Novo projeto', icon: <AssignmentIcon fontSize="small" />, onClick: () => navigate(`/projetos?novo=1&cliente=${row.id}`) },
      { label: 'Novo orçamento', icon: <RequestQuoteIcon fontSize="small" />, onClick: () => navigate(`/orcamentos?new=1&cliente=${row.id}`) },
    ],
  }
  return <CrudPage config={config} />
}

// ------------------------------------------------------------ Fornecedores
const suppliersConfig: CrudConfig = {
  collection: 'suppliers',
  module: 'suppliers',
  title: 'Fornecedores',
  subtitle: 'Fornecedores de chapas, ferragens, insumos e serviços — com prazos e condições de pagamento.',
  singular: 'fornecedor',
  icon: <StorefrontIcon />,
  lookups: ['materials', 'purchases'],
  initialSort: { key: 'name', dir: 'asc' },
  defaults: () => ({ category: 'chapas', status: 'ativo', leadTimeDays: 5, rating: 4 }),
  searchText: (r) => [r.name, r.code, r.document, r.contact, r.email, r.phone],
  filters: [
    { name: 'category', label: 'Categoria', options: SUPPLIER_CATEGORIES, get: (r) => r.category },
    { name: 'status', label: 'Situação', options: ACTIVE_STATUS, get: (r) => r.status },
  ],
  stats: (rows, ctx) => [
    { label: 'Fornecedores', value: rows.length, icon: <StorefrontIcon /> },
    { label: 'Ativos', value: rows.filter((r) => r.status === 'ativo').length, tone: 'success' },
    { label: 'Itens no estoque', value: (ctx.data.materials ?? []).length, tone: 'brand' },
    { label: 'Prazo médio', value: `${Math.round(rows.reduce((s, r) => s + (r.leadTimeDays ?? 0), 0) / Math.max(rows.length, 1))} dias` },
  ],
  columns: (ctx) => [
    { key: 'name', header: 'Fornecedor', sort: (r) => r.name, render: (r) => <Two primary={r.name} secondary={r.code} /> },
    { key: 'category', header: 'Categoria', sort: (r) => r.category, render: (r) => optLabel(SUPPLIER_CATEGORIES, r.category) },
    { key: 'contact', header: 'Contato', hideBelow: 'md', render: (r) => <Two primary={r.contact || '—'} secondary={r.phone || r.email} /> },
    { key: 'terms', header: 'Pagamento', hideBelow: 'lg', render: (r) => r.paymentTerms || '—' },
    { key: 'lead', header: 'Prazo', align: 'right', hideBelow: 'md', sort: (r) => r.leadTimeDays, render: (r) => (r.leadTimeDays ? `${r.leadTimeDays} d` : '—') },
    {
      key: 'items',
      header: 'Itens',
      align: 'right',
      hideBelow: 'md',
      sort: (r) => (ctx.data.materials ?? []).filter((m) => m.supplierId === r.id).length,
      render: (r) => (ctx.data.materials ?? []).filter((m) => m.supplierId === r.id).length,
    },
    { key: 'status', header: 'Situação', render: (r) => <StatusChip options={ACTIVE_STATUS} value={r.status} /> },
  ],
  fields: [
    { name: 'name', label: 'Razão social / nome', type: 'text', required: true, span: 8 },
    { name: 'category', label: 'Categoria', type: 'select', options: SUPPLIER_CATEGORIES, required: true, span: 4 },
    { name: 'document', label: 'CNPJ', type: 'document', span: 4 },
    { name: 'website', label: 'Site', type: 'text', span: 4 },
    { name: 'status', label: 'Situação', type: 'select', options: ACTIVE_STATUS, required: true, span: 4 },
    { name: 'contact', label: 'Contato', type: 'text', span: 4, section: 'Contato' },
    { name: 'phone', label: 'Telefone', type: 'phone', span: 4 },
    { name: 'email', label: 'E-mail', type: 'email', span: 4 },
    { name: 'address', label: 'Endereço', type: 'text', span: 12 },
    { name: 'paymentTerms', label: 'Condição de pagamento', type: 'text', span: 6, section: 'Condições comerciais' },
    { name: 'leadTimeDays', label: 'Prazo de entrega (dias)', type: 'number', span: 3, min: 0 },
    { name: 'rating', label: 'Avaliação (1–5)', type: 'number', span: 3, min: 1, max: 5 },
    { name: 'notes', label: 'Observações', type: 'textarea' },
  ],
}

const contractorsConfig: CrudConfig = {
  collection: 'contractors',
  module: 'suppliers',
  title: 'Prestadores',
  subtitle: 'Montadores, eletricistas, marmoristas e demais prestadores de serviço.',
  singular: 'prestador',
  icon: <EngineeringIcon />,
  initialSort: { key: 'name', dir: 'asc' },
  defaults: () => ({ specialty: 'montador', status: 'ativo' }),
  searchText: (r) => [r.name, r.code, r.document, r.phone],
  filters: [{ name: 'specialty', label: 'Especialidade', options: CONTRACTOR_SPECIALTIES, get: (r) => r.specialty }],
  columns: () => [
    { key: 'name', header: 'Prestador', sort: (r) => r.name, render: (r) => <Two primary={r.name} secondary={r.code} /> },
    { key: 'specialty', header: 'Especialidade', sort: (r) => r.specialty, render: (r) => optLabel(CONTRACTOR_SPECIALTIES, r.specialty) },
    { key: 'phone', header: 'Telefone', render: (r) => r.phone || '—' },
    { key: 'rate', header: 'Diária', align: 'right', sort: (r) => r.dailyRate, render: (r) => (r.dailyRate ? brl(r.dailyRate) : '—') },
    { key: 'status', header: 'Situação', render: (r) => <StatusChip options={ACTIVE_STATUS} value={r.status} /> },
  ],
  fields: [
    { name: 'name', label: 'Nome', type: 'text', required: true, span: 8 },
    { name: 'specialty', label: 'Especialidade', type: 'select', options: CONTRACTOR_SPECIALTIES, required: true, span: 4 },
    { name: 'document', label: 'CPF / CNPJ', type: 'document', span: 4 },
    { name: 'phone', label: 'Telefone', type: 'phone', span: 4 },
    { name: 'email', label: 'E-mail', type: 'email', span: 4 },
    { name: 'dailyRate', label: 'Diária / valor de referência', type: 'money', span: 6 },
    { name: 'status', label: 'Situação', type: 'select', options: ACTIVE_STATUS, required: true, span: 6 },
    { name: 'notes', label: 'Observações', type: 'textarea' },
  ],
}

export function SuppliersPage() {
  const [tab, setTab] = useState(0)
  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Tab label="Fornecedores" />
        <Tab label="Prestadores de serviço" />
      </Tabs>
      {tab === 0 ? <CrudPage key="suppliers" config={suppliersConfig} /> : <CrudPage key="contractors" config={contractorsConfig} />}
    </Box>
  )
}

// ----------------------------------------------------------------- Veículos
export function VehiclesPage() {
  const config: CrudConfig = {
    collection: 'vehicles',
    module: 'vehicles',
    title: 'Veículos',
    subtitle: 'Frota de entrega e instalação: motoristas, manutenção e seguro.',
    singular: 'veículo',
    icon: <DirectionsCarIcon />,
    lookups: ['users'],
    initialSort: { key: 'plate', dir: 'asc' },
    defaults: () => ({ kind: 'van', status: 'ativo' }),
    searchText: (r) => [r.plate, r.model, r.brand],
    filters: [{ name: 'status', label: 'Situação', options: VEHICLE_STATUS, get: (r) => r.status }],
    stats: (rows) => [
      { label: 'Veículos', value: rows.length, icon: <DirectionsCarIcon /> },
      { label: 'Ativos', value: rows.filter((r) => r.status === 'ativo').length, tone: 'success' },
      { label: 'Em manutenção', value: rows.filter((r) => r.status === 'manutencao').length, tone: 'warning' },
      {
        label: 'Seguro / manutenção em 30 dias',
        value: rows.filter((r) => [r.insuranceUntil, r.nextMaintenance].some((d) => d && (daysUntil(d) ?? 999) <= 30)).length,
        tone: 'error',
      },
    ],
    columns: (ctx) => [
      { key: 'plate', header: 'Placa', sort: (r) => r.plate, render: (r) => <Two primary={r.plate} secondary={`${r.brand ?? ''} ${r.model ?? ''}`.trim()} /> },
      { key: 'kind', header: 'Tipo', hideBelow: 'md', render: (r) => optLabel(VEHICLE_KINDS, r.kind) },
      {
        key: 'driver',
        header: 'Motorista',
        hideBelow: 'sm',
        render: (r) => {
          const u = ctx.maps.users?.get(r.driverId)
          return u ? <Stack direction="row" spacing={1} alignItems="center"><UserAvatar user={u} size={24} /><span>{u.name}</span></Stack> : '—'
        },
      },
      { key: 'odo', header: 'Km', align: 'right', hideBelow: 'md', sort: (r) => r.odometer, render: (r) => (r.odometer ? r.odometer.toLocaleString('pt-BR') : '—') },
      { key: 'maint', header: 'Próx. manutenção', hideBelow: 'lg', sort: (r) => r.nextMaintenance, render: (r) => fmtDate(r.nextMaintenance) },
      { key: 'ins', header: 'Seguro até', hideBelow: 'lg', sort: (r) => r.insuranceUntil, render: (r) => fmtDate(r.insuranceUntil) },
      { key: 'status', header: 'Situação', render: (r) => <StatusChip options={VEHICLE_STATUS} value={r.status} /> },
    ],
    fields: [
      { name: 'plate', label: 'Placa', type: 'text', required: true, span: 4 },
      { name: 'model', label: 'Modelo', type: 'text', required: true, span: 4 },
      { name: 'brand', label: 'Marca', type: 'text', span: 4 },
      { name: 'year', label: 'Ano', type: 'number', span: 3, min: 1980 },
      { name: 'kind', label: 'Tipo', type: 'select', options: VEHICLE_KINDS, required: true, span: 3 },
      { name: 'status', label: 'Situação', type: 'select', options: VEHICLE_STATUS, required: true, span: 3 },
      { name: 'odometer', label: 'Odômetro (km)', type: 'number', span: 3, min: 0 },
      { name: 'driverId', label: 'Motorista responsável', type: 'relation', collection: 'users', span: 6 },
      { name: 'nextMaintenance', label: 'Próxima manutenção', type: 'date', span: 3 },
      { name: 'insuranceUntil', label: 'Seguro válido até', type: 'date', span: 3 },
      { name: 'notes', label: 'Observações', type: 'textarea' },
    ],
  }
  return <CrudPage config={config} />
}

// ------------------------------------------------------------------ Qualidade
export function QualityPage() {
  const config: CrudConfig = {
    collection: 'qualityRecords',
    module: 'quality',
    title: 'Qualidade',
    subtitle: 'Registros de não conformidade: retrabalho, refugo, defeitos e reclamações — com causa raiz e ação corretiva.',
    singular: 'registro',
    icon: <VerifiedIcon />,
    lookups: ['projects', 'productionOrders', 'workCenters', 'users'],
    initialSort: { key: 'opened', dir: 'desc' },
    createLabel: 'Registrar não conformidade',
    defaults: (ctx) => ({ kind: 'retrabalho', severity: 'media', status: 'aberta', openedAt: todayISO(), responsibleId: ctx.userId }),
    searchText: (r, ctx) => [r.title, r.code, r.description, ctx.maps.projects?.get(r.projectId)?.name],
    filters: [
      { name: 'status', label: 'Situação', options: QUALITY_STATUS, get: (r) => r.status },
      { name: 'kind', label: 'Tipo', options: QUALITY_KINDS, get: (r) => r.kind },
      { name: 'severity', label: 'Gravidade', options: SEVERITY, get: (r) => r.severity },
    ],
    stats: (rows) => [
      { label: 'Em aberto', value: rows.filter((r) => r.status !== 'concluida').length, tone: 'error', icon: <VerifiedIcon /> },
      { label: 'Críticas', value: rows.filter((r) => r.severity === 'critica' && r.status !== 'concluida').length, tone: 'warning' },
      { label: 'Custo da não qualidade', value: brl(rows.reduce((s, r) => s + (r.cost ?? 0), 0)), tone: 'brand' },
      { label: 'Concluídas', value: rows.filter((r) => r.status === 'concluida').length, tone: 'success' },
    ],
    columns: (ctx) => [
      { key: 'title', header: 'Registro', sort: (r) => r.title, render: (r) => <Two primary={r.title} secondary={`${r.code ?? ''} · ${optLabel(QUALITY_KINDS, r.kind)}`} /> },
      { key: 'project', header: 'Projeto / OP', hideBelow: 'md', render: (r) => <Two primary={ctx.maps.projects?.get(r.projectId)?.name ?? '—'} secondary={ctx.maps.productionOrders?.get(r.productionOrderId)?.code} /> },
      { key: 'sector', header: 'Setor', hideBelow: 'lg', render: (r) => ctx.maps.workCenters?.get(r.workCenterId)?.name ?? '—' },
      { key: 'severity', header: 'Gravidade', sort: (r) => r.severity, render: (r) => <StatusChip options={SEVERITY} value={r.severity} /> },
      { key: 'cost', header: 'Custo', align: 'right', hideBelow: 'md', sort: (r) => r.cost, render: (r) => (r.cost ? brl(r.cost) : '—') },
      { key: 'opened', header: 'Abertura', hideBelow: 'sm', sort: (r) => r.openedAt, render: (r) => fmtDate(r.openedAt) },
      { key: 'status', header: 'Situação', sort: (r) => r.status, render: (r) => <StatusChip options={QUALITY_STATUS} value={r.status} /> },
    ],
    fields: [
      { name: 'title', label: 'Título', type: 'text', required: true, span: 8 },
      { name: 'kind', label: 'Tipo', type: 'select', options: QUALITY_KINDS, required: true, span: 4 },
      { name: 'severity', label: 'Gravidade', type: 'select', options: SEVERITY, required: true, span: 4 },
      { name: 'status', label: 'Situação', type: 'select', options: QUALITY_STATUS, required: true, span: 4 },
      { name: 'openedAt', label: 'Data de abertura', type: 'date', required: true, span: 4 },
      { name: 'projectId', label: 'Projeto', type: 'relation', collection: 'projects', span: 6 },
      { name: 'productionOrderId', label: 'Ordem de produção', type: 'relation', collection: 'productionOrders', span: 6 },
      { name: 'workCenterId', label: 'Setor / máquina', type: 'relation', collection: 'workCenters', span: 6 },
      { name: 'responsibleId', label: 'Responsável', type: 'relation', collection: 'users', span: 6 },
      { name: 'description', label: 'Descrição da ocorrência', type: 'textarea' },
      { name: 'rootCause', label: 'Causa raiz', type: 'textarea', rows: 2 },
      { name: 'correctiveAction', label: 'Ação corretiva / preventiva', type: 'textarea', rows: 2 },
      { name: 'cost', label: 'Custo estimado (R$)', type: 'money', span: 6 },
      { name: 'closedAt', label: 'Data de encerramento', type: 'date', span: 6 },
    ],
    beforeSave: (v) => (v.status === 'concluida' && !v.closedAt ? { ...v, closedAt: todayISO() } : v),
  }
  return <CrudPage config={config} />
}

// ----------------------------------------------------------------- Manutenção
export function MaintenancePage() {
  const maint = useCollection('maintenance')
  const toast = useToast()
  const config: CrudConfig = {
    collection: 'maintenance',
    module: 'maintenance',
    title: 'Manutenção',
    subtitle: 'Planos preventivos e corretivos de máquinas e veículos, com recorrência e custo de parada.',
    singular: 'manutenção',
    icon: <BuildIcon />,
    lookups: ['workCenters', 'vehicles'],
    initialSort: { key: 'date', dir: 'asc' },
    createLabel: 'Agendar manutenção',
    defaults: () => ({ kind: 'preventiva', status: 'agendada', scheduledDate: todayISO() }),
    searchText: (r, ctx) => [r.title, r.code, r.technician, ctx.maps.workCenters?.get(r.workCenterId)?.name],
    filters: [
      { name: 'status', label: 'Situação', options: MAINT_STATUS, get: (r) => r.status },
      { name: 'kind', label: 'Tipo', options: MAINT_KINDS, get: (r) => r.kind },
    ],
    stats: (rows) => {
      const open = rows.filter((r) => r.status === 'agendada' || r.status === 'em_andamento')
      return [
        { label: 'Agendadas', value: open.length, icon: <BuildIcon /> },
        { label: 'Atrasadas', value: open.filter((r) => (daysUntil(r.scheduledDate) ?? 0) < 0).length, tone: 'error' },
        { label: 'Horas de parada', value: `${rows.reduce((s, r) => s + (r.downtimeHours ?? 0), 0)} h`, tone: 'warning' },
        { label: 'Custo acumulado', value: brl(rows.reduce((s, r) => s + (r.cost ?? 0), 0)), tone: 'brand' },
      ]
    },
    columns: (ctx) => [
      { key: 'title', header: 'Serviço', sort: (r) => r.title, render: (r) => <Two primary={r.title} secondary={r.code} /> },
      {
        key: 'asset',
        header: 'Equipamento',
        render: (r) => ctx.maps.workCenters?.get(r.workCenterId)?.name ?? ctx.maps.vehicles?.get(r.vehicleId)?.plate ?? '—',
      },
      { key: 'kind', header: 'Tipo', hideBelow: 'md', render: (r) => optLabel(MAINT_KINDS, r.kind) },
      {
        key: 'date',
        header: 'Previsão',
        sort: (r) => r.scheduledDate,
        render: (r) => {
          const late = r.status === 'agendada' && (daysUntil(r.scheduledDate) ?? 0) < 0
          return <Box sx={{ color: late ? 'error.main' : undefined, fontWeight: late ? 600 : 400 }}>{fmtDate(r.scheduledDate)}</Box>
        },
      },
      { key: 'cost', header: 'Custo', align: 'right', hideBelow: 'md', sort: (r) => r.cost, render: (r) => (r.cost ? brl(r.cost) : '—') },
      { key: 'status', header: 'Situação', render: (r) => <StatusChip options={MAINT_STATUS} value={r.status} /> },
    ],
    fields: [
      { name: 'title', label: 'Serviço / descrição curta', type: 'text', required: true, span: 8 },
      { name: 'kind', label: 'Tipo', type: 'select', options: MAINT_KINDS, required: true, span: 4 },
      { name: 'workCenterId', label: 'Máquina / setor', type: 'relation', collection: 'workCenters', span: 6 },
      { name: 'vehicleId', label: 'Veículo', type: 'relation', collection: 'vehicles', span: 6 },
      { name: 'scheduledDate', label: 'Data prevista', type: 'date', required: true, span: 4 },
      { name: 'doneDate', label: 'Data de execução', type: 'date', span: 4 },
      { name: 'status', label: 'Situação', type: 'select', options: MAINT_STATUS, required: true, span: 4 },
      { name: 'technician', label: 'Técnico / empresa', type: 'text', span: 6 },
      { name: 'recurrenceDays', label: 'Repetir a cada (dias)', type: 'number', span: 3, min: 0, helper: 'Gera a próxima ao concluir' },
      { name: 'downtimeHours', label: 'Parada (h)', type: 'number', span: 3, min: 0 },
      { name: 'cost', label: 'Custo (R$)', type: 'money', span: 6 },
      { name: 'description', label: 'Detalhes', type: 'textarea' },
    ],
    rowActions: (row) => [
      {
        label: 'Concluir e programar próxima',
        icon: <CheckCircleIcon fontSize="small" />,
        hidden: row.status === 'concluida' || row.status === 'cancelada',
        onClick: async () => {
          await maint.update(row.id, { status: 'concluida', doneDate: todayISO() })
          if (row.recurrenceDays > 0) {
            await maint.create({
              title: row.title,
              workCenterId: row.workCenterId,
              vehicleId: row.vehicleId,
              kind: row.kind,
              status: 'agendada',
              scheduledDate: addDaysISO(todayISO(), row.recurrenceDays),
              recurrenceDays: row.recurrenceDays,
              technician: row.technician,
            })
            toast.success('Manutenção concluída e próxima programada.')
          } else toast.success('Manutenção concluída.')
        },
      },
    ],
  }
  return <CrudPage config={config} />
}

// ------------------------------------------------------------------ Garantias
const WARRANTY_KIND = [
  { value: 'garantia', label: 'Garantia (defeito)', color: '#b3261e' },
  { value: 'assistencia', label: 'Assistência / ajuste', color: '#2f6f9f' },
  { value: 'reposicao', label: 'Reposição de peça', color: '#b9852e' },
]
/** Prazo de garantia dos móveis (anos) contado da entrega concluída; é o mesmo prazo das cláusulas do contrato. */
const WARRANTY_YEARS = 5

interface WarrantyCover {
  until: string
  active: boolean
}

/** Data de término da garantia do projeto: instalação/entrega concluída (ou a entrega prevista) + prazo. */
function warrantyCover(
  projectId: string | undefined,
  installations: { projectId?: string; kind: string; status: string; completedAt?: string; date: string }[],
  project?: { dueDate?: string },
): WarrantyCover | null {
  if (!projectId) return null
  const done = installations
    .filter((i) => i.projectId === projectId && ['entrega', 'instalacao'].includes(i.kind) && i.status === 'concluida')
    .map((i) => String(i.completedAt ?? i.date).slice(0, 10))
    .sort()
    .at(-1)
  const start = done ?? (project?.dueDate ? String(project.dueDate).slice(0, 10) : '')
  if (!start) return null
  const end = new Date(`${start}T12:00:00`)
  if (Number.isNaN(end.getTime())) return null
  end.setFullYear(end.getFullYear() + WARRANTY_YEARS)
  const until = end.toISOString().slice(0, 10)
  return { until, active: until >= todayISO() }
}

export function WarrantiesPage() {
  const toast = useToast()
  const warranties = useCollection('warranties')
  const installationsStore = useCollection('installations')
  const config: CrudConfig = {
    collection: 'warranties',
    module: 'warranty',
    title: 'Garantias e assistência técnica',
    subtitle: 'Chamados de pós-venda: abertos pela equipe ou pelo cliente (portal), com visita, fotos, prazo de garantia e custo.',
    singular: 'chamado',
    icon: <SupportAgentIcon />,
    lookups: ['projects', 'clients', 'users', 'installations'],
    initialSort: { key: 'opened', dir: 'desc' },
    createLabel: 'Abrir chamado',
    defaults: (ctx) => ({ status: 'aberta', priority: 'media', kind: 'assistencia', openedAt: todayISO(), responsibleId: ctx.userId }),
    searchText: (r, ctx) => [r.title, r.code, ctx.maps.projects?.get(r.projectId)?.name, ctx.maps.clients?.get(r.clientId)?.name],
    filters: [
      { name: 'status', label: 'Situação', options: WARRANTY_STATUS, get: (r) => r.status },
      { name: 'kind', label: 'Tipo', options: WARRANTY_KIND, get: (r) => r.kind ?? 'assistencia' },
      { name: 'priority', label: 'Prioridade', options: PROJECT_PRIORITIES, get: (r) => r.priority },
    ],
    stats: (rows) => [
      { label: 'Chamados', value: rows.length, icon: <SupportAgentIcon /> },
      { label: 'Em aberto', value: rows.filter((r) => !['resolvida', 'negada'].includes(r.status)).length, tone: 'error' },
      { label: 'Do portal do cliente', value: rows.filter((r) => r.source === 'portal' && !['resolvida', 'negada'].includes(r.status)).length, tone: 'warning' },
      { label: 'Custo de assistência', value: brl(rows.reduce((s, r) => s + (r.cost ?? 0), 0)), tone: 'brand' },
    ],
    columns: (ctx) => [
      {
        key: 'title',
        header: 'Chamado',
        sort: (r) => r.title,
        render: (r) => <Two primary={r.title} secondary={[r.code, optLabel(WARRANTY_KIND, r.kind ?? 'assistencia'), r.source === 'portal' ? 'pedido do cliente' : '', r.visitDate ? `visita ${fmtDate(r.visitDate)}${r.visitTime ? ` ${r.visitTime}` : ''}` : ''].filter(Boolean).join(' · ')} />,
      },
      { key: 'project', header: 'Projeto', hideBelow: 'md', render: (r) => <Two primary={ctx.maps.projects?.get(r.projectId)?.name ?? '—'} secondary={ctx.maps.clients?.get(r.clientId)?.name} /> },
      {
        key: 'cover',
        header: 'Garantia',
        hideBelow: 'lg',
        render: (r) => {
          const c = warrantyCover(r.projectId, (ctx.data.installations ?? []) as never, ctx.maps.projects?.get(r.projectId))
          if (!c) return '—'
          return <Two primary={c.active ? 'Em garantia' : 'Vencida'} secondary={`até ${fmtDate(c.until)}`} />
        },
      },
      { key: 'priority', header: 'Prioridade', render: (r) => <StatusChip options={PROJECT_PRIORITIES} value={r.priority} /> },
      { key: 'opened', header: 'Abertura', hideBelow: 'lg', sort: (r) => r.openedAt, render: (r) => fmtDate(r.openedAt) },
      { key: 'status', header: 'Situação', sort: (r) => r.status, render: (r) => <StatusChip options={WARRANTY_STATUS} value={r.status} /> },
    ],
    fields: [
      { name: 'title', label: 'Assunto', type: 'text', required: true, span: 8 },
      { name: 'priority', label: 'Prioridade', type: 'select', options: PROJECT_PRIORITIES, required: true, span: 4 },
      { name: 'kind', label: 'Tipo de atendimento', type: 'select', options: WARRANTY_KIND, span: 4 },
      { name: 'projectId', label: 'Projeto', type: 'relation', collection: 'projects', span: 4 },
      { name: 'clientId', label: 'Cliente', type: 'relation', collection: 'clients', span: 4 },
      { name: 'status', label: 'Situação', type: 'select', options: WARRANTY_STATUS, required: true, span: 4 },
      { name: 'openedAt', label: 'Abertura', type: 'date', required: true, span: 4 },
      { name: 'resolvedAt', label: 'Resolução', type: 'date', span: 4 },
      { name: 'visitDate', label: 'Visita técnica em', type: 'date', span: 4, helper: 'Use "Agendar visita" na linha para entrar na agenda de entregas.' },
      { name: 'visitTime', label: 'Horário', type: 'time', span: 4 },
      { name: 'responsibleId', label: 'Responsável', type: 'relation', collection: 'users', span: 4 },
      { name: 'cost', label: 'Custo (R$)', type: 'money', span: 4 },
      { name: 'description', label: 'Descrição do problema', type: 'textarea' },
      { name: 'resolution', label: 'Solução aplicada', type: 'textarea', rows: 2 },
    ],
    renderExtra: ({ values, set, crud }) => {
      const project = crud.maps.projects?.get(values.projectId)
      const cover = warrantyCover(values.projectId, (crud.data.installations ?? []) as never, project)
      const photos: string[] = Array.isArray(values.photoIds) ? values.photoIds : []
      return (
        <Box>
          {cover ? (
            <Typography variant="body2" sx={{ mb: 1.5, color: cover.active ? 'success.main' : 'error.main', fontWeight: 600 }}>
              {cover.active ? `Em garantia até ${fmtDate(cover.until)}` : `Garantia vencida em ${fmtDate(cover.until)}`} ({WARRANTY_YEARS} anos da entrega)
            </Typography>
          ) : null}
          <Typography variant="overline" color="primary" sx={{ display: 'block', mb: 0.5 }}>
            Fotos do problema
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' }, gap: 1.5 }}>
            {[0, 1, 2].map((i) => (
              <PhotoField
                key={i}
                label={`Foto ${i + 1}`}
                folder="Assistência técnica"
                refType="warranty"
                value={photos[i] ?? null}
                onChange={(fileId) => {
                  const next = [...photos]
                  next[i] = fileId ?? ''
                  set('photoIds', next.filter(Boolean))
                }}
              />
            ))}
          </Box>
        </Box>
      )
    },
    rowActions: (row, ctx) => [
      {
        label: 'Agendar visita na agenda',
        icon: <LocalShippingIcon fontSize="small" />,
        hidden: !row.visitDate || ['resolvida', 'negada'].includes(row.status),
        onClick: async () => {
          const project = ctx.maps.projects?.get(row.projectId)
          await installationsStore.create({
            kind: 'visita_tecnica',
            projectId: row.projectId,
            clientId: row.clientId,
            date: row.visitDate,
            time: row.visitTime,
            status: 'agendada',
            address: project?.address,
            notes: `Chamado ${row.code ?? ''}: ${row.title}`.trim(),
            checklist: [],
          } as never)
          await warranties.update(row.id, { status: 'agendada' })
          toast.success('Visita técnica criada em Entregas e instalações.')
        },
      },
      {
        label: 'Marcar como resolvido',
        icon: <CheckCircleIcon fontSize="small" />,
        hidden: row.status === 'resolvida' || row.status === 'negada',
        onClick: async () => {
          await warranties.update(row.id, { status: 'resolvida', resolvedAt: todayISO() })
          toast.success('Chamado resolvido.')
        },
      },
    ],
    beforeSave: (v, _m, ctx) => {
      const out = { ...v }
      if (out.projectId && !out.clientId) out.clientId = ctx.maps.projects?.get(out.projectId)?.clientId
      if (out.status === 'resolvida' && !out.resolvedAt) out.resolvedAt = todayISO()
      return out
    },
  }
  return <CrudPage config={config} />
}

// ----------------------------------------------------- Entregas e instalações
const DEFAULT_CHECKLIST = ['Conferir peças e ferragens na chegada', 'Nivelar e fixar os módulos', 'Regular portas, gavetas e puxadores', 'Limpeza do ambiente', 'Termo de aceite assinado pelo cliente']

function ChecklistEditor({ value, onChange }: { value: { id: string; text: string; done: boolean }[]; onChange: (v: { id: string; text: string; done: boolean }[]) => void }) {
  const [text, setText] = useState('')
  return (
    <Box>
      <Typography variant="overline" color="primary" sx={{ display: 'block', mb: 0.5 }}>
        Checklist de campo
      </Typography>
      {value.map((item) => (
        <Stack key={item.id} direction="row" alignItems="center" spacing={0.5}>
          <FormControlLabel
            sx={{ flex: 1, mr: 0 }}
            control={<Checkbox size="small" checked={item.done} onChange={(e) => onChange(value.map((v) => (v.id === item.id ? { ...v, done: e.target.checked } : v)))} />}
            label={<Typography variant="body2" sx={{ textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'text.secondary' : 'text.primary' }}>{item.text}</Typography>}
          />
          <IconButton size="small" onClick={() => onChange(value.filter((v) => v.id !== item.id))} aria-label="Remover item">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Stack>
      ))}
      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <TextField
          placeholder="Adicionar item…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && text.trim()) {
              e.preventDefault()
              onChange([...value, { id: uid(), text: text.trim(), done: false }])
              setText('')
            }
          }}
        />
        <Button
          startIcon={<AddIcon />}
          onClick={() => {
            if (!text.trim()) return
            onChange([...value, { id: uid(), text: text.trim(), done: false }])
            setText('')
          }}
        >
          Adicionar
        </Button>
      </Stack>
    </Box>
  )
}

export function LogisticsPage() {
  const config: CrudConfig = {
    collection: 'installations',
    module: 'logistics',
    title: 'Entregas e instalações',
    subtitle: 'Agenda de medições, entregas, instalações e visitas técnicas com equipe, veículo e checklist de campo.',
    singular: 'agendamento',
    icon: <LocalShippingIcon />,
    lookups: ['projects', 'clients', 'users', 'vehicles'],
    initialSort: { key: 'date', dir: 'asc' },
    createLabel: 'Novo agendamento',
    defaults: () => ({ kind: 'instalacao', status: 'agendada', date: todayISO(), time: '08:00', teamIds: [], checklist: DEFAULT_CHECKLIST.map((text) => ({ id: uid(), text, done: false })) }),
    searchText: (r, ctx) => [r.code, r.address, ctx.maps.projects?.get(r.projectId)?.name, ctx.maps.clients?.get(r.clientId)?.name],
    filters: [
      { name: 'status', label: 'Situação', options: INSTALL_STATUS, get: (r) => r.status },
      { name: 'kind', label: 'Tipo', options: INSTALL_KINDS, get: (r) => r.kind },
    ],
    stats: (rows) => {
      const open = rows.filter((r) => ['agendada', 'em_rota', 'em_andamento', 'reagendada'].includes(r.status))
      return [
        { label: 'Hoje', value: open.filter((r) => r.date === todayISO()).length, icon: <LocalShippingIcon />, tone: 'brand' },
        { label: 'Próximos 7 dias', value: open.filter((r) => (daysUntil(r.date) ?? 99) >= 0 && (daysUntil(r.date) ?? 99) <= 7).length },
        { label: 'Atrasados', value: open.filter((r) => (daysUntil(r.date) ?? 0) < 0).length, tone: 'error' },
        { label: 'Concluídos', value: rows.filter((r) => r.status === 'concluida').length, tone: 'success' },
      ]
    },
    columns: (ctx) => [
      {
        key: 'date',
        header: 'Data',
        sort: (r) => `${r.date} ${r.time ?? ''}`,
        render: (r) => <Two primary={fmtDate(r.date)} secondary={r.time} />,
      },
      { key: 'kind', header: 'Tipo', render: (r) => optLabel(INSTALL_KINDS, r.kind) },
      { key: 'project', header: 'Projeto', render: (r) => <Two primary={ctx.maps.projects?.get(r.projectId)?.name ?? '—'} secondary={ctx.maps.clients?.get(r.clientId)?.name} /> },
      { key: 'address', header: 'Local', hideBelow: 'lg', render: (r) => r.address || ctx.maps.projects?.get(r.projectId)?.address || '—' },
      {
        key: 'team',
        header: 'Equipe',
        hideBelow: 'md',
        render: (r) => (
          <Stack direction="row" spacing={0.5}>
            {(r.teamIds ?? []).slice(0, 4).map((id: string) => (
              <UserAvatar key={id} user={ctx.maps.users?.get(id)} size={24} />
            ))}
          </Stack>
        ),
      },
      { key: 'status', header: 'Situação', sort: (r) => r.status, render: (r) => <StatusChip options={INSTALL_STATUS} value={r.status} /> },
    ],
    fields: [
      { name: 'kind', label: 'Tipo', type: 'select', options: INSTALL_KINDS, required: true, span: 4 },
      { name: 'date', label: 'Data', type: 'date', required: true, span: 4 },
      { name: 'time', label: 'Horário', type: 'time', span: 4 },
      { name: 'projectId', label: 'Projeto', type: 'relation', collection: 'projects', required: true, span: 8 },
      { name: 'status', label: 'Situação', type: 'select', options: INSTALL_STATUS, required: true, span: 4 },
      { name: 'address', label: 'Endereço (se diferente do projeto)', type: 'text', span: 12 },
      { name: 'teamIds', label: 'Equipe', type: 'relations', collection: 'users', span: 8 },
      { name: 'vehicleId', label: 'Veículo', type: 'relation', collection: 'vehicles', span: 4 },
      { name: 'customerSignedBy', label: 'Aceite assinado por', type: 'text', span: 6 },
      { name: 'completedAt', label: 'Concluído em', type: 'date', span: 6 },
      { name: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
    ],
    renderExtra: ({ row, values, set }) => (
      <Stack spacing={2.5}>
        {row?.id ? (
          <DeliveryRoutePanel id={row.id} />
        ) : (
          <Typography variant="caption" color="text.secondary">
            Salve o agendamento para abrir o mapa, localizar o endereço e acompanhar a rota da equipe.
          </Typography>
        )}
        <ChecklistEditor value={values.checklist ?? []} onChange={(v) => set('checklist', v)} />
      </Stack>
    ),
    beforeSave: (v, _m, ctx) => {
      const out = { ...v }
      if (out.projectId) out.clientId = ctx.maps.projects?.get(out.projectId)?.clientId
      if (out.status === 'concluida' && !out.completedAt) out.completedAt = todayISO()
      return out
    },
  }
  return <CrudPage config={config} />
}

export { PageHeader }
