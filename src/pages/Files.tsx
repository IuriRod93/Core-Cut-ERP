import { Box } from '@mui/material'
import { PageHeader } from '../components/ui'
import { FileBrowser } from '../components/FileBrowser'

export function FilesPage() {
  return (
    <Box>
      <PageHeader title="Arquivos" subtitle="Desenhos técnicos, contratos, fotos de obra e documentos — organizados por pasta, projeto e nível de acesso." />
      <FileBrowser />
    </Box>
  )
}
