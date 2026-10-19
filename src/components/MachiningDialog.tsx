import { useState } from 'react'
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem, TextField, Typography } from '@mui/material'
import { Stack } from './Stack'
import { NumberField } from './forms'
import { AddIcon, AutoAwesomeIcon, CloseIcon } from './icons'
import { METHOD_PRESETS, edgeSegments, hingeHoles, newMachining, presetOf, shelfPinHoles } from '../domain/machining'
import { colors } from '../theme'
import type { CutPiece, Machining, MachiningMethod } from '../types'

type PieceLike = Pick<CutPiece, 'label' | 'length' | 'width' | 'edgeTop' | 'edgeBottom' | 'edgeLeft' | 'edgeRight'> & Partial<Pick<CutPiece, 'contour' | 'edgeExtra'>>

/** Pré-visualização da peça com furos, rasgos e arestas fitadas (vista de topo, origem embaixo à esquerda). */
export function PiecePreview({ piece, machining, maxWidth = 560 }: { piece: PieceLike; machining: Machining[]; maxWidth?: number }) {
  const L = Math.max(piece.length, 1)
  const W = Math.max(piece.width, 1)
  const pad = 26
  const scale = Math.min((maxWidth - pad * 2) / L, 240 / W)
  const w = L * scale
  const h = W * scale
  const X = (x: number) => pad + x * scale
  const Y = (y: number) => pad + (W - y) * scale
  return (
    <svg viewBox={`0 0 ${w + pad * 2} ${h + pad * 2}`} style={{ width: '100%', maxWidth, display: 'block', margin: '0 auto' }} role="img" aria-label="Pré-visualização da peça">
      {piece.contour && piece.contour.length >= 3 ? (
        <polygon points={piece.contour.map((c) => `${X(c.x)},${Y(c.y)}`).join(' ')} fill="#f4f1ec" stroke="#8c8279" strokeWidth={1.5} />
      ) : (
        <rect x={X(0)} y={Y(W)} width={w} height={h} fill="#f4f1ec" stroke="#8c8279" strokeWidth={1.5} />
      )}
      {edgeSegments(piece).map(([x1, y1, x2, y2], i) => (
        <line key={i} x1={X(x1)} y1={Y(y1)} x2={X(x2)} y2={Y(y2)} stroke={colors.brand} strokeWidth={4} strokeLinecap="square" />
      ))}
      {machining.map((m) =>
        m.kind === 'furo' ? (
          <g key={m.id}>
            <circle
              cx={X(m.x)}
              cy={Y(m.y)}
              r={Math.max(((m.diameter ?? 5) / 2) * scale, 2.5)}
              fill={m.face === 'borda' ? '#fff3d6' : '#fff'}
              stroke={m.face === 'borda' ? colors.warning : colors.text}
              strokeWidth={1.2}
              strokeDasharray={m.face === 'fundo' ? '2 2' : undefined}
            />
            <circle cx={X(m.x)} cy={Y(m.y)} r={1} fill={colors.text} />
          </g>
        ) : (
          <rect
            key={m.id}
            x={m.kind === 'rasgo' && m.axis === 'y' ? X(m.x - (m.width ?? 6) / 2) : X(m.x)}
            y={m.kind === 'rasgo' && m.axis === 'y' ? Y(m.y + (m.length ?? 0)) : Y(m.y + (m.kind === 'rasgo' ? (m.width ?? 6) / 2 : (m.width ?? 0)))}
            width={m.kind === 'rasgo' && m.axis === 'y' ? Math.max((m.width ?? 6) * scale, 2) : (m.length ?? 0) * scale}
            height={m.kind === 'rasgo' && m.axis === 'y' ? (m.length ?? 0) * scale : Math.max((m.width ?? 6) * scale, 2)}
            fill="rgba(112,6,24,0.15)"
            stroke={colors.brand}
            strokeWidth={1}
            strokeDasharray={m.face === 'fundo' ? '3 2' : undefined}
          />
        ),
      )}
      <text x={X(0)} y={pad - 9} fontSize={10} fill={colors.textSecondary}>
        {L} × {W} mm · origem no canto inferior esquerdo
      </text>
    </svg>
  )
}

