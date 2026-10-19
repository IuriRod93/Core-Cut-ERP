import { useEffect, useState, type ReactNode } from 'react'
import { Link as RouterLink, Navigate } from 'react-router-dom'
import { Logo } from '../brand/Logo'
import { useAuth } from '../auth/AuthContext'
import { api } from '../lib/api'
import { brl } from '../lib/format'
import { isUnlimited, type BillingPlan } from '../lib/billing'
import {
  AccountBalanceIcon,
  AssignmentIcon,
  BusinessIcon,
  CheckCircleIcon,
  ContentCutIcon,
  FactoryIcon,
  GroupsIcon,
  HistoryIcon,
  Inventory2Icon,
  KeyIcon,
  LockIcon,
  RequestQuoteIcon,
  ShoppingCartIcon,
  VerifiedIcon,
} from '../components/icons'
import './landing.css'

/** Contatos exibidos no site. Deixe `email` vazio para ocultá-lo até que o endereço seja confirmado. */
const CONTACT = {
  phoneDisplay: '(21) 99307-9682',
  whatsapp: `https://wa.me/5521993079682?text=${encodeURIComponent('Olá! Gostaria de conhecer o Core Cut ERP e o plano de corte.')}`,
  instagram: 'https://www.instagram.com/core_cut4.0/',
  instagramHandle: '@core_cut4.0',
  email: '',
}

const fallbackPlans: BillingPlan[] = [
  { id: 'essencial', name: 'Essencial', price: 99, currency: 'BRL', interval: 'month', description: 'Projetos, clientes, orçamentos e financeiro básico.', highlights: ['Até 3 usuários', 'Projetos e orçamentos', 'Estoque e fornecedores'], mobileApp: false, limits: { maxUsers: 3, maxProjects: 50, maxBudgets: 100, maxProductionOrders: 50, maxInventoryItems: 200 } },
  { id: 'profissional', name: 'Profissional', price: 199, currency: 'BRL', interval: 'month', description: 'Operação completa para marcenarias em crescimento.', highlights: ['Até 10 usuários', 'Produção e plano de corte', 'Compras e qualidade', 'Aplicativo Android e iOS'], mobileApp: true, limits: { maxUsers: 10, maxProjects: 200, maxBudgets: 500, maxProductionOrders: 200, maxInventoryItems: 1000 } },
  { id: 'industrial', name: 'Industrial', price: 399, currency: 'BRL', interval: 'month', description: 'Controle avançado para produção em escala.', highlights: ['Usuários ilimitados', 'Chão de fábrica e manutenção', 'Relatórios e automações', 'Aplicativo Android e iOS'], mobileApp: true, limits: { maxUsers: 999999, maxProjects: 999999, maxBudgets: 999999, maxProductionOrders: 999999, maxInventoryItems: 999999 } },
]

const features: Array<{ icon: ReactNode; title: string; text: string }> = [
  { icon: <RequestQuoteIcon />, title: 'Orçamentos e contratos', text: 'Custo real, margem e impostos; proposta e contrato em PDF com a sua marca. Aprovou o orçamento, o projeto, a ordem de produção e as parcelas nascem juntos.' },
  { icon: <AssignmentIcon />, title: 'Projetos e tarefas', text: 'Quadro, lista, calendário, cronograma e carga de trabalho. Responsáveis, prazos, checklists, comentários e avisos de atraso.' },
  { icon: <FactoryIcon />, title: 'Produção e chão de fábrica', text: 'Ordens com roteiro por setor, necessidade de materiais, reserva de estoque e apontamento de tempo direto na bancada.' },
  { icon: <ContentCutIcon />, title: 'Plano de corte', text: 'Otimização de chapas com fita de borda e usinagens, custo em reais, etiquetas com QR Code e G-code por chapa.' },
  { icon: <Inventory2Icon />, title: 'Estoque e catálogo', text: 'Saldo mínimo, movimentações e catálogo da Leo Madeiras com chapas, ferragens e fitas de borda com preço em reais.' },
  { icon: <ShoppingCartIcon />, title: 'Compras e fornecedores', text: 'Da solicitação ao recebimento, com aprovação, vínculo à ordem de produção e entrada automática no estoque.' },
  { icon: <AccountBalanceIcon />, title: 'Financeiro', text: 'Contas a receber e a pagar com parcelamento e baixa, fluxo de caixa projetado e resultado por categoria.' },
  { icon: <VerifiedIcon />, title: 'Qualidade, entregas e garantia', text: 'Inspeções e não conformidades, entregas e instalações com equipe e checklist, assistência e garantias.' },
  { icon: <GroupsIcon />, title: 'Equipe e permissões', text: 'Perfis por função, módulos liberados por usuário, ponto eletrônico e registro de tudo que acontece no sistema.' },
]

const steps = [
  { title: 'Crie sua conta', text: 'Cadastro em poucos minutos, sem cartão. Você já entra no sistema.' },
  { title: 'Configure a empresa', text: 'Dados da empresa, etapas, setores de produção e usuários da equipe.' },
  { title: 'Cadastre e produza', text: 'Clientes, orçamentos, projetos, plano de corte e ordens de produção.' },
  { title: 'Acompanhe e entregue', text: 'Prazos, estoque, financeiro e instalação em um painel só.' },
]

