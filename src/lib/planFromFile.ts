import { createDoc, getCollectionSnapshot, loadCollection } from './store'
import { fileUrl } from './api'
import { DEFAULT_GCODE } from '../domain/cutPlan'
import { autoMapEdge, autoMapMaterials, isPromobFile, parsePromobFiles, toCutPieces, FORMAT_LABEL } from '../domain/promob'
import type { CutPlan, Material } from '../types'

export { isPromobFile }

interface Origin {
  fileId: string
  fileName: string
  projectId: string
  taskId?: string
  taskTitle?: string
  responsibleId?: string
}

/**
 * Lê um arquivo do Promob (CSV/XML/DXF/DXT) anexado a uma tarefa e cria um plano de corte em rascunho
 * vinculado ao projeto, com as peças, fitas, usinagens e materiais já mapeados ao estoque quando há
 * correspondência. O plano fica marcado para revisão no módulo Plano de corte.
 * Devolve null quando o arquivo não contém peças de corte.
 */
export async function createPlanFromBytes(bytes: Uint8Array, o: Origin): Promise<CutPlan | null> {
  const imp = parsePromobFiles([{ name: o.fileName, bytes }])
  if (!imp.parts.length) return null
  await loadCollection('materials')
  const stock: Material[] = getCollectionSnapshot('materials')
  const matMap = autoMapMaterials(imp.parts, stock)
  const pieces = toCutPieces(imp.parts, matMap)
  const edgeMaterialId = autoMapEdge(imp.parts, stock)
  const defaultMaterialId = Object.values(matMap).find(Boolean)
  const unmapped = Object.values(matMap).filter((v) => !v).length
  const notes = [
    `Criado automaticamente do arquivo ${o.fileName} anexado${o.taskTitle ? ` à tarefa "${o.taskTitle}"` : ''}.`,
    unmapped ? `${unmapped} material(is) do arquivo sem chapa correspondente no estoque — defina a chapa das peças antes de calcular.` : '',
    ...imp.warnings.slice(0, 4),
  ]
    .filter(Boolean)
    .join('\n')
  const hardware = imp.hardware.map((h, i) => ({ id: `h${Date.now().toString(36)}${i}`, description: h.description, quantity: Math.ceil(h.quantity), unitCost: 0 }))
  const payload: Partial<CutPlan> = {
    title: `Plano — ${o.fileName.replace(/\.[^.]+$/, '')}`,
    status: 'rascunho',
    projectId: o.projectId,
    responsibleId: o.responsibleId,
    mode: 'seccionadora',
    kerf: 3,
    trim: 10,
    defaultMaterialId,
    edgeMaterialId,
    pieces,
    hardware,
    groups: [],
    costs: { sheets: 0, edge: 0, hardware: 0, machining: 0, total: 0, edgeMeters: 0, holes: 0, grooves: 0, minutes: 0 },
    utilization: 0,
    gcode: DEFAULT_GCODE,
    notes,
    taskId: o.taskId,
    pendingReview: true,
    imports: [{ fileName: o.fileName, format: FORMAT_LABEL[imp.format], at: new Date().toISOString(), parts: pieces.length, fileId: o.fileId }],
  }
  return createDoc('cutPlans', payload)
}

/** Baixa um arquivo já enviado ao sistema e cria o plano de corte a partir dele. */
export async function createPlanFromStoredFile(o: Origin): Promise<CutPlan | null> {
  const res = await fetch(fileUrl(o.fileId))
  if (!res.ok) throw new Error('Não foi possível baixar o arquivo.')
  return createPlanFromBytes(new Uint8Array(await res.arrayBuffer()), o)
}
