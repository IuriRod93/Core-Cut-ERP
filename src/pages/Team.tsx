import { useState } from 'react'
import { Box, Checkbox, FormControlLabel, Tab, Tabs, Typography } from '@mui/material'
import { Stack } from '../components/Stack'
import { CrudPage, type CrudConfig } from '../components/CrudPage'
import { GroupsIcon } from '../components/icons'
import { StatusChip, UserAvatar } from '../components/ui'
import { useAuth } from '../auth/AuthContext'
import { PhotoUpload } from '../components/PhotoUpload'
import { fmtDate, fmtRelative, brl } from '../lib/format'
import { colors } from '../theme'
import { MODULES, ROLES, ROLE_DEFAULT_MODULES, type RoleKey } from '../../shared/access.mjs'
import type { ModuleKey, User } from '../types'

const roleOptions = (Object.keys(ROLES) as RoleKey[]).map((r) => ({ value: r, label: ROLES[r] }))

/** Equipe e Empresas/unidades: o administrador do cliente organiza os usuários por empresa ou filial. */
export function TeamPage() {
  const [tab, setTab] = useState<'users' | 'units'>('users')
  return (
    <Box>
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2.5, borderBottom: `1px solid ${colors.border}` }}>
        <Tab value="users" label="Usuários" />
        <Tab value="units" label="Empresas e unidades" />
      </Tabs>
      {tab === 'users' ? <UsersView /> : <UnitsView />}
    </Box>
  )
}

