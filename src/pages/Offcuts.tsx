import { Box, Typography } from '@mui/material'
import { CrudPage, type CrudConfig } from '../components/CrudPage'
import { ContentCutIcon } from '../components/icons'
import { StatusChip } from '../components/ui'
import { fmtDate, round2 } from '../lib/format'
import type { Material, Offcut, OffcutStatus } from '../types'

const STATUS: { value: OffcutStatus; label: string; color: string }[] = [
  { value: 'disponivel', label: 'Disponível', color: '#2e7d4f' },
  { value: 'reservado', label: 'Reservado em plano', color: '#b9852e' },
  { value: 'usado', label: 'Usado', color: '#7d838c' },
  { value: 'descartado', label: 'Descartado', color: '#9a2f2f' },
]

const area = (o: Pick<Offcut, 'width' | 'height'>) => round2(((o.width || 0) * (o.height || 0)) / 1_000_000)

/**
 * Retalhos: sobras de chapa guardadas no estoque. Os próximos planos de corte do mesmo material
 * e espessura usam o retalho antes de abrir uma chapa nova.
 */
export function OffcutsTab() {
  const config: CrudConfig = {
    collection: 'offcuts',
    module: 'inventory',
    title: 'Retalhos',
    subtitle: 'Sobras de chapa guardadas para reaproveitar. O plano de corte usa estes retalhos antes de abrir chapa nova.',
    singular: 'retalho',
    icon: <ContentCutIcon />,
    lookups: ['materials', 'cutPlans', 'projects'],
    initialSort: { key: 'area', dir: 'desc' },
    createLabel: 'Novo retalho',
    defaults: () => ({ status: 'disponivel' }),
    searchText: (r) => [r.code, r.materialName, r.location, r.notes],
    filters: [{ name: 'status', label: 'Situação', options: STATUS, get: (r) => r.status }],
    stats: (rows) => {
      const free = rows.filter((r) => r.status === 'disponivel')
      return [
        { label: 'Disponíveis', value: free.length, tone: 'success' },
        { label: 'Área disponível', value: `${round2(free.reduce((s, r) => s + area(r as Offcut), 0))} m²`, tone: 'brand' },
        { label: 'Reservados', value: rows.filter((r) => r.status === 'reservado').length },
        { label: 'Usados', value: rows.filter((r) => r.status === 'usado').length },
      ]
    },
    beforeSave: (values, _mode, ctx) => {
      const material = ctx.maps.materials?.get(values.materialId as string) as Material | undefined
      if (!material) return values
      return {
        ...values,
        materialName: material.name,
        thickness: values.thickness ?? material.thickness ?? undefined,
      }
    },
    columns: (ctx) => [
      {
        key: 'material',
        header: 'Retalho',
        sort: (r) => r.materialName,
        render: (r) => (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {r.materialName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {[r.code, r.thickness ? `${r.thickness} mm` : '', r.location].filter(Boolean).join(' · ')}
            </Typography>
          </Box>
        ),
      },
      { key: 'size', header: 'Medidas', sort: (r) => r.width * r.height, render: (r) => `${r.width} × ${r.height} mm` },
      { key: 'area', header: 'Área', align: 'right', sort: (r) => r.width * r.height, render: (r) => `${area(r as Offcut)} m²` },
      {
        key: 'origin',
        header: 'Origem',
        hideBelow: 'md',
        render: (r) => {
          const plan = ctx.maps.cutPlans?.get(r.sourcePlanId)
          return plan ? [plan.code, r.sourceSheet ? `chapa ${r.sourceSheet}` : ''].filter(Boolean).join(' · ') : '—'
        },
      },
      { key: 'created', header: 'Guardado em', hideBelow: 'lg', sort: (r) => r.createdAt ?? '', render: (r) => (r.createdAt ? fmtDate(r.createdAt) : '—') },
      { key: 'status', header: 'Situação', sort: (r) => r.status, render: (r) => <StatusChip options={STATUS} value={r.status} /> },
    ],
    fields: [
      {
        name: 'materialId',
        label: 'Material (chapa)',
        type: 'relation',
        collection: 'materials',
        filter: (m: Material) => m.category === 'chapa',
        required: true,
        span: 8,
      },
      { name: 'status', label: 'Situação', type: 'select', options: STATUS, required: true, span: 4 },
      { name: 'width', label: 'Comprimento (mm) — sentido do veio', type: 'number', required: true, min: 50, span: 4 },
      { name: 'height', label: 'Largura (mm)', type: 'number', required: true, min: 50, span: 4 },
      { name: 'thickness', label: 'Espessura (mm)', type: 'number', min: 1, span: 4, helper: 'Em branco usa a espessura do material.' },
      { name: 'location', label: 'Onde está guardado', type: 'text', placeholder: 'Ex.: Prateleira B2', span: 12 },
      { name: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
    ],
  }
  return <CrudPage config={config} />
}