export function MachiningDialog({ piece, value, onClose, onSave }: { piece: PieceLike; value: Machining[]; onClose: () => void; onSave: (list: Machining[]) => void }) {
  const [list, setList] = useState<Machining[]>(value)
  const [shelves, setShelves] = useState<number | null>(2)
  const update = (id: string, patch: Partial<Machining>) => setList((l) => l.map((m) => (m.id === id ? { ...m, ...patch } : m)))
  const add = (items: Machining[]) => setList((l) => [...l, ...items])

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>Usinagens · {piece.label || 'peça'}</DialogTitle>
      <DialogContent>
        <Box sx={{ border: `1px solid ${colors.border}`, borderRadius: 2, p: 1, mb: 2, bgcolor: '#fff' }}>
          <PiecePreview piece={piece} machining={list} />
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2, flexWrap: 'wrap' }}>
          <Button size="small" variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={() => add(hingeHoles(piece.length, piece.width))}>
            Dobradiças (automático)
          </Button>
          <Button size="small" variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={() => add(shelfPinHoles(piece.length, piece.width, shelves ?? 0))}>
            Pinos de prateleira
          </Button>
          <Box sx={{ width: 110 }}>
            <NumberField label="Prateleiras" value={shelves} min={1} decimals={0} onChange={setShelves} />
          </Box>
          <Button size="small" variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={() => add([{ ...newMachining('rasgo_fundo', 10, 10), length: Math.max(piece.length - 20, 10) }])}>
            Rasgo para fundo
          </Button>
          <Button size="small" variant="outlined" startIcon={<AutoAwesomeIcon />} onClick={() => add([newMachining('puxador_5', piece.length / 2 - 64, 40), newMachining('puxador_5', piece.length / 2 + 64, 40)])}>
            Puxador 128 mm
          </Button>
        </Stack>

        <Typography variant="overline" color="text.secondary" sx={{ display: 'block' }}>
          Adicionar método
        </Typography>
        <Stack direction="row" spacing={0.5} sx={{ mb: 2, flexWrap: 'wrap' }}>
          {METHOD_PRESETS.map((p) => (
            <Button
              key={p.method}
              size="small"
              startIcon={<AddIcon />}
              title={p.hint}
              onClick={() => add([newMachining(p.method as MachiningMethod, Math.round(piece.length / 2), Math.round(piece.width / 2))])}
            >
              {p.label}
            </Button>
          ))}
        </Stack>

        {list.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
            Nenhuma usinagem. Use os atalhos acima para incluir furos, rasgos ou recortes.
          </Typography>
        ) : (
          <Box sx={{ overflowX: 'auto' }}>
            <Box sx={{ minWidth: 880 }}>
              <Box sx={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 80px 80px 80px 80px 80px 80px 96px 32px', gap: 0.75, pb: 0.5 }}>
                {['Método', 'Face', 'X (mm)', 'Y (mm)', 'Ø (mm)', 'Prof.', 'Compr.', 'Larg.', 'Sentido', ''].map((h) => (
                  <Typography key={h} variant="overline" color="text.secondary">
                    {h}
                  </Typography>
                ))}
              </Box>
              {list.map((m) => (
                <Box key={m.id} sx={{ display: 'grid', gridTemplateColumns: '2.2fr 1fr 80px 80px 80px 80px 80px 80px 96px 32px', gap: 0.75, mb: 0.75, alignItems: 'center' }}>
                  <TextField
                    select
                    value={m.method}
                    onChange={(e) => {
                      const p = presetOf(e.target.value as MachiningMethod)
                      update(m.id, { method: e.target.value as MachiningMethod, kind: p?.kind ?? m.kind, face: p?.face ?? m.face, diameter: p?.diameter, depth: p?.depth ?? m.depth, width: p?.width ?? m.width })
                    }}
                  >
                    {METHOD_PRESETS.map((p) => (
                      <MenuItem key={p.method} value={p.method}>
                        {p.label}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField select value={m.face} onChange={(e) => update(m.id, { face: e.target.value as Machining['face'] })}>
                    <MenuItem value="topo">Topo</MenuItem>
                    <MenuItem value="fundo">Face inferior</MenuItem>
                    {m.kind === 'furo' && <MenuItem value="borda">Borda</MenuItem>}
                  </TextField>
                  <NumberField value={m.x} min={0} decimals={1} onChange={(v) => update(m.id, { x: v ?? 0 })} />
                  <NumberField value={m.y} min={0} decimals={1} onChange={(v) => update(m.id, { y: v ?? 0 })} />
                  <NumberField value={m.diameter ?? null} min={0} decimals={1} disabled={m.kind !== 'furo'} onChange={(v) => update(m.id, { diameter: v ?? undefined })} />
                  <NumberField value={m.depth} min={0} decimals={1} onChange={(v) => update(m.id, { depth: v ?? 0 })} />
                  <NumberField value={m.length ?? null} min={0} decimals={1} disabled={m.kind === 'furo'} onChange={(v) => update(m.id, { length: v ?? undefined })} />
                  <NumberField value={m.width ?? null} min={0} decimals={1} disabled={m.kind === 'furo'} onChange={(v) => update(m.id, { width: v ?? undefined })} />
                  <TextField select value={m.axis ?? 'x'} disabled={m.kind !== 'rasgo'} onChange={(e) => update(m.id, { axis: e.target.value as 'x' | 'y' })}>
                    <MenuItem value="x">Comprimento</MenuItem>
                    <MenuItem value="y">Largura</MenuItem>
                  </TextField>
                  <IconButton size="small" onClick={() => setList((l) => l.filter((x) => x.id !== m.id))} aria-label="Remover usinagem">
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          </Box>
        )}
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Coordenadas a partir do canto inferior esquerdo da peça (X no comprimento, Y na largura). Furos de borda e da face inferior ficam registrados no plano, mas não entram no G-code do router.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={() => {
            onSave(list)
            onClose()
          }}
        >
          Aplicar à peça
        </Button>
      </DialogActions>
    </Dialog>
  )
}
