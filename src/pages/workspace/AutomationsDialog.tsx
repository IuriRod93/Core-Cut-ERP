import { useState } from 'react'
import { Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, Paper, Switch, TextField, Typography } from '@mui/material'
import { Stack } from '../../components/Stack'
import { AddIcon, BoltIcon, CloseIcon, DeleteIcon } from '../../components/icons'
import { updateDoc } from '../../lib/store'
import { uid } from '../../lib/format'
import { TASK_PRIORITIES } from '../../domain/constants'
import { automationTemplates, describeAction, describeTrigger } from '../../domain/automations'
import { colors } from '../../theme'
import { useWorkspace } from './useWorkspace'
import type { Automation, AutomationAction, AutomationTrigger } from '../../types'

const TRIGGERS: { value: AutomationTrigger['type']; label: string }[] = [
  { value: 'status_changed', label: 'O status mudar para…' },
  { value: 'task_created', label: 'Uma tarefa for criada' },
  { value: 'assigned', label: 'Alguém for atribuído' },
  { value: 'priority_changed', label: 'A prioridade mudar para…' },
  { value: 'due_in', label: 'Faltarem N dias para a entrega' },
  { value: 'overdue', label: 'Estiver atrasada há N dias' },
]

const ACTIONS: { value: AutomationAction['type']; label: string }[] = [
  { value: 'set_status', label: 'Mudar o status' },
  { value: 'assign', label: 'Atribuir a uma pessoa' },
  { value: 'set_priority', label: 'Definir a prioridade' },
  { value: 'add_tag', label: 'Adicionar etiqueta' },
  { value: 'move_list', label: 'Mover para uma lista' },
  { value: 'set_due_in', label: 'Definir a entrega (dias a partir de hoje)' },
  { value: 'comment', label: 'Comentar na tarefa' },
  { value: 'create_subtasks', label: 'Criar subtarefas' },
]

