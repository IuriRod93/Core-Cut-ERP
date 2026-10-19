import type { CollectionName } from '../types'

type AnyDoc = Record<string, unknown> & { id: string }

const s = (v: unknown) => (v === undefined || v === null ? '' : String(v))

// Texto exibido para um registro quando ele aparece como referência em outro.
export function relationLabel(collection: CollectionName, doc: AnyDoc): string {
  switch (collection) {
    case 'projects':
      return `${s(doc.code)} · ${s(doc.name)}`.replace(/^ · /, '')
    case 'productionOrders':
      return `${s(doc.code)} · ${s(doc.title)}`.replace(/^ · /, '')
    case 'budgets':
      return `${s(doc.code)} · ${s(doc.title)}`.replace(/^ · /, '')
    case 'contracts':
      return `${s(doc.code)} · ${s(doc.title)}`.replace(/^ · /, '')
    case 'purchases':
      return s(doc.code)
    case 'materials':
      return s(doc.name)
    case 'vehicles':
      return `${s(doc.plate)} · ${s(doc.model)}`
    case 'workCenters':
      return s(doc.name)
    case 'tasks':
    case 'qualityRecords':
    case 'warranties':
    case 'cutPlans':
      return s(doc.title ?? doc.name)
    default:
      return s(doc.name ?? doc.title ?? doc.code ?? doc.id)
  }
}

export function relationHint(collection: CollectionName, doc: AnyDoc): string {
  switch (collection) {
    case 'materials':
      return [s(doc.code), s(doc.brand)].filter(Boolean).join(' · ')
    case 'clients':
      return s(doc.document)
    case 'users':
      return s(doc.position)
    default:
      return ''
  }
}