function UnitsView() {
  const config: CrudConfig = {
    collection: 'units',
    module: 'team',
    title: 'Empresas e unidades',
    subtitle: 'Organize a equipe por empresa, filial ou unidade. Cada usuário é ligado a uma delas na aba Usuários.',
    singular: 'empresa',
    icon: <GroupsIcon />,
    lookups: ['users'],
    initialSort: { key: 'name', dir: 'asc' },
    createLabel: 'Nova empresa',
    defaults: () => ({ active: true }),
    searchText: (r) => [r.code, r.name, r.city, r.document],
    columns: (ctx) => [
      { key: 'name', header: 'Empresa / unidade', sort: (r) => r.name, render: (r) => (<Box><Typography variant="body2" sx={{ fontWeight: 600 }}>{r.name}</Typography><Typography variant="caption" color="text.secondary">{[r.code, r.city].filter(Boolean).join(' · ')}</Typography></Box>) },
      { key: 'manager', header: 'Responsável', hideBelow: 'md', render: (r) => ctx.maps.users?.get(r.managerId)?.name ?? '—' },
      { key: 'people', header: 'Usuários', align: 'right', sort: (r) => (ctx.data.users ?? []).filter((u: User) => u.unitId === r.id).length, render: (r) => (ctx.data.users ?? []).filter((u: User) => u.unitId === r.id && u.active !== false).length },
      { key: 'active', header: 'Situação', render: (r) => <StatusChip options={[{ value: 'true', label: 'Ativa', color: '#2e7d4f' }, { value: 'false', label: 'Inativa', color: '#7d838c' }]} value={String(r.active !== false)} /> },
    ],
    fields: [
      { name: 'name', label: 'Nome da empresa ou unidade', type: 'text', required: true, span: 8 },
      { name: 'active', label: 'Ativa', type: 'switch', span: 4 },
      { name: 'document', label: 'CNPJ', type: 'document', span: 4 },
      { name: 'phone', label: 'Telefone', type: 'phone', span: 4 },
      { name: 'city', label: 'Cidade', type: 'text', span: 4 },
      { name: 'address', label: 'Endereço', type: 'text', span: 8 },
      { name: 'managerId', label: 'Responsável', type: 'relation', collection: 'users', span: 4 },
      { name: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
    ],
  }
  return <CrudPage config={config} />
}

function UsersView() {
  const { user: me } = useAuth()
  const isAdmin = me?.role === 'admin'

  const config: CrudConfig = {
    collection: 'users',
    module: 'team',
    title: 'Equipe',
    subtitle: 'Usuários do sistema, funções e permissões por módulo.',
    singular: 'usuário',
    icon: <GroupsIcon />,
    initialSort: { key: 'name', dir: 'asc' },
    canDelete: false,
    dialogWidth: 'md',
    defaults: () => ({ role: 'producao', active: true, extraModules: [], deniedModules: [] }),
    lookups: ['units'],
    searchText: (r) => [r.name, r.email, r.position, r.phone],
    filters: [
      { name: 'role', label: 'Função', options: roleOptions, get: (r) => r.role },
      { name: 'active', label: 'Situação', options: [{ value: 'true', label: 'Ativos' }, { value: 'false', label: 'Inativos' }], get: (r) => String(r.active !== false) },
    ],
    stats: (rows) => [
      { label: 'Usuários', value: rows.length, icon: <GroupsIcon /> },
      { label: 'Ativos', value: rows.filter((r) => r.active !== false).length, tone: 'success' },
      { label: 'Administradores', value: rows.filter((r) => r.role === 'admin').length, tone: 'brand' },
      { label: 'Custo/hora médio', value: brl(rows.filter((r) => r.hourlyCost).reduce((s, r, _i, a) => s + (r.hourlyCost ?? 0) / a.length, 0)) },
    ],
    columns: () => [
      {
        key: 'name',
        header: 'Usuário',
        sort: (r) => r.name,
        render: (r) => (
          <Stack direction="row" spacing={1.25} alignItems="center">
            <UserAvatar user={r as unknown as User} size={34} />
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {r.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {r.email}
              </Typography>
            </Box>
          </Stack>
        ),
      },
      { key: 'role', header: 'Função', sort: (r) => r.role, render: (r) => ROLES[r.role as RoleKey] ?? r.role },
      { key: 'unit', header: 'Empresa / unidade', hideBelow: 'md', render: (r, ) => (r.unitId ? '—' : '—') },
      { key: 'position', header: 'Cargo', hideBelow: 'md', render: (r) => r.position || '—' },
      { key: 'cost', header: 'Custo/hora', align: 'right', hideBelow: 'lg', sort: (r) => r.hourlyCost, render: (r) => (r.hourlyCost ? brl(r.hourlyCost) : '—') },
      { key: 'login', header: 'Último acesso', hideBelow: 'lg', sort: (r) => r.lastLoginAt, render: (r) => (r.lastLoginAt ? fmtRelative(r.lastLoginAt) : 'Nunca') },
      { key: 'active', header: 'Situação', render: (r) => <StatusChip options={[{ value: 'true', label: 'Ativo', color: '#2e7d4f' }, { value: 'false', label: 'Inativo', color: '#7d838c' }]} value={String(r.active !== false)} /> },
    ],
    fields: [
      { name: 'name', label: 'Nome completo', type: 'text', required: true, span: 8 },
      { name: 'active', label: 'Acesso ativo', type: 'switch', span: 4 },
      { name: 'email', label: 'E-mail (login)', type: 'email', required: true, span: 6 },
      { name: 'role', label: 'Função no sistema', type: 'select', options: roleOptions.filter((o) => isAdmin || o.value !== 'admin'), required: true, span: 6 },
      { name: 'password', label: 'Senha', type: 'password', span: 6, helper: 'Mínimo 8 caracteres. Em edição, preencha apenas para redefinir (o usuário deverá trocá-la).' },
      { name: 'position', label: 'Cargo', type: 'text', span: 6 },
      { name: 'phone', label: 'Telefone', type: 'phone', span: 4 },
      { name: 'hourlyCost', label: 'Custo por hora (R$)', type: 'money', span: 4 },
      { name: 'admissionDate', label: 'Admissão', type: 'date', span: 4 },
      { name: 'workSchedule', label: 'Jornada', type: 'text', span: 12, placeholder: 'Ex.: Seg a sex, 07:30–17:30 (1h de intervalo)' },
      { name: 'notes', label: 'Observações', type: 'textarea', rows: 2 },
    ],
    beforeSave: (v, mode) => {
      const out = { ...v }
      if (!out.password) delete out.password
      if (mode === 'create' && !out.password) throw new Error('Defina uma senha inicial para o novo usuário.')
      return out
    },
    renderExtra: ({ values, set }) => {
      const base = ROLE_DEFAULT_MODULES[values.role as RoleKey] ?? []
      const extra: ModuleKey[] = values.extraModules ?? []
      const denied: ModuleKey[] = values.deniedModules ?? []
      const keys = Object.keys(MODULES) as ModuleKey[]
      return (
        <Box>
          <Box sx={{ mb: 3 }}>
            <PhotoUpload user={{ id: values.id ?? 'novo', name: values.name || 'Novo usuário', color: values.color }} photoFileId={values.photoFileId} onChange={(id) => set('photoFileId', id)} />
          </Box>
          <Typography variant="overline" color="primary" sx={{ display: 'block', mb: 0.5 }}>
            Permissões por módulo
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
            Os módulos marcados já vêm da função “{ROLES[values.role as RoleKey]}”. Marque módulos adicionais ou revogue acessos específicos.
          </Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' }, gap: 0.25, p: 1.5, border: `1px solid ${colors.border}`, borderRadius: 2 }}>
            {keys.map((k) => {
              const fromRole = base.includes(k)
              const effective = (fromRole && !denied.includes(k)) || extra.includes(k)
              return (
                <FormControlLabel
                  key={k}
                  control={
                    <Checkbox
                      size="small"
                      checked={effective}
                      disabled={values.role === 'admin' || k === 'dashboard'}
                      onChange={(e) => {
                        const on = e.target.checked
                        if (fromRole) set('deniedModules', on ? denied.filter((d) => d !== k) : [...denied, k])
                        else set('extraModules', on ? [...extra, k] : extra.filter((d) => d !== k))
                      }}
                    />
                  }
                  label={<Typography variant="body2">{MODULES[k]}</Typography>}
                />
              )
            })}
          </Box>
          {values.admissionDate ? (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Na empresa desde {fmtDate(values.admissionDate)}.
            </Typography>
          ) : null}
        </Box>
      )
    },
  }
  return <CrudPage config={config} />
}
