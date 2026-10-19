import { useMemo, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, TextField, Typography, alpha } from '@mui/material'
import { Stack } from './Stack'
import { NumberField } from './forms'
import { Panel } from './ui'
import { ShoppingCartIcon, AttachMoneyIcon } from './icons'
import { useToast } from './feedback'
import { api } from '../lib/api'
import { refreshCollection, useCollections } from '../lib/store'
import { planNeeds, projectPurchaseBalance, type PlanNeed, type ProjectPurchaseBalance } from '../domain/planFlow'
import { PURCHASE_STATUS, optColor, optLabel } from '../domain/constants'
import { brl } from '../lib/format'
import { colors } from '../theme'
import type { Budget, CutPlan, Purchase } from '../types'

interface PlanSnapshot {
  id?: string
  code?: string
  title: string
  projectId?: string
  groups: CutPlan['groups']
  hardware: CutPlan['hardware']
  costs: CutPlan['costs']
  edgeMaterialId?: string
}

/** Painel "Orçamento e compras": soma o plano ao orçamento do projeto e gera a solicitação de compras. */
export function PlanFlowPanel({ plan, saved, onBudgetSynced }: { plan: PlanSnapshot; saved: boolean; onBudgetSynced?: () => void }) {
  const toast = useToast()
  const { data, maps } = useCollections(['budgets', 'purchases', 'materials', 'suppliers'] as const)
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)

  const budgetsWithPlan = useMemo(() => data.budgets.filter((b) => plan.id && b.items.some((i) => i.cutPlanId === plan.id)), [data.budgets, plan.id])
  const linked: Budget | undefined = budgetsWithPlan[0]
  const linkedCost = linked ? linked.items.filter((i) => i.cutPlanId === plan.id).reduce((s, i) => s + i.quantity * i.unitCost, 0) : 0
  const orders = useMemo(() => data.purchases.filter((p) => plan.id && p.cutPlanId === plan.id), [data.purchases, plan.id])
  const outdated = linked ? Math.abs(linkedCost - plan.costs.total) > 0.05 : false

  const sync = async () => {
    if (!plan.id) return
    setBusy(true)
    try {
      const r = await api.post<{ budget: Budget; created: boolean; items: number; cost: number }>(`/cut-plans/${plan.id}/sync-budget`, {})
      await refreshCollection('budgets')
      toast.success(`${r.created ? 'Orçamento criado' : 'Orçamento atualizado'}: ${r.budget.code} · ${brl(r.cost)} em ${r.items} itens.`)
      onBudgetSynced?.()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível atualizar o orçamento.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Orçamento e compras" subtitle="Custos do plano somados ao orçamento do projeto e solicitação de material para aprovação">
      <Stack spacing={2}>
        <Box>
          <Typography variant="overline" color="text.secondary">
            Orçamento do projeto
          </Typography>
          {!plan.projectId ? (
            <Typography variant="body2" color="text.secondary">
              Vincule o plano a um projeto para somar o custo ao orçamento.
            </Typography>
          ) : linked ? (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
              <Chip size="small" color="success" label="Somado" />
              <Typography variant="body2">
                <RouterLink to={`/orcamentos`} style={{ color: colors.brand, fontWeight: 700 }}>
                  {linked.code}
                </RouterLink>{' '}
                · {brl(linkedCost)} de custo direto do plano
              </Typography>
              {outdated ? <Chip size="small" color="warning" label={`Plano mudou: ${brl(plan.costs.total)}`} /> : null}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Ainda não somado. Ao salvar o plano o custo ({brl(plan.costs.total)}) entra no orçamento do projeto; a margem do orçamento é aplicada sobre ele.
            </Typography>
          )}
          <Button size="small" variant="outlined" startIcon={<AttachMoneyIcon />} sx={{ mt: 1 }} disabled={!saved || busy || !plan.projectId} onClick={sync}>
            {linked ? 'Atualizar no orçamento' : 'Somar ao orçamento do projeto'}
          </Button>
          {!saved ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              Salve o plano para somar ao orçamento.
            </Typography>
          ) : null}
        </Box>

        <Box>
          <Typography variant="overline" color="text.secondary">
            Solicitações de compra
          </Typography>
          {orders.length ? (
            <Stack spacing={0.5} sx={{ mb: 1 }}>
              {orders.map((o) => (
                <Stack key={o.id} direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap' }}>
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {o.code}
                  </Typography>
                  <Chip size="small" label={optLabel(PURCHASE_STATUS, o.status)} sx={{ bgcolor: `${optColor(PURCHASE_STATUS, o.status)}22`, color: optColor(PURCHASE_STATUS, o.status), fontWeight: 600 }} />
                  <Typography variant="caption" color="text.secondary">
                    {maps.suppliers.get(o.supplierId ?? '')?.name ?? 'Sem fornecedor'} · {o.items.length} itens ·{' '}
                    {brl(o.items.reduce((s, i) => s + i.quantity * i.unitCost, 0))}
                  </Typography>
                  {o.status === 'reprovado' && o.rejectedReason ? (
                    <Typography variant="caption" color="error.main">
                      Motivo: {o.rejectedReason}
                    </Typography>
                  ) : null}
                </Stack>
              ))}
              <Typography variant="caption" color="text.secondary">
                A aprovação ou reprovação é feita em <RouterLink to="/compras" style={{ color: colors.brand }}>Compras</RouterLink>.
              </Typography>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Nenhuma solicitação gerada para este plano.
            </Typography>
          )}
          <Button size="small" variant="contained" startIcon={<ShoppingCartIcon />} disabled={!saved || plan.groups.length === 0} onClick={() => setOpen(true)}>
            Gerar solicitação de compras
          </Button>
        </Box>
      </Stack>

      {open ? (
        <RequestDialog
          plan={plan}
          materials={maps.materials}
          supplierName={(id) => maps.suppliers.get(id ?? '')?.name}
          existing={orders}
          budgets={data.budgets}
          purchases={data.purchases}
          onClose={() => setOpen(false)}
          onCreated={async (count, balance) => {
            await refreshCollection('purchases')
            setOpen(false)
            toast.success(`${count} solicitação(ões) de compra criada(s) — aguardando aprovação em Compras.`)
            if (balance && balance.balance < 0) toast.warning(`Atenção: as compras do projeto passam ${brl(-balance.balance)} do valor do orçamento ${balance.budgetCode ?? ''}.`)
          }}
        />
      ) : null}
    </Panel>
  )
}

