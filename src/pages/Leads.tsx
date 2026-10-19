import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd'
import { Box, Button, Grid, Paper, ToggleButton, ToggleButtonGroup, Typography, alpha } from '@mui/material'
import { Stack } from '../components/Stack'
import { AddIcon, AssignmentIcon, CallIcon, EmailIcon, PeopleAltIcon, ViewKanbanIcon, ViewListIcon, RequestQuoteIcon } from '../components/icons'
import { DataTable, Dot, EmptyState, LoadingState, PageHeader, SearchField, StatCard, StatusChip, UserAvatar, type Column } from '../components/ui'
import { FormDialog, type FieldDef } from '../components/forms'
import { useConfirm, useToast } from '../components/feedback'
import { useAuth } from '../auth/AuthContext'
import { createDoc, removeDoc, updateDoc, useCollections } from '../lib/store'
import { LEAD_ORIGINS, LEAD_STAGES, optColor, optLabel } from '../domain/constants'
import { brl, brlShort, daysUntil, fmtDate, matches, todayISO } from '../lib/format'
import { colors } from '../theme'
import type { Lead } from '../types'

export function LeadsPage() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const [params, setParams] = useSearchParams()
  const { data, maps, loading } = useCollections(['leads', 'users', 'clients'] as const)
  const [view, setView] = useState<'quadro' | 'lista'>('quadro')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Lead | 'new' | null>(() => {
    if (params.get('new') === '1') return 'new'
    return null
  })

  const idParam = params.get('id')
  const resolvedEditing = editing ?? (idParam ? (maps.leads.get(idParam) ?? null) : null)

  const rows = data.leads.filter((l) => matches([l.name, l.company, l.email, l.phone, l.interest, l.code], query))
  const open = data.leads.filter((l) => !['ganho', 'perdido'].includes(l.stage))
  const won = data.leads.filter((l) => l.stage === 'ganho')
  const decided = won.length + data.leads.filter((l) => l.stage === 'perdido').length

  const fields: FieldDef[] = [
    { name: 'name', label: 'Nome do contato', type: 'text', required: true, span: 6 },
    { name: 'company', label: 'Empresa / escritório', type: 'text', span: 6 },
    { name: 'phone', label: 'Telefone / WhatsApp', type: 'phone', span: 4 },
    { name: 'email', label: 'E-mail', type: 'email', span: 4 },
    { name: 'origin', label: 'Origem', type: 'select', options: LEAD_ORIGINS, required: true, span: 4 },
    { name: 'interest', label: 'Interesse / ambiente', type: 'text', span: 8, placeholder: 'Ex.: Cozinha e área gourmet' },
    { name: 'value', label: 'Valor estimado (R$)', type: 'money', span: 4 },
    { name: 'stage', label: 'Etapa do funil', type: 'select', options: LEAD_STAGES, required: true, span: 4 },
    { name: 'responsibleId', label: 'Responsável', type: 'relation', collection: 'users', span: 4 },
    { name: 'nextActionDate', label: 'Próximo contato', type: 'date', span: 4 },
    { name: 'nextAction', label: 'Próxima ação', type: 'text', span: 12 },
    { name: 'lostReason', label: 'Motivo da perda', type: 'text', span: 12, show: (v) => v.stage === 'perdido' },
    { name: 'notes', label: 'Observações', type: 'textarea', rows: 3 },
  ]

  const close = () => {
    setEditing(null)
    if (params.get('id') || params.get('new')) {
      params.delete('id')
      params.delete('new')
      setParams(params, { replace: true })
    }
  }

  const onDragEnd = (r: DropResult) => {
    if (!r.destination || r.destination.droppableId === r.source.droppableId) return
    void updateDoc('leads', r.draggableId, { stage: r.destination.droppableId as Lead['stage'] })
  }

  const convert = async (lead: Lead) => {
    const ok = await confirm({
      title: 'Converter lead em cliente?',
      message: `Será criado o cadastro de cliente “${lead.name}” e você poderá abrir o projeto ou o orçamento em seguida.`,
      confirmLabel: 'Converter',
    })
    if (!ok) return
    const client = lead.clientId
      ? maps.clients.get(lead.clientId)
      : await createDoc('clients', { name: lead.company || lead.name, type: lead.company ? 'PJ' : 'PF', contactName: lead.name, phone: lead.phone, email: lead.email, status: 'ativo', segment: 'residencial' })
    if (!client) return
    await updateDoc('leads', lead.id, { clientId: client.id, stage: 'ganho' })
    toast.success('Lead convertido em cliente.')
    navigate(`/projetos?novo=1&cliente=${client.id}`)
  }

  const columns: Column<Lead>[] = [
    {
      key: 'name',
      header: 'Lead',
      sort: (l) => l.name,
      render: (l) => (
        <Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {l.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {l.company || l.interest || l.phone}
          </Typography>
        </Box>
      ),
    },
    { key: 'stage', header: 'Etapa', sort: (l) => LEAD_STAGES.findIndex((s) => s.value === l.stage), render: (l) => <StatusChip options={LEAD_STAGES} value={l.stage} /> },
    { key: 'origin', header: 'Origem', hideBelow: 'md', render: (l) => optLabel(LEAD_ORIGINS, l.origin) },
    { key: 'value', header: 'Valor', align: 'right', sort: (l) => l.value, render: (l) => (l.value ? brl(l.value) : '—') },
    { key: 'next', header: 'Próx. contato', hideBelow: 'md', sort: (l) => l.nextActionDate, render: (l) => fmtDate(l.nextActionDate) },
    { key: 'owner', header: 'Responsável', hideBelow: 'lg', render: (l) => maps.users.get(l.responsibleId ?? '')?.name ?? '—' },
  ]

  if (loading && !data.leads.length) return <LoadingState />

  return (
    <Box>
      <PageHeader
        title="Leads e funil comercial"
        subtitle="Acompanhe oportunidades do primeiro contato ao fechamento e converta em cliente e projeto."
        actions={
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>
            Novo lead
          </Button>
        }
      />
      <Grid container spacing={2} sx={{ mb: 2.5 }}>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Oportunidades abertas" value={open.length} icon={<PeopleAltIcon />} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Valor no funil" value={brlShort(open.reduce((s, l) => s + (l.value ?? 0), 0))} tone="brand" />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Ganhos" value={won.length} tone="success" hint={brl(won.reduce((s, l) => s + (l.value ?? 0), 0))} />
        </Grid>
        <Grid size={{ xs: 6, md: 3 }}>
          <StatCard label="Taxa de conversão" value={decided ? `${Math.round((won.length / decided) * 100)}%` : '—'} />
        </Grid>
      </Grid>

      <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
        <SearchField value={query} onChange={setQuery} placeholder="Buscar leads…" />
        <Box sx={{ flex: 1 }} />
        <ToggleButtonGroup size="small" exclusive value={view} onChange={(_, v) => v && setView(v)}>
          <ToggleButton value="quadro">
            <ViewKanbanIcon fontSize="small" sx={{ mr: 0.75 }} /> Funil
          </ToggleButton>
          <ToggleButton value="lista">
            <ViewListIcon fontSize="small" sx={{ mr: 0.75 }} /> Lista
          </ToggleButton>
        </ToggleButtonGroup>
      </Stack>

      {data.leads.length === 0 ? (
        <Paper variant="outlined" sx={{ borderRadius: 3 }}>
          <EmptyState icon={<PeopleAltIcon />} title="Nenhum lead cadastrado" description="Registre contatos de Instagram, indicações, arquitetos e feiras para acompanhar o funil." action={<Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing('new')}>Novo lead</Button>} />
        </Paper>
      ) : view === 'quadro' ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2, alignItems: 'flex-start' }}>
            {LEAD_STAGES.map((st) => {
              const items = rows.filter((l) => l.stage === st.value)
              return (
                <Box key={st.value} sx={{ width: 280, flexShrink: 0 }}>
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1.25, py: 1, borderRadius: 2, bgcolor: alpha(optColor(LEAD_STAGES, st.value), 0.1), mb: 1 }}>
                    <Dot color={st.color!} size={10} />
                    <Typography variant="subtitle2" sx={{ flex: 1 }} noWrap>
                      {st.label}
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: st.color }}>
                      {items.length}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ px: 1.25, display: 'block', mb: 0.5 }}>
                    {brl(items.reduce((s, l) => s + (l.value ?? 0), 0))}
                  </Typography>
                  <Droppable droppableId={st.value}>
                    {(p, snap) => (
                      <Box ref={p.innerRef} {...p.droppableProps} sx={{ minHeight: 80, p: 0.5, borderRadius: 2, bgcolor: snap.isDraggingOver ? alpha(colors.brand, 0.05) : 'transparent' }}>
                        {items.map((l, i) => {
                          const d = l.nextActionDate ? daysUntil(l.nextActionDate) : null
                          return (
                            <Draggable key={l.id} draggableId={l.id} index={i}>
                              {(dp, ds) => (
                                <Paper
                                  ref={dp.innerRef}
                                  {...dp.draggableProps}
                                  {...dp.dragHandleProps}
                                  variant="outlined"
                                  onClick={() => setEditing(l)}
                                  sx={{ p: 1.5, mb: 1, borderRadius: 2.5, cursor: 'pointer', bgcolor: '#fff', boxShadow: ds.isDragging ? '0 10px 28px rgba(30,26,25,0.18)' : 'none', '&:hover': { borderColor: colors.brand } }}
                                >
                                  <Typography variant="subtitle2">{l.name}</Typography>
                                  <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                                    {l.company || l.interest || optLabel(LEAD_ORIGINS, l.origin)}
                                  </Typography>
                                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 1 }}>
                                    <UserAvatar user={maps.users.get(l.responsibleId ?? '')} size={22} />
                                    <Typography variant="caption" sx={{ flex: 1, fontWeight: 700 }}>
                                      {l.value ? brl(l.value) : ''}
                                    </Typography>
                                    {l.nextActionDate ? (
                                      <Typography variant="caption" sx={{ fontWeight: 700, color: d !== null && d < 0 ? 'error.main' : d === 0 ? 'warning.main' : 'text.secondary' }}>
                                        {fmtDate(l.nextActionDate, 'dd MMM')}
                                      </Typography>
                                    ) : null}
                                  </Stack>
                                </Paper>
                              )}
                            </Draggable>
                          )
                        })}
                        {p.placeholder}
                      </Box>
                    )}
                  </Droppable>
                </Box>
              )
            })}
          </Box>
        </DragDropContext>
      ) : (
        <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
          <DataTable rows={rows} columns={columns} rowKey={(l) => l.id} onRowClick={(l) => setEditing(l)} initialSort={{ key: 'next', dir: 'asc' }} />
        </Paper>
      )}

      {resolvedEditing ? (
        <FormDialog
          open
          title={resolvedEditing === 'new' ? 'Novo lead' : resolvedEditing.name}
          subtitle={resolvedEditing !== 'new' ? `${optLabel(LEAD_ORIGINS, resolvedEditing.origin)}${resolvedEditing.phone ? ` · ${resolvedEditing.phone}` : ''}` : undefined}
          fields={fields}
          initial={resolvedEditing === 'new' ? { origin: 'instagram', stage: 'novo', responsibleId: user?.id, nextActionDate: todayISO() } : { ...resolvedEditing }}
          onClose={close}
          extraActions={
            resolvedEditing !== 'new' ? (
              <Stack direction="row" spacing={1}>
                <Button size="small" startIcon={<AssignmentIcon />} onClick={() => convert(resolvedEditing)}>
                  Converter em cliente
                </Button>
                {resolvedEditing.clientId ? (
                  <Button size="small" startIcon={<RequestQuoteIcon />} onClick={() => navigate(`/orcamentos?new=1&cliente=${resolvedEditing.clientId}`)}>
                    Orçamento
                  </Button>
                ) : null}
                {resolvedEditing.phone ? (
                  <Button size="small" startIcon={<CallIcon />} component="a" href={`tel:${resolvedEditing.phone}`}>
                    Ligar
                  </Button>
                ) : null}
                {resolvedEditing.email ? (
                  <Button size="small" startIcon={<EmailIcon />} component="a" href={`mailto:${resolvedEditing.email}`}>
                    E-mail
                  </Button>
                ) : null}
                <Button
                  size="small"
                  color="error"
                  onClick={async () => {
                    if (await confirm({ title: 'Excluir lead?', message: resolvedEditing.name, confirmLabel: 'Excluir', danger: true })) {
                      await removeDoc('leads', resolvedEditing.id)
                      close()
                    }
                  }}
                >
                  Excluir
                </Button>
              </Stack>
            ) : undefined
          }
          onSave={async (values) => {
            const { id, createdAt, updatedAt, ...rest } = values
            void createdAt
            void updatedAt
            if (id) await updateDoc('leads', id, rest)
            else await createDoc('leads', rest)
            toast.success('Lead salvo.')
          }}
        />
      ) : null}
    </Box>
  )
}