const securityItems: Array<{ icon: ReactNode; title: string; text: string }> = [
  { icon: <LockIcon />, title: 'Conexão criptografada', text: 'Todo o acesso ao sistema é feito por HTTPS.' },
  { icon: <BusinessIcon />, title: 'Dados isolados por empresa', text: 'Cada empresa enxerga somente as próprias informações.' },
  { icon: <KeyIcon />, title: 'Senhas e permissões', text: 'Senhas armazenadas com criptografia e acesso por perfil e módulo.' },
  { icon: <HistoryIcon />, title: 'Registro de atividades', text: 'Criações, alterações, exclusões e acessos ficam registrados.' },
]

const faqs = [
  { q: 'Preciso instalar alguma coisa?', a: 'No computador, não: o sistema funciona direto no navegador. Se o seu plano é o Profissional ou o Industrial, você também pode instalar o aplicativo Android, com o mesmo usuário e senha.' },
  { q: 'Quem pode usar o aplicativo Android?', a: 'O aplicativo é um direito dos planos Profissional e Industrial, com a assinatura ativa. Depois de assinar e pagar, é só entrar no sistema e abrir a página do aplicativo para baixar. O login é o mesmo do site, e o app confirma o seu rosto ao entrar.' },
  { q: 'E para iPhone?', a: 'A versão para iOS está nos planos. Enquanto ela não chega, o sistema abre normalmente no navegador do iPhone, e o Android já tem o aplicativo.' },
  { q: 'Os usuários cadastrados têm acesso ao painel administrativo?', a: 'Não. O Painel Admin é exclusivo da equipe da Core Cut. Cada empresa enxerga somente os próprios dados, e cada usuário, só os módulos liberados pelo plano e pelo perfil que o responsável definiu.' },
  { q: 'Como funciona o teste de 48 horas?', a: 'Você cria a conta, escolhe o plano e usa o sistema por 48 horas, sem informar cartão. Ao final, o acesso fica em pausa e os seus dados continuam guardados até você escolher um plano.' },
  { q: 'Quais as formas de pagamento?', a: 'Cartão de crédito, em assinatura mensal com renovação automática, e PIX, que libera 1, 3 ou 6 meses. Os pagamentos são processados pelo Mercado Pago.' },
  { q: 'Posso cancelar quando quiser?', a: 'Sim. No cartão você cancela pela própria tela de assinatura e o acesso segue até o fim do período pago. O PIX é um pagamento único, sem renovação automática.' },
  { q: 'O sistema lê arquivos do Promob?', a: 'Sim. Importa CSV, XML, DXF (um por chapa) e DXT, inclusive centenas de arquivos de uma vez ou a pasta inteira. Peças, furos, rasgos, fitas e materiais entram lidos, e você confere tudo antes de confirmar.' },
  { q: 'O mapa de corte serve para a seccionadora?', a: 'Sim. No modo seccionadora o plano gera só cortes de ponta a ponta, respeitando disco, refilo e veio. No modo CNC o encaixe é livre e o plano gera G-code ISO por chapa.' },
  { q: 'O plano de corte está em todos os planos?', a: 'O plano de corte, as fichas técnicas, as compras e a qualidade fazem parte do plano Profissional e do Industrial. O Essencial cobre projetos, orçamentos, produção, estoque e financeiro.' },
  { q: 'O plano de corte gera arquivo para a máquina?', a: 'Sim, o plano gera G-code ISO por chapa, além de relatório em PDF e etiquetas com QR Code. Confira os parâmetros com o fabricante da sua máquina antes de usar em produção.' },
  { q: 'Quantos usuários posso ter?', a: 'Depende do plano: 3 no Essencial, 10 no Profissional e ilimitados no Industrial. Cada usuário tem perfil e módulos próprios.' },
]

const tour = [
  { id: 'painel', label: 'Painel', title: 'A operação inteira em uma tela', text: 'Projetos ativos, recebimentos, ordens em andamento e alertas de estoque, prazos e manutenção.', img: '/site/telas/painel.webp' },
  { id: 'promob', label: 'Importação do Promob', title: 'Centenas de lotes importados de uma vez', text: 'CSV, XML, DXF e DXT. Arraste a pasta inteira: peças, furos, rasgos e fitas entram lidos e já mapeados às chapas do estoque.', img: '/site/telas/importacao-promob.webp' },
  { id: 'corte', label: 'Mapa de corte', title: 'Cortes de ponta a ponta para a seccionadora', text: 'O mapa respeita disco, refilo e veio e só gera cortes que a serra executa. Para CNC, o encaixe é livre e sai com G-code.', img: '/site/telas/chapa-mapa.webp' },
  { id: 'etiquetas', label: 'Etiquetas', title: 'Uma etiqueta com QR Code por peça', text: 'Projeto, medidas, material, fitas, usinagens e a posição da peça na chapa, em layout completo ou compacto.', img: '/site/telas/plano-etiquetas.webp' },
  { id: 'projetos', label: 'Projetos', title: 'Quadro, lista, calendário e cronograma', text: 'Tarefas com responsáveis, prazos, checklists e comentários, do briefing à entrega.', img: '/site/telas/projeto-quadro.webp' },
  { id: 'orcamentos', label: 'Orçamentos', title: 'Propostas com custo real e margem', text: 'Taxa de aprovação, ticket médio e lucro por proposta. Aprovou, o projeto e a produção nascem juntos.', img: '/site/telas/orcamentos.webp' },
]

