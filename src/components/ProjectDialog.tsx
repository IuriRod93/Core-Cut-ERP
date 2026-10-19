import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Box, MenuItem, TextField, Typography } from '@mui/material'
import { FormDialog, type FieldDef } from './forms'
import { useToast } from './feedback'
import { getCollectionSnapshot, refreshCollection, updateDoc, useCollection, useProjectStages } from '../lib/store'
import { createProjectFromTemplate } from '../domain/projectFactory'
import { ENVIRONMENTS, PROJECT_PRIORITIES } from '../domain/constants'
import { PROJECT_TEMPLATES } from '../domain/tasks'
import { todayISO, addDaysISO } from '../lib/format'
import { useAuth } from '../auth/AuthContext'
import type { Project } from '../types'

export function ProjectDialog({ open, project, initialStageId, onClose }: { open: boolean; project?: Project | null; initialStageId?: string; onClose: () => void }) {
  const stages = useProjectStages()
  const { user, can } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const clients = useCollection('clients')
  void clients

  const fields = useMemo<FieldDef[]>(
    () => [
      { name: 'name', label: 'Nome do projeto', type: 'text', required: true, span: 8, placeholder: 'Ex.: Cozinha planejada — Residência Silva' },
      { name: 'clientId', label: 'Cliente', type: 'relation', collection: 'clients', span: 4 },
      { name: 'environment', label: 'Ambiente', type: 'select', options: ENVIRONMENTS, span: 4 },
      { name: 'stageId', label: 'Etapa do portfólio', type: 'select', options: stages.map((s) => ({ value: s.id, label: s.label })), required: true, span: 4 },
      { name: 'priority', label: 'Prioridade', type: 'select', options: PROJECT_PRIORITIES, required: true, span: 4 },
      { name: 'managerId', label: 'Responsável', type: 'relation', collection: 'users', span: 6 },
      { name: 'startDate', label: 'Início', type: 'date', span: 3 },
      { name: 'dueDate', label: 'Entrega prevista', type: 'date', span: 3 },
      { name: 'contractValue', label: 'Valor do contrato', type: 'money', span: 3 },
      { name: 'estimatedCost', label: 'Custo previsto', type: 'money', span: 3 },
      { name: 'memberIds', label: 'Equipe do projeto', type: 'relations', collection: 'users' },
      { name: 'address', label: 'Local da obra / instalação', type: 'text', span: 12 },
      { name: 'tags', label: 'Etiquetas', type: 'tags' },
      { name: 'description', label: 'Escopo e observações', type: 'textarea', rows: 3 },
    ],
    [stages],
  )

  const initial = project
    ? { ...project }
    : {
        stageId: initialStageId ?? stages[0]?.id ?? 'briefing',
        priority: 'media',
        managerId: user?.id,
        startDate: todayISO(),
        dueDate: addDaysISO(todayISO(), 45),
        clientId: params.get('cliente') ?? undefined,
        memberIds: [],
        tags: [],
        _template: 'ambiente',
      }

  return (
    <FormDialog
      open={open}
      title={project ? 'Editar projeto' : 'Novo projeto'}
      subtitle={project?.code}
      fields={fields}
      initial={initial}
      onClose={onClose}
      saveLabel={project ? 'Salvar' : 'Criar projeto'}
      maxWidth="md"
      onSave={async (values) => {
        const { _template, id: _id, createdAt: _c, updatedAt: _u, ...data } = values
        void _id
        void _c
        void _u
        if (project) {
          const stageMoved = data.stageId && data.stageId !== project.stageId
          await updateDoc('projects', project.id, { ...(data as Partial<Project>), ...(stageMoved ? { stageChangedAt: new Date().toISOString() } : {}) })
          toast.success('Projeto atualizado.')
          return
        }
        const productionEnabled = can('production')
        if (productionEnabled) await refreshCollection('workCenters')
        const { project: created, template, productionOrder, productionError } = await createProjectFromTemplate(
          { ...(data as Partial<Project>), stageChangedAt: new Date().toISOString() },
          String(_template ?? 'ambiente'),
          { workCenters: productionEnabled ? getCollectionSnapshot('workCenters') : [] },
        )
        toast.success(`Projeto ${created.code ?? ''} criado com o modelo “${template.label}”.${productionOrder ? ` Ordem ${productionOrder.code} criada em planejamento.` : ''}`)
        if (productionEnabled && !productionOrder && productionError) toast.warning(`Projeto criado, mas a ordem de produção não foi iniciada: ${productionError}`)
        else if (productionEnabled && !productionOrder) toast.warning('Projeto criado. Cadastre ao menos um setor ativo em Produção para iniciar a ordem de fábrica.')
        navigate(`/projetos/${created.id}`)
      }}
    >
      {({ values, set }) =>
        project ? null : (
          <Box>
            <Typography variant="overline" color="primary" sx={{ display: 'block', mb: 1 }}>
              Modelo de projeto
            </Typography>
            <TextField select value={values._template ?? 'ambiente'} onChange={(e) => set('_template', e.target.value)}>
              {PROJECT_TEMPLATES.map((t) => (
                <MenuItem key={t.id} value={t.id}>
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {t.label}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t.description}
                    </Typography>
                  </Box>
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.75, display: 'block' }}>
              As listas, tarefas, prazos e estimativas do modelo são criados automaticamente a partir da data de início.
            </Typography>
          </Box>
        )
      }
    </FormDialog>
  )
}
