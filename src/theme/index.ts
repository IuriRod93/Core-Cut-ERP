import { createTheme, alpha } from '@mui/material/styles'

export const colors = {
  brand: '#1389a8',
  brandDark: '#086681',
  brandLight: '#48b6d0',
  brandTint: '#edf8fb',
  brandTint2: '#d9f0f5',
  oak: '#a67b52',
  oakLight: '#eadfd1',
  bg: '#f8f7f5',
  paper: '#ffffff',
  subtle: '#fbfaf9',
  border: '#e8e4df',
  borderStrong: '#d6d0c9',
  text: '#1e1a19',
  textSecondary: '#6a625d',
  textMuted: '#968e88',
  success: '#2e7d4f',
  warning: '#b7791f',
  error: '#c23b3b',
  info: '#2f6f9f',
}

// Paleta para séries de gráficos — azul Core Cut primeiro, depois neutros e madeira.
export const chartPalette = ['#1389a8', '#a67b52', '#2f6f9f', '#2f8f8a', '#b7791f', '#6b5fa8', '#8b8f98', '#3f7a4f']

export const fontStack = '"Inter Variable", "Inter", "Segoe UI", system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif'
export const brandFont = '"Jost", "Inter Variable", "Segoe UI", system-ui, sans-serif'

export const theme = createTheme({
  cssVariables: false,
  palette: {
    mode: 'light',
    primary: { main: colors.brand, dark: colors.brandDark, light: colors.brandLight, contrastText: '#fff' },
    secondary: { main: colors.oak, contrastText: '#fff' },
    success: { main: colors.success },
    warning: { main: colors.warning },
    error: { main: colors.error },
    info: { main: colors.info },
    background: { default: colors.bg, paper: colors.paper },
    text: { primary: colors.text, secondary: colors.textSecondary, disabled: colors.textMuted },
    divider: colors.border,
    action: { hover: alpha(colors.brand, 0.04), selected: alpha(colors.brand, 0.08) },
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: fontStack,
    fontSize: 14,
    h1: { fontFamily: brandFont, fontSize: '2.25rem', fontWeight: 500, letterSpacing: '-0.01em' },
    h2: { fontFamily: brandFont, fontSize: '1.875rem', fontWeight: 500, letterSpacing: '-0.01em' },
    h3: { fontFamily: brandFont, fontSize: '1.5rem', fontWeight: 500 },
    h4: { fontFamily: brandFont, fontSize: '1.3rem', fontWeight: 500 },
    h5: { fontFamily: brandFont, fontSize: '1.125rem', fontWeight: 500 },
    h6: { fontFamily: brandFont, fontSize: '1rem', fontWeight: 500 },
    subtitle1: { fontSize: '0.95rem', fontWeight: 600 },
    subtitle2: { fontSize: '0.8125rem', fontWeight: 600 },
    body1: { fontSize: '0.9rem', lineHeight: 1.55 },
    body2: { fontSize: '0.8125rem', lineHeight: 1.5 },
    caption: { fontSize: '0.75rem', color: colors.textSecondary },
    overline: { fontSize: '0.6875rem', fontWeight: 600, letterSpacing: '0.09em', lineHeight: 1.4 },
    button: { textTransform: 'none', fontWeight: 600, fontSize: '0.8125rem' },
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: { backgroundColor: colors.bg, fontFeatureSettings: '"cv11", "ss01"', WebkitFontSmoothing: 'antialiased' },
        '*::-webkit-scrollbar': { width: 10, height: 10 },
        '*::-webkit-scrollbar-thumb': { background: '#d6d0c9', borderRadius: 8, border: '2px solid transparent', backgroundClip: 'content-box' },
        '*::-webkit-scrollbar-thumb:hover': { background: '#bdb5ad', backgroundClip: 'content-box', border: '2px solid transparent' },
        '::selection': { background: alpha(colors.brand, 0.18) },
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 8, padding: '6px 14px', minHeight: 34, '&.MuiButton-containedPrimary:hover': { backgroundColor: colors.brandDark } },
        sizeSmall: { padding: '3px 10px', minHeight: 28, fontSize: '0.78rem' },
        sizeLarge: { padding: '9px 20px', minHeight: 42 },
        outlined: { borderColor: colors.borderStrong, color: colors.text, '&:hover': { borderColor: colors.brand, backgroundColor: colors.brandTint } },
        text: { '&:hover': { backgroundColor: colors.brandTint } },
      },
    },
    MuiIconButton: { styleOverrides: { root: { borderRadius: 8 } } },
    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { border: `1px solid ${colors.border}`, borderRadius: 12, backgroundImage: 'none' } },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { root: { backgroundImage: 'none' }, outlined: { borderColor: colors.border } },
    },
    MuiDialog: {
      styleOverrides: { paper: { borderRadius: 14, boxShadow: '0 24px 64px rgba(30,26,25,0.18)' } },
    },
    MuiDialogTitle: { styleOverrides: { root: { fontFamily: brandFont, fontSize: '1.2rem', fontWeight: 500, padding: '18px 24px 12px' } } },
    MuiDialogContent: { styleOverrides: { root: { padding: '8px 24px 16px', '.MuiDialogTitle-root + &': { paddingTop: 14 } } } },
    MuiDialogActions: { styleOverrides: { root: { padding: '12px 24px 18px', gap: 4 } } },
    MuiTextField: { defaultProps: { size: 'small', variant: 'outlined', fullWidth: true } },
    MuiFormControl: { defaultProps: { size: 'small' } },
    MuiSelect: { defaultProps: { size: 'small' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          backgroundColor: '#fff',
          '& .MuiOutlinedInput-notchedOutline': { borderColor: colors.borderStrong },
          '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: '#b9b0a7' },
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: colors.brand, borderWidth: 1.5 },
        },
        input: { fontSize: '0.875rem' },
      },
    },
    MuiInputLabel: { styleOverrides: { root: { fontSize: '0.875rem' } } },
    MuiChip: {
      styleOverrides: {
        root: { borderRadius: 6, fontWeight: 600, fontSize: '0.72rem', height: 24 },
        sizeSmall: { height: 22 },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: { minHeight: 42 },
        indicator: { height: 2.5, borderRadius: 2, backgroundColor: colors.brand },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: { minHeight: 42, padding: '8px 14px', fontWeight: 600, fontSize: '0.8125rem', color: colors.textSecondary, '&.Mui-selected': { color: colors.brand } },
      },
    },
    MuiTableCell: {
      styleOverrides: {
        root: { borderColor: colors.border, padding: '10px 14px', fontSize: '0.8125rem' },
        head: { fontWeight: 600, color: colors.textSecondary, backgroundColor: colors.subtle, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' },
      },
    },
    MuiTableRow: { styleOverrides: { root: { '&.MuiTableRow-hover:hover': { backgroundColor: alpha(colors.brand, 0.035) } } } },
    MuiMenu: { styleOverrides: { paper: { border: `1px solid ${colors.border}`, boxShadow: '0 12px 32px rgba(30,26,25,0.12)', borderRadius: 10 } } },
    MuiMenuItem: { styleOverrides: { root: { fontSize: '0.8125rem', minHeight: 36 } } },
    MuiTooltip: { styleOverrides: { tooltip: { backgroundColor: '#2a2523', fontSize: '0.72rem', borderRadius: 6 } } },
    MuiDrawer: { styleOverrides: { paper: { borderColor: colors.border } } },
    MuiLinearProgress: { styleOverrides: { root: { borderRadius: 6, backgroundColor: colors.border } } },
    MuiAlert: { styleOverrides: { root: { borderRadius: 10, fontSize: '0.8125rem' } } },
    MuiDivider: { styleOverrides: { root: { borderColor: colors.border } } },
    MuiListItemButton: {
      styleOverrides: {
        root: { borderRadius: 8, '&.Mui-selected': { backgroundColor: colors.brandTint, '&:hover': { backgroundColor: colors.brandTint2 } } },
      },
    },
    MuiAvatar: { styleOverrides: { root: { fontSize: '0.78rem', fontWeight: 700 } } },
  },
})