/** Automações do projeto no estilo “quando … então …”: executam ao criar tarefas e ao mudar status, responsável ou prioridade. */
export function AutomationsDialog({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace()
  const [rules, setRules] = useState<Automation[]>(ws.project.automations ?? [])
  const [editing, setEditing] = useState<Automation | null>(null)
  const ctx = { statuses: ws.statuses, lists: ws.lists, userName: (id: string) => ws.userMap.get(id)?.name ?? '—' }

  const persist = async (next: Automation[]) => {
    setRules(next)
    await updateDoc('projects', ws.project.id, { automations: next })
  }

  const blank = (): Automation => ({
    id: uid(),
    name: 'Nova automação',
    enabled: true,
    trigger: { type: 'status_changed', statusId: ws.statuses.find((s) => s.type === 'active')?.id ?? ws.statuses[0].id },
    actions: [{ type: 'comment', text: '' }],
  })

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Automações do projeto</DialogTitle>
      <DialogContent>
        {editing ? (
          <RuleEditor
            rule={editing}
            onCancel={() => setEditing(null)}
            onSave={async (r) => {
              await persist(rules.some((x) => x.id === r.id) ? rules.map((x) => (x.id === r.id ? r : x)) : [...rules, r])
              setEditing(null)
            }}
          />
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Regras que trabalham por você: ao mudar o status, atribuir alguém ou criar uma tarefa, o sistema aplica as ações abaixo e registra no histórico da tarefa.
            </Typography>
            {rules.length === 0 ? (
              <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, textAlign: 'center', mb: 2 }}>
                <BoltIcon sx={{ color: colors.brand }} />
                <Typography variant="body2" color="text.secondary">
                  Nenhuma automação ainda. Crie uma regra ou comece por um modelo.
                </Typography>
              </Paper>
            ) : (
              <Stack spacing={1} sx={{ mb: 2 }}>
                {rules.map((r) => (
                  <Paper key={r.id} variant="outlined" sx={{ p: 1.5, borderRadius: 3 }}>
                    <Stack direction="row" spacing={1.5} alignItems="center">
                      <Switch checked={r.enabled} onChange={(e) => persist(rules.map((x) => (x.id === r.id ? { ...x, enabled: e.target.checked } : x)))} />
                      <Box sx={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => setEditing(r)}>
                        <Typography variant="subtitle2">{r.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          Quando {describeTrigger(r.trigger, ctx)} → {r.actions.map((a) => describeAction(a, ctx)).join('; ')}
                        </Typography>
                      </Box>
                      <IconButton aria-label="Excluir automação" onClick={() => persist(rules.filter((x) => x.id !== r.id))}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
            )}
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditing(blank())}>
                Nova automação
              </Button>
              {automationTemplates(ws.statuses).map((t) => (
                <Chip key={t.name} label={`+ ${t.name}`} variant="outlined" onClick={() => persist([...rules, { ...t, id: uid() }])} />
              ))}
            </Stack>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  )
}

function RuleEditor({ rule, onSave, onCancel }: { rule: Automation; onSave: (r: Automation) => void; onCancel: () => void }) {
  const ws = useWorkspace()
  const [r, setR] = useState<Automation>(rule)
  const setTrigger = (type: AutomationTrigger['type']) => {
    const t: AutomationTrigger =
      type === 'status_changed'
        ? { type, statusId: ws.statuses[0].id }
        : type === 'task_created'
          ? { type }
          : type === 'assigned'
            ? { type }
            : type === 'due_in'
              ? { type, days: 1 }
              : type === 'overdue'
                ? { type, days: 1 }
                : { type: 'priority_changed', priority: 'alta' }
    setR((x) => ({ ...x, trigger: t }))
  }
  const setAction = (i: number, type: AutomationAction['type']) => {
    const a: AutomationAction =
      type === 'set_status'
        ? { type, statusId: ws.statuses[0].id }
        : type === 'assign'
          ? { type, userId: ws.users[0]?.id ?? '' }
          : type === 'set_priority'
            ? { type, priority: 'alta' }
            : type === 'add_tag'
              ? { type, tag: '' }
              : type === 'move_list'
                ? { type, listId: ws.lists[0]?.id ?? '' }
                : type === 'set_due_in'
                  ? { type, days: 3 }
                  : type === 'comment'
                    ? { type, text: '' }
                    : { type: 'create_subtasks', titles: [] }
    setR((x) => ({ ...x, actions: x.actions.map((y, j) => (j === i ? a : y)) }))
  }
  const patchAction = (i: number, patch: Partial<AutomationAction>) => setR((x) => ({ ...x, actions: x.actions.map((y, j) => (j === i ? ({ ...y, ...patch } as AutomationAction) : y)) }))
  const t = r.trigger

  return (
    <Stack spacing={2}>
      <TextField label="Nome da regra" value={r.name} onChange={(e) => setR({ ...r, name: e.target.value })} />
      <Box>
        <Typography variant="overline" color="primary">
          Quando
        </Typography>
        <Stack direction="row" spacing={1}>
          <TextField select value={t.type} onChange={(e) => setTrigger(e.target.value as AutomationTrigger['type'])} sx={{ minWidth: 260 }}>
            {TRIGGERS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </TextField>
          {t.type === 'status_changed' ? (
            <TextField select value={t.statusId} onChange={(e) => setR({ ...r, trigger: { type: 'status_changed', statusId: e.target.value } })} sx={{ minWidth: 200 }}>
              {ws.statuses.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.label}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {t.type === 'task_created' ? (
            <TextField select value={t.listId ?? ''} onChange={(e) => setR({ ...r, trigger: { type: 'task_created', listId: e.target.value || undefined } })} sx={{ minWidth: 220 }}>
              <MenuItem value="">Em qualquer lista</MenuItem>
              {ws.lists.map((l) => (
                <MenuItem key={l.id} value={l.id}>
                  {l.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {t.type === 'assigned' ? (
            <TextField select value={t.userId ?? ''} onChange={(e) => setR({ ...r, trigger: { type: 'assigned', userId: e.target.value || undefined } })} sx={{ minWidth: 220 }}>
              <MenuItem value="">Qualquer pessoa</MenuItem>
              {ws.users.map((u) => (
                <MenuItem key={u.id} value={u.id}>
                  {u.name}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          {t.type === 'due_in' || t.type === 'overdue' ? (
            <TextField
              type="number"
              value={t.days}
              onChange={(e) => setR({ ...r, trigger: { type: t.type, days: Math.max(Number(e.target.value) || 0, t.type === 'overdue' ? 1 : 0) } })}
              sx={{ width: { xs: 'calc(50% - 6px)', sm: 120 } }}
              helperText={t.type === 'due_in' ? '0 = no dia' : 'dias de atraso'}
            />
          ) : null}
          {t.type === 'priority_changed' ? (
            <TextField select value={t.priority} onChange={(e) => setR({ ...r, trigger: { type: 'priority_changed', priority: e.target.value } })} sx={{ minWidth: 200 }}>
              {TASK_PRIORITIES.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {p.label}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
        </Stack>
      </Box>

      <Box>
        <Typography variant="overline" color="primary">
          Então
        </Typography>
        <Stack spacing={1}>
          {r.actions.map((a, i) => (
            <Stack key={i} direction="row" spacing={1} alignItems="flex-start">
              <TextField select value={a.type} onChange={(e) => setAction(i, e.target.value as AutomationAction['type'])} sx={{ minWidth: 280 }}>
                {ACTIONS.map((o) => (
                  <MenuItem key={o.value} value={o.value}>
                    {o.label}
                  </MenuItem>
                ))}
              </TextField>
              {a.type === 'set_status' ? (
                <TextField select value={a.statusId} onChange={(e) => patchAction(i, { statusId: e.target.value })} sx={{ minWidth: 200 }}>
                  {ws.statuses.map((s) => (
                    <MenuItem key={s.id} value={s.id}>
                      {s.label}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              {a.type === 'assign' ? (
                <TextField select value={a.userId} onChange={(e) => patchAction(i, { userId: e.target.value })} sx={{ minWidth: 220 }}>
                  {ws.users.map((u) => (
                    <MenuItem key={u.id} value={u.id}>
                      {u.name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              {a.type === 'set_priority' ? (
                <TextField select value={a.priority} onChange={(e) => patchAction(i, { priority: e.target.value })} sx={{ minWidth: 200 }}>
                  {TASK_PRIORITIES.map((p) => (
                    <MenuItem key={p.value} value={p.value}>
                      {p.label}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              {a.type === 'add_tag' ? <TextField placeholder="Etiqueta" value={a.tag} onChange={(e) => patchAction(i, { tag: e.target.value })} /> : null}
              {a.type === 'move_list' ? (
                <TextField select value={a.listId} onChange={(e) => patchAction(i, { listId: e.target.value })} sx={{ minWidth: 220 }}>
                  {ws.lists.map((l) => (
                    <MenuItem key={l.id} value={l.id}>
                      {l.name}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              {a.type === 'set_due_in' ? <TextField type="number" value={a.days} onChange={(e) => patchAction(i, { days: Number(e.target.value) || 0 })} sx={{ width: { xs: 'calc(50% - 6px)', sm: 120 } }} /> : null}
              {a.type === 'comment' ? <TextField placeholder="Texto do comentário" value={a.text} onChange={(e) => patchAction(i, { text: e.target.value })} /> : null}
              {a.type === 'create_subtasks' ? (
                <TextField
                  multiline
                  minRows={2}
                  placeholder="Uma subtarefa por linha"
                  value={a.titles.join('\n')}
                  onChange={(e) => patchAction(i, { titles: e.target.value.split('\n') })}
                />
              ) : null}
              <IconButton aria-label="Remover ação" disabled={r.actions.length <= 1} onClick={() => setR({ ...r, actions: r.actions.filter((_, j) => j !== i) })}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Stack>
          ))}
          <Box>
            <Button size="small" startIcon={<AddIcon />} onClick={() => setR({ ...r, actions: [...r.actions, { type: 'comment', text: '' }] })}>
              Adicionar ação
            </Button>
          </Box>
        </Stack>
      </Box>

      <Stack direction="row" spacing={1} justifyContent="flex-end">
        <Button color="inherit" onClick={onCancel}>
          Voltar
        </Button>
        <Button
          variant="contained"
          disabled={!r.name.trim()}
          onClick={() => onSave({ ...r, actions: r.actions.map((a) => (a.type === 'create_subtasks' ? { ...a, titles: a.titles.map((x) => x.trim()).filter(Boolean) } : a)) })}
        >
          Salvar regra
        </Button>
      </Stack>
    </Stack>
  )
}
