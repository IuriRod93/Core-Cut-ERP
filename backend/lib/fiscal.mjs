import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Nota fiscal eletrônica (NF-e de produto) por provedor fiscal.
 *
 * O Core Cut nunca fala com a SEFAZ: ele monta a nota, envia ao provedor (Focus NFe) e guarda o resultado.
 * O provedor assina com o certificado digital da empresa e transmite. O mapeamento de campos fica concentrado em
 * `buildFocusPayload` para ser ajustado em um só lugar depois dos testes em homologação.
 */

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000
const digits = (v) => String(v ?? '').replace(/\D/g, '')

export const FOCUS_URLS = {
  homologacao: 'https://homologacao.focusnfe.com.br',
  producao: 'https://api.focusnfe.com.br',
}

// ------------------------------------------------------------------ documentos
export function validCpf(value) {
  const d = digits(value)
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false
  for (const size of [9, 10]) {
    let sum = 0
    for (let i = 0; i < size; i++) sum += Number(d[i]) * (size + 1 - i)
    if (((sum * 10) % 11) % 10 !== Number(d[size])) return false
  }
  return true
}

export function validCnpj(value) {
  const d = digits(value)
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false
  for (const size of [12, 13]) {
    let sum = 0
    let weight = size - 7
    for (let i = 0; i < size; i++) {
      sum += Number(d[i]) * weight
      weight = weight === 2 ? 9 : weight - 1
    }
    const check = sum % 11 < 2 ? 0 : 11 - (sum % 11)
    if (check !== Number(d[size])) return false
  }
  return true
}

// ------------------------------------------------------------------ segredos
/** Guarda o token do provedor cifrado (AES-256-GCM). A chave vem do ambiente ou de um arquivo local. */
export function createSecretBox({ env = process.env, dataDir, purpose = 'fiscal', envKey = 'FISCAL_SECRET_KEY' } = {}) {
  let key
  const material = () => {
    if (env[envKey]) return env[envKey]
    if (env.FISCAL_SECRET_KEY) return env.FISCAL_SECRET_KEY
    if (env.DATABASE_URL) return env.DATABASE_URL
    if (!dataDir) return 'core-cut-dev-only'
    const file = join(dataDir, `${purpose}.key`)
    if (!existsSync(file)) {
      mkdirSync(dataDir, { recursive: true })
      writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 })
    }
    return readFileSync(file, 'utf8').trim()
  }
  const getKey = () => (key ??= createHash('sha256').update(`corecut-${purpose}:${material()}`).digest())
  return {
    seal(text) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', getKey(), iv)
      const body = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()])
      return [iv, cipher.getAuthTag(), body].map((b) => b.toString('base64')).join('.')
    },
    open(blob) {
      try {
        const [iv, tag, body] = String(blob).split('.').map((p) => Buffer.from(p, 'base64'))
        const decipher = createDecipheriv('aes-256-gcm', getKey(), iv)
        decipher.setAuthTag(tag)
        return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
      } catch {
        return null
      }
    },
  }
}

// ------------------------------------------------------------------ validação
/** Pendências do cadastro da empresa para emitir nota (mostradas em Configurações). */
export function companyProblems(company = {}) {
  const out = []
  if (!validCnpj(company.cnpj)) out.push('CNPJ da empresa ausente ou inválido.')
  if (!String(company.legalName ?? '').trim()) out.push('Razão social da empresa.')
  if (!digits(company.ie)) out.push('Inscrição estadual da empresa.')
  if (!['1', '2', '3'].includes(String(company.taxRegime ?? ''))) out.push('Regime tributário da empresa.')
  if (!String(company.address ?? '').trim()) out.push('Logradouro (rua) da empresa.')
  if (!String(company.number ?? '').trim()) out.push('Número do endereço da empresa.')
  if (!String(company.district ?? '').trim()) out.push('Bairro da empresa.')
  if (!String(company.city ?? '').trim() || String(company.state ?? '').length !== 2) out.push('Cidade e UF da empresa.')
  if (digits(company.cep).length !== 8) out.push('CEP da empresa (8 dígitos).')
  return out
}

