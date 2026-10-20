import { useRef, useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert, Box, Button, Chip, Grid, IconButton, MenuItem, Paper, Tab, Tabs, TextField, Typography, LinearProgress } from '@mui/material'
import { Stack } from '../components/Stack'
import { AddIcon, CloseIcon, DeleteIcon, FactoryIcon, RestoreFromTrashIcon, UploadFileIcon, DownloadIcon, SettingsIcon, AutoAwesomeIcon } from '../components/icons'
import { DataTable, EmptyState, LoadingState, PageHeader, Panel, type Column } from '../components/ui'
import { CrudPage, type CrudConfig } from '../components/CrudPage'
import { NumberField } from '../components/forms'
import { useConfirm, useToast } from '../components/feedback'
import { useAuth } from '../auth/AuthContext'
import { api, fileUrl, tokenStore } from '../lib/api'
import { resizeToLogo } from '../lib/image'
import { refreshCollection, resetStore, useCollection, useCompany, useDefaultTaskStatuses, useProjectStages, useSettings } from '../lib/store'
import { brl, downloadBlob, fmtDate, fmtDateTime, uid } from '../lib/format'
import { PaymentMethodPicker, PayButton, type PaymentChoice } from '../components/PaymentOptions'
import { PixPaymentDialog } from '../components/PixPaymentDialog'
import { isUnlimited, limitLabels, methodLabel, type BillingMethods, type BillingPlan, type CheckoutResponse } from '../lib/billing'
import { colors } from '../theme'
import type { CompanySettings, FileDoc, PlanLimits, StageDef, Subscriber, TaskStatusDef, TrashEntry } from '../types'

type SettingsTab = 'company' | 'flows' | 'centers' | 'data' | 'billing' | 'trash'

export function SettingsPage() {
  const [params] = useSearchParams()
  const { user } = useAuth()
  // Assinatura: só quem pertence a uma empresa (para cobrança) ou o administrador da plataforma (atalho do Painel Admin)
  const showBilling = Boolean(user?.companyId) || user?.role === 'admin'
  const [tab, setTab] = useState<SettingsTab>(params.get('aba') === 'assinatura' && showBilling ? 'billing' : 'company')
  return (
    <Box>
      <PageHeader title="Configurações" subtitle="Dados da empresa, parâmetros comerciais, etapas, setores de produção, backup e manutenção do sistema." />
      <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" scrollButtons="auto" sx={{ mb: 2.5, borderBottom: `1px solid ${colors.border}` }}>
        <Tab value="company" label="Empresa" />
        <Tab value="flows" label="Fluxos e etapas" />
        <Tab value="centers" label="Setores e máquinas" />
        <Tab value="data" label="Dados e backup" />
        {showBilling ? <Tab value="billing" label="Assinatura" /> : null}
        <Tab value="trash" label="Lixeira" />
      </Tabs>
      {tab === 'company' ? <CompanyTab /> : null}
      {tab === 'flows' ? <FlowsTab /> : null}
      {tab === 'centers' ? <WorkCenters /> : null}
      {tab === 'data' ? <DataTab /> : null}
      {tab === 'billing' && showBilling ? <BillingTab /> : null}
      {tab === 'trash' ? <TrashTab /> : null}
    </Box>
  )
}

/** Logotipo da empresa: aparece em propostas, contratos, plano de corte, etiquetas e relatórios impressos. */
function LogoPanel({ value, onChange }: { value?: string | null; onChange: (id: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const pick = async (file?: File) => {
    if (!file) return
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return toast.error('Use uma imagem PNG, JPG ou WebP (de preferência com fundo transparente).')
    if (file.size > 8 * 1024 * 1024) return toast.error('A imagem passa de 8 MB. Escolha um arquivo menor.')
    setBusy(true)
    try {
      const small = await resizeToLogo(file)
      const qs = new URLSearchParams({ name: 'logotipo.png', folder: 'Logotipo', refType: 'company-logo', visibility: 'compartilhado' })
      const meta = await api.upload<FileDoc>(`/files/upload?${qs}`, small)
      onChange(meta.id)
      void refreshCollection('files')
      toast.success('Logotipo carregado. Clique em “Salvar configurações” para confirmar.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível enviar o logotipo.')
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }
  return (
    <Panel title="Logotipo da empresa" subtitle="Aparece nas propostas, contratos, plano de corte, etiquetas e relatórios impressos">
      <Stack direction="row" spacing={2.5} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 2 }}>
        <Box sx={{ width: 220, height: 90, border: `1px dashed ${colors.borderStrong}`, borderRadius: 2, display: 'grid', placeItems: 'center', bgcolor: '#fff', overflow: 'hidden' }}>
          {value ? (
            <Box component="img" src={fileUrl(value, { inline: true })} alt="Logotipo da empresa" sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', p: 1 }} />
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ px: 2, textAlign: 'center' }}>
              Sem logotipo: os documentos usam a marca Core Cut
            </Typography>
          )}
        </Box>
        <Box>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" startIcon={<UploadFileIcon />} disabled={busy} onClick={() => input.current?.click()}>
              {busy ? 'Enviando…' : value ? 'Trocar logotipo' : 'Enviar logotipo'}
            </Button>
            {value ? (
              <Button color="inherit" startIcon={<DeleteIcon />} onClick={() => onChange(null)}>
                Remover
              </Button>
            ) : null}
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1, maxWidth: 360 }}>
            PNG, JPG ou WebP. Fundo transparente e formato horizontal ficam melhores. A imagem é reduzida automaticamente.
          </Typography>
        </Box>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => void pick(e.target.files?.[0])} />
      </Stack>
    </Panel>
  )
}