const cutPlanItems = [
  'Otimização de chapas por material, com rotação e aproveitamento',
  'Cortes de ponta a ponta para a seccionadora (ou encaixe livre para CNC)',
  'Fita de borda por aresta e usinagens: dobradiça, minifix, cavilha, pinos e rasgos',
  'Importação de listas de peças em CSV, XML, DXF e DXT — centenas de lotes de uma vez',
  'Custo em reais direto do catálogo, somado ao orçamento do projeto',
  'Relatório em PDF, etiquetas por peça com QR Code e G-code ISO por chapa',
  'Solicitação de compra das chapas, fitas e ferragens que faltam no estoque',
]

/** O que cada plano libera. O servidor aplica a mesma regra (módulos, limites e aplicativo por plano). */
const accessRows: Array<{ label: string; values: Record<string, string | boolean> }> = [
  { label: 'Sistema no navegador (computador e celular)', values: { essencial: true, profissional: true, industrial: true } },
  { label: 'Aplicativo Android com verificação facial', values: { essencial: false, profissional: true, industrial: true } },
  { label: 'Orçamentos, projetos, produção, estoque e financeiro', values: { essencial: true, profissional: true, industrial: true } },
  { label: 'Plano de corte, fichas técnicas, compras e qualidade', values: { essencial: false, profissional: true, industrial: true } },
  { label: 'Chão de fábrica, manutenção, veículos e relatórios', values: { essencial: false, profissional: false, industrial: true } },
  { label: 'Usuários', values: { essencial: 'Até 3', profissional: 'Até 10', industrial: 'Ilimitados' } },
]

function AndroidIcon({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M17.6 9.48l1.84-3.18c.16-.31.04-.69-.26-.85a.637.637 0 0 0-.83.22l-1.88 3.24a11.463 11.463 0 0 0-8.94 0L5.65 5.67a.643.643 0 0 0-.87-.2c-.28.18-.37.54-.22.83L6.4 9.48A10.78 10.78 0 0 0 1 18h22a10.78 10.78 0 0 0-5.4-8.52ZM7 15.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm10 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" />
    </svg>
  )
}

function AppleIcon({ size = 26 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <path d="M16.37 1.43c0 1.14-.42 2.2-1.25 3.09-.9.96-1.98 1.52-3.16 1.43-.03-1.1.43-2.21 1.2-3.03.86-.9 2.07-1.5 3.21-1.49ZM20.5 17.07c-.5 1.16-.74 1.67-1.38 2.7-.9 1.43-2.17 3.2-3.74 3.22-1.4.01-1.76-.91-3.66-.9-1.9.01-2.29.92-3.69.91-1.57-.01-2.77-1.62-3.67-3.05C1.83 15.9 1.57 11.36 3.13 8.95c1.1-1.7 2.85-2.7 4.5-2.7 1.68 0 2.73.92 4.12.92 1.35 0 2.17-.92 4.1-.92 1.47 0 3.03.8 4.13 2.18-3.63 1.99-3.04 7.18.52 8.64Z" />
    </svg>
  )
}

/** Moldura de celular para as telas reais do aplicativo. */
function PhoneFrame({ src, alt, className = '', eager = false }: { src: string; alt: string; className?: string; eager?: boolean }) {
  return (
    <figure className={`lp-phone ${className}`.trim()}>
      <span className="lp-phone-notch" aria-hidden="true" />
      <img src={src} alt={alt} width={390} height={844} loading={eager ? 'eager' : 'lazy'} decoding="async" />
    </figure>
  )
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
      <path d="M12.04 2a9.9 9.9 0 0 0-8.4 15.13L2 22l5-1.6A9.9 9.9 0 1 0 12.04 2Zm0 18.1a8.2 8.2 0 0 1-4.2-1.15l-.3-.18-3 .97.98-2.9-.2-.31A8.2 8.2 0 1 1 12.04 20.1Zm4.5-6.15c-.25-.12-1.46-.72-1.69-.8-.22-.09-.39-.12-.55.12-.17.25-.64.8-.78.96-.14.17-.29.19-.54.06a6.7 6.7 0 0 1-1.97-1.22 7.4 7.4 0 0 1-1.36-1.7c-.14-.25 0-.38.1-.5.11-.11.25-.29.37-.43.12-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.55-1.33-.76-1.82-.2-.48-.4-.41-.55-.42h-.47a.9.9 0 0 0-.65.31c-.22.25-.85.83-.85 2.03s.87 2.35.99 2.52c.12.16 1.7 2.6 4.12 3.65.58.25 1.03.4 1.38.51.58.18 1.1.16 1.52.1.46-.07 1.46-.6 1.66-1.17.2-.58.2-1.07.14-1.17-.06-.1-.22-.16-.47-.28Z" />
    </svg>
  )
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="3" width="18" height="18" rx="5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.3" cy="6.7" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m4 7.5 8 6 8-6" />
    </svg>
  )
}

