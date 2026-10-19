import { forwardRef } from 'react'
import { Stack as MuiStack, type StackProps } from '@mui/material'

type Responsive = string | number | Record<string, string | number>

export type ArcoStackProps = StackProps & {
  alignItems?: Responsive
  justifyContent?: Responsive
  flexWrap?: Responsive
}

/**
 * Stack com as props de alinhamento do MUI v5/v6 (removidas no v9).
 * Mantém `useFlexGap` ligado para que `spacing` funcione com quebra de linha.
 */
export const Stack = forwardRef<HTMLDivElement, ArcoStackProps>(function Stack(
  { alignItems, justifyContent, flexWrap, sx, useFlexGap = true, ...rest },
  ref,
) {
  const extra: Record<string, unknown> = {}
  if (alignItems !== undefined) extra.alignItems = alignItems
  if (justifyContent !== undefined) extra.justifyContent = justifyContent
  if (flexWrap !== undefined) extra.flexWrap = flexWrap
  return <MuiStack ref={ref} useFlexGap={useFlexGap} {...rest} sx={[extra, ...(Array.isArray(sx) ? sx : sx ? [sx] : [])] as never} />
})
