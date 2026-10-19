import { Box, Typography } from '@mui/material'

interface LogoProps {
  /** wordmark = marca e nome; mono = apenas o símbolo. */
  variant?: 'wordmark' | 'mono'
  height?: number
  color?: string
  title?: string
}

export function Logo({ variant = 'wordmark', height = 22, color = '#142934', title = 'Core Cut ERP' }: LogoProps) {
  if (variant === 'mono') {
    return (
      <Box
        component="img"
        src="/core-cut-logo.png"
        alt={title}
        sx={{ height, width: height, objectFit: 'contain', display: 'block', flexShrink: 0 }}
      />
    )
  }
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, height, flexShrink: 0 }}>
      <Box
        component="img"
        src="/core-cut-logo.png"
        alt=""
        aria-hidden="true"
        sx={{ height, width: height, objectFit: 'contain', display: 'block', flexShrink: 0 }}
      />
      <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', lineHeight: 1 }}>
        <Typography component="span" sx={{ color, fontSize: height * 0.62, fontWeight: 700, letterSpacing: '0.055em', lineHeight: 1 }}>
          CORE CUT
        </Typography>
        <Typography component="span" sx={{ color: '#159db8', fontSize: height * 0.31, fontWeight: 700, letterSpacing: '0.2em', mt: '2px', lineHeight: 1 }}>
          ERP
        </Typography>
      </Box>
    </Box>
  )
}
