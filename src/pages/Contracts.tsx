import { useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, IconButton, Typography } from '@mui/material'
import { Stack } from '../components/Stack'
import { AddIcon, CloseIcon, DescriptionIcon, PaidIcon, PictureAsPdfIcon } from '../components/icons'
import { CrudPage, type CrudConfig } from '../components/CrudPage'
import { NumberField } from '../components/forms'
import { StatusChip } from '../components/ui'
import { useToast } from '../components/feedback'
import { budgetTotals } from '../domain/budget'
import type { CrudContext } from '../components/CrudPage'
import { createDoc, updateDoc, useCollections, useCompany } from '../lib/store'
import { CONTRACT_STATUS } from '../domain/constants'
import { buildContractPdf } from '../domain/pdf'
import { addDaysISO, brl, downloadBlob, fmtDate, round2, todayISO, uid } from '../lib/format'
import { colors } from '../theme'
import type { Contract, Installment } from '../types'

const DEFAULT_TERMS =
  'O prazo de entrega começa a contar a partir da aprovação do projeto executivo e do pagamento da entrada. Alterações solicitadas após a aprovação podem implicar novo prazo e valor. A garantia dos móveis é de 5 anos contra defeitos de fabricação, excluindo mau uso e umidade excessiva.'

/**
 * Preenche o contrato sozinho a partir do projeto e do orçamento escolhidos: cliente, objeto, valor,
 * datas e um cronograma inicial. Só completa o que está vazio, e o que a pessoa digitou continua valendo.
 */
function ContractAutoFill({
  values,
  set,
  crud,
  generate,
}: {
  values: Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
  set: (name: string, value: unknown) => void
  crud: CrudContext
  generate: (n: number, entryPercent: number, total?: number) => void
}) {
  const previous = useRef({ projectId: values.projectId as string | undefined, budgetId: values.budgetId as string | undefined })
  const [note, setNote] = useState('')
  const projects = crud.maps.projects as Map<string, any> | undefined // eslint-disable-line @typescript-eslint/no-explicit-any
  const budgets = crud.maps.budgets as Map<string, any> | undefined // eslint-disable-line @typescript-eslint/no-explicit-any

  useEffect(() => {
    const before = previous.current
    const notes: string[] = []
    if (values.projectId && values.projectId !== before.projectId) {
      const project = projects?.get(values.projectId)
      if (project) {
        if (!values.clientId && project.clientId) set('clientId', project.clientId)
        if (project.startDate) set('startDate', String(project.startDate).slice(0, 10))
        if (project.dueDate) set('endDate', String(project.dueDate).slice(0, 10))
        if (!String(values.title ?? '').trim()) set('title', `Fornecimento e instalação — ${project.name}`)
        notes.push(`projeto ${project.code ?? ''} ${project.name}`.trim())
        if (!values.budgetId) {
          // orçamento do projeto: o aprovado mais recente; sem ele, o mais recente que não foi recusado
          const mine = [...(budgets?.values() ?? [])].filter((b) => b.projectId === project.id && !['recusado', 'expirado'].includes(b.status))
          const newest = (list: any[]) => [...list].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))[0] // eslint-disable-line @typescript-eslint/no-explicit-any
          const chosen = newest(mine.filter((b) => b.status === 'aprovado')) ?? newest(mine)
          if (chosen) set('budgetId', chosen.id)
          else if (project.contractValue && !values.value) set('value', project.contractValue)
        }
      }
    }
    if (values.budgetId && values.budgetId !== before.budgetId) {
      const budget = budgets?.get(values.budgetId)
      if (budget) {
        const total = budgetTotals(budget).total
        set('value', total)
        if (!values.clientId && budget.clientId) set('clientId', budget.clientId)
        if (!values.projectId && budget.projectId) set('projectId', budget.projectId)
        if (!String(values.title ?? '').trim()) set('title', `Fornecimento e instalação — ${budget.title}`)
        if (!(values.installments ?? []).length && total > 0) generate(1, 50, total)
        notes.push(`orçamento ${budget.code ?? ''} (${brl(total)})`.trim())
      }
    }
    previous.current = { projectId: values.projectId, budgetId: values.budgetId }
    if (notes.length) setNote(`Preenchido a partir de: ${notes.join(' · ')}. Confira e ajuste o que precisar.`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values.projectId, values.budgetId])

  const project = values.projectId ? projects?.get(values.projectId) : undefined
  if (!note && !project) return null
  return (
    <Box sx={{ mb: 2 }}>
      {note ? (
        <Alert severity="success" sx={{ mb: 1 }}>
          {note}
        </Alert>
      ) : null}
      {project ? (
        <Box sx={{ p: 1.5, borderRadius: 2, border: `1px solid ${colors.border}`, bgcolor: colors.subtle }}>
          <Typography variant="overline" color="text.secondary">
            Projeto vinculado
          </Typography>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {project.code ? `${project.code} · ` : ''}
            {project.name}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {[project.environment, project.address, project.startDate ? `início ${fmtDate(project.startDate)}` : '', project.dueDate ? `entrega ${fmtDate(project.dueDate)}` : ''].filter(Boolean).join(' · ') || 'Sem endereço ou datas cadastrados no projeto.'}
          </Typography>
        </Box>
      ) : null}
    </Box>
  )
}

