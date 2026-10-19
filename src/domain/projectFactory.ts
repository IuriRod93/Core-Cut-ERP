import { createDoc } from '../lib/store'
import { PROJECT_TEMPLATES, buildTemplateTasks } from './tasks'
import { todayISO, uid } from '../lib/format'
import type { ProductionOrder, Project, WorkCenter } from '../types'

/** Cria o projeto e, a partir do modelo escolhido, suas listas, tarefas e subtarefas. */
export async function createProjectFromTemplate(data: Partial<Project>, templateId: string, options: { workCenters?: WorkCenter[] } = {}) {
  const created = await createDoc('projects', { archived: false, ...data })
  const template = PROJECT_TEMPLATES.find((t) => t.id === templateId) ?? PROJECT_TEMPLATES[PROJECT_TEMPLATES.length - 1]
  const start = data.startDate || todayISO()
  for (const group of buildTemplateTasks(template, start)) {
    const list = await createDoc('taskLists', { projectId: created.id, name: group.list.name, color: group.list.color, order: group.list.order })
    for (const t of group.tasks) {
      const parent = await createDoc('tasks', {
        projectId: created.id,
        listId: list.id,
        parentId: null,
        title: t.title,
        status: 'todo',
        priority: t.priority as 'normal',
        assigneeIds: [],
        startDate: t.startDate,
        dueDate: t.dueDate,
        estimateMinutes: t.estimateMinutes,
        order: t.order,
        tags: [],
        checklists: [],
      })
      for (const [si, sub] of t.subtasks.entries()) {
        await createDoc('tasks', {
          projectId: created.id,
          listId: list.id,
          parentId: parent.id,
          title: sub.text,
          status: 'todo',
          priority: 'normal',
          assigneeIds: [],
          dueDate: t.dueDate,
          order: (si + 1) * 1000,
          tags: [],
          checklists: [],
        })
      }
    }
  }

  // Com o módulo de produção configurado, o projeto já nasce com uma ordem em planejamento.
  // O responsável libera a ordem quando engenharia e materiais estiverem prontos; as etapas
  // aparecem no Chão de fábrica após a liberação e são espelhadas como tarefas do projeto.
  const workCenters = (options.workCenters ?? []).filter((center) => center.active).sort((a, b) => a.order - b.order)
  let productionOrder: ProductionOrder | undefined
  let productionError: string | undefined
  if (workCenters.length) {
    try {
      productionOrder = await createDoc('productionOrders', {
        title: `Produção — ${created.name}`,
        projectId: created.id,
        clientId: created.clientId,
        status: 'planejada',
        priority: created.priority ?? 'media',
        startDate: start,
        dueDate: created.dueDate,
        items: [],
        operations: workCenters.map((center, index) => ({
          id: uid(),
          workCenterId: center.id,
          name: center.name,
          order: index + 1,
          plannedMinutes: 0,
          actualSeconds: 0,
          status: 'pendente' as const,
          quantityDone: 0,
        })),
        materialsPosted: false,
        cutPlanIds: [],
        notes: 'Ordem inicial criada junto com o projeto. Complete os itens e libere quando estiver pronto para produção.',
      })
    } catch (error) {
      productionError = error instanceof Error ? error.message : 'Não foi possível iniciar a ordem de produção.'
    }
  }

  return { project: created, template, productionOrder, productionError }
}