// ---------------------------------------------------------------- dados fiscais (nota fiscal)
const TAX_REGIMES = [
  { value: '1', label: 'Simples Nacional' },
  { value: '2', label: 'Simples Nacional — excesso de sublimite' },
  { value: '3', label: 'Regime normal (Lucro presumido ou real)' },
]

/**
 * Dados da empresa para emitir NF-e e o token do provedor fiscal (Focus NFe).
 * Os dados ficam junto do cadastro da empresa e saem na nota e no DANFE; o token é guardado cifrado no servidor.
 */
function FiscalPanel({ v, set }: { v: CompanySettings; set: <K extends keyof CompanySettings>(k: K, val: CompanySettings[K]) => void }) {
  const toast = useToast()
  const { user } = useAuth()
  const canToken = user?.role === 'admin' || user?.role === 'gerente'
  const [status, setStatus] = useState<{
    tokens: { homologacao: boolean; producao: boolean }
    sources: { homologacao: string | null; producao: string | null }
    own: { homologacao: boolean; producao: boolean }
    platform: { available: boolean; allowed: boolean }
    problems: string[]
  } | null>(null)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const environment = v.fiscalEnvironment === 'producao' ? 'producao' : 'homologacao'

  const load = () =>
    api
      .get<NonNullable<typeof status>>('/fiscal/status')
      .then(setStatus)
      .catch(() => setStatus(null))
  useEffect(() => {
    void load()
  }, [])

  const saveToken = async (clear = false) => {
    setBusy(true)
    try {
      await api.put('/fiscal/token', { environment, token: clear ? '' : token })
      setToken('')
      await load()
      toast.success(clear ? 'Token removido.' : 'Token salvo com segurança.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível salvar o token.')
    } finally {
      setBusy(false)
    }
  }
  const text = (label: string, key: keyof CompanySettings, size: number, props: object = {}) => (
    <Grid size={{ xs: 12, sm: size }}>
      <TextField label={label} value={(v[key] as string | undefined) ?? ''} onChange={(e) => set(key, e.target.value as never)} {...props} />
    </Grid>
  )

  return (
    <Panel title="Dados fiscais (nota fiscal)" subtitle="Emissão de NF-e de produto e DANFE por provedor fiscal (Focus NFe). O contador deve confirmar estes padrões.">
      <Grid container spacing={2}>
        {text('Inscrição estadual (IE)', 'ie', 4)}
        {text('Inscrição municipal (IM)', 'im', 4)}
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField select label="Regime tributário" value={v.taxRegime ?? ''} onChange={(e) => set('taxRegime', e.target.value as CompanySettings['taxRegime'])}>
            {TAX_REGIMES.map((r) => (
              <MenuItem key={r.value} value={r.value}>
                {r.label}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        {text('CEP', 'cep', 3, { slotProps: { htmlInput: { maxLength: 9 } } })}
        {text('Número', 'number', 3)}
        {text('Bairro', 'district', 3)}
        {text('Complemento', 'complement', 3)}
        {text('Cód. IBGE do município', 'cityCode', 5, { helperText: '7 dígitos (consulte no IBGE).' })}
        {text('Série da NF-e', 'fiscalSerie', 3)}
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField select label="Ambiente" value={environment} onChange={(e) => set('fiscalEnvironment', e.target.value as CompanySettings['fiscalEnvironment'])} helperText="Homologação = testes sem valor fiscal.">
            <MenuItem value="homologacao">Homologação (testes)</MenuItem>
            <MenuItem value="producao">Produção (valor fiscal)</MenuItem>
          </TextField>
        </Grid>
        {text('Natureza da operação padrão', 'fiscalNature', 6, { placeholder: 'Venda de mercadoria' })}
        {text('CFOP padrão', 'fiscalCfop', 3, { placeholder: '5101' })}
        {text('NCM padrão', 'fiscalNcm', 3, { placeholder: '94036000' })}
        {text('Origem da mercadoria', 'fiscalOrigin', 4, { placeholder: '0' })}
        {text('CSOSN / CST padrão', 'fiscalTaxSituation', 4, { placeholder: v.taxRegime === '3' ? '00' : '102' })}
      </Grid>

      <Box sx={{ mt: 2.5, pt: 2, borderTop: `1px solid ${colors.border}` }}>
        <Typography variant="overline" color="primary">
          Provedor fiscal: Focus NFe
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          {status?.sources[environment] === 'plataforma'
            ? 'A emissão usa a conta fiscal do Core Cut: você não precisa criar conta nem informar token. A nota sai com os dados da sua empresa acima.'
            : status?.platform.available && !status.platform.allowed
              ? 'Para emitir sem ter conta própria na Focus NFe, peça ao suporte do Core Cut a liberação da nota fiscal. Se preferir, use a sua própria conta abaixo.'
              : `Se a sua empresa tem conta própria na Focus NFe, cole o token do ambiente ${environment === 'producao' ? 'de produção' : 'de homologação'} abaixo.`}
        </Typography>
        {canToken ? (
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }}>
            <TextField
              size="small"
              type="password"
              label={status?.own[environment] ? 'Token próprio salvo — digite para trocar' : 'Token próprio da Focus NFe (opcional)'}
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              sx={{ flex: 1 }}
            />
            <Button variant="outlined" disabled={busy || token.trim().length < 10} onClick={() => saveToken(false)}>
              Salvar token
            </Button>
            {status?.own[environment] ? (
              <Button color="error" disabled={busy} onClick={() => saveToken(true)}>
                Remover
              </Button>
            ) : null}
          </Stack>
        ) : (
          <Typography variant="caption" color="text.secondary">
            Somente administrador ou gerente altera o token.
          </Typography>
        )}
        <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
          {(['homologacao', 'producao'] as const).map((env) => (
            <Chip
              key={env}
              size="small"
              color={status?.tokens[env] ? 'success' : 'default'}
              label={`${env === 'homologacao' ? 'Homologação' : 'Produção'}: ${status?.sources[env] === 'plataforma' ? 'conta Core Cut' : status?.sources[env] === 'empresa' ? 'token próprio' : 'sem token'}`}
            />
          ))}
        </Stack>
        {status?.problems.length ? (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            Ainda falta para emitir: {status.problems.join(' ')} (salve as configurações depois de preencher).
          </Alert>
        ) : status ? (
          <Alert severity="success" sx={{ mt: 1.5 }}>
            Cadastro da empresa completo para emitir nota fiscal.
          </Alert>
        ) : null}
      </Box>
    </Panel>
  )
}

// ---------------------------------------------------------------- empresa
function CompanyTab() {
  const company = useCompany()
  const { save } = useSettings()
  const toast = useToast()
  const [v, setV] = useState<CompanySettings>(company)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof CompanySettings>(k: K, val: CompanySettings[K]) => setV((s) => ({ ...s, [k]: val }))

  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, lg: 8 }}>
        <Panel title="Dados da empresa" subtitle="Aparecem nas propostas, contratos, planos de corte, etiquetas e relatórios">
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Nome fantasia" value={v.name} onChange={(e) => set('name', e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Razão social" value={v.legalName} onChange={(e) => set('legalName', e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="CNPJ" value={v.cnpj} onChange={(e) => set('cnpj', e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="Telefone" value={v.phone} onChange={(e) => set('phone', e.target.value)} />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <TextField label="E-mail" value={v.email} onChange={(e) => set('email', e.target.value)} slotProps={{ htmlInput: { name: 'empresa_email_contato', autoComplete: 'off' } }} />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField label="Endereço" value={v.address} onChange={(e) => set('address', e.target.value)} />
            </Grid>
            <Grid size={{ xs: 8, sm: 4 }}>
              <TextField label="Cidade" value={v.city} onChange={(e) => set('city', e.target.value)} />
            </Grid>
            <Grid size={{ xs: 4, sm: 2 }}>
              <TextField label="UF" value={v.state} onChange={(e) => set('state', e.target.value.toUpperCase().slice(0, 2))} />
            </Grid>
            <Grid size={12}>
              <TextField label="Site" value={v.website} onChange={(e) => set('website', e.target.value)} />
            </Grid>
          </Grid>
        </Panel>
        <Box sx={{ mt: 2.5 }}>
          <LogoPanel value={v.logoFileId} onChange={(id) => set('logoFileId', id)} />
        </Box>
        <Box sx={{ mt: 2.5 }}>
          <FiscalPanel v={v} set={set} />
        </Box>
      </Grid>
      <Grid size={{ xs: 12, lg: 4 }}>
        <Panel title="Parâmetros comerciais">
          <Stack spacing={2}>
            <NumberField label="Margem padrão (%)" value={v.defaultMargin} min={0} onChange={(n) => set('defaultMargin', n ?? 0)} />
            <NumberField label="Impostos padrão (%)" value={v.defaultTax} min={0} onChange={(n) => set('defaultTax', n ?? 0)} />
            <NumberField label="Validade das propostas (dias)" value={v.quoteValidityDays} min={1} decimals={0} onChange={(n) => set('quoteValidityDays', n ?? 15)} />
            <NumberField label="Jornada diária (horas)" value={v.workdayHours} min={1} max={24} onChange={(n) => set('workdayHours', n ?? 8)} />
            <TextField label="Condição de pagamento padrão" value={v.paymentTerms} onChange={(e) => set('paymentTerms', e.target.value)} />
          </Stack>
        </Panel>
        <Panel title="Chão de fábrica" subtitle="Pausa automática de cronômetro esquecido ligado" sx={{ mt: 2.5 }}>
          <Stack spacing={2}>
            <TextField
              type="time"
              label="Fim do expediente"
              value={v.shopfloorShiftEnd ?? ''}
              onChange={(e) => set('shopfloorShiftEnd', e.target.value)}
              slotProps={{ inputLabel: { shrink: true } }}
              helperText="Etapas ainda rodando neste horário são pausadas como “Fim do turno”. Vazio = desligado."
            />
            <NumberField
              label="Pausar depois de (horas seguidas)"
              value={v.shopfloorMaxRunHours ?? 10}
              min={0}
              max={24}
              decimals={0}
              onChange={(n) => set('shopfloorMaxRunHours', n ?? 10)}
              helperText="Limite para etapa rodando sem nenhuma pausa. 0 = desligado."
            />
          </Stack>
        </Panel>
        <Button
          fullWidth
          variant="contained"
          size="large"
          sx={{ mt: 2 }}
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const { id, createdAt, updatedAt, ...rest } = v
              void id
              void createdAt
              void updatedAt
              await save('company', rest)
              toast.success('Configurações salvas.')
            } catch (e) {
              toast.error(e instanceof Error ? e.message : 'Falha ao salvar.')
            } finally {
              setBusy(false)
            }
          }}
        >
          Salvar configurações
        </Button>
      </Grid>
    </Grid>
  )
}

