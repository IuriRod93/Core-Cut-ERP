import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Dialog, InputBase, List, ListItemButton, ListItemIcon, ListItemText, Typography } from '@mui/material'
import {
  AssignmentIcon,
  BusinessIcon,
  FactoryIcon,
  Inventory2Icon,
  PeopleAltIcon,
  RequestQuoteIcon,
  SearchIcon,
  StorefrontIcon,
  TaskAltIcon,
} from '../components/icons'
import { useAuth } from '../auth/AuthContext'
import { useCollections } from '../lib/store'
import { matches } from '../lib/format'
import { colors } from '../theme'
import type { CollectionName } from '../types'

interface Hit {
  key: string
  group: string
  title: string
  detail: string
  path: string
  icon: ReactNode
}

export function GlobalSearch({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const { can } = useAuth()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)

  const names = useMemo(() => {
    const list: CollectionName[] = ['projects', 'tasks', 'clients']
    if (can('leads')) list.push('leads')
    if (can('budgets')) list.push('budgets')
    if (can('production')) list.push('productionOrders')
    if (can('inventory')) list.push('materials')
    if (can('suppliers') || can('purchases')) list.push('suppliers')
    return list
  }, [can])
  const { data } = useCollections(open ? names : [])

  useEffect(() => {
    if (open) {
      setQuery('')
      setCursor(0)
    }
  }, [open])

  const hits = useMemo<Hit[]>(() => {
    if (query.trim().length < 2) return []
    const out: Hit[] = []
    const clientName = new Map((data.clients ?? []).map((c) => [c.id, c.name]))
    const projectOf = new Map((data.projects ?? []).map((p) => [p.id, p]))
    for (const p of data.projects ?? [])
      if (matches([p.code, p.name, clientName.get(p.clientId ?? ''), p.address], query))
        out.push({ key: `p${p.id}`, group: 'Projetos', title: p.name, detail: `${p.code ?? ''} · ${clientName.get(p.clientId ?? '') ?? 'Sem cliente'}`, path: `/projetos/${p.id}`, icon: <AssignmentIcon /> })
    for (const t of data.tasks ?? [])
      if (matches([t.title, t.tags?.join(' ')], query))
        out.push({ key: `t${t.id}`, group: 'Tarefas', title: t.title, detail: projectOf.get(t.projectId)?.name ?? '', path: `/projetos/${t.projectId}?tarefa=${t.id}`, icon: <TaskAltIcon /> })
    for (const c of data.clients ?? [])
      if (matches([c.name, c.document, c.email, c.phone, c.city], query))
        out.push({ key: `c${c.id}`, group: 'Clientes', title: c.name, detail: [c.document, c.city].filter(Boolean).join(' · '), path: `/clientes?id=${c.id}`, icon: <BusinessIcon /> })
    for (const l of data.leads ?? [])
      if (matches([l.name, l.company, l.email, l.phone], query))
        out.push({ key: `l${l.id}`, group: 'Leads', title: l.name, detail: l.company ?? '', path: `/leads?id=${l.id}`, icon: <PeopleAltIcon /> })
    for (const b of data.budgets ?? [])
      if (matches([b.code, b.title], query))
        out.push({ key: `b${b.id}`, group: 'Orçamentos', title: `${b.code} · ${b.title}`, detail: clientName.get(b.clientId ?? '') ?? '', path: `/orcamentos?id=${b.id}`, icon: <RequestQuoteIcon /> })
    for (const o of data.productionOrders ?? [])
      if (matches([o.code, o.title, o.batch], query))
        out.push({ key: `o${o.id}`, group: 'Produção', title: `${o.code} · ${o.title}`, detail: o.batch ?? '', path: `/producao?id=${o.id}`, icon: <FactoryIcon /> })
    for (const m of data.materials ?? [])
      if (matches([m.name, m.code, m.brand], query))
        out.push({ key: `m${m.id}`, group: 'Estoque', title: m.name, detail: [m.code, m.brand].filter(Boolean).join(' · '), path: `/estoque?q=${encodeURIComponent(m.code ?? m.name)}`, icon: <Inventory2Icon /> })
    for (const s of data.suppliers ?? [])
      if (matches([s.name, s.document, s.contact], query))
        out.push({ key: `s${s.id}`, group: 'Fornecedores', title: s.name, detail: s.contact ?? '', path: `/fornecedores?id=${s.id}`, icon: <StorefrontIcon /> })
    return out.slice(0, 40)
  }, [query, data])

  useEffect(() => setCursor(0), [query])
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [cursor])

  const go = (hit: Hit) => {
    onClose()
    navigate(hit.path)
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      slotProps={{ paper: { sx: { position: 'absolute', top: '10vh', m: 0, borderRadius: 3 } } }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2, py: 1.5, borderBottom: `1px solid ${colors.border}` }}>
        <SearchIcon sx={{ color: colors.textMuted }} />
        <InputBase
          autoFocus
          fullWidth
          placeholder="Buscar projetos, tarefas, clientes, materiais, ordens…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setCursor((c) => Math.min(c + 1, hits.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setCursor((c) => Math.max(c - 1, 0))
            } else if (e.key === 'Enter' && hits[cursor]) go(hits[cursor])
          }}
          sx={{ fontSize: '0.95rem' }}
        />
        <Typography variant="caption" sx={{ border: `1px solid ${colors.border}`, borderRadius: 1, px: 0.75, color: colors.textMuted }}>
          Esc
        </Typography>
      </Box>
      <List ref={listRef} dense sx={{ maxHeight: '55vh', overflowY: 'auto', py: 0.5 }}>
        {query.trim().length < 2 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            Digite ao menos 2 caracteres para buscar em todo o sistema.
          </Typography>
        ) : hits.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
            Nenhum resultado para “{query}”.
          </Typography>
        ) : (
          hits.map((h, i) => (
            <Box key={h.key}>
              {i === 0 || hits[i - 1].group !== h.group ? (
                <Typography variant="overline" color="text.secondary" sx={{ display: 'block', px: 2, pt: 1.25 }}>
                  {h.group}
                </Typography>
              ) : null}
              <ListItemButton selected={i === cursor} data-active={i === cursor} onClick={() => go(h)} sx={{ mx: 1, py: 0.75 }}>
                <ListItemIcon sx={{ minWidth: 36, color: colors.brand }}>{h.icon}</ListItemIcon>
                <ListItemText primary={h.title} secondary={h.detail} slotProps={{ primary: { noWrap: true, sx: { fontWeight: 600 } }, secondary: { noWrap: true } }} />
              </ListItemButton>
            </Box>
          ))
        )}
      </List>
    </Dialog>
  )
}
