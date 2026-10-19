import { useEffect, type ReactNode } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import { Logo } from '../brand/Logo'
import './landing.css'

/**
 * Textos-base dos documentos legais. Revise com assessoria jurídica e complete a identificação
 * da empresa (razão social, CNPJ e endereço) antes de divulgar.
 */
const COMPANY = 'Core Cut Sistemas'
const WHATSAPP = '(21) 99307-9682'
const UPDATED = 'outubro de 2026'

function LegalLayout({ title, children }: { title: string; children: ReactNode }) {
  useEffect(() => {
    document.title = `${title} | Core Cut`
    window.scrollTo(0, 0)
  }, [title])
  return (
    <div className="lp">
      <header className="lp-header">
        <div className="lp-container lp-header-inner">
          <RouterLink to="/" className="lp-logo" aria-label="Core Cut — início">
            <Logo height={32} />
          </RouterLink>
          <div className="lp-header-actions" style={{ marginLeft: 'auto' }}>
            <RouterLink to="/login" className="lp-btn lp-btn-ghost">Entrar</RouterLink>
            <RouterLink to="/cadastro" className="lp-btn lp-btn-primary lp-hide-sm">Testar grátis</RouterLink>
          </div>
        </div>
      </header>
      <main className="lp-section">
        <article className="lp-container lp-legal">
          <p className="lp-kicker">Documento legal</p>
          <h1>{title}</h1>
          <p className="lp-legal-meta">Última atualização: {UPDATED}</p>
          {children}
          <p className="lp-legal-meta">
            Dúvidas sobre este documento? Fale com a {COMPANY} pelo WhatsApp {WHATSAPP}. <RouterLink to="/">Voltar ao site</RouterLink>
          </p>
        </article>
      </main>
    </div>
  )
}

export function TermsPage() {
  return (
    <LegalLayout title="Termos de Uso">
      <h2>1. Sobre o serviço</h2>
      <p>
        A {COMPANY} oferece o Core Cut ERP, sistema de gestão (ERP) e de plano de corte para marcenarias e indústrias moveleiras, disponibilizado
        pela internet na modalidade de assinatura. Ao criar uma conta ou usar o sistema, você declara que leu e aceita estes Termos.
      </p>
      <h2>2. Cadastro e responsabilidade pela conta</h2>
      <p>
        O cadastro deve conter informações verdadeiras. A pessoa que cria a conta é a administradora da empresa e responde pelos usuários que
        cadastrar, pela guarda das senhas e por toda atividade realizada com as credenciais da empresa.
      </p>
      <h2>3. Teste gratuito</h2>
      <p>
        Novas empresas podem usar o sistema gratuitamente por 48 (quarenta e oito) horas, sem informar cartão. Cada CPF/CNPJ e cada e-mail
        podem iniciar um único teste. Terminado o período, o acesso fica em pausa até a contratação de um plano; os dados da empresa são
        mantidos por prazo razoável para permitir a contratação.
      </p>
      <h2>4. Planos, pagamento e cancelamento</h2>
      <p>
        Os planos, preços e limites estão descritos no site e na tela de assinatura. O pagamento é feito por cartão de crédito, em assinatura
        mensal com renovação automática, ou por PIX, que libera o plano por 1, 3 ou 6 meses sem renovação automática. Os pagamentos são
        processados pelo Mercado Pago; o sistema não armazena dados de cartão. A assinatura no cartão pode ser cancelada a qualquer momento
        pela tela de assinatura, mantendo-se o acesso até o fim do período já pago. Não há reembolso proporcional de períodos já utilizados,
        ressalvados os direitos previstos em lei.
      </p>
      <h2>5. Limites do plano e uso adequado</h2>
      <p>
        Cada plano possui limites de usuários, projetos, orçamentos, ordens de produção e itens de estoque. É proibido usar o sistema para fins
        ilícitos, tentar acessar dados de outras empresas, comprometer a segurança ou a disponibilidade do serviço, ou revender o acesso sem
        autorização.
      </p>
      <h2>6. Dados da empresa</h2>
      <p>
        Os dados inseridos pela empresa continuam sendo de sua propriedade. A {COMPANY} os trata apenas para prestar o serviço, conforme a
        Política de Privacidade. A empresa é responsável pela licitude dos dados que cadastra, inclusive de seus clientes e colaboradores.
      </p>
      <h2>7. Disponibilidade e responsabilidade</h2>
      <p>
        Empregamos esforços razoáveis para manter o serviço disponível e seguro, mas não garantimos funcionamento ininterrupto. Os resultados
        do plano de corte, custos e arquivos de máquina (G-code) devem ser conferidos pela empresa antes do uso em produção. Na extensão
        permitida pela lei, a responsabilidade da {COMPANY} limita-se ao valor pago pela assinatura no período em que o fato ocorreu.
      </p>
      <h2>8. Suspensão e encerramento</h2>
      <p>
        O acesso pode ser suspenso em caso de pagamento em atraso, uso em desacordo com estes Termos ou risco à segurança do serviço. A empresa
        pode encerrar a conta quando quiser, solicitando pelos canais de contato.
      </p>
      <h2>9. Alterações e foro</h2>
      <p>
        Estes Termos podem ser atualizados; a versão vigente fica disponível nesta página. Fica eleito o foro da comarca do domicílio do
        consumidor ou, quando empresarial, o da sede da {COMPANY}, para dirimir questões deste contrato.
      </p>
    </LegalLayout>
  )
}

