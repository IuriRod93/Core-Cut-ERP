import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Box, Button, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel, LinearProgress, Paper, Radio, RadioGroup, Typography } from '@mui/material'
import { Stack } from './Stack'
import { CloseIcon, UploadFileIcon } from './icons'
import { MaterialPicker } from './MaterialPicker'
import { useToast } from './feedback'
import { useCollections, useSettings } from '../lib/store'
import { brl, round2, uid } from '../lib/format'
import { colors } from '../theme'
import {
  FORMAT_LABEL,
  autoMapEdge,
  autoMapMaterials,
  importStats,
  isPromobFile,
  parsePromobFiles,
  suggestMaterial,
  summarizeEdges,
  summarizeMaterials,
  toCutPieces,
  type PromobImport,
} from '../domain/promob'
import type { CutPiece, CutPlan } from '../types'

export interface PromobApply {
  pieces: CutPiece[]
  hardware: CutPlan['hardware']
  edgeMaterialId?: string
  defaultMaterialId?: string
  replace: boolean
  imports: NonNullable<CutPlan['imports']>
  info: PromobImport['info']
}

const ACCEPT = '.csv,.txt,.xml,.dxf,.dxt'
/** Arquivos lidos por vez: mantém a tela respondendo e a memória baixa em importações de centenas de chapas. */
const READ_BATCH = 40
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** "498 DXF · 2 CSV" — resumo curto para não despejar centenas de nomes na tela. */
function describeFiles(list: File[]) {
  if (list.length <= 4) return list.map((f) => f.name).join(' · ')
  const count = new Map<string, number>()
  for (const f of list) {
    const ext = (/\.([a-z0-9]+)$/i.exec(f.name)?.[1] ?? '?').toUpperCase()
    count.set(ext, (count.get(ext) ?? 0) + 1)
  }
  return `${list.length} arquivos · ${[...count.entries()].map(([ext, n]) => `${n} ${ext}`).join(' · ')}`
}

/** Percorre pastas arrastadas (webkitGetAsEntry) e devolve todos os arquivos dentro delas. */
async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items ?? [])
    .map((item) => (typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => Boolean(e))
  if (!entries.length) return Array.from(dt.files)
  const out: File[] = []
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File | null>((resolve) => (entry as FileSystemFileEntry).file(resolve, () => resolve(null)))
      if (file) out.push(file)
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])))
        if (!batch.length) break
        for (const child of batch) await walk(child)
      }
    }
  }
  for (const entry of entries) await walk(entry)
  return out
}

/**
 * Importação de arquivos do Promob (CSV, XML, DXF, DXT): lê, mostra o que foi encontrado,
 * mapeia os materiais para o estoque/catálogo Leo e devolve as peças prontas para o plano.
 */
