# Core Cut ERP — aplicativo Android e iOS

Aplicativo em **React Native (Expo)** que usa o mesmo servidor do sistema (`https://www.cutcore.com.br`).
O mesmo projeto Expo gera o aplicativo para iPhone: login, confirmação facial, sistema web, câmera,
localização e compartilhamento de arquivos usam os mesmos fluxos do Android.

## O que ele faz

| Etapa | Como funciona |
|---|---|
| **Entrada** | Tela nativa igual à do site: usuário ou e-mail, senha, *Entrar*, *Esqueci minha senha* e *Cadastro de empresas*. |
| **Cadastro de empresas** | Abre `https://www.cutcore.com.br/cadastro` no navegador. Lá a pessoa cria a conta, ganha **48 horas de teste** e escolhe o plano (mensal, trimestral ou semestral por PIX; cartão mensal). |
| **Verificação facial** | Em vez do código de duas etapas do site. Só aparece depois que usuário e senha estão corretos. No primeiro acesso a pessoa cadastra o rosto (com consentimento); depois o servidor confirma que é a mesma pessoa. |
| **Sistema completo** | Depois da verificação, abre o Core Cut inteiro (as mesmas telas, permissões por perfil e regras do site), dentro do aplicativo. Tudo o que o site ganhar aparece no aplicativo sem reinstalar. |
| **Reabertura** | Ao voltar do segundo plano depois de 5 minutos, ou ao abrir o app com a sessão guardada, pede o rosto de novo. |
| **Painel Admin** | Em `https://www.cutcore.com.br/admin` → aba **Verificação facial**: foto cadastrada, cada tentativa (com foto e resultado) e o botão *Redefinir* rosto. |

PDFs, planilhas e arquivos gerados pelo sistema (proposta, contrato, DANFE, relatórios, G-code) são
entregues pelo aplicativo na folha de compartilhamento do Android (salvar, enviar por WhatsApp, abrir).
Localização (ponto e rota das entregas) e câmera (fotos) funcionam como no site.

## Rodar em desenvolvimento

```bash
cd CoreCut-App
npm install
npx expo start            # abre o Expo; escaneie o QR no celular com o Expo Go
```

> A câmera e a localização funcionam no Expo Go. Para testar exatamente como o app instalado, gere o APK (abaixo).

Para apontar para outro servidor (testes), troque `expo.extra.apiUrl` em `app.json`.

## Gerar o APK para instalar

**Local (precisa do JDK 17 e do Android SDK, que já estão neste computador):**

```bash
cd CoreCut-App
npx expo prebuild --platform android      # gera a pasta android/
cd android
./gradlew assembleRelease                 # no Windows: gradlew.bat assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```

Esse APK é assinado com a chave de depuração do template: serve para instalar e testar. Para a **Google Play**
é preciso gerar um *Android App Bundle* assinado com uma chave sua:

```bash
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile production   # gera .aab assinado na nuvem
```

Guarde a chave (keystore) em local seguro: sem ela não é possível publicar atualizações.

## Segurança e privacidade (LGPD)

- A sessão fica no cofre do Android (Keystore), nunca em armazenamento comum.
- O rosto vira um vetor de 128 números; o vetor e a foto cadastrada ficam **cifrados** (AES-256-GCM) no servidor.
- As fotos das tentativas são apagadas depois de **30 dias**.
- O backup que o cliente baixa não leva dados faciais.
- O cadastro exige o consentimento da pessoa, registrado com data e versão do texto.
- Limite conhecido: não há detecção de "prova de vida"; uma foto impressa de boa qualidade pode enganar o reconhecimento.
  O rosto é uma confirmação adicional à senha, não substitui uma senha forte. O site não tem mais verificação em duas
  etapas por código: a confirmação adicional é o rosto, no aplicativo. O cadastro do rosto pode ser redefinido pelo
  administrador em `/admin` → Verificação facial.

## Publicação na Play Store: pontos de atenção

- Política de pagamentos: a assinatura é contratada **fora** do aplicativo (site), e o botão de cadastro abre o navegador.
  Pagamentos de mensalidade exibidos dentro do app podem exigir o faturamento do Google Play. Por isso, links de pagamento
  e do Mercado Pago abrem no navegador do aparelho.
- Declare na ficha da loja: câmera, localização e uso de dados biométricos (rosto), com a política de privacidade.
- Ícone e telas de divulgação: usar as artes em `marketing/`.

