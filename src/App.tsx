import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { Box, CircularProgress } from '@mui/material'
import { useAuth } from './auth/AuthContext'
import { LoginPage } from './pages/Login'
import { CompanySignupPage } from './pages/CompanySignup'
import { ForgotPasswordPage, ResetPasswordPage } from './pages/PasswordRecovery'
import { PaywallPage, SubscriptionResultPage } from './pages/Subscription'
import { LandingPage } from './pages/Landing'
import { PrivacyPage, TermsPage } from './pages/Legal'
import { ClientPortalPage } from './pages/ClientPortal'
import { AppDownloadPage } from './pages/AppDownload'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LoadingState } from './components/ui'
import { EmptyState } from './components/ui'
import { LockIcon } from './components/icons'
import type { ModuleKey } from './types'
import { colors } from './theme'

const lazyPage = (loader: () => Promise<Record<string, unknown>>, name: string) =>
  lazy(() => loader().then((m) => ({ default: m[name] as React.ComponentType })))

// Código das telas internas: carregado só depois do login (o servidor não o entrega a quem não tem sessão).
const AppShell = lazyPage(() => import('./layout/AppShell'), 'AppShell')
const PlatformShell = lazy(() => import('./layout/PlatformShell').then((m) => ({ default: m.PlatformShell })))
const ChangePasswordPage = lazyPage(() => import('./pages/ChangePassword'), 'ChangePasswordPage')
const CommissionsPage = lazyPage(() => import('./pages/Commissions'), 'CommissionsPage')
const InvoicesPage = lazyPage(() => import('./pages/Invoices'), 'InvoicesPage')
const Dashboard = lazyPage(() => import('./pages/Dashboard'), 'DashboardPage')
const PlatformAdmin = lazyPage(() => import('./pages/PlatformAdmin'), 'PlatformAdminPage')
const PlatformPaymentTest = lazyPage(() => import('./pages/PlatformPaymentTest'), 'PlatformPaymentTestPage')
const MyTasks = lazyPage(() => import('./pages/MyTasks'), 'MyTasksPage')
const Agenda = lazyPage(() => import('./pages/Agenda'), 'AgendaPage')
const Leads = lazyPage(() => import('./pages/Leads'), 'LeadsPage')
const Budgets = lazyPage(() => import('./pages/Budgets'), 'BudgetsPage')
const Contracts = lazyPage(() => import('./pages/Contracts'), 'ContractsPage')
const Projects = lazyPage(() => import('./pages/Projects'), 'ProjectsPage')
const ProjectWorkspace = lazyPage(() => import('./pages/ProjectWorkspace'), 'ProjectWorkspacePage')
const Production = lazyPage(() => import('./pages/Production'), 'ProductionPage')
const ShopFloor = lazyPage(() => import('./pages/ShopFloor'), 'ShopFloorPage')
const CutPlan = lazyPage(() => import('./pages/CutPlan'), 'CutPlanPage')
const Boms = lazyPage(() => import('./pages/Boms'), 'BomsPage')
const Inventory = lazyPage(() => import('./pages/Inventory'), 'InventoryPage')
const Purchases = lazyPage(() => import('./pages/Purchases'), 'PurchasesPage')
const Financial = lazyPage(() => import('./pages/Financial'), 'FinancialPage')
const Team = lazyPage(() => import('./pages/Team'), 'TeamPage')
const Timeclock = lazyPage(() => import('./pages/Timeclock'), 'TimeclockPage')
const Reports = lazyPage(() => import('./pages/Reports'), 'ReportsPage')
const Files = lazyPage(() => import('./pages/Files'), 'FilesPage')
const Settings = lazyPage(() => import('./pages/Settings'), 'SettingsPage')
const AuditLog = lazyPage(() => import('./pages/AuditLog'), 'AuditLogPage')
const Clients = lazyPage(() => import('./pages/registers'), 'ClientsPage')
const Suppliers = lazyPage(() => import('./pages/registers'), 'SuppliersPage')
const Vehicles = lazyPage(() => import('./pages/registers'), 'VehiclesPage')
const Quality = lazyPage(() => import('./pages/registers'), 'QualityPage')
const Maintenance = lazyPage(() => import('./pages/registers'), 'MaintenancePage')
const Warranties = lazyPage(() => import('./pages/registers'), 'WarrantiesPage')
const Logistics = lazyPage(() => import('./pages/registers'), 'LogisticsPage')

function Guard({ module, children }: { module: ModuleKey; children: React.ReactNode }) {
  const { can } = useAuth()
  if (!can(module)) {
    return <EmptyState icon={<LockIcon />} title="Acesso restrito" description="Seu perfil não tem permissão para este módulo. Solicite acesso ao administrador do sistema." />
  }
  return <>{children}</>
}