export function PromobImportDialog({
  initialFiles,
  hasPieces,
  onClose,
  onApply,
}: {
  initialFiles?: File[]
  hasPieces: boolean
  onClose: () => void
  onApply: (r: PromobApply) => void
}) {
  const toast = useToast()
  const { data, maps } = useCollections(['materials'] as const)
  const settings = useSettings()
  const inputRef = useRef<HTMLInputElement>(null)
  const folderRef = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [showAllWarnings, setShowAllWarnings] = useState(false)
  const [files, setFiles] = useState<File[]>([])
  const [imp, setImp] = useState<PromobImport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [matMap, setMatMap] = useState<Record<string, string | undefined>>({})
  const [edgeId, setEdgeId] = useState<string | undefined>()
  const [hwOn, setHwOn] = useState<Record<number, boolean>>({})
  const [replace, setReplace] = useState(false)
  const [drag, setDrag] = useState(false)

  const load = useCallback(
    async (all: File[]) => {
      if (!all.length) return
      // pastas inteiras trazem imagens e outros arquivos: só os formatos do Promob são lidos
      const list = all.filter((f) => isPromobFile(f.name))
      const skipped = all.length - list.length
      if (!list.length) {
        setImp(null)
        setError('Nenhum arquivo do Promob (CSV, XML, DXF ou DXT) foi encontrado na seleção.')
        return
      }
      setBusy(true)
      setError('')
      setShowAllWarnings(false)
      try {
        // leitura em lotes, cedendo a tela entre eles (centenas de DXFs não travam a página)
        const inputs: Array<{ name: string; bytes: Uint8Array }> = []
        setProgress({ done: 0, total: list.length })
        for (let i = 0; i < list.length; i += READ_BATCH) {
          const slice = list.slice(i, i + READ_BATCH)
          const read = await Promise.all(slice.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })))
          inputs.push(...read)
          setProgress({ done: Math.min(i + READ_BATCH, list.length), total: list.length })
          await tick()
        }
        const result = parsePromobFiles(inputs)
        result.ignored += skipped
        setFiles(list)
        setImp(result)
        // escolhas anteriores da empresa valem mais que a sugestão automática (o 2º arquivo já entra mapeado)
        const remembered = settings.get<{ map?: Record<string, string> }>('promobMaterialMap', {}).map ?? {}
        const auto = autoMapMaterials(result.parts, data.materials)
        for (const key of Object.keys(auto)) {
          const saved = remembered[key]
          if (saved && data.materials.some((m) => m.id === saved && m.active !== false)) auto[key] = saved
        }
        setMatMap(auto)
        setEdgeId(autoMapEdge(result.parts, data.materials))
        setHwOn(Object.fromEntries(result.hardware.map((_, i) => [i, true])))
      } catch (e) {
        setImp(null)
        setError(e instanceof Error ? e.message : 'Não foi possível ler os arquivos.')
      } finally {
        setBusy(false)
        setProgress(null)
      }
    },
    [data.materials, settings],
  )

  // arquivos recebidos de fora (ex.: anexo de tarefa) são lidos uma única vez
  const started = useRef(false)
  useEffect(() => {
    if (initialFiles?.length && !started.current && data.materials) {
      started.current = true
      void load(initialFiles)
    }
  }, [initialFiles, load, data.materials])

  const materials = useMemo(() => (imp ? summarizeMaterials(imp.parts) : []), [imp])
  const edges = useMemo(() => (imp ? summarizeEdges(imp.parts) : []), [imp])
  const stats = useMemo(() => (imp ? importStats(imp) : null), [imp])
  const unmapped = materials.filter((m) => !matMap[m.key])

  const apply = () => {
    if (!imp) return
    const pieces = toCutPieces(imp.parts, matMap)
    const hardware: CutPlan['hardware'] = imp.hardware
      .map((h, i) => ({ h, i }))
      .filter(({ i }) => hwOn[i])
      .map(({ h }) => {
        const hit = suggestMaterial(`${h.description} ${h.reference ?? ''}`, 0, {}, data.materials, 'ferragem')
        const mat = hit ? maps.materials.get(hit.id) : undefined
        return { id: uid(), materialId: mat?.id, description: h.description, quantity: Math.ceil(h.quantity), unitCost: mat?.cost ?? 0 }
      })
    // lembra o mapeamento para os próximos arquivos (sem bloquear a importação se não houver permissão)
    const rememberedNow = settings.get<{ map?: Record<string, string> }>('promobMaterialMap', {}).map ?? {}
    const chosen = Object.fromEntries(Object.entries(matMap).filter((entry): entry is [string, string] => Boolean(entry[1])))
    if (Object.keys(chosen).length) void settings.save('promobMaterialMap', { map: { ...rememberedNow, ...chosen } }).catch(() => undefined)
    // chapa padrão: material com mais área mapeado
    const defaultMaterialId = materials.map((m) => matMap[m.key]).find(Boolean)
    onApply({
      pieces,
      hardware,
      edgeMaterialId: edgeId,
      defaultMaterialId,
      replace,
      imports: [{ fileName: imp.fileNames.length > 3 ? `${imp.fileNames.slice(0, 3).join(', ')} … (${imp.fileNames.length} arquivos)` : imp.fileNames.join(', '), format: FORMAT_LABEL[imp.format], at: new Date().toISOString(), parts: pieces.length }],
      info: imp.info,
    })
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDrag(false)
    void filesFromDrop(e.dataTransfer).then((list) => load(list))
  }

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle>Importar do Promob</DialogTitle>
      <DialogContent>
        <input
          ref={inputRef}
          type="file"
          hidden
          multiple
          accept={ACCEPT}
          onChange={(e) => {
            void load(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <input
          ref={folderRef}
          type="file"
          hidden
          multiple
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => {
            void load(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
        <Paper
          variant="outlined"
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
          sx={{ p: 2.5, mb: 2, borderRadius: 3, borderStyle: 'dashed', borderColor: drag ? colors.brand : colors.borderStrong, bgcolor: drag ? colors.brandTint : colors.subtle, textAlign: 'center' }}
        >
          <Stack spacing={1} alignItems="center">
            <UploadFileIcon sx={{ color: colors.brand }} />
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              {files.length ? describeFiles(files) : 'Arraste os arquivos (ou a pasta) do Promob ou selecione'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              CSV (lista de corte ou peças com operações), XML (listagem), DXF (desenho por chapa) e DXT (lista de peças). Vários arquivos podem ser lidos juntos — por exemplo, um DXT com seus DXFs.
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button size="small" variant="outlined" disabled={busy} onClick={() => inputRef.current?.click()}>
                {files.length ? 'Trocar arquivos' : 'Selecionar arquivos'}
              </Button>
              <Button size="small" variant="outlined" disabled={busy} onClick={() => folderRef.current?.click()}>
                Selecionar pasta
              </Button>
            </Stack>
          </Stack>
        </Paper>

        {busy ? (
          <Box sx={{ mb: 2 }}>
            <LinearProgress {...(progress && progress.total > 1 ? { variant: 'determinate' as const, value: (progress.done / progress.total) * 100 } : {})} />
            <Typography variant="caption" color="text.secondary">
              {progress && progress.total > 1 ? `Lendo ${progress.done} de ${progress.total} arquivos…` : 'Lendo o arquivo…'}
            </Typography>
          </Box>
        ) : null}
        {error ? (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        ) : null}

        {imp && stats ? (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Chip size="small" color="primary" label={FORMAT_LABEL[imp.format]} />
              {imp.lots > 0 ? <Chip size="small" label={`${imp.lots} lote(s) de chapa`} /> : null}
              {imp.ignored > 0 ? <Chip size="small" color="warning" label={`${imp.ignored} arquivo(s) ignorado(s)`} /> : null}
              <Chip size="small" label={`${stats.lines} linhas · ${stats.units} peças`} />
              <Chip size="small" label={`${stats.edgeMeters.toFixed(1).replace('.', ',')} m de fita`} />
              <Chip size="small" label={`${stats.holes} furos`} />
              <Chip size="small" label={`${stats.grooves} rasgos/recortes`} />
              {stats.irregular ? <Chip size="small" color="warning" label={`${stats.irregular} peça(s) não retangular(es)`} /> : null}
              {imp.info.client ? <Chip size="small" variant="outlined" label={`Cliente: ${imp.info.client}`} /> : null}
              {imp.info.environments.slice(0, 3).map((e) => (
                <Chip key={e} size="small" variant="outlined" label={e} />
              ))}
            </Stack>

            {imp.warnings.length ? (
              <Alert severity="warning">
                <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                  {(showAllWarnings ? imp.warnings.slice(0, 300) : imp.warnings.slice(0, 8)).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {!showAllWarnings && imp.warnings.length > 8 ? (
                    <li>
                      … e mais {imp.warnings.length - 8} aviso(s){' '}
                      <Button size="small" onClick={() => setShowAllWarnings(true)}>
                        Ver todos
                      </Button>
                    </li>
                  ) : null}
                </Box>
              </Alert>
            ) : null}

            <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                Materiais do arquivo → estoque
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                Escolha o item do estoque (ou busque no catálogo Leo Madeiras, com preço em R$) que corresponde a cada material. A chapa do estoque define o formato e o custo usados na otimização.
              </Typography>
              <Box sx={{ overflowX: 'auto' }}>
                <Box sx={{ minWidth: 760 }}>
                  <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1.2fr) 150px minmax(280px, 1.5fr)', gap: 1, pb: 0.5 }}>
                    {['Material no arquivo', 'Uso', 'Chapa do estoque'].map((h) => (
                      <Typography key={h} variant="overline" color="text.secondary">
                        {h}
                      </Typography>
                    ))}
                  </Box>
                  {materials.map((m) => {
                    const mapped = maps.materials.get(matMap[m.key] ?? '')
                    return (
                      <Box key={m.key} sx={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 1.2fr) 150px minmax(280px, 1.5fr)', gap: 1, mb: 1, alignItems: 'center' }}>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {m.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {m.thickness ? `${m.thickness} mm` : 'espessura n/d'}
                            {m.sheetWidth ? ` · chapa ${m.sheetWidth}×${m.sheetHeight}` : ''}
                            {m.code ? ` · cód. ${m.code}` : ''}
                          </Typography>
                        </Box>
                        <Typography variant="body2" color="text.secondary">
                          {m.units} peças · {m.area.toFixed(2).replace('.', ',')} m²
                        </Typography>
                        <Box>
                          <MaterialPicker category="chapa" value={matMap[m.key]} placeholder="Escolher chapa…" onChange={(id) => setMatMap((s) => ({ ...s, [m.key]: id ?? undefined }))} />
                          {mapped && m.thickness && mapped.thickness && Math.abs(mapped.thickness - m.thickness) > 0.6 ? (
                            <Typography variant="caption" color="warning.main">
                              Espessura do estoque ({mapped.thickness} mm) difere do arquivo ({m.thickness} mm).
                            </Typography>
                          ) : null}
                        </Box>
                      </Box>
                    )
                  })}
                </Box>
              </Box>
              {unmapped.length ? (
                <Typography variant="caption" color="warning.main">
                  {unmapped.length} material(is) sem chapa: as peças correspondentes ficam sem material e usam a chapa padrão do plano.
                </Typography>
              ) : null}
            </Paper>

            {edges.length ? (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Fita de borda
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  {edges.map((e) => `${e.name}${e.height ? ` ${e.height}mm` : ''}: ${e.meters.toFixed(1).replace('.', ',')} m`).join(' · ')}
                </Typography>
                <Box sx={{ maxWidth: 520 }}>
                  <MaterialPicker label="Fita de borda do plano" category="fita_borda" value={edgeId} onChange={(id) => setEdgeId(id ?? undefined)} />
                </Box>
                {edges.length > 1 ? (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>
                    O plano usa uma fita única para o custo; as demais ficam registradas nas peças.
                  </Typography>
                ) : null}
              </Paper>
            ) : null}

            {imp.hardware.length ? (
              <Paper variant="outlined" sx={{ p: 2, borderRadius: 3 }}>
                <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                  Ferragens do arquivo ({imp.hardware.length})
                </Typography>
                <Box sx={{ maxHeight: 220, overflow: 'auto' }}>
                  {imp.hardware.map((h, i) => {
                    const hit = suggestMaterial(`${h.description} ${h.reference ?? ''}`, 0, {}, data.materials, 'ferragem')
                    const mat = hit ? maps.materials.get(hit.id) : undefined
                    return (
                      <Stack key={i} direction="row" spacing={1} alignItems="center">
                        <Checkbox size="small" checked={Boolean(hwOn[i])} onChange={(e) => setHwOn((s) => ({ ...s, [i]: e.target.checked }))} />
                        <Typography variant="body2" sx={{ flex: 1 }}>
                          {h.description}
                          {h.reference ? <Typography component="span" variant="caption" color="text.secondary"> · {h.reference}</Typography> : null}
                        </Typography>
                        <Typography variant="body2" sx={{ width: 80, textAlign: 'right' }}>
                          {round2(h.quantity)} {h.unit.toLowerCase()}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ width: 150, textAlign: 'right' }}>
                          {mat ? `${mat.name.slice(0, 18)} · ${brl(mat.cost)}` : 'sem item no estoque'}
                        </Typography>
                      </Stack>
                    )
                  })}
                </Box>
              </Paper>
            ) : null}

            {hasPieces ? (
              <RadioGroup row value={replace ? 'replace' : 'append'} onChange={(e) => setReplace(e.target.value === 'replace')}>
                <FormControlLabel value="append" control={<Radio size="small" />} label="Adicionar às peças do plano" />
                <FormControlLabel value="replace" control={<Radio size="small" />} label="Substituir as peças atuais" />
              </RadioGroup>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" startIcon={<CloseIcon />} onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          disabled={!imp || !imp.parts.length}
          onClick={() => {
            apply()
            toast.success('Peças do Promob importadas.')
          }}
        >
          Importar {imp ? `${imp.parts.length} linhas` : ''}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