/** Pendências da nota em si (destinatário e itens). */
export function invoiceProblems(invoice, company = {}) {
  const out = []
  const r = invoice.recipient ?? {}
  const doc = digits(r.document)
  if (!String(r.name ?? '').trim()) out.push('Nome do destinatário.')
  if (!(doc.length === 11 ? validCpf(doc) : doc.length === 14 ? validCnpj(doc) : false)) out.push('CPF ou CNPJ do destinatário ausente ou inválido.')
  if (!String(r.address ?? '').trim()) out.push('Endereço do destinatário.')
  if (!String(r.number ?? '').trim()) out.push('Número do endereço do destinatário.')
  if (!String(r.district ?? '').trim()) out.push('Bairro do destinatário.')
  if (!String(r.city ?? '').trim() || String(r.state ?? '').length !== 2) out.push('Cidade e UF do destinatário.')
  if (digits(r.zip).length !== 8) out.push('CEP do destinatário (8 dígitos).')
  if (!Array.isArray(invoice.items) || invoice.items.length === 0) out.push('A nota precisa de pelo menos um item.')
  for (const [index, item] of (invoice.items ?? []).entries()) {
    const label = `Item ${index + 1}`
    if (!String(item.description ?? '').trim()) out.push(`${label}: descrição.`)
    if (digits(item.ncm).length !== 8) out.push(`${label}: NCM com 8 dígitos.`)
    if (digits(item.cfop).length !== 4) out.push(`${label}: CFOP com 4 dígitos.`)
    if (!(Number(item.quantity) > 0)) out.push(`${label}: quantidade.`)
    if (!(Number(item.unitPrice) >= 0)) out.push(`${label}: valor unitário.`)
    if (!String(item.taxSituation ?? '').trim()) out.push(`${label}: CSOSN/CST.`)
  }
  if (!(totalsOf(invoice).total > 0)) out.push('O valor total da nota precisa ser maior que zero.')
  void company
  return out
}

/** Recalcula os totais a partir dos itens: o servidor nunca confia nos valores vindos do navegador. */
export function totalsOf(invoice) {
  const items = (invoice.items ?? []).map((i) => ({ ...i, total: round2(round4(Number(i.quantity) || 0) * (Number(i.unitPrice) || 0)) }))
  const products = round2(items.reduce((s, i) => s + i.total, 0))
  const freight = round2(Math.max(Number(invoice.freight) || 0, 0))
  const discount = round2(Math.min(Math.max(Number(invoice.discount) || 0, 0), products + freight))
  return { items, products, freight, discount, total: round2(products + freight - discount) }
}

// ------------------------------------------------------------------ payload
/** Monta o JSON da NF-e no formato da API da Focus NFe. */
export function buildFocusPayload({ invoice, company, now = new Date() }) {
  const t = totalsOf(invoice)
  const r = invoice.recipient
  const recipientDoc = digits(r.document)
  const isCompany = recipientDoc.length === 14
  const ie = digits(r.ie)
  // 1 = contribuinte do ICMS, 2 = isento, 9 = não contribuinte
  const ieIndicator = isCompany && ie ? '1' : '9'
  const sameState = String(r.state ?? '').toUpperCase() === String(company.state ?? '').toUpperCase()
  const payload = {
    natureza_operacao: String(invoice.natureOfOperation || 'Venda de mercadoria').slice(0, 60),
    data_emissao: now.toISOString(),
    data_entrada_saida: now.toISOString(),
    tipo_documento: 1,
    finalidade_emissao: 1,
    local_destino: sameState ? 1 : 2,
    consumidor_final: ieIndicator === '9' ? 1 : 0,
    presenca_comprador: 9,
    cnpj_emitente: digits(company.cnpj),
    ...(company.fiscalSerie ? { serie: String(company.fiscalSerie) } : {}),
    regime_tributario_emitente: String(company.taxRegime ?? '1'),
    nome_destinatario: String(r.name).slice(0, 60),
    ...(isCompany ? { cnpj_destinatario: recipientDoc } : { cpf_destinatario: recipientDoc }),
    indicador_inscricao_estadual_destinatario: ieIndicator,
    ...(ieIndicator === '1' ? { inscricao_estadual_destinatario: ie } : {}),
    logradouro_destinatario: String(r.address).slice(0, 60),
    numero_destinatario: String(r.number).slice(0, 60),
    bairro_destinatario: String(r.district).slice(0, 60),
    municipio_destinatario: String(r.city).slice(0, 60),
    uf_destinatario: String(r.state).toUpperCase(),
    cep_destinatario: digits(r.zip),
    ...(r.phone ? { telefone_destinatario: digits(r.phone).slice(0, 14) } : {}),
    ...(r.email ? { email_destinatario: String(r.email).slice(0, 60) } : {}),
    pais_destinatario: 'Brasil',
    valor_frete: t.freight,
    valor_desconto: t.discount,
    valor_produtos: t.products,
    valor_total: t.total,
    modalidade_frete: t.freight > 0 ? 0 : 9,
    ...(invoice.notes ? { informacoes_adicionais_contribuinte: String(invoice.notes).slice(0, 2000) } : {}),
    items: t.items.map((i, index) => ({
      numero_item: index + 1,
      codigo_produto: String(i.code || index + 1).slice(0, 60),
      descricao: String(i.description).slice(0, 120),
      codigo_ncm: digits(i.ncm),
      cfop: digits(i.cfop),
      unidade_comercial: String(i.unit || 'UN').slice(0, 6).toUpperCase(),
      quantidade_comercial: round4(i.quantity),
      valor_unitario_comercial: round4(i.unitPrice),
      valor_bruto: i.total,
      unidade_tributavel: String(i.unit || 'UN').slice(0, 6).toUpperCase(),
      quantidade_tributavel: round4(i.quantity),
      valor_unitario_tributavel: round4(i.unitPrice),
      icms_origem: String(i.origin ?? '0'),
      icms_situacao_tributaria: String(i.taxSituation),
      pis_situacao_tributaria: '07',
      cofins_situacao_tributaria: '07',
      inclui_no_total: 1,
    })),
    formas_pagamento: [{ forma_pagamento: '99', valor_pagamento: t.total }],
  }
  return payload
}