function RequireAuth() {
  const { user, company, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><LoadingState /></Box>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.passwordMustChange && location.pathname !== '/alterar-senha') return <Navigate to="/alterar-senha" replace state={{ from: location.pathname }} />
  if (user.passwordMustChange) return <ChangePasswordPage />
  if (company && !company.access.allowed) return <PaywallPage />
  return <AppShell />
}

/** Painel da plataforma: moldura própria e acesso só para administradores da base original (sem empresa). */
function PlatformRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center' }}><LoadingState /></Box>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  if (user.passwordMustChange) return <Navigate to="/alterar-senha" replace state={{ from: location.pathname }} />
  if (user.companyId || user.role !== 'admin') {
    return (
      <Box sx={{ minHeight: '100vh', display: 'grid', placeItems: 'center', p: 3 }}>
        <EmptyState icon={<LockIcon />} title="Acesso restrito" description="O Painel Admin é exclusivo da administração da plataforma." />
      </Box>
    )
  }
  return <PlatformShell>{children}</PlatformShell>
}

const guarded = (module: ModuleKey, element: React.ReactNode) => <Guard module={module}>{element}</Guard>

export default function App() {
  return (
    <ErrorBoundary>
    <Suspense
      fallback={
        <Box sx={{ minHeight: '60vh', display: 'grid', placeItems: 'center' }}>
          <CircularProgress size={28} sx={{ color: colors.brand }} />
        </Box>
      }
    >
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/cadastro" element={<CompanySignupPage />} />
        <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
        <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
        <Route path="/admin" element={<PlatformRoute><PlatformAdmin /></PlatformRoute>} />
        <Route path="/admin/teste-pagamento" element={<PlatformRoute><PlatformPaymentTest /></PlatformRoute>} />
        <Route path="/acompanhar/:token" element={<ClientPortalPage />} />
        <Route path="/app" element={<AppDownloadPage />} />
        <Route path="/termos" element={<TermsPage />} />
        <Route path="/privacidade" element={<PrivacyPage />} />
        <Route path="/assinatura" element={<SubscriptionResultPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/painel" element={<Dashboard />} />
          <Route path="/alterar-senha" element={<ChangePasswordPage />} />
          <Route path="/tarefas" element={guarded('tasks', <MyTasks />)} />
          <Route path="/agenda" element={guarded('agenda', <Agenda />)} />
          <Route path="/leads" element={guarded('leads', <Leads />)} />
          <Route path="/clientes" element={guarded('clients', <Clients />)} />
          <Route path="/orcamentos" element={guarded('budgets', <Budgets />)} />
          <Route path="/contratos" element={guarded('contracts', <Contracts />)} />
          <Route path="/projetos" element={guarded('projects', <Projects />)} />
          <Route path="/projetos/:projectId" element={guarded('projects', <ProjectWorkspace />)} />
          <Route path="/producao" element={guarded('production', <Production />)} />
          <Route path="/chao-de-fabrica" element={guarded('shopfloor', <ShopFloor />)} />
          <Route path="/plano-de-corte" element={guarded('cutplan', <CutPlan />)} />
          <Route path="/fichas-tecnicas" element={guarded('bom', <Boms />)} />
          <Route path="/qualidade" element={guarded('quality', <Quality />)} />
          <Route path="/manutencao" element={guarded('maintenance', <Maintenance />)} />
          <Route path="/entregas" element={guarded('logistics', <Logistics />)} />
          <Route path="/garantias" element={guarded('warranty', <Warranties />)} />
          <Route path="/estoque" element={guarded('inventory', <Inventory />)} />
          <Route path="/compras" element={guarded('purchases', <Purchases />)} />
          <Route path="/fornecedores" element={guarded('suppliers', <Suppliers />)} />
          <Route path="/financeiro" element={guarded('financial', <Financial />)} />
          <Route path="/notas-fiscais" element={guarded('financial', <InvoicesPage />)} />
          <Route path="/comissoes" element={guarded('financial', <CommissionsPage />)} />
          <Route path="/equipe" element={guarded('team', <Team />)} />
          <Route path="/ponto" element={guarded('timeclock', <Timeclock />)} />
          <Route path="/veiculos" element={guarded('vehicles', <Vehicles />)} />
          <Route path="/relatorios" element={guarded('reports', <Reports />)} />
          <Route path="/arquivos" element={guarded('files', <Files />)} />
          <Route path="/logs" element={guarded('audit', <AuditLog />)} />
          <Route path="/configuracoes" element={guarded('settings', <Settings />)} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
    </ErrorBoundary>
  )
}