export function PrivacyPage() {
  return (
    <LegalLayout title="Política de Privacidade">
      <h2>1. Quem somos</h2>
      <p>
        A {COMPANY} é a controladora dos dados pessoais tratados para o cadastro, a cobrança e a segurança do Core Cut ERP. Em relação aos dados
        que a sua empresa insere no sistema (clientes, fornecedores, colaboradores), a empresa é a controladora e a {COMPANY} atua como
        operadora, nos termos da Lei Geral de Proteção de Dados (LGPD, Lei 13.709/2018).
      </p>
      <h2>2. Quais dados tratamos</h2>
      <ul>
        <li>Cadastro: nome da empresa, razão social, CPF/CNPJ, telefone, nome e e-mail do administrador e dos usuários.</li>
        <li>Acesso e segurança: registros de login, endereço IP, navegador e ações realizadas no sistema.</li>
        <li>Pagamento: situação, valor e forma de pagamento. Dados de cartão são tratados diretamente pelo Mercado Pago.</li>
        <li>Conteúdo da empresa: projetos, orçamentos, estoque, financeiro e demais informações inseridas pelos usuários.</li>
      </ul>
      <h2>3. Para que usamos</h2>
      <p>
        Para prestar o serviço contratado, autenticar usuários, cobrar a assinatura, prevenir fraudes e abusos, cumprir obrigações legais e
        dar suporte. Não vendemos dados pessoais.
      </p>
      <h2>4. Compartilhamento</h2>
      <p>
        Compartilhamos dados apenas com prestadores necessários à operação (como o Mercado Pago, para pagamentos, e o provedor de hospedagem do
        servidor) ou por determinação legal. Os dados de cada empresa são isolados das demais dentro do sistema.
      </p>
      <h2>5. Armazenamento e segurança</h2>
      <p>
        Adotamos medidas como conexão criptografada (HTTPS), senhas armazenadas com criptografia, controle de acesso por perfil e registro de
        atividades. Nenhum sistema é totalmente imune a incidentes; em caso de incidente relevante, a empresa afetada será comunicada.
      </p>
      <h2>6. Por quanto tempo guardamos</h2>
      <p>
        Mantemos os dados enquanto a conta estiver ativa e pelo prazo necessário para cumprir obrigações legais, exercer direitos e permitir a
        reativação da conta. Dados de teste não contratados podem ser eliminados após prazo razoável de inatividade.
      </p>
      <h2>7. Seus direitos</h2>
      <p>
        Você pode solicitar confirmação do tratamento, acesso, correção, anonimização, portabilidade, eliminação e informações sobre
        compartilhamento, além de revogar consentimentos, pelos canais de contato abaixo.
      </p>
      <h2>8. Cookies e armazenamento local</h2>
      <p>
        O sistema usa o armazenamento do navegador apenas para manter a sessão do usuário e preferências de uso, sem rastreamento publicitário.
      </p>
      <h2>9. Localização do aparelho</h2>
      <p>
        Com a sua permissão, o sistema registra a localização do aparelho em dois momentos: quando você registra o ponto (para mostrar onde
        a marcação foi feita) e enquanto você mantém ligada a rota de uma entrega ou instalação (para que a empresa acompanhe o deslocamento).
        Não há rastreamento contínuo em segundo plano. A permissão pode ser revogada a qualquer momento nas configurações do navegador, e o
        sistema continua funcionando sem ela. Para mostrar mapas e rotas, o endereço consultado é enviado a serviços do OpenStreetMap. A
        empresa contratante é a controladora desses dados em relação aos seus colaboradores.
      </p>
    </LegalLayout>
  )
}
