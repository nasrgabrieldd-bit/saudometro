# Saudômetro — entrega desktop

## Arquitetura auditada

Base: repositório https://github.com/nasrgabrieldd-bit/saudometro, commit `b19b53a`. O app usa JavaScript ES Modules e CSS, sem framework/build. `js/app.js` renderiza as telas em `#view-container` (Casal) e `#friends-view` (Turma). A navegação usa o estado existente, incluindo links iniciais por query string; não há um roteador externo.

`db.js`, `friends.js` e `gameRooms.js` consultam o mesmo Supabase (auth Google e legado anônimo, Postgres/RPC, RLS, Storage e Realtime). `sw.js` armazena o shell offline. `icons.js`, `people.js`, `css/styles.css` e `css/fonts.css` são as fontes existentes de identidade, configurações, tokens e temas. Jogos existentes incluem Capibatman, Capiverso e Capistop; a economia continua nos serviços originais. Não foi localizado módulo Capisurpresa integrado. Existe um “modo dono” parcial; não foi evoluído nesta etapa.

## Mudanças

- `css/desktop.css`: apenas regras responsivas. Navegação lateral a partir de 1024 px, conteúdo de até 1440 px, duas colunas nos hubs e quatro colunas nos atalhos em telas maiores.
- `index.html`: importa o novo CSS e identifica a navegação do casal.
- `js/app.js`: atributos de layout nos renderizadores, estado ativo acessível na navegação, calendário com os detalhes ao lado, e registro de clique no menu do casal sem acumular handlers ao reentrar. Os serviços e contratos de persistência permanecem os existentes.
- `sw.js`: inclui o CSS novo no cache e incrementa a versão para v78.
- `scripts/serve.mjs`: servidor de desenvolvimento em localhost, sem dependência de runtime.
- `tests/desktop-ui.mjs`: teste de interface usando renderizadores reais e respostas de serviço interceptadas somente no teste.
- `package.json`/lockfile: Playwright como dependência exclusiva de teste; scripts de prévia e teste desktop.
- `.github/workflows/testes.yml`: job desktop com Chromium e backend simulado, separado dos testes existentes.

A navegação mobile mantém as seis seções de cada modo e a posição inferior. As cores, fontes, ícones, mascote, formulários e mecânicas dos jogos vêm do app original. Nenhuma migration, configuração Supabase ou Edge Function foi modificada. Esta pasta é uma cópia do aplicativo original, separada da landing e da publicação em produção.

## Executar e testar

Node 22+:

```sh
npm ci
npm run dev
```

Abra http://127.0.0.1:5187. O servidor serve o app real; login local depende da configuração OAuth/redirect permitida no Supabase existente. O servidor é só para desenvolvimento, não substitui a hospedagem de produção.

```sh
npm test
npx playwright install chromium
npm run test:desktop
```

Em Linux, use `npx playwright install --with-deps chromium` se forem necessárias bibliotecas do navegador. Com Edge instalado, em PowerShell:

```powershell
$env:TEST_BROWSER_CHANNEL='msedge'
npm run test:desktop
```

`TEST_URL` pode apontar para outro servidor local. A suíte de navegador exige um servidor ativo; o job de CI inicia um antes dos testes. Capturas ficam em `test-results/`, ignoradas no Git. O Playwright injeta estado e serviços apenas nas respostas interceptadas pelo teste; o código servido ao usuário não contém dados de demonstração nem bypass de login.

## Validação realizada

- 59 testes existentes passaram antes e depois das alterações: sintaxe, imports, recursos, cache offline, ausência de segredos e lógica de Casal/Cartas/Stop.
- Interface de Casal e Turma verificada em 390, 768, 1024, 1366 e 1920 px, sem transbordamento horizontal nas áreas verificadas.
- Temas claro/escuro na Home do Casal; menu inferior/lateral, navegação, calendário e detalhes simultâneos, recados, histórico, humor, loja/prêmios e tabuleiro original verificados no navegador.
- Formulário de recado e modal verificados em larguras mobile/tablet/desktop. Mensagem escrita em uma tela reapareceu na segunda tela com backend e evento de atualização simulados.
- O fluxo visual do botão Google foi verificado sob interceptação; nenhum login OAuth real foi realizado e nenhuma conta real foi criada ou alterada.
- O novo job de CI foi preparado; seu resultado remoto só é confirmado após a execução no GitHub.

**Limites:** sincronização real entre dispositivos, OAuth real, RLS e funcionalidades completas com usuários autenticados ainda precisam ser testados em homologação. A simulação de duas telas não certifica o backend real. Não foi publicada nenhuma alteração nem iniciada a administração.

## Integração no Claude

Use o commit/PR desktop desta branch sobre a base auditada, sem copiar a landing. Se o projeto Claude já avançou, compare antes de aplicar. Arquivos principais de produto: `index.html`, `js/app.js`, `css/desktop.css` e `sw.js`; os demais suportam testes/documentação.

Na integração, preserve mudanças concorrentes em `app.js` e reconcilie a versão do cache com a versão mais recente do projeto. Mantenha `css/desktop.css` depois de `styles.css` e inclua-o no `SHELL`. Execute `npm test`, `npm run test:desktop` e a regressão real de login, Casal/Turma, recados, calendário, jogos, loja e moedas. Avalie o desktop e aprove esta etapa antes de iniciar o painel administrativo.

Para reverter, reverta o commit desktop e incremente/reconcilie o cache para atualizar clientes, sem tocar no banco. Não dar push na main nem fazer merge/publicação automaticamente.

### Prévia interativa sem login

Execute `npm ci` e `npm run dev:preview`, depois abra http://127.0.0.1:5188.
A barra superior permite alternar Casal, Turma e tema. Esta prévia usa os renderizadores e eventos do aplicativo com as mesmas respostas de demonstração dos testes desktop. Os dados ficam em memória e desaparecem ao recarregar. Não há login real, sincronização, notificações ou partidas multiplayer reais nesta prévia.

O servidor escuta somente em 127.0.0.1, substitui os módulos de serviços e bloqueia conexões externas pela política CSP. Não publique este servidor. O aplicativo normal continua disponível via `npm run dev`, sem alterações no fluxo de autenticação. Para validar a navegação da prévia, com o servidor ativo execute `npm run test:preview` (ou defina `TEST_BROWSER_CHANNEL=msedge` quando não houver Chromium instalado).
