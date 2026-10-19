import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Button, IconButton, Paper, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material'
import { Stack } from '../../components/Stack'
import { AddIcon, ArticleIcon, DeleteIcon, PushPinIcon } from '../../components/icons'
import { EmptyState } from '../../components/ui'
import { Markdown } from '../../components/Markdown'
import { useConfirm } from '../../components/feedback'
import { useAuth } from '../../auth/AuthContext'
import { createDoc, removeDoc, updateDoc, useCollection } from '../../lib/store'
import { fmtRelative } from '../../lib/format'
import { colors } from '../../theme'
import { useWorkspace } from './useWorkspace'

const TEMPLATES: { title: string; body: string }[] = [
  {
    title: 'Briefing do cliente',
    body: '# Briefing\n\n## Ambientes\n- [ ] Cozinha\n- [ ] Sala\n\n## Referências e estilo\n\n## Materiais preferidos\n\n## Restrições (prazo, orçamento, obra)\n',
  },
  {
    title: 'Ata de reunião',
    body: '# Ata de reunião\n\n**Data:**  \n**Participantes:**  \n\n## Pauta\n\n## Decisões\n- \n\n## Próximos passos\n- [ ] \n',
  },
  {
    title: 'Checklist de instalação',
    body: '# Checklist de instalação\n\n- [ ] Local liberado e limpo\n- [ ] Pontos elétricos e hidráulicos conferidos\n- [ ] Peças conferidas com a lista de corte\n- [ ] Ferragens e acessórios separados\n- [ ] Fotos antes/depois\n- [ ] Termo de aceite assinado\n',
  },
]