/** Página inicial pública: apresenta a Core Cut e leva ao login do ERP. */
export function LandingPage() {
  const { user, loading } = useAuth()
  const [plans, setPlans] = useState<BillingPlan[]>(fallbackPlans)
  const [menuOpen, setMenuOpen] = useState(false)
  const [tourId, setTourId] = useState(tour[0].id)
  const [appVersion, setAppVersion] = useState('')
  const [iosNotice, setIosNotice] = useState(false)
  const activeTour = tour.find((t) => t.id === tourId) ?? tour[0]
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)
  // o download exige login e plano Profissional ou Industrial: quem não entrou vai ao login e volta para a página do app
  const appHref = isAndroid ? '/app?baixar=1' : '/app'

  useEffect(() => {
    fetch('/downloads/app-version.json', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { versionName?: string } | null) => {
        if (data?.versionName) setAppVersion(String(data.versionName))
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    document.title = 'Core Cut | ERP e plano de corte para marcenarias'
    const root = document.documentElement
    root.style.scrollBehavior = 'smooth'
    return () => {
      root.style.scrollBehavior = ''
    }
  }, [])

  useEffect(() => {
    api.get<{ plans: BillingPlan[] }>('/billing/plans')
      .then((response) => {
        if (response.plans?.length) setPlans(response.plans)
      })
      .catch(() => undefined)
  }, [])

  if (user) return <Navigate to="/painel" replace />
  if (loading) return null

  return (
    <div className="lp">
      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <a href="#topo" aria-label="Core Cut ERP — início" className="lp-logo">
            <Logo height={32} />
          </a>
          <nav className="lp-nav" aria-label="Seções do site">
            <a href="#solucoes">Soluções</a>
            <a href="#aplicativo">Aplicativo</a>
            <a href="#veja-por-dentro">Veja por dentro</a>
            <a href="#funcionalidades">Funcionalidades</a>
            <a href="#plano-de-corte">Plano de corte</a>
            <a href="#planos">Planos</a>
            <a href="#faq">Dúvidas</a>
            <a href="#contato">Contato</a>
          </nav>
          <div className="lp-header-actions">
            <RouterLink to="/login" className="lp-btn lp-btn-ghost">Entrar</RouterLink>
            <RouterLink to="/cadastro" className="lp-btn lp-btn-primary lp-hide-sm">Testar grátis</RouterLink>
            <button type="button" className="lp-menu-btn" aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'} aria-expanded={menuOpen} aria-controls="lp-mobile-nav" onClick={() => setMenuOpen((open) => !open)}>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                {menuOpen ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
              </svg>
            </button>
          </div>
        </div>
        {menuOpen ? (
          <nav id="lp-mobile-nav" className="lp-mobile-nav" aria-label="Seções do site" onClick={() => setMenuOpen(false)}>
            <a href="#solucoes">Soluções</a>
            <a href="#aplicativo">Aplicativo</a>
            <a href="#veja-por-dentro">Veja por dentro</a>
            <a href="#funcionalidades">Funcionalidades</a>
            <a href="#plano-de-corte">Plano de corte</a>
            <a href="#planos">Planos</a>
            <a href="#faq">Dúvidas</a>
            <a href="#contato">Contato</a>
            <RouterLink to="/cadastro" className="lp-btn lp-btn-primary lp-btn-block">Testar grátis por 48 horas</RouterLink>
          </nav>
        ) : null}
      </header>

      <main id="topo">
        <section className="lp-hero">
          <div className="lp-container lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-eyebrow">ERP e plano de corte para marcenaria</p>
              <h1>Do orçamento ao corte, da fábrica à entrega: tudo em um só sistema.</h1>
              <p className="lp-lead">
                A Core Cut desenvolve sistemas de ERP e de plano de corte para marcenarias e indústrias moveleiras. Projetos, produção, estoque, financeiro e otimização de chapas com G-code, com preços em reais, no computador e no aplicativo Android.
              </p>
              <div className="lp-hero-cta">
                <RouterLink to="/cadastro" className="lp-btn lp-btn-primary lp-btn-lg">Testar grátis por 48 horas</RouterLink>
                <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer" className="lp-btn lp-btn-whatsapp lp-btn-lg">
                  <WhatsAppIcon /> Falar no WhatsApp
                </a>
              </div>
              <p className="lp-hero-note">
                Sem cartão de crédito. Já é cliente? <RouterLink to="/login">Entrar no sistema →</RouterLink>
              </p>
              <ul className="lp-platforms-row" aria-label="Plataformas">
                <li>
                  <a href="#veja-por-dentro" className="lp-chip">
                    <span className="lp-chip-icon"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg></span>
                    Computador
                  </a>
                </li>
                <li>
                  <RouterLink to={appHref} className="lp-chip" title="Baixar o aplicativo Android (planos Profissional e Industrial)">
                    <span className="lp-chip-icon lp-chip-android"><AndroidIcon size={18} /></span>
                    Baixar para Android
                  </RouterLink>
                </li>
                <li className="is-soon">
                  <button type="button" className="lp-chip" onClick={() => setIosNotice(true)} title="Versão para iOS em breve">
                    <span className="lp-chip-icon"><AppleIcon size={18} /></span>
                    iOS em breve
                  </button>
                </li>
              </ul>
              {iosNotice ? <p className="lp-ios-notice" role="status">A versão para iPhone (iOS) está em desenvolvimento. Enquanto isso, o sistema abre normalmente no navegador do iPhone.</p> : null}
              <ul className="lp-stats">
                <li><strong>+5.500</strong><span>itens no catálogo Leo Madeiras</span></li>
                <li><strong>G-code</strong><span>ISO por chapa, direto do plano</span></li>
                <li><strong>R$ 99</strong><span>a partir de, por mês</span></li>
              </ul>
            </div>
            <div className="lp-devices">
              <figure className="lp-browser lp-devices-desktop">
                <div className="lp-browser-bar" aria-hidden="true"><i /><i /><i /><span>www.cutcore.com.br</span></div>
                <img src="/site/telas/painel.webp" alt="Painel do Core Cut ERP no computador" fetchPriority="high" />
              </figure>
              <PhoneFrame src="/site/app/painel.webp" alt="Painel do Core Cut ERP no aplicativo Android" className="lp-devices-phone" eager />
            </div>
          </div>
        </section>

        <section id="teste-gratis" className="lp-trial">
          <div className="lp-container lp-trial-inner">
            <div>
              <h2>Experimente por 48 horas, sem pagar nada</h2>
              <p>Crie a conta da sua empresa em poucos minutos e use o plano escolhido com todos os recursos. Gostou? Escolha o plano e continue de onde parou.</p>
            </div>
            <RouterLink to="/cadastro" className="lp-btn lp-btn-light lp-btn-lg">Começar o teste grátis</RouterLink>
          </div>
        </section>

        <section id="veja-por-dentro" className="lp-section lp-section-alt">
          <div className="lp-container">
            <p className="lp-kicker">Veja por dentro</p>
            <h2>O sistema funcionando, tela por tela</h2>
            <p className="lp-section-lead">Imagens reais do Core Cut ERP, com dados de demonstração.</p>
            <div className="lp-tour">
              <div className="lp-tour-tabs" role="tablist" aria-label="Telas do sistema">
                {tour.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    id={`tour-tab-${item.id}`}
                    aria-selected={item.id === tourId}
                    aria-controls="tour-panel"
                    className={`lp-tour-tab${item.id === tourId ? ' is-active' : ''}`}
                    onClick={() => setTourId(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div id="tour-panel" role="tabpanel" aria-labelledby={`tour-tab-${activeTour.id}`} className="lp-tour-panel">
                <div className="lp-tour-copy">
                  <h3>{activeTour.title}</h3>
                  <p>{activeTour.text}</p>
                  <RouterLink to="/cadastro" className="lp-btn lp-btn-primary">Testar grátis por 48 horas</RouterLink>
                </div>
                <figure className="lp-browser">
                  <div className="lp-browser-bar" aria-hidden="true"><i /><i /><i /><span>www.cutcore.com.br</span></div>
                  <img key={activeTour.id} src={activeTour.img} alt={`Tela do Core Cut ERP: ${activeTour.title}`} loading="lazy" decoding="async" />
                </figure>
              </div>
            </div>
          </div>
        </section>

        <section id="aplicativo" className="lp-section lp-app">
          <div className="lp-container">
            <p className="lp-kicker lp-kicker-light">Computador e celular</p>
            <h2>O mesmo ERP no computador e no seu Android</h2>
            <p className="lp-section-lead lp-lead-light">
              Um só login, os mesmos dados e as mesmas permissões. Na mesa, o sistema completo no navegador; na fábrica e na obra, o aplicativo com confirmação por rosto.
            </p>
            <div className="lp-app-grid">
              <div>
                <ul className="lp-platforms">
                  <li>
                    <div className="lp-platform-card">
                      <span className="lp-platform-icon"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></svg></span>
                      <div><strong>Computador</strong><span>Windows, Mac e Linux, direto no navegador. Todos os planos.</span></div>
                    </div>
                  </li>
                  <li>
                    <RouterLink to={appHref} className="lp-platform-card" aria-label="Baixar o aplicativo Android">
                      <span className="lp-platform-icon lp-platform-android"><AndroidIcon /></span>
                      <div><strong>Android <em className="lp-tag-ok">baixar</em></strong><span>Aplicativo com verificação facial. Planos Profissional e Industrial.</span></div>
                    </RouterLink>
                  </li>
                  <li className="is-soon">
                    <button type="button" className="lp-platform-card" onClick={() => setIosNotice(true)}>
                      <span className="lp-platform-icon"><AppleIcon /></span>
                      <div><strong>iPhone e iPad <em>em breve</em></strong><span>A versão para iOS está a caminho. Por enquanto, use pelo navegador.</span></div>
                    </button>
                  </li>
                </ul>

                <div className="lp-store-row">
                  <RouterLink to={appHref} className="lp-store lp-store-android">
                    <AndroidIcon size={30} />
                    <span><small>Baixar a última versão para</small><strong>Android</strong></span>
                  </RouterLink>
                  <button type="button" className="lp-store lp-store-ios" onClick={() => setIosNotice(true)} title="Versão para iOS em breve">
                    <AppleIcon size={30} />
                    <span><small>Em breve para</small><strong>iOS (Apple)</strong></span>
                  </button>
                </div>
                {iosNotice ? <p className="lp-ios-notice" role="status">A versão para iPhone (iOS) está em desenvolvimento. Enquanto isso, o sistema abre normalmente no navegador do iPhone.</p> : null}
                <p className="lp-app-note">
                  {appVersion ? `Versão ${appVersion} · ` : ''}Exclusivo dos planos <b>Profissional</b> e <b>Industrial</b>, com assinatura ativa. Entre com o mesmo usuário e senha do site para baixar.
                </p>

                <div className="lp-qr">
                  <img src="/site/qr-app.svg" alt="QR code para baixar o aplicativo Core Cut no Android" width={120} height={120} loading="lazy" decoding="async" />
                  <p><strong>Prefere pelo celular?</strong> Aponte a câmera do Android para o código, entre com o seu login e o download começa.</p>
                </div>
              </div>

              <div className="lp-app-visual">
                <PhoneFrame src="/site/app/financeiro.webp" alt="Tela Financeiro do aplicativo Core Cut" className="lp-app-phone lp-app-phone-left" />
                <PhoneFrame src="/site/app/painel.webp" alt="Painel do aplicativo Core Cut" className="lp-app-phone lp-app-phone-main" />
                <PhoneFrame src="/site/app/projetos.webp" alt="Tela Projetos do aplicativo Core Cut" className="lp-app-phone lp-app-phone-right" />
              </div>
            </div>
          </div>
        </section>

        <section id="solucoes" className="lp-section">
          <div className="lp-container">
            <p className="lp-kicker">O que fazemos</p>
            <h2>Sistemas de ERP e sistemas de plano de corte</h2>
            <p className="lp-section-lead">Duas frentes que se conversam: a gestão da empresa e o planejamento do corte, no mesmo lugar e com os mesmos dados.</p>
            <div className="lp-products">
              <article className="lp-product">
                <span className="lp-product-icon"><FactoryIcon /></span>
                <h3>Sistema de ERP</h3>
                <p>Gestão completa da marcenaria industrial: do comercial ao financeiro, passando por projetos, produção, estoque, compras e equipe.</p>
                <ul className="lp-checks">
                  <li><CheckCircleIcon /> Orçamentos, contratos e financeiro</li>
                  <li><CheckCircleIcon /> Projetos, tarefas e cronograma</li>
                  <li><CheckCircleIcon /> Produção, qualidade e chão de fábrica</li>
                  <li><CheckCircleIcon /> Estoque, compras e fornecedores</li>
                </ul>
                <RouterLink to="/login" className="lp-link">Entrar no ERP →</RouterLink>
              </article>
              <article className="lp-product">
                <span className="lp-product-icon"><ContentCutIcon /></span>
                <h3>Sistema de plano de corte</h3>
                <p>Otimização de chapas e fitas com usinagens, custo em reais e saída pronta para a máquina, integrada ao orçamento e à produção.</p>
                <ul className="lp-checks">
                  <li><CheckCircleIcon /> Aproveitamento de chapa otimizado</li>
                  <li><CheckCircleIcon /> Etiquetas com QR Code e relatório em PDF</li>
                  <li><CheckCircleIcon /> G-code ISO para CNC por chapa</li>
                  <li><CheckCircleIcon /> Importação de listas de peças</li>
                </ul>
                <a href="#plano-de-corte" className="lp-link">Ver o plano de corte →</a>
              </article>
            </div>
          </div>
        </section>

        <section id="como-funciona" className="lp-section">
          <div className="lp-container">
            <p className="lp-kicker">Como funciona</p>
            <h2>Da conta criada à primeira ordem de produção, em um dia</h2>
            <ol className="lp-steps">
              {steps.map((step, index) => (
                <li key={step.title}>
                  <span className="lp-step-number">{index + 1}</span>
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="funcionalidades" className="lp-section lp-section-alt">
          <div className="lp-container">
            <p className="lp-kicker">Funcionalidades</p>
            <h2>Tudo que a sua operação precisa, sem planilhas soltas</h2>
            <div className="lp-features">
              {features.map((feature) => (
                <article key={feature.title} className="lp-feature">
                  <span className="lp-feature-icon">{feature.icon}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="materiais" className="lp-section">
          <div className="lp-container lp-split lp-split-reverse">
            <div>
              <p className="lp-kicker">Materiais e estoque</p>
              <h2>Do catálogo ao corte, com o preço de cada chapa em reais</h2>
              <p className="lp-section-lead">Escolha o MDF, a fita e as ferragens direto do catálogo da Leo Madeiras (+5.500 itens). O custo entra no plano de corte, no orçamento e na lista de compras.</p>
              <ul className="lp-checks lp-checks-lg">
                <li><CheckCircleIcon /> Cada material do arquivo do Promob é ligado a uma chapa do estoque</li>
                <li><CheckCircleIcon /> Saldo mínimo, reservas por ordem de produção e entrada automática na compra</li>
                <li><CheckCircleIcon /> Aproveitamento e custo por material, antes de cortar</li>
              </ul>
            </div>
            <div className="lp-split-media">
              <img src="/site/amostras-mdf.jpg" alt="Amostras de MDF em diferentes cores e veios de madeira" loading="lazy" decoding="async" />
            </div>
          </div>
        </section>

        <section id="plano-de-corte" className="lp-section lp-section-alt">
          <div className="lp-container lp-split">
            <figure className="lp-browser">
              <div className="lp-browser-bar" aria-hidden="true"><i /><i /><i /><span>Plano de corte · chapa 2750 × 1850</span></div>
              <img src="/site/telas/chapa-mapa.webp" alt="Mapa de corte de uma chapa com as peças encaixadas em cortes de ponta a ponta" loading="lazy" decoding="async" />
            </figure>
            <div>
              <p className="lp-kicker">Plano de corte</p>
              <h2>Menos desperdício na chapa, mais previsibilidade na produção</h2>
              <p className="lp-section-lead">O plano nasce do projeto, calcula o custo com preços do catálogo e já sai pronto para cortar, etiquetar e comprar o que falta.</p>
              <ul className="lp-checks lp-checks-lg">
                {cutPlanItems.map((item) => (
                  <li key={item}><CheckCircleIcon /> {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="lp-section lp-section-dark">
          <div className="lp-container">
            <p className="lp-kicker lp-kicker-light">Resultado na obra</p>
            <h2>Do projeto ao ambiente pronto</h2>
            <p className="lp-section-lead lp-lead-light">Cozinhas, dormitórios, áreas externas: o ERP acompanha cada ambiente do briefing à instalação.</p>
            <div className="lp-gallery lp-gallery-4">
              <figure><img src="/site/cozinha-branca.jpg" alt="Cozinha branca com ilha central e bancos de madeira" loading="lazy" decoding="async" /><figcaption>Minimalismo sob medida</figcaption></figure>
              <figure><img src="/site/cozinha-planejada.jpg" alt="Cozinha planejada com marcenaria em madeira clara" loading="lazy" decoding="async" /><figcaption>Cozinhas planejadas</figcaption></figure>
              <figure><img src="/site/cozinha-moderna.jpg" alt="Cozinha moderna com iluminação em LED e bancada em L" loading="lazy" decoding="async" /><figcaption>Ambientes sob medida</figcaption></figure>
              <figure><img src="/site/deck-externo.jpg" alt="Deck de madeira com pergolado e móveis externos" loading="lazy" decoding="async" /><figcaption>Áreas externas</figcaption></figure>
            </div>
          </div>
        </section>

        <section id="planos" className="lp-section">
          <div className="lp-container">
            <p className="lp-kicker">Planos</p>
            <h2>Escolha o plano do tamanho da sua marcenaria</h2>
            <p className="lp-section-lead">Pagamento por cartão (assinatura mensal) ou por PIX (1, 3 ou 6 meses). Cada empresa tem os próprios dados, isolados das demais.</p>
            <p className="lp-plans-note">Plano de corte, fichas técnicas, compras e qualidade estão no Profissional e no Industrial.</p>
            <div className="lp-plans">
              {plans.map((plan) => (
                <article key={plan.id} className={`lp-plan${plan.id === 'profissional' ? ' lp-plan-featured' : ''}`}>
                  {plan.id === 'profissional' ? <span className="lp-badge">Mais escolhido</span> : null}
                  <h3>{plan.name}</h3>
                  <p className="lp-plan-desc">{plan.description}</p>
                  <p className="lp-price"><strong>{brl(plan.price)}</strong><span> / mês</span></p>
                  <ul className="lp-checks">
                    {plan.highlights.map((highlight) => (
                      <li key={highlight}>{highlight === 'Aplicativo Android' ? <AndroidIcon size={20} /> : <CheckCircleIcon />} {highlight}</li>
                    ))}
                    {plan.limits ? (
                      <li><CheckCircleIcon /> {isUnlimited(plan.limits.maxProjects) ? 'Projetos ilimitados' : `${plan.limits.maxProjects} projetos`}</li>
                    ) : null}
                    {!plan.mobileApp && !plan.highlights.includes('Aplicativo Android') ? (
                      <li className="lp-check-off"><AndroidIcon size={20} /> Aplicativo Android a partir do Profissional</li>
                    ) : null}
                  </ul>
                  <RouterLink to={`/cadastro?plano=${plan.id}`} className={`lp-btn ${plan.id === 'profissional' ? 'lp-btn-primary' : 'lp-btn-outline'} lp-btn-block`}>
                    Testar {plan.name} grátis
                  </RouterLink>
                </article>
              ))}
            </div>

            <div className="lp-compare" role="region" aria-label="O que cada plano libera" tabIndex={0}>
              <table>
                <caption>O que cada plano libera</caption>
                <thead>
                  <tr>
                    <th scope="col">Recurso</th>
                    {plans.map((plan) => <th key={plan.id} scope="col">{plan.name}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {accessRows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      {plans.map((plan) => {
                        const value = row.values[plan.id]
                        return (
                          <td key={plan.id}>
                            {value === true ? <span className="lp-yes" aria-label="Incluído"><CheckCircleIcon /></span> : value === false ? <span className="lp-no" aria-label="Não incluído">—</span> : value}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="lp-plans-note lp-compare-note">O Painel Admin da plataforma é exclusivo da equipe Core Cut: os clientes acessam somente a própria empresa, conforme o plano contratado.</p>
          </div>
        </section>

        <section id="sobre" className="lp-section lp-section-alt">
          <div className="lp-container lp-split lp-split-reverse">
            <div>
              <p className="lp-kicker">Sobre a Core Cut</p>
              <h2>Tecnologia pensada para o chão de fábrica da marcenaria</h2>
              <p>
                A Core Cut é uma empresa de tecnologia dedicada à marcenaria e à indústria moveleira. Desenvolvemos sistemas de ERP e de plano de corte que seguem o fluxo real da fábrica: o orçamento vira projeto, o projeto vira ordem de produção, a ordem vira plano de corte e o plano vira peça cortada, etiquetada e entregue.
              </p>
              <p>
                Nosso foco é tirar a operação das planilhas e do papel, reduzir desperdício de material e dar ao dono da marcenaria uma visão clara de prazos, custos e resultado.
              </p>
              <ul className="lp-checks">
                <li><CheckCircleIcon /> Feito para o dia a dia da marcenaria</li>
                <li><CheckCircleIcon /> Valores e catálogo em reais</li>
                <li><CheckCircleIcon /> Dados de cada empresa isolados e protegidos</li>
                <li><CheckCircleIcon /> Atendimento direto pelo WhatsApp</li>
              </ul>
            </div>
            <div className="lp-split-media">
              <img src="/site/fabrica-linha-producao.jpg" alt="Linha de produção de uma indústria moveleira com operadores e painéis sobre a esteira" loading="lazy" decoding="async" />
            </div>
          </div>
        </section>

        <section id="seguranca" className="lp-section">
          <div className="lp-container">
            <p className="lp-kicker">Segurança</p>
            <h2>Os dados da sua marcenaria protegidos</h2>
            <div className="lp-features lp-features-4">
              {securityItems.map((item) => (
                <article key={item.title} className="lp-feature">
                  <span className="lp-feature-icon">{item.icon}</span>
                  <h3>{item.title}</h3>
                  <p>{item.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="faq" className="lp-section lp-section-alt">
          <div className="lp-container lp-faq-wrap">
            <div>
              <p className="lp-kicker">Dúvidas frequentes</p>
              <h2>Perguntas que todo marceneiro faz</h2>
              <p className="lp-section-lead">Não encontrou o que procura? Fale com a gente pelo WhatsApp.</p>
              <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer" className="lp-btn lp-btn-whatsapp">
                <WhatsAppIcon /> Tirar dúvidas
              </a>
            </div>
            <div className="lp-faq">
              {faqs.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        <section id="contato" className="lp-contact">
          <div className="lp-container">
            <p className="lp-kicker lp-kicker-light">Contato</p>
            <h2>Vamos conversar sobre a sua marcenaria?</h2>
            <p className="lp-section-lead lp-lead-light">Fale com a gente para contratar, tirar dúvidas ou ver o sistema funcionando.</p>
            <div className="lp-contact-grid">
              <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer" className="lp-contact-card">
                <span className="lp-contact-icon lp-contact-whatsapp"><WhatsAppIcon /></span>
                <strong>WhatsApp</strong>
                <span>{CONTACT.phoneDisplay}</span>
              </a>
              <a href={CONTACT.instagram} target="_blank" rel="noreferrer" className="lp-contact-card">
                <span className="lp-contact-icon lp-contact-instagram"><InstagramIcon /></span>
                <strong>Instagram</strong>
                <span>{CONTACT.instagramHandle}</span>
              </a>
              {CONTACT.email ? (
                <a href={`mailto:${CONTACT.email}`} className="lp-contact-card">
                  <span className="lp-contact-icon lp-contact-mail"><MailIcon /></span>
                  <strong>E-mail</strong>
                  <span>{CONTACT.email}</span>
                </a>
              ) : null}
            </div>
            <div className="lp-contact-actions">
              <RouterLink to="/cadastro" className="lp-btn lp-btn-primary lp-btn-lg">Testar grátis por 48 horas</RouterLink>
              <RouterLink to="/login" className="lp-btn lp-btn-light lp-btn-lg">Já sou cliente — entrar</RouterLink>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-container lp-footer-inner">
          <div>
            <Logo height={26} color="#fff" />
            <p>ERP e plano de corte para marcenarias e indústrias moveleiras.</p>
          </div>
          <nav aria-label="Rodapé">
            <RouterLink to="/login">Entrar no sistema</RouterLink>
            <RouterLink to="/cadastro">Teste grátis por 48 horas</RouterLink>
            <a href="#aplicativo">Aplicativo Android</a>
            <RouterLink to="/termos">Termos de Uso</RouterLink>
            <RouterLink to="/privacidade">Política de Privacidade</RouterLink>
            <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer">WhatsApp {CONTACT.phoneDisplay}</a>
            <a href={CONTACT.instagram} target="_blank" rel="noreferrer">Instagram {CONTACT.instagramHandle}</a>
          </nav>
        </div>
        <p className="lp-copy">© {new Date().getFullYear()} Core Cut Sistemas. Todos os direitos reservados.</p>
      </footer>

      <a href={CONTACT.whatsapp} target="_blank" rel="noreferrer" className="lp-float-whatsapp" aria-label="Falar no WhatsApp">
        <WhatsAppIcon />
      </a>
    </div>
  )
}
