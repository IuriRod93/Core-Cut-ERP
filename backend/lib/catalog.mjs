import { existsSync, readFileSync, statSync } from 'node:fs'

const strip = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Catálogo da Leo Madeiras mantido em memória, com busca sem acentos. */
export class LeoCatalog {
  constructor(file) {
    this.file = file
    this.items = []
    this.meta = { supplier: 'Leo Madeiras', currency: 'BRL', generatedAt: null, summary: {} }
    this.mtime = 0
    this.reload()
  }

  reload() {
    if (!existsSync(this.file)) {
      this.items = []
      return false
    }
    const raw = JSON.parse(readFileSync(this.file, 'utf8'))
    this.items = (raw.items ?? []).map((item) => ({
      ...item,
      _s: strip(`${item.code} ${item.name} ${item.brand ?? ''} ${item.category}`),
    }))
    this.byId = new Map(this.items.map((i) => [i.id, i]))
    this.byCode = new Map(this.items.map((i) => [i.code, i]))
    this.meta = { supplier: raw.supplier, currency: raw.currency, generatedAt: raw.generatedAt, summary: raw.summary ?? {} }
    this.mtime = statSync(this.file).mtimeMs
    return true
  }

  facets() {
    const kinds = {}
    const brands = new Set()
    const thickness = new Set()
    for (const i of this.items) {
      const k = (kinds[i.kind] ??= { total: 0, priced: 0, categories: {} })
      k.total += 1
      if (i.price !== null) k.priced += 1
      k.categories[i.category] = (k.categories[i.category] ?? 0) + 1
      if (i.brand) brands.add(i.brand)
      if (i.kind === 'chapa' && i.thickness) thickness.add(i.thickness)
    }
    return {
      ...this.meta,
      total: this.items.length,
      kinds,
      brands: [...brands].sort((a, b) => a.localeCompare(b, 'pt-BR')),
      thickness: [...thickness].sort((a, b) => a - b),
    }
  }

  search({ q = '', kind, category, brand, priced, thickness, sort = 'name', page = 1, pageSize = 40 }) {
    const tokens = strip(q).split(/\s+/).filter(Boolean)
    let rows = this.items.filter((i) => {
      if (kind && i.kind !== kind) return false
      if (category && i.category !== category) return false
      if (brand && i.brand !== brand) return false
      if (priced === '1' && i.price === null) return false
      if (thickness && Number(i.thickness) !== Number(thickness)) return false
      return tokens.every((t) => i._s.includes(t))
    })
    const byName = (a, b) => a.name.localeCompare(b.name, 'pt-BR')
    if (sort === 'price_asc') rows.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity) || byName(a, b))
    else if (sort === 'price_desc') rows.sort((a, b) => (b.price ?? -1) - (a.price ?? -1) || byName(a, b))
    else rows.sort(byName)
    const total = rows.length
    const size = Math.min(Math.max(Number(pageSize) || 40, 1), 200)
    const current = Math.max(Number(page) || 1, 1)
    rows = rows.slice((current - 1) * size, current * size)
    return { total, page: current, pageSize: size, items: rows.map(({ _s, ...rest }) => rest) }
  }

  find(id) {
    const hit = this.byId?.get(id)
    if (!hit) return null
    const { _s, ...rest } = hit
    return rest
  }
}