## Gerar o .ipa pelo GitHub Actions (sem Mac e sem conta Expo)

O workflow [`.github/workflows/ios-ipa.yml`](../.github/workflows/ios-ipa.yml) (na raiz do repositório) compila o app num Mac do GitHub:
gera a pasta `ios/` a partir do `app.json` (`expo prebuild`), compila com o Xcode e publica o `.ipa` como
*artifact* da execução.

1. O repositório é o https://github.com/IuriRod93/Core-Cut-ERP (o app fica na pasta `CoreCut-App`).
2. **Actions → iOS (.ipa) → Run workflow** (ou crie uma tag `app-v1.0.5`).
3. No fim da execução, baixe o `.ipa` em **Artifacts** (fica 30 dias).

Sem os Secrets da Apple sai `CoreCut-ERP-<versão>-sem-assinatura.ipa`: o iPhone não instala esse arquivo
direto; ele precisa ser assinado (ex.: Sideloadly/AltStore com o seu Apple ID, que vale 7 dias na conta
gratuita, ou o Xcode). Com uma conta **Apple Developer**, cadastre em *Settings → Secrets and variables →
Actions* os secrets `IOS_P12_BASE64`, `IOS_P12_PASSWORD` e `IOS_PROFILE_BASE64` (certificado de
distribuição e perfil Ad Hoc ou App Store em base64) e o arquivo sai assinado:
`CoreCut-ERP-<versão>-assinado.ipa`. Ad Hoc instala nos iPhones cadastrados no perfil; App Store vai para o
TestFlight (`xcrun altool`/Transporter) e, com o link público do TestFlight em `IOS_APP_URL` no `.env` do
servidor, o botão "Instalar no iPhone" aparece em `/app`.

## Gerar e distribuir o aplicativo iOS (.ipa) pelo EAS

Alternativa ao GitHub Actions: o build iOS feito na nuvem pelo EAS Build (não é necessário ter um Mac). Para instalar em iPhone ou
distribuir pelo TestFlight/App Store, é necessário participar do Apple Developer Program e configurar
as credenciais de assinatura da Apple. O perfil `production` gera o `.ipa` de distribuição da loja.

```bash
cd CoreCut-App
npx eas-cli@latest login
npx eas-cli@latest init               # vincula a pasta à conta Expo e grava o projectId
npx eas-cli@latest build:configure   # primeira configuração da conta/projeto EAS
npx eas-cli@latest build --platform ios --profile production
```

No primeiro build, o EAS solicita acesso à conta Apple para criar certificado e perfil de distribuição.
Ao terminar, baixe o `.ipa` pelo link exibido no terminal ou pelo painel do EAS. Esse arquivo de produção
é enviado ao App Store Connect para TestFlight e revisão da App Store; não é um instalador para abrir
diretamente no iPhone.

Para instalar diretamente em aparelhos registrados (distribuição interna/ad hoc), registre os iPhones
na conta Apple/EAS e use o perfil `ios-device` definido em `eas.json`:

```bash
npx eas-cli@latest device:create
npx eas-cli@latest build --platform ios --profile ios-device
```

O arquivo da build interna também é `.ipa`, mas só instala nos aparelhos incluídos no perfil de
provisionamento. Para testar sem iPhone, há um build de simulador:

```bash
npx eas-cli@latest build --platform ios --profile preview
```

Para enviar uma build de produção ao App Store Connect pelo EAS, configure a chave de API da Apple e rode:

```bash
npx eas-cli@latest submit --platform ios --profile production
```

O identificador iOS está definido como `br.com.cutcore.erp` em `app.json`. Antes de publicar, configure
no App Store Connect o nome, as capturas de tela, a política de privacidade e as declarações de câmera,
localização e dados biométricos. O app abre o mesmo ERP hospedado em `www.cutcore.com.br`, portanto as
alterações do sistema web passam a aparecer no iPhone sem uma nova versão do aplicativo.

## Estrutura

```
App.tsx                   fluxo: abertura → login → rosto → sistema (e bloqueio ao reabrir)
src/api.ts                chamadas ao servidor (/api/mobile/*, /api/auth/me)
src/session.ts            sessão no cofre do Android (expo-secure-store)
src/screens/LoginScreen   tela inicial igual à do site
src/screens/FaceScreen    cadastro/verificação/nova checagem do rosto
src/screens/ShellScreen   o sistema completo (WebView) + ponte de downloads e saída
```