export function ContractsPage() {
  const toast = useToast()
  const company = useCompany()
  const { maps } = useCollections(['clients', 'projects', 'budgets'] as const)

  const config: CrudConfig = {
    collection: 'contracts',
    module: 'contracts',
    title: 'Contratos',
    subtitle: 'Contratos de fornecimento com cronograma de parcelas, PDF e geração automática de contas a receber.',
    singular: 'contrato',
    icon: <DescriptionIcon />,
    lookups: ['clients', 'projects', 'budgets'],
    initialSort: { key: 'code', dir: 'desc' },
    dialogWidth: 'lg',
    defaults: () => ({ status: 'rascunho', startDate: todayISO(), endDate: addDaysISO(todayISO(), 60), installments: [], terms: DEFAULT_TERMS, value: 0 }),
    searchText: (r, ctx) => [r.code, r.title, ctx.maps.clients?.get(r.clientId)?.name, ctx.maps.projects?.get(r.projectId)?.name],
    filters: [{ name: 'status', label: 'Situação', options: CONTRACT_STATUS, get: (r) => r.status }],
    stats: (rows) => [
      { label: 'Contratos', value: rows.length, icon: <DescriptionIcon /> },
      { label: 'Em execução', value: rows.filter((r) => r.status === 'em_execucao' || r.status === 'assinado').length, tone: 'brand' },
      { label: 'Valor contratado', value: brl(rows.filter((r) => !['cancelado', 'rascunho'].includes(r.status)).reduce((s, r) => s + (r.value ?? 0), 0)), tone: 'success' },
      { label: 'Aguardando assinatura', value: rows.filter((r) => r.status === 'enviado').length, tone: 'warning' },
    ],
    columns: (ctx) => [
      {
        key: 'code',
        header: 'Contrato',
        sort: (r) => r.code,
        render: (r) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {r.code}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {r.title}
            </Typography>
          </Box>
        ),
      },
      { key: 'client', header: 'Cliente', sort: (r) => ctx.maps.clients?.get(r.clientId)?.name, render: (r) => ctx.maps.clients?.get(r.clientId)?.name ?? '—' },
      { key: 'value', header: 'Valor', align: 'right', sort: (r) => r.value, render: (r) => <strong>{brl(r.value)}</strong> },
      { key: 'inst', header: 'Parcelas', align: 'right', hideBelow: 'md', render: (r) => (r.installments ?? []).length },
      { key: 'signed', header: 'Assinatura', hideBelow: 'md', sort: (r) => r.signedAt, render: (r) => fmtDate(r.signedAt) },
      { key: 'status', header: 'Situação', sort: (r) => r.status, render: (r) => <StatusChip options={CONTRACT_STATUS} value={r.status} /> },
    ],
    fields: [
      { name: 'title', label: 'Objeto do contrato', type: 'text', required: true, span: 8, placeholder: 'Ex.: Fornecimento e instalação de cozinha planejada' },
      { name: 'status', label: 'Situação', type: 'select', options: CONTRACT_STATUS, required: true, span: 4 },
      { name: 'clientId', label: 'Cliente', type: 'relation', collection: 'clients', required: true, span: 6 },
      { name: 'projectId', label: 'Projeto', type: 'relation', collection: 'projects', span: 6 },
      { name: 'budgetId', label: 'Orçamento de origem', type: 'relation', collection: 'budgets', span: 6 },
      { name: 'value', label: 'Valor total (R$)', type: 'money', required: true, span: 3 },
      { name: 'signedAt', label: 'Assinado em', type: 'date', span: 3 },
      { name: 'startDate', label: 'Início', type: 'date', span: 3 },
      { name: 'endDate', label: 'Término previsto', type: 'date', span: 3 },
      { name: 'terms', label: 'Cláusulas e condições', type: 'textarea', rows: 4 },
    ],
    beforeSave: (v, _m, ctx) => {
      const out = { ...v }
      if (out.budgetId && !out.projectId) out.projectId = ctx.maps.budgets?.get(out.budgetId)?.projectId
      return out
    },
    renderExtra: ({ values, set, crud }) => {
      const inst: Installment[] = values.installments ?? []
      const sum = inst.reduce((s, i) => s + i.amount, 0)
      const diff = round2((values.value ?? 0) - sum)
      const generate = (n: number, entryPercent: number, totalOverride?: number) => {
        const total = totalOverride ?? values.value ?? 0
        const entry = round2((total * entryPercent) / 100)
        const rest = round2(total - entry)
        const each = round2(rest / n)
        const list: Installment[] = []
        if (entry > 0) list.push({ id: uid(), label: 'Entrada', dueDate: values.signedAt ?? todayISO(), amount: entry })
        for (let i = 0; i < n; i++) {
          list.push({ id: uid(), label: `Parcela ${i + 1}/${n}`, dueDate: addDaysISO(values.signedAt ?? todayISO(), 30 * (i + 1)), amount: i === n - 1 ? round2(rest - each * (n - 1)) : each })
        }
        set('installments', list)
      }
      return (
        <Box>
          <ContractAutoFill values={values} set={set} crud={crud} generate={generate} />
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1, flexWrap: 'wrap' }}>
            <Typography variant="overline" color="primary">
              Cronograma de parcelas
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" onClick={() => generate(1, 50)}>
                50% + 50%
              </Button>
              <Button size="small" onClick={() => generate(3, 30)}>
                30% + 3x
              </Button>
              <Button size="small" onClick={() => generate(6, 20)}>
                20% + 6x
              </Button>
              <Button size="small" startIcon={<AddIcon />} onClick={() => set('installments', [...inst, { id: uid(), label: `Parcela ${inst.length + 1}`, dueDate: todayISO(), amount: 0 }])}>
                Adicionar
              </Button>
            </Stack>
          </Stack>
          {inst.map((i) => (
            <Stack key={i.id} direction="row" spacing={1} sx={{ mb: 0.75 }} alignItems="center">
              <Box sx={{ flex: 1 }}>
                <input
                  value={i.label}
                  onChange={(e) => set('installments', inst.map((x) => (x.id === i.id ? { ...x, label: e.target.value } : x)))}
                  style={{ width: '100%', padding: '8px 10px', border: `1px solid ${colors.borderStrong}`, borderRadius: 8, font: 'inherit', fontSize: 13 }}
                />
              </Box>
              <input
                type="date"
                value={i.dueDate}
                onChange={(e) => set('installments', inst.map((x) => (x.id === i.id ? { ...x, dueDate: e.target.value } : x)))}
                style={{ padding: '8px 10px', border: `1px solid ${colors.borderStrong}`, borderRadius: 8, font: 'inherit', fontSize: 13 }}
              />
              <Box sx={{ width: 150 }}>
                <NumberField value={i.amount} adornment="R$" min={0} decimals={2} onChange={(v) => set('installments', inst.map((x) => (x.id === i.id ? { ...x, amount: v ?? 0 } : x)))} />
              </Box>
              <IconButton size="small" onClick={() => set('installments', inst.filter((x) => x.id !== i.id))} aria-label="Remover parcela">
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          {inst.length ? (
            <Typography variant="caption" sx={{ color: Math.abs(diff) > 0.01 ? 'error.main' : 'success.main', fontWeight: 700 }}>
              Soma das parcelas: {brl(sum)} {Math.abs(diff) > 0.01 ? `(diferença de ${brl(diff)} para o valor do contrato)` : '— confere com o contrato'}
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Defina o valor total e use um dos atalhos para gerar as parcelas.
            </Typography>
          )}
        </Box>
      )
    },
    rowActions: (row) => [
      {
        label: 'Gerar PDF do contrato',
        icon: <PictureAsPdfIcon fontSize="small" />,
        onClick: async () => {
          if (!company.cnpj || !company.address) toast.warning('Os dados da empresa (CNPJ e endereço) estão incompletos e saem em branco no contrato. Preencha em Configurações → Empresa.')
          const blob = await buildContractPdf(row as unknown as Contract, maps.clients.get(row.clientId), company, {
            project: maps.projects.get(row.projectId),
            budget: maps.budgets.get(row.budgetId),
          })
          downloadBlob(blob, `contrato-${String(row.code).toLowerCase()}.pdf`)
        },
      },
      {
        label: 'Gerar contas a receber',
        icon: <PaidIcon fontSize="small" />,
        hidden: !(row.installments ?? []).some((i: Installment) => !i.receivableId),
        onClick: async () => {
          const updated: Installment[] = []
          for (const i of row.installments as Installment[]) {
            if (i.receivableId) {
              updated.push(i)
              continue
            }
            const r = await createDoc('receivables', {
              description: `${row.code} — ${i.label}`,
              amount: i.amount,
              dueDate: i.dueDate,
              status: 'pendente',
              category: i.label === 'Entrada' ? 'Entrada / sinal' : 'Parcelas de contrato',
              clientId: row.clientId,
              contractId: row.id,
              projectId: row.projectId,
              installmentLabel: i.label,
            })
            updated.push({ ...i, receivableId: r.id })
          }
          await updateDoc('contracts', row.id, { installments: updated })
          toast.success('Contas a receber geradas a partir das parcelas.')
        },
      },
    ],
  }
  return <CrudPage config={config} />
}