function RequestDialog({
  plan,
  materials,
  supplierName,
  existing,
  budgets,
  purchases,
  onClose,
  onCreated,
}: {
  plan: PlanSnapshot
  materials: Map<string, import('../types').Material>
  supplierName: (id?: string) => string | undefined
  existing: Purchase[]
  budgets: Budget[]
  purchases: Purchase[]
  onClose: () => void
  onCreated: (count: number, balance: ProjectPurchaseBalance | null) => void
}) {
  const toast = useToast()
  const needs = useMemo(() => planNeeds({ groups: plan.groups, hardware: plan.hardware, costs: plan.costs, edgeMaterialId: plan.edgeMaterialId }, materials), [plan, materials])
  const [sel, setSel] = useState<Record<string, { on: boolean; qty: number }>>(() =>
    Object.fromEntries(needs.map((n) => [n.key, { on: n.toBuy > 0, qty: n.toBuy > 0 ? n.toBuy : n.quantity }])),
  )
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const chosen = needs.filter((n) => sel[n.key]?.on && (sel[n.key]?.qty ?? 0) > 0)
  const total = chosen.reduce((s, n) => s + (sel[n.key]?.qty ?? 0) * n.unitCost, 0)
  const alreadyRequested = existing.some((o) => !['cancelado', 'reprovado'].includes(o.status))
  // quanto sobra do orçamento do projeto depois desta compra
  const balance = useMemo(() => projectPurchaseBalance({ projectId: plan.projectId, budgets, purchases, request: total }), [plan.projectId, budgets, purchases, total])

  const submit = async () => {
    setBusy(true)
    try {
      const r = await api.post<{ purchases: Purchase[]; balance: ProjectPurchaseBalance | null }>(`/cut-plans/${plan.id}/purchase-request`, {
        notes,
        items: chosen.map((n: PlanNeed) => ({
          materialId: n.materialId,
          description: n.description,
          unit: n.unit,
          quantity: sel[n.key].qty,
          unitCost: n.unitCost,
          supplierId: n.supplierId,
        })),
      })
      onCreated(r.purchases.length, r.balance)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível gerar a solicitação.')
      setBusy(false)
    }
  }

  const kindLabel = { chapa: 'Chapa', fita: 'Fita', ferragem: 'Ferragem' } as const

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Gerar solicitação de compras</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
          Quantidades calculadas pelo plano otimizado. A sugestão já desconta o saldo do estoque; itens com saldo suficiente vêm desmarcados. A solicitação é agrupada por fornecedor e segue para aprovação em Compras.
        </Typography>
        {alreadyRequested ? (
          <Alert severity="info" sx={{ mb: 1.5 }}>
            Este plano já possui solicitação em andamento. Gere outra somente para itens ainda não pedidos.
          </Alert>
        ) : null}
        <Box sx={{ overflowX: 'auto' }}>
          <Box sx={{ minWidth: 720 }}>
            <Box sx={{ display: 'grid', gridTemplateColumns: '36px 1fr 90px 90px 120px 110px', gap: 1, pb: 0.5 }}>
              {['', 'Item', 'Necessário', 'Em estoque', 'Comprar', 'Custo'].map((h) => (
                <Typography key={h} variant="overline" color="text.secondary">
                  {h}
                </Typography>
              ))}
            </Box>
            {needs.map((n) => {
              const s = sel[n.key] ?? { on: false, qty: 0 }
              return (
                <Box key={n.key} sx={{ display: 'grid', gridTemplateColumns: '36px 1fr 90px 90px 120px 110px', gap: 1, alignItems: 'center', mb: 0.5 }}>
                  <Checkbox size="small" checked={s.on} onChange={(e) => setSel((x) => ({ ...x, [n.key]: { ...s, on: e.target.checked } }))} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                      {n.description}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {kindLabel[n.kind]} · {supplierName(n.supplierId) ?? 'fornecedor a definir'} · {brl(n.unitCost)}/{n.unit}
                    </Typography>
                  </Box>
                  <Typography variant="body2">
                    {n.quantity} {n.unit}
                  </Typography>
                  <Typography variant="body2" color={n.stock >= n.quantity ? 'success.main' : 'text.secondary'}>
                    {n.stock}
                  </Typography>
                  <NumberField value={s.qty} min={0} decimals={n.kind === 'fita' ? 1 : 0} onChange={(v) => setSel((x) => ({ ...x, [n.key]: { ...s, qty: v ?? 0, on: (v ?? 0) > 0 ? s.on : false } }))} />
                  <Typography variant="body2" sx={{ fontWeight: 600, textAlign: 'right' }}>
                    {brl(s.qty * n.unitCost)}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        </Box>
        {balance ? (
          <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, border: `1px solid ${balance.balance < 0 ? colors.error : colors.border}`, bgcolor: balance.balance < 0 ? alpha(colors.error, 0.06) : colors.subtle }}>
            <Typography variant="overline" color="text.secondary" sx={{ display: 'block' }}>
              Saldo do orçamento do projeto{balance.budgetCode ? ` · ${balance.budgetCode}` : ''}
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(4, 1fr)' }, gap: 1.5, mt: 0.5 }}>
              {[
                ['Valor do orçamento', brl(balance.budgetTotal)],
                ['Compras já feitas', `− ${brl(balance.committed)}`],
                ['Esta solicitação', `− ${brl(balance.request)}`],
                ['Saldo depois', brl(balance.balance)],
              ].map(([label, value], i) => (
                <Box key={label}>
                  <Typography variant="caption" color="text.secondary">
                    {label}
                  </Typography>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, color: i === 3 ? (balance.balance < 0 ? colors.error : colors.success) : undefined }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
            <Typography variant="caption" color={balance.materialsBalance < 0 ? 'error.main' : 'text.secondary'} sx={{ display: 'block', mt: 0.75 }}>
              Verba de materiais prevista no orçamento: {brl(balance.materialsBudget)} → saldo de materiais {brl(balance.materialsBalance)}
              {balance.materialsBalance < 0 ? ' (compra acima do previsto)' : ''}
            </Typography>
          </Box>
        ) : plan.projectId ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
            O projeto ainda não tem orçamento: some o plano ao orçamento para acompanhar o saldo.
          </Typography>
        ) : null}
        <TextField sx={{ mt: 2 }} label="Observações para a compra (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} multiline minRows={2} />
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 1.5 }}>
          <Typography variant="subtitle1">
            {chosen.length} itens · <span style={{ color: colors.brand }}>{brl(total)}</span>
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button variant="contained" disabled={!chosen.length || busy} onClick={submit}>
          {busy ? 'Gerando…' : 'Gerar solicitação'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
