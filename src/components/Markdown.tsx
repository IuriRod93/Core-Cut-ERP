import { Fragment, type ReactNode } from 'react'
import { Box, Checkbox, Link, Typography } from '@mui/material'
import { colors } from '../theme'

/** Interpretação inline: **negrito**, *itálico*, `código` e [texto](https://link). Sem HTML — seguro para conteúdo digitado por usuários. */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\((?:https?:\/\/|mailto:)[^)\s]+\))/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    const tok = m[0]
    const key = `${keyBase}-${i++}`
    if (tok.startsWith('**')) out.push(<strong key={key}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) out.push(<code key={key} style={{ background: colors.subtle, padding: '1px 5px', borderRadius: 4, fontSize: '0.92em' }}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)!
      out.push(
        <Link key={key} href={mm[2]} target="_blank" rel="noopener noreferrer">
          {mm[1]}
        </Link>,
      )
    } else out.push(<em key={key}>{tok.slice(1, -1)}</em>)
    last = m.index + tok.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Renderizador de Markdown simples (títulos, listas, tarefas, citações, código e linhas). `onToggle` recebe o índice da linha de uma tarefa marcada/desmarcada. */
export function Markdown({ source, onToggle }: { source: string; onToggle?: (lineIndex: number) => void }) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let k = 0
  const flush = () => {
    if (!para.length) return
    blocks.push(
      <Typography key={`p${k++}`} variant="body2" sx={{ mb: 1.25, lineHeight: 1.65 }}>
        {inline(para.join(' '), `p${k}`)}
      </Typography>,
    )
    para = []
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim().startsWith('```')) {
      flush()
      const code: string[] = []
      i += 1
      while (i < lines.length && !lines[i].trim().startsWith('```')) code.push(lines[i++])
      blocks.push(
        <Box key={`c${k++}`} component="pre" sx={{ m: 0, mb: 1.25, p: 1.5, borderRadius: 2, bgcolor: colors.subtle, fontSize: 12.5, overflowX: 'auto' }}>
          {code.join('\n')}
        </Box>,
      )
      continue
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      flush()
      const level = h[1].length
      blocks.push(
        <Typography key={`h${k++}`} variant={level === 1 ? 'h4' : level === 2 ? 'h5' : 'h6'} sx={{ mt: 1.5, mb: 1 }}>
          {inline(h[2], `h${k}`)}
        </Typography>,
      )
      continue
    }
    if (/^---+$/.test(line.trim())) {
      flush()
      blocks.push(<Box key={`r${k++}`} sx={{ borderTop: `1px solid ${colors.border}`, my: 1.5 }} />)
      continue
    }
    const task = /^\s*[-*]\s+\[( |x|X)\]\s+(.*)$/.exec(line)
    if (task) {
      flush()
      const done = task[1].toLowerCase() === 'x'
      const idx = i
      blocks.push(
        <Box key={`t${k++}`} sx={{ display: 'flex', alignItems: 'center', ml: -1 }}>
          <Checkbox size="small" checked={done} disabled={!onToggle} onChange={() => onToggle?.(idx)} />
          <Typography variant="body2" sx={{ textDecoration: done ? 'line-through' : 'none', color: done ? 'text.secondary' : 'text.primary' }}>
            {inline(task[2], `t${k}`)}
          </Typography>
        </Box>,
      )
      continue
    }
    const li = /^\s*([-*]|\d+\.)\s+(.*)$/.exec(line)
    if (li) {
      flush()
      const ordered = /\d+\./.test(li[1])
      blocks.push(
        <Typography key={`l${k++}`} variant="body2" sx={{ display: 'flex', gap: 1, mb: 0.4, pl: 1 }}>
          <span style={{ color: colors.textMuted, minWidth: 18 }}>{ordered ? li[1] : '•'}</span>
          <span>{inline(li[2], `l${k}`)}</span>
        </Typography>,
      )
      continue
    }
    if (line.startsWith('>')) {
      flush()
      blocks.push(
        <Box key={`q${k++}`} sx={{ borderLeft: `3px solid ${colors.brand}`, pl: 1.5, py: 0.25, mb: 1.25, color: 'text.secondary' }}>
          <Typography variant="body2">{inline(line.replace(/^>\s?/, ''), `q${k}`)}</Typography>
        </Box>,
      )
      continue
    }
    if (!line.trim()) {
      flush()
      continue
    }
    para.push(line.trim())
  }
  flush()
  return (
    <Fragment>
      <Box>{blocks.length ? blocks : <Typography variant="body2" color="text.secondary">Documento vazio.</Typography>}</Box>
    </Fragment>
  )
}