// ----------------------------------------------------------- fluxos/etapas
function FlowsTab() {
  const { save } = useSettings()
  const toast = useToast()
  const stagesNow = useProjectStages()
  const statusesNow = useDefaultTaskStatuses()
  const [stages, setStages] = useState<StageDef[]>(stagesNow)
  const [statuses, setStatuses] = useState<TaskStatusDef[]>(statusesNow)

  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Panel
          title="Etapas do portfólio de projetos"
          subtitle="Colunas do quadro em Projetos"
          actions={
            <Button size="small" startIcon={<AddIcon />} onClick={() => setStages((l) => [...l, { id: `etapa-${uid().slice(0, 6)}`, label: 'Nova etapa', color: '#7d838c' }])}>
              Etapa
            </Button>
          }
        >
          <Stack spacing={1}>
            {stages.map((s, i) => (
              <Stack key={s.id} direction="row" spacing={1} alignItems="center">
                <TextField type="color" value={s.color} onChange={(e) => setStages((l) => l.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} sx={{ width: 56, '& input': { height: 22, p: 0.5 } }} />
                <TextField value={s.label} onChange={(e) => setStages((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <IconButton disabled={i === 0} onClick={() => setStages((l) => { const c = [...l]; [c[i - 1], c[i]] = [c[i], c[i - 1]]; return c })} aria-label="Subir">
                  <Box component="span" sx={{ fontSize: 16 }}>↑</Box>
                </IconButton>
                <IconButton disabled={stages.length <= 3} onClick={() => setStages((l) => l.filter((_, j) => j !== i))} aria-label="Remover">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            onClick={async () => {
              await save('projectStages', { stages })
              toast.success('Etapas do portfólio salvas.')
            }}
          >
            Salvar etapas
          </Button>
        </Panel>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Panel
          title="Status padrão das tarefas"
          subtitle="Aplicado a novos projetos (cada projeto pode personalizar os seus)"
          actions={
            <Button size="small" startIcon={<AddIcon />} onClick={() => setStatuses((l) => [...l, { id: `st-${uid().slice(0, 6)}`, label: 'Novo status', color: '#7d838c', type: 'active' }])}>
              Status
            </Button>
          }
        >
          <Stack spacing={1}>
            {statuses.map((s, i) => (
              <Stack key={s.id} direction="row" spacing={1} alignItems="center">
                <TextField type="color" value={s.color} onChange={(e) => setStatuses((l) => l.map((x, j) => (j === i ? { ...x, color: e.target.value } : x)))} sx={{ width: 56, '& input': { height: 22, p: 0.5 } }} />
                <TextField value={s.label} onChange={(e) => setStatuses((l) => l.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <TextField select value={s.type} onChange={(e) => setStatuses((l) => l.map((x, j) => (j === i ? { ...x, type: e.target.value as TaskStatusDef['type'] } : x)))} sx={{ width: { xs: 'calc(50% - 6px)', sm: 170 } }}>
                  <MenuItem value="open">Aberto</MenuItem>
                  <MenuItem value="active">Em andamento</MenuItem>
                  <MenuItem value="done">Concluído</MenuItem>
                </TextField>
                <IconButton disabled={statuses.length <= 2} onClick={() => setStatuses((l) => l.filter((_, j) => j !== i))} aria-label="Remover">
                  <CloseIcon fontSize="small" />
                </IconButton>
              </Stack>
            ))}
          </Stack>
          <Button
            variant="contained"
            sx={{ mt: 2 }}
            onClick={async () => {
              if (!statuses.some((s) => s.type === 'done')) return toast.error('Mantenha ao menos um status “Concluído”.')
              await save('taskStatuses', { statuses })
              toast.success('Status padrão salvos.')
            }}
          >
            Salvar status
          </Button>
        </Panel>
      </Grid>
    </Grid>
  )
}

// ------------------------------------------------------------------ setores
function WorkCenters() {
  const config: CrudConfig = {
    collection: 'workCenters',
    module: 'settings',
    title: 'Setores e máquinas',
    subtitle: 'Centros de trabalho usados no roteiro de produção, no chão de fábrica e no custo hora-máquina.',
    singular: 'setor',
    icon: <FactoryIcon />,
    initialSort: { key: 'order', dir: 'asc' },
    defaults: () => ({ kind: 'manual', hourlyCost: 0, capacityHours: 8, order: 99, active: true }),
    columns: () => [
      { key: 'order', header: '#', width: 56, sort: (r) => r.order, render: (r) => r.order },
      { key: 'code', header: 'Código', sort: (r) => r.code, render: (r) => <strong>{r.code}</strong> },
      { key: 'name', header: 'Setor / máquina', sort: (r) => r.name, render: (r) => r.name },
      { key: 'kind', header: 'Tipo', render: (r) => (r.kind === 'machine' ? 'Máquina' : 'Manual') },
      { key: 'cost', header: 'Custo/hora', align: 'right', sort: (r) => r.hourlyCost, render: (r) => brl(r.hourlyCost) },
      { key: 'cap', header: 'Capacidade', align: 'right', render: (r) => `${r.capacityHours} h/dia` },
      { key: 'active', header: 'Situação', render: (r) => <Chip size="small" label={r.active ? 'Ativo' : 'Inativo'} color={r.active ? 'success' : 'default'} variant="outlined" /> },
    ],
    fields: [
      { name: 'code', label: 'Código', type: 'text', required: true, span: 4, helper: 'Ex.: CORTE, CNC' },
      { name: 'name', label: 'Nome', type: 'text', required: true, span: 8 },
      { name: 'kind', label: 'Tipo', type: 'select', options: [{ value: 'machine', label: 'Máquina' }, { value: 'manual', label: 'Posto manual' }], required: true, span: 4 },
      { name: 'order', label: 'Ordem no roteiro', type: 'number', span: 4, min: 1 },
      { name: 'hourlyCost', label: 'Custo por hora (R$)', type: 'money', span: 4 },
      { name: 'capacityHours', label: 'Capacidade (h/dia)', type: 'number', span: 4, min: 0 },
      { name: 'active', label: 'Ativo', type: 'switch', span: 4 },
      { name: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
    ],
  }
  return <CrudPage config={config} />
}

// -------------------------------------------------------------- dados/backup
function DataTab() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const fileInput = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState('')
  const admin = user?.role === 'admin'

  const backup = async () => {
    setBusy('backup')
    try {
      const res = await fetch('/api/admin/backup', { headers: { Authorization: `Bearer ${tokenStore.get()}` } })
      if (!res.ok) throw new Error('Falha ao gerar backup.')
      downloadBlob(await res.blob(), `arcoplan-backup-${new Date().toISOString().slice(0, 10)}.json`)
      toast.success('Backup gerado.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha no backup.')
    } finally {
      setBusy('')
    }
  }

  const restore = async (file: File | undefined) => {
    if (!file) return
    const ok = await confirm({ title: 'Restaurar backup?', message: 'Todos os dados atuais serão substituídos pelo conteúdo do arquivo. Esta ação não pode ser desfeita.', confirmLabel: 'Restaurar', danger: true })
    if (!ok) return
    setBusy('restore')
    try {
      const json = JSON.parse(await file.text())
      await api.post('/admin/restore', json)
      resetStore()
      toast.success('Backup restaurado. Recarregando…')
      setTimeout(() => location.reload(), 800)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Arquivo inválido.')
    } finally {
      setBusy('')
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const loadDemo = async () => {
    const ok = await confirm({ title: 'Carregar dados de demonstração?', message: 'Serão criados clientes, projetos, tarefas, orçamentos, ordens, compras e lançamentos fictícios para você explorar o sistema. Eles podem ser removidos depois sem afetar seus dados reais.', confirmLabel: 'Carregar' })
    if (!ok) return
    setBusy('demo')
    try {
      await api.post('/admin/demo')
      resetStore()
      toast.success('Dados de demonstração carregados.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao carregar.')
    } finally {
      setBusy('')
    }
  }

  const clearDemo = async () => {
    const ok = await confirm({ title: 'Remover dados de demonstração?', message: 'Apenas registros marcados como demonstração serão removidos.', confirmLabel: 'Remover', danger: true })
    if (!ok) return
    setBusy('clear')
    try {
      await api.del('/admin/demo')
      resetStore()
      toast.success('Dados de demonstração removidos.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Falha ao remover.')
    } finally {
      setBusy('')
    }
  }

  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Panel title="Backup e restauração">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            O sistema mantém backups automáticos diários (últimos 14 dias) na pasta de dados do servidor. Baixe uma cópia completa para guardar em local seguro.
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
            <Button variant="contained" startIcon={<DownloadIcon />} onClick={backup} disabled={Boolean(busy)}>
              Baixar backup completo
            </Button>
            {admin ? (
              <>
                <Button variant="outlined" color="inherit" startIcon={<UploadFileIcon />} onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
                  Restaurar de arquivo
                </Button>
                <input ref={fileInput} type="file" accept="application/json,.json" hidden onChange={(e) => restore(e.target.files?.[0])} />
              </>
            ) : null}
          </Stack>
        </Panel>
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Panel title="Dados de demonstração">
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Popula o sistema com um cenário realista de fábrica de marcenaria — clientes, projetos com tarefas, orçamentos, produção, compras e financeiro — ideal para treinamento e apresentação.
          </Typography>
          {admin ? (
            <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
              <Button variant="contained" startIcon={<AutoAwesomeIcon />} onClick={loadDemo} disabled={Boolean(busy)}>
                {busy === 'demo' ? 'Carregando…' : 'Carregar demonstração'}
              </Button>
              <Button variant="outlined" color="inherit" startIcon={<DeleteIcon />} onClick={clearDemo} disabled={Boolean(busy)}>
                Remover demonstração
              </Button>
            </Stack>
          ) : (
            <Alert severity="info">Somente administradores podem gerenciar dados de demonstração.</Alert>
          )}
        </Panel>
      </Grid>
      <Grid size={12}>
        <Panel title="Catálogo Leo Madeiras">
          <Typography variant="body2" color="text.secondary">
            O catálogo (chapas, ferragens e fitas de borda, preços em R$) é carregado do arquivo <code>backend/catalog/leo-madeiras.json</code>. Para renová-lo, atualize os preços no IROD-Orça e execute <code>npm run catalog:export</code> no servidor; em seguida use <strong>Estoque e catálogo → Catálogo → Atualizar preços do estoque</strong>.
          </Typography>
        </Panel>
      </Grid>
    </Grid>
  )
}

// ------------------------------------------------------------------ assinatura
interface BillingStatus {
  company: Subscriber
  limits: PlanLimits
  usage: Record<string, number>
  plans: BillingPlan[]
  methods: BillingMethods
  mode: string
  canCancel: boolean
  lastPaymentAt: string | null
  lastPaymentError: string | null
}

const stateChip: Record<string, { label: string; color: 'success' | 'warning' | 'error' | 'default' }> = {
  active: { label: 'Ativa', color: 'success' },
  expiring: { label: 'Vence em breve', color: 'warning' },
  grace: { label: 'Vencida (carência)', color: 'warning' },
  past_due: { label: 'Cobrança com falha', color: 'warning' },
  pending_payment: { label: 'Aguardando pagamento', color: 'warning' },
  canceled: { label: 'Cancelada', color: 'error' },
  expired: { label: 'Vencida', color: 'error' },
  trial: { label: 'Teste gratuito', color: 'warning' },
  trial_expired: { label: 'Teste encerrado', color: 'error' },
  suspended: { label: 'Suspensa', color: 'error' },
  platform: { label: 'Plataforma', color: 'default' },
}

function BillingTab() {
  const { user, company: sessionCompany, refresh } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const [pixCheckout, setPixCheckout] = useState<CheckoutResponse | null>(null)
  const [data, setData] = useState<BillingStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [planId, setPlanId] = useState('')
  const [choice, setChoice] = useState<PaymentChoice>({ method: 'card', months: 1 })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user?.companyId) {
      setLoading(false)
      return
    }
    api.get<BillingStatus>('/billing/status')
      .then((status) => {
        setData(status)
        setPlanId(status.company.planId)
        setChoice({ method: status.company.billingMethod === 'pix' ? 'pix' : 'card', months: 1 })
      })
      .catch(() => undefined)
      .finally(() => setLoading(false))
  }, [user?.companyId, sessionCompany?.status])

  if (loading) return <LoadingState />
  if (!user?.companyId) return <PlatformCompanies />
  if (!data) return <Alert severity="info">Não foi possível carregar informações da assinatura.</Alert>

  const { company } = data
  const isAdmin = user.role === 'admin'
  const plan = data.plans.find((entry) => entry.id === planId)
  const chip = stateChip[company.access.state] ?? stateChip.active
  const changing = planId !== company.planId

  const checkout = async () => {
    setBusy(true)
    try {
      const response = await api.post<CheckoutResponse>('/billing/checkout', { planId, paymentMethod: choice.method, pixMonths: choice.months })
      if (response.pix) {
        setPixCheckout(response)
        setBusy(false)
      } else if (response.checkoutUrl) window.location.assign(response.checkoutUrl)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível iniciar o pagamento.')
      setBusy(false)
    }
  }
  const cancel = async () => {
    const ok = await confirm({
      title: 'Cancelar a assinatura no cartão?',
      message: 'A cobrança mensal para. O acesso continua até o fim do período já pago.',
      confirmLabel: 'Cancelar assinatura',
      danger: true,
    })
    if (!ok) return
    setBusy(true)
    try {
      const status = await api.post<BillingStatus>('/billing/cancel')
      setData(status)
      await refresh()
      toast.success('Assinatura cancelada. O acesso segue até o fim do período pago.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível cancelar a assinatura.')
    } finally {
      setBusy(false)
    }
  }
  const verify = async () => {
    await refresh()
    const status = await api.get<BillingStatus>('/billing/status')
    setData(status)
    toast.info('Situação da assinatura atualizada.')
  }

  return (
    <Grid container spacing={2.5}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Panel title="Plano atual" subtitle={`${brl(company.planPrice)} / mês`}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <Typography variant="h4" color="primary">{company.planName}</Typography>
            <Chip size="small" label={chip.label} color={chip.color} />
          </Stack>
          <Stack spacing={0.75} sx={{ mb: 2 }}>
            <Typography variant="body2">Forma de pagamento: <strong>{methodLabel(company.billingMethod)}</strong></Typography>
            {company.paidUntil ? (
              <Typography variant="body2">
                {company.billingMethod === 'card' ? 'Próxima renovação' : 'Válido até'}: <strong>{fmtDate(company.paidUntil)}</strong>
                {company.access.daysLeft !== null ? ` (${Math.max(company.access.daysLeft, 0)} dia(s))` : ''}
              </Typography>
            ) : null}
            {company.cancelAtPeriodEnd ? <Typography variant="body2" color="warning.main">Cancelamento agendado para o fim do período.</Typography> : null}
          </Stack>
          {company.access.warning ? <Alert severity="warning" sx={{ mb: 2 }}>{company.access.warning}</Alert> : null}
          {data.lastPaymentError ? <Alert severity="error" sx={{ mb: 2 }}>{data.lastPaymentError}</Alert> : null}
          <Stack spacing={2}>
            {limitLabels.map(({ key, label, usage }) => {
              const max = data.limits[key]
              const used = data.usage[usage] ?? 0
              const pct = isUnlimited(max) ? 0 : Math.min(100, (used / max) * 100)
              return (
                <Box key={key}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography variant="body2" color="text.secondary">{label}</Typography>
                    <Typography variant="caption" color={pct >= 90 ? 'error' : 'text.secondary'}>{used} / {isUnlimited(max) ? '∞' : max}</Typography>
                  </Stack>
                  <LinearProgress variant="determinate" value={pct} color={pct >= 90 ? 'error' : 'primary'} sx={{ mt: 0.5 }} />
                </Box>
              )
            })}
          </Stack>
        </Panel>
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <Panel title={company.status === 'active' ? 'Renovar ou mudar de plano' : company.status === 'trial' ? 'Assinar um plano' : 'Regularizar assinatura'} subtitle={data.mode === 'test' ? 'Ambiente de testes do Mercado Pago — nenhum valor real é cobrado.' : undefined}>
          {isAdmin ? (
            <Stack spacing={2.5}>
              <Box sx={{ display: 'grid', gap: 1, gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, 1fr)' } }}>
                {data.plans.map((entry) => (
                  <Paper
                    key={entry.id}
                    variant="outlined"
                    onClick={() => setPlanId(entry.id)}
                    sx={{ p: 1.5, borderRadius: 2, cursor: 'pointer', border: `2px solid ${planId === entry.id ? colors.brand : colors.border}`, bgcolor: planId === entry.id ? colors.brandTint : '#fff' }}
                  >
                    <Typography sx={{ fontWeight: 700 }}>{entry.name}{entry.id === company.planId ? ' (atual)' : ''}</Typography>
                    <Typography variant="body2" color="primary">{brl(entry.price)} / mês</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {isUnlimited(entry.limits.maxUsers) ? 'Usuários ilimitados' : `${entry.limits.maxUsers} usuários`}
                    </Typography>
                  </Paper>
                ))}
              </Box>
              <PaymentMethodPicker plan={plan} methods={data.methods} value={choice} onChange={setChoice} />
              <PayButton
                busy={busy}
                onClick={() => void checkout()}
                label={choice.method === 'pix' ? `Gerar PIX de ${brl((plan?.price ?? 0) * choice.months)}` : changing ? `Trocar para ${plan?.name} no cartão` : 'Assinar com cartão'}
              />
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {data.canCancel ? <Button color="error" onClick={() => void cancel()} disabled={busy}>Cancelar assinatura no cartão</Button> : null}
                <Button onClick={() => void verify()} disabled={busy}>Verificar pagamento</Button>
              </Stack>
              {changing && company.billingMethod === 'card' ? (
                <Typography variant="caption" color="text.secondary">Ao confirmar o novo plano no cartão, a assinatura anterior é cancelada automaticamente.</Typography>
              ) : null}
              {pixCheckout?.pix ? (
                <PixPaymentDialog
                  checkoutRef={pixCheckout.ref}
                  pix={pixCheckout.pix}
                  onClose={() => setPixCheckout(null)}
                  onPaid={() => {
                    setPixCheckout(null)
                    toast.success('Pagamento confirmado! Validade atualizada.')
                    void verify()
                  }}
                />
              ) : null}
            </Stack>
          ) : (
            <Alert severity="info">Somente administradores da empresa gerenciam a assinatura.</Alert>
          )}
        </Panel>
      </Grid>
    </Grid>
  )
}

/** Base da plataforma: a gestão de empresas fica no Painel Admin. */
function PlatformCompanies() {
  const navigate = useNavigate()
  const { user } = useAuth()
  // o Painel Admin é exclusivo do administrador da plataforma; ninguém mais vê o atalho
  if (user?.companyId || user?.role !== 'admin') {
    return <Alert severity="info">A assinatura é gerenciada pelo administrador da plataforma.</Alert>
  }
  return (
    <Panel title="Assinaturas das empresas" subtitle="Você está na base da plataforma, sem plano próprio.">
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Empresas, testes de 48 horas, pagamentos, licenças e credenciais ficam no Painel Admin.
      </Typography>
      <Button variant="contained" onClick={() => navigate('/admin')}>Abrir o Painel Admin</Button>
    </Panel>
  )
}

// ------------------------------------------------------------------ lixeira
function TrashTab() {
  const trash = useCollection('trash')
  const toast = useToast()
  const confirm = useConfirm()
  const columns: Column<TrashEntry>[] = [
    { key: 'at', header: 'Excluído em', sort: (t) => t.deletedAt, render: (t) => fmtDateTime(t.deletedAt) },
    { key: 'label', header: 'Registro', render: (t) => <strong>{t.label || t.doc.id}</strong> },
    { key: 'coll', header: 'Módulo', hideBelow: 'md', render: (t) => t.collection },
    { key: 'by', header: 'Por', hideBelow: 'md', render: (t) => t.deletedByName },
    {
      key: 'actions',
      header: '',
      align: 'right',
      width: 220,
      render: (t) => (
        <Stack direction="row" spacing={1} justifyContent="flex-end">
          <Button
            size="small"
            startIcon={<RestoreFromTrashIcon />}
            onClick={async () => {
              await api.post(`/trash/${t.id}/restore`)
              await Promise.all([refreshCollection('trash'), refreshCollection(t.collection as never)])
              toast.success('Registro restaurado.')
            }}
          >
            Restaurar
          </Button>
          <Button
            size="small"
            color="error"
            onClick={async () => {
              if (await confirm({ title: 'Excluir definitivamente?', message: t.label, confirmLabel: 'Excluir', danger: true })) {
                await api.del(`/trash/${t.id}`)
                await refreshCollection('trash')
              }
            }}
          >
            Excluir
          </Button>
        </Stack>
      ),
    },
  ]
  if (trash.loading) return <LoadingState />
  return (
    <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
      {trash.items.length === 0 ? (
        <EmptyState icon={<SettingsIcon />} title="Lixeira vazia" description="Registros excluídos ficam aqui e podem ser restaurados por um administrador." />
      ) : (
        <DataTable rows={trash.items} columns={columns} rowKey={(t) => t.id} initialSort={{ key: 'at', dir: 'desc' }} />
      )}
    </Paper>
  )
}
