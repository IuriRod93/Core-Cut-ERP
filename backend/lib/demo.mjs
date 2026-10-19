import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { COLLECTIONS } from '../../shared/access.mjs'
import { hashPassword } from './auth.mjs'

const iso = (offsetDays = 0, hour = 12) => {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}
const day = (offset = 0) => iso(offset).slice(0, 10)
const uid = () => randomUUID()

export const DEMO_PASSWORD = 'Demo@2026'

/**
 * Carrega um cenário fictício completo. Todo registro recebe `demo: true`,
 * permitindo remoção segura sem afetar dados reais.
 */
const AVATAR_COLORS = ['#700618', '#a67b52', '#2f6f9f', '#2f8f8a', '#6b5fa8', '#3f7a4f', '#c06a2b', '#4c5a67']

const avatarSvg = (name, color) => {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160"><rect width="160" height="160" fill="${color}"/><circle cx="80" cy="62" r="30" fill="rgba(255,255,255,0.28)"/><path d="M24 160c0-34 25-58 56-58s56 24 56 58z" fill="rgba(255,255,255,0.28)"/><text x="80" y="96" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="46" font-weight="700" fill="#fff">${initials}</text></svg>`
}

export async function loadDemo(db, { catalog, ensureLeoSupplier, materialFromCatalog, filesDir }) {
  const counts = {}
  // O módulo de CAM é TypeScript compartilhado com o frontend; o Node 22+ o importa diretamente.
  let cam = null
  try {
    const [machining, cutting, cutPlan] = await Promise.all([
      import('../../src/domain/machining.ts'),
      import('../../src/domain/cutting.ts'),
      import('../../src/domain/cutPlan.ts'),
    ])
    cam = { ...machining, ...cutting, ...cutPlan }
  } catch {
    cam = null
  }
  const ins = (name, doc) => {
    const rule = COLLECTIONS[name]
    const record = { ...doc, demo: true }
    if (rule?.prefix && !record.code) record.code = db.nextCode(rule.prefix)
    counts[name] = (counts[name] ?? 0) + 1
    return db.insert(name, record)
  }

  // ------------------------------------------------------------- usuários
  const pass = hashPassword(DEMO_PASSWORD)
  const mk = (name, login, role, position, hourlyCost) =>
    ins('users', { name, email: `${login}@arcoplan.com.br`, role, position, hourlyCost, active: true, passwordHash: pass, passwordMustChange: false, admissionDate: day(-400), phone: '(11) 99999-0000' })
  const carlos = mk('Carlos Mendes', 'carlos', 'gerente', 'Gerente industrial', 62)
  const ana = mk('Ana Beatriz Souza', 'ana', 'projetista', 'Projetista de interiores', 48)
  const rafael = mk('Rafael Lima', 'rafael', 'pcp', 'Analista de PCP', 44)
  const joao = mk('João Pereira', 'joao', 'producao', 'Operador de seccionadora', 28)
  const marcos = mk('Marcos Silva', 'marcos', 'producao', 'Montador', 26)
  const luciana = mk('Luciana Costa', 'luciana', 'comercial', 'Consultora comercial', 40)
  const paulo = mk('Paulo Henrique', 'paulo', 'instalador', 'Chefe de instalação', 32)
  const fernanda = mk('Fernanda Rocha', 'fernanda', 'financeiro', 'Analista financeiro', 38)
  const diego = mk('Diego Santos', 'diego', 'suprimentos', 'Comprador', 34)

  // fotos de demonstração (SVG) para a equipe
  ;[carlos, ana, rafael, joao, marcos, luciana, paulo, fernanda, diego].forEach((u, i) => {
    const id = uid()
    writeFileSync(join(filesDir, id), avatarSvg(u.name, AVATAR_COLORS[i % AVATAR_COLORS.length]))
    ins('files', { id, name: `foto-${u.name}.svg`, size: 1200, mime: 'image/svg+xml', folder: 'Fotos da equipe', visibility: 'compartilhado', refType: 'avatar', refId: u.id, uploadedBy: u.id, uploadedByName: u.name })
    db.update('users', u.id, { photoFileId: id })
  })

  const centers = db.col('workCenters')
  const wc = (code) => centers.find((c) => c.code === code)
  const bank = ins('bankAccounts', { name: 'Banco Principal — C/C', bank: 'Banco do Brasil', kind: 'corrente', openingBalance: 85000, active: true })

  // ----------------------------------------------------------- fornecedores
  const leo = ensureLeoSupplier()
  const supplierFerr = ins('suppliers', { name: 'Ferragens & Cia Atacadista', category: 'ferragens', contact: 'Marta', phone: '(11) 3333-4444', email: 'vendas@ferragenscia.com.br', paymentTerms: '28 dias', leadTimeDays: 4, rating: 4, status: 'ativo' })
  const supplierVidro = ins('suppliers', { name: 'Vidraçaria Cristal', category: 'vidros', contact: 'Sérgio', phone: '(11) 3555-1212', paymentTerms: '30 dias', leadTimeDays: 7, rating: 5, status: 'ativo' })
  const supplierTinta = ins('suppliers', { name: 'Tintas e Vernizes Sul', category: 'insumos', contact: 'Elaine', phone: '(11) 3777-8899', paymentTerms: 'À vista', leadTimeDays: 2, rating: 3, status: 'ativo' })

  // --------------------------------------------------- materiais (catálogo)
  const find = (kind, re, predicate = () => true) => catalog.items.find((i) => i.kind === kind && i.price && re.test(i.name) && predicate(i))
  const importItem = (item, stock, minStock) => {
    if (!item) return null
    const existing = db.col('materials').find((m) => m.catalogId === item.id)
    if (existing) return existing
    return ins('materials', { ...materialFromCatalog(item, leo.id), stock, minStock })
  }
  const mdfBranco18 = importItem(find('chapa', /MDF Branco.*18mm.*2750x1850/i), 24, 10)
  const mdfBranco15 = importItem(find('chapa', /MDF Branco.*15mm/i, (i) => i.name !== mdfBranco18?.name), 12, 6)
  const mdfCarvalho = importItem(find('chapa', /MDF Carvalho.*18mm/i), 8, 8)
  const mdfNogueira = importItem(find('chapa', /MDF Nogueira.*18mm/i), 4, 6)
  const mdfCinza = importItem(find('chapa', /MDF Cinza.*18mm/i), 10, 5)
  const mdfFundo = importItem(find('chapa', /MDF.*\b6mm\b/i), 30, 15)
  const fitaBranca = importItem(find('fita', /Branc/i), 220, 100)
  const fitaCarvalho = importItem(find('fita', /Carvalho/i), 60, 80)
  const dobradica = importItem(find('ferragem', /Dobradi[cç]a/i), 180, 100)
  const corredica = importItem(find('ferragem', /Corredi[cç]a.*(Telesc|45)/i) ?? find('ferragem', /Corredi[cç]a/i), 36, 40)
  const puxador = importItem(find('ferragem', /Puxador/i), 90, 50)
  for (const w of ['Parafuso', 'Cavilha', 'Minifix', 'Tampa']) importItem(find('ferragem', new RegExp(w, 'i')), 400, 200)
  const cola = ins('materials', { name: 'Cola PVA para madeira 20 kg', category: 'insumo', unit: 'un', cost: 189.9, stock: 3, minStock: 4, supplierId: supplierTinta.id, active: true, priceSource: 'manual', location: 'Almoxarifado A1' })
  const verniz = ins('materials', { name: 'Verniz PU fosco 3,6 L', category: 'insumo', unit: 'un', cost: 128.5, stock: 9, minStock: 4, supplierId: supplierTinta.id, active: true, priceSource: 'manual', location: 'Almoxarifado A2' })
  const espelho = ins('materials', { name: 'Espelho bisotado 4 mm (m²)', category: 'vidro', unit: 'm2', cost: 215, stock: 6, minStock: 2, supplierId: supplierVidro.id, active: true, priceSource: 'manual' })

  const m = (x) => x?.id
  const bomParts = (carcass, fundo, front) => ({ carcass: m(carcass), fundo: m(fundo), front: m(front) })

  // -------------------------------------------------------- fichas técnicas
  const route = (cut, edge, cnc, asm, pack) => [
    { id: uid(), workCenterId: wc('CORTE')?.id, minutes: cut },
    { id: uid(), workCenterId: wc('BORDA')?.id, minutes: edge },
    { id: uid(), workCenterId: wc('CNC')?.id, minutes: cnc },
    { id: uid(), workCenterId: wc('MONT')?.id, minutes: asm },
    { id: uid(), workCenterId: wc('EMB')?.id, minutes: pack },
  ].filter((r) => r.workCenterId)
  const p = (name, quantity, length, width, materialId, edges = {}) => ({ id: uid(), name, quantity, length, width, materialId, grain: true, ...edges })
  const t = { edgeTop: true }
  const all = { edgeTop: true, edgeBottom: true, edgeLeft: true, edgeRight: true }
  const c1 = bomParts(mdfBranco18, mdfFundo, mdfBranco15)
  const bomBalcao = ins('boms', {
    name: 'Balcão 2 portas 800 × 720 × 560',
    category: 'balcao',
    width: 800,
    height: 720,
    depth: 560,
    edgeMaterialId: m(fitaBranca),
    salePrice: 1180,
    active: true,
    parts: [p('Lateral', 2, 720, 560, c1.carcass, t), p('Base', 1, 764, 560, c1.carcass, t), p('Travessa', 2, 764, 100, c1.carcass, t), p('Prateleira', 1, 762, 540, c1.carcass, t), p('Fundo', 1, 710, 790, c1.fundo, {}), p('Porta', 2, 716, 396, c1.front, all)],
    hardware: [{ id: uid(), materialId: m(dobradica), description: 'Dobradiça', quantity: 4 }, { id: uid(), materialId: m(puxador), description: 'Puxador', quantity: 2 }],
    routing: route(9, 8, 10, 28, 6),
  })
  const bomAereo = ins('boms', {
    name: 'Aéreo 2 portas 800 × 700 × 330',
    category: 'aereo',
    width: 800,
    height: 700,
    depth: 330,
    edgeMaterialId: m(fitaBranca),
    salePrice: 890,
    active: true,
    parts: [p('Lateral', 2, 700, 330, c1.carcass, t), p('Base', 1, 764, 330, c1.carcass, t), p('Tampo', 1, 764, 330, c1.carcass, t), p('Prateleira', 1, 762, 310, c1.carcass, t), p('Fundo', 1, 690, 790, c1.fundo, {}), p('Porta', 2, 696, 396, c1.front, all)],
    hardware: [{ id: uid(), materialId: m(dobradica), description: 'Dobradiça', quantity: 4 }, { id: uid(), materialId: m(puxador), description: 'Puxador', quantity: 2 }],
    routing: route(8, 7, 9, 24, 5),
  })
  const bomGaveteiro = ins('boms', {
    name: 'Gaveteiro 3 gavetas 450',
    category: 'gaveteiro',
    width: 450,
    height: 720,
    depth: 560,
    edgeMaterialId: m(fitaCarvalho ?? fitaBranca),
    salePrice: 1420,
    active: true,
    parts: [p('Lateral', 2, 720, 560, m(mdfCarvalho ?? mdfBranco18), t), p('Base', 1, 414, 560, m(mdfCarvalho ?? mdfBranco18), t), p('Frente de gaveta', 3, 410, 226, m(mdfCarvalho ?? mdfBranco18), all), p('Fundo', 1, 710, 440, c1.fundo, {})],
    hardware: [{ id: uid(), materialId: m(corredica), description: 'Corrediça telescópica', quantity: 6 }, { id: uid(), materialId: m(puxador), description: 'Puxador', quantity: 3 }],
    routing: route(10, 9, 14, 38, 7),
  })

  // usinagens padrão nas fichas (dobradiças, sistema 32, rasgo do fundo e puxadores)
  if (cam) {
    for (const bom of [bomBalcao, bomAereo, bomGaveteiro]) {
      const parts = bom.parts.map((pt) => {
        if (pt.name === 'Porta') return { ...pt, machining: cam.hingeHoles(pt.length, pt.width) }
        if (pt.name === 'Lateral')
          return { ...pt, machining: [...cam.shelfPinHoles(pt.length, pt.width, 1), { ...cam.newMachining('rasgo_fundo', 10, pt.width - 16), length: pt.length - 20 }] }
        if (pt.name === 'Frente de gaveta')
          return { ...pt, machining: [cam.newMachining('puxador_5', pt.length / 2 - 64, 40), cam.newMachining('puxador_5', pt.length / 2 + 64, 40)] }
        return pt
      })
      db.update('boms', bom.id, { parts })
      bom.parts = parts
    }
  }

  // ------------------------------------------------------------- clientes
  const cli = (name, type, doc, city, seg, extra = {}) =>
    ins('clients', { name, type, document: doc, city, state: 'SP', segment: seg, status: 'ativo', phone: '(11) 98888-1234', email: `contato@${name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '')}.com.br`, address: 'Rua das Acácias, 120', ...extra })
  const silva = cli('Família Silva', 'PF', '123.456.789-09', 'São Paulo', 'residencial')
  const costa = cli('Construtora Horizonte', 'PJ', '12.345.678/0001-90', 'Guarulhos', 'construtora', { contactName: 'Eng. Roberto' })
  const lopes = cli('Escritório Lopes Arquitetura', 'PJ', '98.765.432/0001-10', 'São Paulo', 'arquiteto', { contactName: 'Marina Lopes' })
  const almeida = cli('Dr. Almeida — Clínica Sorriso', 'PJ', '45.678.912/0001-33', 'Osasco', 'corporativo')
  const barros = cli('Juliana Barros', 'PF', '987.654.321-00', 'Santo André', 'residencial')
  const hotel = cli('Hotel Vila Verde', 'PJ', '33.222.111/0001-55', 'Campinas', 'corporativo', { contactName: 'Gerente de compras' })

  // ---------------------------------------------------------------- leads
  const lead = (name, company, stage, value, origin, nextOffset) =>
    ins('leads', { name, company, stage, value, origin, interest: 'Mobiliário planejado', nextActionDate: day(nextOffset), nextAction: 'Retornar contato', responsibleId: luciana.id, phone: '(11) 97777-0000' })
  lead('Patrícia Gomes', '', 'novo', 38000, 'instagram', 1)
  lead('Renato Faria', 'RF Engenharia', 'contato', 120000, 'indicacao', 2)
  lead('Camila Duarte', '', 'visita', 54000, 'google', 3)
  lead('Studio Ambiente', 'Studio Ambiente', 'proposta', 86000, 'arquiteto', -1)
  lead('Edifício Mirante', 'Condomínio Mirante', 'negociacao', 210000, 'feira', 4)
  lead('Fábio Teixeira', '', 'ganho', 42000, 'cliente_antigo', -10)
  lead('Larissa Prado', '', 'perdido', 28000, 'instagram', -20)

  // ------------------------------------------------------------- projetos
  const mkProject = (name, client, stageId, startOff, dueOff, value, cost, manager, members, priority = 'media', lists) => {
    const project = ins('projects', {
      name,
      clientId: client.id,
      stageId,
      priority,
      managerId: manager.id,
      memberIds: members.map((x) => x.id),
      startDate: day(startOff),
      dueDate: day(dueOff),
      contractValue: value,
      estimatedCost: cost,
      address: `${client.city} — SP`,
      description: 'Projeto de mobiliário planejado sob medida, com produção na fábrica Arcoplan e instalação no local.',
      tags: ['planejado'],
      archived: false,
    })
    lists.forEach((l, li) => {
      const list = ins('taskLists', { projectId: project.id, name: l.name, color: l.color, order: (li + 1) * 1000 })
      l.tasks.forEach(([title, status, s, e, hours, who, prio], ti) => {
        const task = ins('tasks', {
          projectId: project.id,
          listId: list.id,
          parentId: null,
          title,
          status,
          priority: prio ?? 'normal',
          assigneeIds: who.map((x) => x.id),
          startDate: day(s),
          dueDate: day(e),
          estimateMinutes: hours * 60,
          order: (ti + 1) * 1000,
          tags: [],
          checklists: [],
          completedAt: status === 'done' ? iso(Math.min(e, 0)) : null,
        })
        if (status === 'doing' && ti % 2 === 0)
          ins('taskComments', { taskId: task.id, projectId: project.id, authorId: who[0]?.id ?? carlos.id, authorName: who[0]?.name ?? carlos.name, body: 'Em andamento, aguardando confirmação das medidas finais do cliente.', kind: 'comment' })
        if (status === 'done' || status === 'doing')
          ins('timeEntries', { taskId: task.id, projectId: project.id, userId: (who[0] ?? carlos).id, userName: (who[0] ?? carlos).name, start: iso(Math.min(s, -1), 9), end: iso(Math.min(s, -1), 9 + Math.max(1, Math.min(hours, 6))), seconds: Math.max(1, Math.min(hours, 6)) * 3600, billable: true })
      })
    })
    return project
  }

  const prj1 = mkProject('Cozinha planejada — Residência Silva', silva, 'producao', -35, 14, 48500, 27800, ana, [rafael, joao, marcos, paulo], 'alta', [
    { name: 'Comercial e medição', color: '#4f7ea8', tasks: [['Visita técnica e medição', 'done', -35, -33, 3, [ana]], ['Briefing e escolha de acabamentos', 'done', -33, -30, 2, [luciana, ana]]] },
    { name: 'Projeto', color: '#6b5fa8', tasks: [['Projeto executivo 3D', 'done', -30, -22, 12, [ana], 'alta'], ['Aprovação do cliente', 'done', -22, -19, 1, [luciana]], ['Lista de corte e detalhamento', 'done', -19, -17, 6, [ana]]] },
    { name: 'Suprimentos', color: '#b9852e', tasks: [['Compra de chapas e ferragens', 'done', -17, -14, 4, [diego]], ['Conferência do recebimento', 'done', -12, -11, 2, [diego]]] },
    { name: 'Produção', color: '#700618', tasks: [['Plano de corte otimizado', 'done', -11, -10, 2, [rafael]], ['Corte das chapas', 'done', -10, -7, 8, [joao]], ['Fita de borda e usinagem', 'doing', -6, 1, 14, [joao], 'alta'], ['Pré-montagem e conferência', 'todo', 1, 5, 12, [marcos]], ['Acabamento e embalagem', 'todo', 5, 8, 6, [marcos]]] },
    { name: 'Entrega e instalação', color: '#3f7a4f', tasks: [['Agendar entrega com o cliente', 'todo', 6, 8, 1, [luciana]], ['Entrega e instalação', 'todo', 10, 13, 16, [paulo], 'alta'], ['Vistoria e termo de aceite', 'todo', 13, 14, 1, [paulo]]] },
  ])
  const prj2 = mkProject('Closet casal — Juliana Barros', barros, 'projeto', -12, 38, 36200, 20100, ana, [rafael], 'media', [
    { name: 'Projeto', color: '#6b5fa8', tasks: [['Medição no local', 'done', -12, -11, 3, [ana]], ['Projeto 3D e renders', 'doing', -10, 3, 14, [ana], 'alta'], ['Aprovação', 'todo', 3, 6, 1, [luciana]]] },
    { name: 'Produção', color: '#700618', tasks: [['Plano de corte', 'todo', 8, 9, 2, [rafael]], ['Corte e usinagem', 'todo', 12, 18, 20, [joao]], ['Montagem', 'todo', 19, 26, 24, [marcos]]] },
    { name: 'Instalação', color: '#3f7a4f', tasks: [['Instalação', 'todo', 32, 36, 20, [paulo]]] },
  ])
  const prj3 = mkProject('Lote seriado — Apartamentos Horizonte (24 unid.)', costa, 'producao', -20, 25, 312000, 201000, carlos, [rafael, joao, marcos, diego], 'urgente', [
    { name: 'Engenharia', color: '#6b5fa8', tasks: [['Ficha técnica aprovada', 'done', -20, -17, 6, [ana]], ['Programação CNC', 'done', -17, -14, 8, [rafael]]] },
    { name: 'Produção do lote', color: '#700618', tasks: [['Corte do lote 1 (12 unid.)', 'done', -13, -10, 16, [joao]], ['Borda e CNC — lote 1', 'doing', -9, -2, 24, [joao], 'urgente'], ['Montagem — lote 1', 'doing', -3, 4, 40, [marcos], 'alta'], ['Corte do lote 2', 'todo', -1, 5, 16, [joao], 'urgente'], ['Montagem — lote 2', 'todo', 6, 16, 40, [marcos]]] },
    { name: 'Expedição', color: '#3f7a4f', tasks: [['Embalagem e romaneio — lote 1', 'todo', 5, 6, 8, [marcos]], ['Entrega lote 1', 'todo', 7, 8, 4, [paulo]], ['Entrega lote 2', 'todo', 22, 25, 4, [paulo]]] },
  ])
  const prj4 = mkProject('Recepção e consultórios — Clínica Sorriso', almeida, 'aprovacao', -8, 55, 78400, 44200, ana, [luciana], 'media', [
    { name: 'Projeto', color: '#6b5fa8', tasks: [['Levantamento e briefing', 'done', -8, -6, 4, [ana]], ['Projeto executivo', 'doing', -5, 6, 18, [ana]], ['Apresentação ao cliente', 'todo', 7, 8, 2, [luciana, ana]]] },
  ])
  const prj5 = mkProject('Painéis e balcão — Hotel Vila Verde', hotel, 'entregue', -90, -12, 124000, 71500, carlos, [paulo], 'media', [
    { name: 'Instalação', color: '#3f7a4f', tasks: [['Instalação concluída', 'done', -20, -13, 40, [paulo]], ['Termo de aceite', 'done', -13, -12, 1, [paulo]]] },
  ])
  const prj6 = mkProject('Escritório de arquitetura — Studio Lopes', lopes, 'briefing', -2, 60, 52000, 0, luciana, [], 'baixa', [
    { name: 'Comercial', color: '#4f7ea8', tasks: [['Reunião de briefing', 'todo', 1, 2, 2, [luciana]], ['Medição', 'todo', 3, 4, 3, [ana]]] },
  ])

  // --------------------------------------------------- ordens de produção
  const op = (title, project, status, priority, batch, startOff, dueOff, items, opsState) => {
    const minutes = new Map()
    items.forEach((it) => {
      const bom = db.col('boms').find((b) => b.id === it.bomId)
      bom?.routing.forEach((r) => minutes.set(r.workCenterId, (minutes.get(r.workCenterId) ?? 0) + r.minutes * it.quantity))
    })
    const ordered = centers.filter((c) => minutes.has(c.id)).sort((a, b) => a.order - b.order)
    const operations = ordered.map((c, i) => {
      const st = opsState[i] ?? 'pendente'
      const planned = Math.round(minutes.get(c.id))
      return {
        id: uid(),
        workCenterId: c.id,
        name: c.name,
        order: i + 1,
        plannedMinutes: planned,
        actualSeconds: st === 'concluida' ? Math.round(planned * 60 * 1.07) : st === 'em_andamento' ? Math.round(planned * 60 * 0.4) : 0,
        status: st,
        runningSince: null,
        operatorId: st === 'pendente' ? null : joao.id,
        operatorName: st === 'pendente' ? null : joao.name,
        quantityDone: st === 'concluida' ? items.reduce((s, x) => s + x.quantity, 0) : 0,
        startedAt: st === 'pendente' ? null : iso(-3, 8),
        finishedAt: st === 'concluida' ? iso(-2, 16) : null,
      }
    })
    return ins('productionOrders', { title, projectId: project.id, clientId: project.clientId, status, priority, batch, startDate: day(startOff), dueDate: day(dueOff), items, operations, materialsPosted: status !== 'planejada', notes: '' })
  }
  const opSilva = op('Cozinha Silva — módulos de balcão e aéreos', prj1, 'em_producao', 'alta', 'L-2410-A', -9, 4, [
    { id: uid(), bomId: bomBalcao.id, name: bomBalcao.name, quantity: 5 },
    { id: uid(), bomId: bomAereo.id, name: bomAereo.name, quantity: 6 },
    { id: uid(), bomId: bomGaveteiro.id, name: bomGaveteiro.name, quantity: 2 },
  ], ['concluida', 'em_andamento', 'pendente', 'pendente', 'pendente'])
  op('Horizonte — lote 1 (12 apartamentos)', prj3, 'em_producao', 'urgente', 'L-2410-B', -13, 6, [
    { id: uid(), bomId: bomBalcao.id, name: bomBalcao.name, quantity: 12 },
    { id: uid(), bomId: bomAereo.id, name: bomAereo.name, quantity: 12 },
  ], ['concluida', 'concluida', 'em_andamento', 'pendente', 'pendente'])
  op('Horizonte — lote 2 (12 apartamentos)', prj3, 'liberada', 'alta', 'L-2410-C', 0, 16, [
    { id: uid(), bomId: bomBalcao.id, name: bomBalcao.name, quantity: 12 },
    { id: uid(), bomId: bomAereo.id, name: bomAereo.name, quantity: 12 },
  ], [])
  op('Closet Barros — gaveteiros', prj2, 'planejada', 'media', 'L-2411-A', 12, 26, [{ id: uid(), bomId: bomGaveteiro.id, name: bomGaveteiro.name, quantity: 4 }], [])
  op('Hotel Vila Verde — balcões de recepção', prj5, 'concluida', 'media', 'L-2408-A', -70, -25, [{ id: uid(), bomId: bomBalcao.id, name: bomBalcao.name, quantity: 6 }], ['concluida', 'concluida', 'concluida', 'concluida', 'concluida'])

  // ------------------------------------------------- plano de corte (CAM)
  if (cam) {
    const materialsMap = new Map(db.col('materials').map((x) => [x.id, x]))
    const pieces = []
    for (const [bom, qty] of [[bomBalcao, 5], [bomAereo, 6], [bomGaveteiro, 2]]) {
      for (const part of bom.parts) {
        pieces.push({
          id: uid(),
          label: `${bom.name.split(' ').slice(0, 2).join(' ')} · ${part.name}`,
          module: bom.name,
          length: part.length,
          width: part.width,
          quantity: part.quantity * qty,
          rotate: part.grain === false,
          materialId: part.materialId,
          edgeTop: part.edgeTop,
          edgeBottom: part.edgeBottom,
          edgeLeft: part.edgeLeft,
          edgeRight: part.edgeRight,
          machining: (part.machining ?? []).map((x) => ({ ...x, id: uid() })),
        })
      }
    }
    const kerf = 7
    const trim = 10
    const { groups } = cam.planGroups(
      pieces,
      (pc) => {
        const mat = materialsMap.get(pc.materialId ?? '')
        if (!mat || !mat.sheetWidth) return null
        return { key: mat.id, materialId: mat.id, materialName: mat.name, thickness: mat.thickness ?? 0, sheetWidth: mat.sheetWidth, sheetHeight: mat.sheetHeight, sheetCost: mat.cost }
      },
      kerf,
      trim,
    )
    const hardware = dobradica ? [{ id: uid(), materialId: dobradica.id, description: dobradica.name, quantity: 60, unitCost: dobradica.cost }] : []
    const plan = {
      title: 'Cozinha Silva — carcaças, fundos e frentes',
      status: 'em_corte',
      projectId: prj1.id,
      productionOrderId: opSilva.id,
      responsibleId: rafael.id,
      mode: 'cnc',
      kerf,
      trim,
      defaultMaterialId: m(mdfBranco18),
      edgeMaterialId: m(fitaBranca),
      pieces,
      hardware,
      groups,
      gcode: cam.DEFAULT_GCODE,
      notes: '',
    }
    plan.costs = cam.computeCosts({ pieces, groups, hardware, mode: 'cnc', edgeMaterialId: plan.edgeMaterialId, gcode: cam.DEFAULT_GCODE }, materialsMap, centers)
    plan.utilization = groups.length ? Math.round((groups.reduce((s, g) => s + g.utilization, 0) / groups.length) * 100) / 100 : 0
    const created = ins('cutPlans', plan)
    db.update('productionOrders', opSilva.id, { cutPlanIds: [created.id] })
  }

  // ---------------------------------------------------------- orçamentos
  const bi = (group, description, kind, qty, cost, price = 0, extra = {}) => ({ id: uid(), group, description, kind, unit: 'un', quantity: qty, unitCost: cost, unitPrice: price, ...extra })
  ins('budgets', {
    title: 'Cozinha planejada — Residência Silva',
    clientId: silva.id,
    projectId: prj1.id,
    status: 'aprovado',
    approvedAt: iso(-33),
    validUntil: day(-20),
    marginPercent: 38,
    taxPercent: 6,
    discountPercent: 3,
    laborHours: 40,
    laborRate: 55,
    freight: 450,
    installation: 2800,
    paymentTerms: '50% na aprovação, 50% na entrega',
    deliveryDays: 35,
    responsibleId: luciana.id,
    items: [bi('Cozinha', bomBalcao.name, 'modulo', 5, 640, 1180, { bomId: bomBalcao.id }), bi('Cozinha', bomAereo.name, 'modulo', 6, 470, 890, { bomId: bomAereo.id }), bi('Cozinha', bomGaveteiro.name, 'modulo', 2, 760, 1420, { bomId: bomGaveteiro.id }), bi('Cozinha', 'Tampo em granito com recorte de cuba', 'servico', 1, 3200, 4800)],
  })
  ins('budgets', {
    title: 'Closet casal — Juliana Barros',
    clientId: barros.id,
    projectId: prj2.id,
    status: 'aprovado',
    approvedAt: iso(-10),
    validUntil: day(5),
    marginPercent: 36,
    taxPercent: 6,
    discountPercent: 0,
    laborHours: 30,
    laborRate: 55,
    freight: 300,
    installation: 1900,
    deliveryDays: 40,
    responsibleId: luciana.id,
    items: [bi('Closet', 'Módulo roupeiro com portas de correr', 'modulo', 3, 1850, 0), bi('Closet', bomGaveteiro.name, 'modulo', 2, 760, 1420, { bomId: bomGaveteiro.id }), bi('Closet', 'Espelho bisotado', 'material', 4, 215 * 1.8, 0)],
  })
  ins('budgets', {
    title: 'Recepção e consultórios — Clínica Sorriso',
    clientId: almeida.id,
    projectId: prj4.id,
    status: 'enviado',
    validUntil: day(9),
    marginPercent: 40,
    taxPercent: 6,
    discountPercent: 5,
    laborHours: 80,
    laborRate: 55,
    freight: 600,
    installation: 4200,
    deliveryDays: 55,
    responsibleId: luciana.id,
    items: [bi('Recepção', 'Balcão de recepção em laminado', 'modulo', 1, 6200, 0), bi('Consultórios', bomBalcao.name, 'modulo', 8, 640, 1180, { bomId: bomBalcao.id }), bi('Consultórios', bomAereo.name, 'modulo', 8, 470, 890, { bomId: bomAereo.id })],
  })
  ins('budgets', {
    title: 'Apartamento decorado — Studio Ambiente',
    clientId: lopes.id,
    status: 'rascunho',
    validUntil: day(14),
    marginPercent: 35,
    taxPercent: 6,
    discountPercent: 0,
    laborHours: 24,
    laborRate: 55,
    freight: 0,
    installation: 1500,
    deliveryDays: 30,
    responsibleId: luciana.id,
    items: [bi('Sala', 'Painel ripado com TV', 'servico', 1, 4100, 0), bi('Dormitório', 'Cabeceira e criados-mudos', 'servico', 1, 2300, 0)],
  })
  ins('budgets', { title: 'Estante home office', clientId: barros.id, status: 'recusado', validUntil: day(-30), marginPercent: 35, taxPercent: 6, discountPercent: 0, laborHours: 10, laborRate: 55, freight: 0, installation: 600, items: [bi('Home office', 'Estante com nichos', 'servico', 1, 2100, 0)] })

  // ------------------------------------------------------------ contratos
  const contract = ins('contracts', {
    title: 'Fornecimento e instalação de cozinha planejada',
    clientId: silva.id,
    projectId: prj1.id,
    value: 48500,
    status: 'em_execucao',
    signedAt: day(-32),
    startDate: day(-32),
    endDate: day(14),
    terms: 'Garantia de 5 anos contra defeitos de fabricação. Prazo conta a partir da aprovação do projeto executivo.',
    installments: [],
  })
  const instals = [
    { label: 'Entrada', amount: 24250, due: -32, paid: true },
    { label: 'Parcela 1/2', amount: 12125, due: 5, paid: false },
    { label: 'Parcela 2/2', amount: 12125, due: 35, paid: false },
  ]
  const instRecords = instals.map((i) => {
    const r = ins('receivables', { description: `${contract.code} — ${i.label}`, amount: i.amount, dueDate: day(i.due), paidDate: i.paid ? day(i.due) : null, status: i.paid ? 'pago' : 'pendente', category: i.label === 'Entrada' ? 'Entrada / sinal' : 'Parcelas de contrato', clientId: silva.id, contractId: contract.id, projectId: prj1.id, accountId: bank.id, method: 'pix' })
    return { id: uid(), label: i.label, dueDate: day(i.due), amount: i.amount, receivableId: r.id }
  })
  db.update('contracts', contract.id, { installments: instRecords })

  // ------------------------------------------------------ financeiro (hist.)
  const rec = (description, amount, off, paid, category, client, project) =>
    ins('receivables', { description, amount, dueDate: day(off), paidDate: paid ? day(off) : null, status: paid ? 'pago' : 'pendente', category, clientId: client?.id, projectId: project?.id, accountId: bank.id, method: 'pix' })
  rec('Hotel Vila Verde — medição final', 62000, -75, true, 'Parcelas de contrato', hotel, prj5)
  rec('Hotel Vila Verde — entrega', 62000, -14, true, 'Parcelas de contrato', hotel, prj5)
  rec('Construtora Horizonte — entrada lote seriado', 93600, -20, true, 'Entrada / sinal', costa, prj3)
  rec('Construtora Horizonte — medição 1', 109200, -3, false, 'Parcelas de contrato', costa, prj3)
  rec('Construtora Horizonte — medição 2', 109200, 21, false, 'Parcelas de contrato', costa, prj3)
  rec('Closet Barros — entrada', 18100, -10, true, 'Entrada / sinal', barros, prj2)
  rec('Assistência técnica — troca de dobradiças', 480, -40, true, 'Assistência técnica', silva)
  rec('Clínica Sorriso — sinal do projeto', 7840, 6, false, 'Entrada / sinal', almeida, prj4)
  const pay = (description, amount, off, paid, category, supplier, project) =>
    ins('payables', { description, amount, dueDate: day(off), paidDate: paid ? day(off) : null, status: paid ? 'pago' : 'pendente', category, supplierId: supplier?.id, projectId: project?.id, accountId: bank.id, method: 'boleto' })
  for (let i = 1; i <= 4; i++) {
    pay(`Folha de pagamento — mês -${i}`, 38500 + i * 120, -30 * i, true, 'Folha de pagamento')
    pay(`Aluguel do galpão — mês -${i}`, 9800, -30 * i + 3, true, 'Aluguel e condomínio')
    pay(`Compra de chapas — Leo Madeiras (mês -${i})`, 21000 + i * 1800, -30 * i + 8, true, 'Matéria-prima', leo)
    pay(`Energia elétrica — mês -${i}`, 3100 + i * 90, -30 * i + 10, true, 'Energia e água')
  }
  pay('Folha de pagamento — mês atual', 39100, 5, false, 'Folha de pagamento')
  pay('Aluguel do galpão — mês atual', 9800, 3, false, 'Aluguel e condomínio')
  pay('Compra de ferragens — Ferragens & Cia', 6840, 12, false, 'Ferragens e insumos', supplierFerr, prj3)
  pay('Impostos — Simples Nacional', 11250, -4, false, 'Encargos e impostos')
  pay('Manutenção da coladeira de bordas', 2350, 2, false, 'Manutenção de máquinas')

  // --------------------------------------------------------------- compras
  const mat = (x, qty, price) => ({ materialId: x?.id, description: x?.name ?? 'Item', unit: x?.unit, quantity: qty, unitCost: price ?? x?.cost ?? 0, received: 0 })
  const poSent = ins('purchases', { supplierId: leo.id, projectId: prj3.id, status: 'pedido', expectedDate: day(3), items: [mat(mdfBranco18, 20), mat(mdfFundo, 12), mat(fitaBranca, 600)].filter((i) => i.materialId), notes: 'Lote 2 — Construtora Horizonte' })
  ins('purchases', { supplierId: supplierFerr.id, status: 'cotacao', expectedDate: day(8), items: [mat(dobradica, 300), mat(puxador, 120), mat(corredica, 60)].filter((i) => i.materialId) })
  ins('purchases', { supplierId: leo.id, projectId: prj1.id, status: 'recebido', receivedAt: iso(-14), expectedDate: day(-14), invoiceNumber: '48215', items: [{ ...mat(mdfBranco18, 14), received: 14 }, { ...mat(fitaBranca, 300), received: 300 }].filter((i) => i.materialId) })
  ins('purchases', { supplierId: supplierTinta.id, status: 'rascunho', items: [mat(cola, 4), mat(verniz, 6)] })

  // --------------------------------------------------- movimentações de estoque
  for (const [mtl, type, qty, reason, off] of [
    [mdfBranco18, 'entry', 14, 'Recebimento do pedido PC-2025', -14],
    [mdfBranco18, 'exit', 9, 'Consumo da OP — Cozinha Silva', -9],
    [fitaBranca, 'entry', 300, 'Recebimento do pedido', -14],
    [dobradica, 'exit', 48, 'Consumo da OP — Cozinha Silva', -9],
    [cola, 'exit', 2, 'Consumo na montagem', -5],
  ]) {
    if (!mtl) continue
    ins('inventoryMovements', { materialId: mtl.id, materialName: mtl.name, type, quantity: qty, stockBefore: mtl.stock, stockAfter: mtl.stock, unit: mtl.unit, reason, userId: diego.id, userName: diego.name, occurredAt: iso(off, 10) })
  }

  // ------------------------------------------------ qualidade / manutenção
  ins('qualityRecords', { title: 'Peças com lascamento na fita de borda', kind: 'retrabalho', severity: 'media', status: 'em_tratamento', projectId: prj3.id, workCenterId: wc('BORDA')?.id, description: 'Lote de portas com lascamento no canto superior após aparador.', rootCause: 'Faca do aparador desgastada', correctiveAction: 'Troca da faca e inspeção a cada 200 peças', responsibleId: rafael.id, cost: 640, openedAt: day(-4) })
  ins('qualityRecords', { title: 'Chapa com empenamento recebida', kind: 'defeito_material', severity: 'alta', status: 'aberta', projectId: prj1.id, description: '3 chapas MDF 18 mm com empenamento acima do tolerável.', responsibleId: diego.id, cost: 1380, openedAt: day(-2) })
  ins('qualityRecords', { title: 'Furação fora do gabarito', kind: 'erro_projeto', severity: 'baixa', status: 'concluida', workCenterId: wc('CNC')?.id, description: 'Posição de dobradiça 2 mm deslocada.', correctiveAction: 'Programa CNC corrigido', responsibleId: ana.id, cost: 120, openedAt: day(-25), closedAt: day(-23) })
  ins('maintenance', { title: 'Revisão preventiva da seccionadora', workCenterId: wc('CORTE')?.id, kind: 'preventiva', status: 'agendada', scheduledDate: day(2), technician: 'Assistência técnica do fabricante', recurrenceDays: 90, cost: 1800, downtimeHours: 4 })
  ins('maintenance', { title: 'Troca de cola e limpeza da coladeira', workCenterId: wc('BORDA')?.id, kind: 'preventiva', status: 'agendada', scheduledDate: day(-1), technician: 'Equipe interna', recurrenceDays: 30, cost: 350, downtimeHours: 2 })
  ins('maintenance', { title: 'Reparo da bomba de vácuo do CNC', workCenterId: wc('CNC')?.id, kind: 'corretiva', status: 'concluida', scheduledDate: day(-18), doneDate: day(-17), technician: 'Vácuo & Cia', cost: 2650, downtimeHours: 9 })

  // ---------------------------------------------------- logística / garantia
  const van = ins('vehicles', { plate: 'ABC-1D23', model: 'Master Furgão', brand: 'Renault', year: 2021, kind: 'van', driverId: paulo.id, status: 'ativo', odometer: 84210, nextMaintenance: day(20), insuranceUntil: day(120) })
  ins('vehicles', { plate: 'XYZ-9K88', model: 'Accelo 815', brand: 'Mercedes-Benz', year: 2019, kind: 'caminhao', status: 'manutencao', odometer: 152300, nextMaintenance: day(-3), insuranceUntil: day(14) })
  const checklist = [['Conferir peças e ferragens', true], ['Nivelar e fixar módulos', false], ['Regular portas e gavetas', false], ['Termo de aceite assinado', false]].map(([text, done]) => ({ id: uid(), text, done }))
  ins('installations', { kind: 'instalacao', projectId: prj1.id, clientId: silva.id, date: day(10), time: '08:00', status: 'agendada', address: 'Rua das Acácias, 120 — São Paulo', teamIds: [paulo.id, marcos.id], vehicleId: van.id, checklist })
  ins('installations', { kind: 'entrega', projectId: prj3.id, clientId: costa.id, date: day(7), time: '07:30', status: 'agendada', teamIds: [paulo.id], vehicleId: van.id, checklist: [] })
  ins('installations', { kind: 'medicao', projectId: prj6.id, clientId: lopes.id, date: day(3), time: '14:00', status: 'agendada', teamIds: [ana.id], checklist: [] })
  ins('installations', { kind: 'instalacao', projectId: prj5.id, clientId: hotel.id, date: day(-13), time: '08:00', status: 'concluida', teamIds: [paulo.id], completedAt: day(-13), customerSignedBy: 'Gerente de compras', checklist: checklist.map((c) => ({ ...c, done: true })) })
  ins('warranties', { title: 'Porta do balcão desalinhada', projectId: prj5.id, clientId: hotel.id, status: 'agendada', priority: 'media', description: 'Cliente relata porta do balcão da recepção roçando na lateral.', responsibleId: paulo.id, openedAt: day(-5), cost: 0 })
  ins('warranties', { title: 'Troca de puxador danificado', projectId: prj1.id, clientId: silva.id, status: 'resolvida', priority: 'baixa', description: 'Puxador quebrado durante o transporte.', resolution: 'Substituído na entrega.', openedAt: day(-30), resolvedAt: day(-28), cost: 45 })

  // ----------------------------------------------------- agenda e produtos
  ins('events', { title: 'Reunião de planejamento da semana (PCP)', kind: 'reuniao', date: day(0), startTime: '08:00', endTime: '09:00', attendeeIds: [carlos.id, rafael.id, ana.id], location: 'Sala de reuniões' })
  ins('events', { title: 'Apresentação do projeto — Clínica Sorriso', kind: 'reuniao', date: day(7), startTime: '15:00', projectId: prj4.id, attendeeIds: [ana.id, luciana.id] })
  ins('events', { title: 'Visita à Feira de Móveis', kind: 'outro', date: day(12), allDay: true })
  for (const [name, kind, price, cost] of [['Projeto executivo 3D (por ambiente)', 'servico', 1800, 700], ['Instalação — diária de equipe', 'servico', 1200, 640], ['Frete urbano (até 30 km)', 'servico', 450, 280], ['Visita técnica e medição', 'servico', 350, 120]])
    ins('productsServices', { name, kind, unit: 'un', price, cost, category: 'Serviços', active: true })

  // --------------------------------------------------------------- ponto
  for (const u of [joao, marcos, rafael, ana]) {
    for (const off of [-1, 0]) {
      const times = off === 0 ? [[7, 'entrada'], [12, 'saida_intervalo'], [13, 'volta_intervalo']] : [[7, 'entrada'], [12, 'saida_intervalo'], [13, 'volta_intervalo'], [17, 'saida']]
      for (const [h, type] of times) {
        if (off === 0 && new Date().getHours() < h) continue
        ins('timeclock', { userId: u.id, type, at: iso(off, h) })
      }
    }
  }

  return counts
}