/** Documentos do projeto (briefing, atas, especificações) em Markdown, com pré-visualização e salvamento automático. */
export function DocsView() {
  const ws = useWorkspace()
  const { user } = useAuth()
  const confirm = useConfirm()
  const docs = useCollection('projectDocs')
  const mine = useMemo(
    () => docs.items.filter((d) => d.projectId === ws.project.id).sort((a, b) => Number(b.pinned ?? false) - Number(a.pinned ?? false) || b.updatedAt.localeCompare(a.updatedAt)),
    [docs.items, ws.project.id],
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')
  const active = mine.find((d) => d.id === activeId) ?? mine[0]
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const loaded = useRef<string | null>(null)

  // carrega o documento ativo no editor (uma vez por troca)
  useEffect(() => {
    if (active && loaded.current !== active.id) {
      loaded.current = active.id
      setTitle(active.title)
      setBody(active.body)
    }
    if (!active) loaded.current = null
  }, [active])

  // salvamento automático
  useEffect(() => {
    if (!active || loaded.current !== active.id) return
    if (title === active.title && body === active.body) return
    const t = window.setTimeout(() => {
      void updateDoc('projectDocs', active.id, { title: title.trim() || 'Sem título', body, updatedByName: user?.name })
    }, 700)
    return () => window.clearTimeout(t)
  }, [title, body, active, user?.name])

  const create = async (tpl?: { title: string; body: string }) => {
    const doc = await createDoc('projectDocs', { projectId: ws.project.id, title: tpl?.title ?? 'Novo documento', body: tpl?.body ?? '', updatedByName: user?.name })
    loaded.current = null
    setActiveId(doc.id)
    setMode('edit')
  }

  const wrap = (before: string, after = before) => setBody((b) => `${b}${b && !b.endsWith('\n') ? '\n' : ''}${before}texto${after}`)
  const toggleLine = (idx: number) =>
    setBody((b) => {
      const lines = b.split('\n')
      lines[idx] = /\[( )\]/.test(lines[idx]) ? lines[idx].replace('[ ]', '[x]') : lines[idx].replace(/\[(x|X)\]/, '[ ]')
      return lines.join('\n')
    })

  if (!mine.length)
    return (
      <Paper variant="outlined" sx={{ borderRadius: 3 }}>
        <EmptyState
          icon={<ArticleIcon />}
          title="Nenhum documento neste projeto"
          description="Registre briefing, atas de reunião, medidas e combinados com o cliente em um só lugar."
          action={
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', justifyContent: 'center' }}>
              <Button variant="contained" startIcon={<AddIcon />} onClick={() => create()}>
                Documento em branco
              </Button>
              {TEMPLATES.map((t) => (
                <Button key={t.title} variant="outlined" onClick={() => create(t)}>
                  {t.title}
                </Button>
              ))}
            </Stack>
          }
        />
      </Paper>
    )

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '260px 1fr' }, gap: 2, alignItems: 'start' }}>
      <Paper variant="outlined" sx={{ borderRadius: 3, p: 1 }}>
        <Button fullWidth size="small" startIcon={<AddIcon />} onClick={() => create()} sx={{ mb: 0.5 }}>
          Novo documento
        </Button>
        {mine.map((d) => (
          <Box
            key={d.id}
            onClick={() => {
              loaded.current = null
              setActiveId(d.id)
            }}
            sx={{
              p: 1,
              borderRadius: 2,
              cursor: 'pointer',
              bgcolor: d.id === active?.id ? colors.brandTint : 'transparent',
              '&:hover': { bgcolor: d.id === active?.id ? colors.brandTint : colors.subtle },
            }}
          >
            <Stack direction="row" spacing={0.75} alignItems="center">
              {d.pinned ? <PushPinIcon sx={{ fontSize: 14, color: colors.brand }} /> : <ArticleIcon sx={{ fontSize: 16, color: colors.textMuted }} />}
              <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
                {d.title}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {fmtRelative(d.updatedAt)}
              {d.updatedByName ? ` · ${d.updatedByName}` : ''}
            </Typography>
          </Box>
        ))}
      </Paper>

      {active ? (
        <Paper variant="outlined" sx={{ borderRadius: 3, p: 2.5, minHeight: 420 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <TextField value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Título" slotProps={{ input: { sx: { fontSize: 20, fontWeight: 700 } } }} />
            <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
              <ToggleButton value="edit">Editar</ToggleButton>
              <ToggleButton value="preview">Visualizar</ToggleButton>
            </ToggleButtonGroup>
            <Tooltip title={active.pinned ? 'Desafixar' : 'Fixar no topo'}>
              <IconButton onClick={() => updateDoc('projectDocs', active.id, { pinned: !active.pinned })} aria-label="Fixar documento">
                <PushPinIcon fontSize="small" sx={{ color: active.pinned ? colors.brand : undefined }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Excluir documento">
              <IconButton
                aria-label="Excluir documento"
                onClick={async () => {
                  if (await confirm({ title: 'Excluir documento?', message: active.title, confirmLabel: 'Excluir', danger: true })) {
                    loaded.current = null
                    setActiveId(null)
                    await removeDoc('projectDocs', active.id)
                  }
                }}
              >
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Stack>
          {mode === 'edit' ? (
            <>
              <Stack direction="row" spacing={0.5} sx={{ mb: 1, flexWrap: 'wrap' }}>
                <Button size="small" color="inherit" onClick={() => setBody((b) => `${b}${b && !b.endsWith('\n') ? '\n' : ''}## Título\n`)}>
                  Título
                </Button>
                <Button size="small" color="inherit" onClick={() => wrap('**')}>
                  Negrito
                </Button>
                <Button size="small" color="inherit" onClick={() => wrap('*')}>
                  Itálico
                </Button>
                <Button size="small" color="inherit" onClick={() => setBody((b) => `${b}${b && !b.endsWith('\n') ? '\n' : ''}- item\n`)}>
                  Lista
                </Button>
                <Button size="small" color="inherit" onClick={() => setBody((b) => `${b}${b && !b.endsWith('\n') ? '\n' : ''}- [ ] tarefa\n`)}>
                  Checklist
                </Button>
                <Button size="small" color="inherit" onClick={() => setBody((b) => `${b}${b && !b.endsWith('\n') ? '\n' : ''}> citação\n`)}>
                  Citação
                </Button>
              </Stack>
              <TextField multiline minRows={16} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Escreva em Markdown: # título, **negrito**, - lista, - [ ] tarefa…" />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                Salvo automaticamente.
              </Typography>
            </>
          ) : (
            <Markdown source={body} onToggle={toggleLine} />
          )}
        </Paper>
      ) : null}
    </Box>
  )
}