/** Traduz a resposta da Focus NFe para o status do Core Cut. */
export function mapFocusResponse(body = {}, baseUrl = '') {
  const abs = (path) => (path ? (/^https?:/i.test(path) ? path : `${baseUrl}${path}`) : undefined)
  const raw = String(body.status ?? '')
  const map = { processando_autorizacao: 'processando', autorizado: 'autorizada', erro_autorizacao: 'rejeitada', denegado: 'rejeitada', cancelado: 'cancelada', erro_cancelamento: 'autorizada' }
  const errors = Array.isArray(body.erros) ? body.erros.map((e) => e?.mensagem ?? e?.message).filter(Boolean).join(' · ') : ''
  const message = [body.mensagem_sefaz, body.mensagem, errors, body.codigo === 'nao_encontrado' ? 'Nota não encontrada no provedor.' : ''].filter(Boolean).join(' · ').slice(0, 600)
  return {
    status: map[raw] ?? (body.codigo === 'nao_encontrado' ? 'rascunho' : 'processando'),
    number: body.numero ? String(body.numero) : undefined,
    serie: body.serie ? String(body.serie) : undefined,
    accessKey: body.chave_nfe ? String(body.chave_nfe).replace(/^NFe/i, '') : undefined,
    protocol: body.protocolo ? String(body.protocolo) : undefined,
    xmlUrl: abs(body.caminho_xml_nota_fiscal),
    danfeUrl: abs(body.caminho_danfe),
    message: message || undefined,
  }
}

// ------------------------------------------------------------------ cliente HTTP
export function createFocusClient({ fetchImpl = fetch, env = process.env, timeoutMs = 25_000 } = {}) {
  const baseOf = (environment) => (environment === 'producao' ? env.FOCUS_URL_PRODUCAO : env.FOCUS_URL_HOMOLOGACAO) || FOCUS_URLS[environment === 'producao' ? 'producao' : 'homologacao']

  async function call(method, path, { token, environment, body, query }) {
    const base = baseOf(environment)
    const url = `${base}${path}${query ? `?${new URLSearchParams(query)}` : ''}`
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetchImpl(url, {
        method,
        headers: { Authorization: `Basic ${Buffer.from(`${token}:`).toString('base64')}`, ...(body ? { 'Content-Type': 'application/json' } : {}), Accept: 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      })
      const text = await response.text()
      let json = {}
      try {
        json = text ? JSON.parse(text) : {}
      } catch {
        json = { mensagem: text.slice(0, 300) }
      }
      return { httpStatus: response.status, json, base }
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    baseOf,
    emit: ({ token, environment, ref, payload }) => call('POST', '/v2/nfe', { token, environment, body: payload, query: { ref } }),
    consult: ({ token, environment, ref }) => call('GET', `/v2/nfe/${encodeURIComponent(ref)}`, { token, environment }),
    cancel: ({ token, environment, ref, reason }) => call('DELETE', `/v2/nfe/${encodeURIComponent(ref)}`, { token, environment, body: { justificativa: reason } }),
  }
}
