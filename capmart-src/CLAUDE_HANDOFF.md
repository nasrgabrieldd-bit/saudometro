# Entrega ao Claude — CapMart 1.1

## Objetivo e estado

Integrar este jogo aprovado ao aplicativo Saudômetro existente. A integração NÃO está concluída: este pacote é o módulo independente e seus contratos. Não reconstruir o jogo, redesenhar telas, substituir a capivara, recalibrar fases ou mudar regras/economia durante a integração.

Prontos: campanha de 60 fases, seis conjuntos, desafio diário de São Paulo, objetivos de limpeza/pedido/pontos, estoque oculto, cadeados, combo de cinco segundos, estrelas, quatro ajudas, confirmação de compras, tutorial, pausa, replay determinístico, persistência local e leitura de resultados anteriores. Interface desktop/mobile/tablet com painel de nível/pontos/tempo/movimentos/combo, arraste por mouse/toque, teclado, som opcional e movimento reduzido. Casal/Turma têm interface e contrato; participantes reais dependem do host.

## Primeiro procedimento

1. Ler README.md, ARCHITECTURE.md, INTEGRATION_GUIDE.md, GAME_RULES.md e TEST_REPORT.md.
2. Inspecionar o código real do Saudômetro: framework, navegação, usuário autenticado, carteira, progresso, transações e rankings. Esse código NÃO está neste pacote.
3. Rodar `npm ci`, `npm test`, `npm run typecheck`, `npm run test:ui`, `npm run build` para estabelecer a referência. Se não houver Edge, executar `npx playwright install chromium` antes dos testes UI.
4. Incorporar o módulo por uma rota/tela e criar um adaptador usando serviços já existentes. Não montar `<CapMart/>` sem `services` em produção: isso ativa o simulador.
5. Verificar com o backend compras/resultados repetidos, falhas de rede, troca de usuário e autorização de Casal/Turma. Só depois preparar a publicação para revisão.

## Arquivos principais

- `integration/index.ts`: entrada pública; `contracts.ts`: tipos; `hostAdapter.ts`: repasse dos serviços do host, sem backend próprio.
- `src/engine/`: regras/estado/replay puros, reutilizáveis no servidor TypeScript.
- `src/levels/index.ts`: campanha atual/configuração 2; `legacy.ts`: configuração anterior. `levels.snapshot.json` e `LEVELS.md`: catálogo derivado, não uma segunda fonte de regras.
- `src/components/CapMart.tsx`, `Board.tsx`, `useDialogFocus.ts`: interface aprovada.
- `src/styles.css` e `src/theme.css`: importar nessa ordem. `standalone.css` e `main.tsx` são só do executável independente.
- `src/services/local.ts`: simulador; `progress.ts`: defaults/mesclagem/data; `sound.ts`: som local.
- `public/`: JPG original, quatro SVGs com o mesmo JPG embutido e manifesto. Produtos são emojis definidos em `engine/config.ts`, sem downloads externos.
- `tests/`: 330 testes de motor/serviços e 30 cenários de navegador; `previews/`: capturas aprovadas.

## Dados e serviços do Saudômetro

Fornecer uma instância estável de `CapMartServices` com identidade autenticada (id/displayName; partnerId/groupId opcionais), progresso versão 1, saldo inteiro de moedas, autorização de compras, submissão/recibo de resultado e rankings autorizados. `onOpen/onClose` são callbacks de montagem/desmontagem; a prop `onClose` solicita fechar a tela. Remontar com chave do usuário ao trocar a conta. IDs opcionais não implementam autorização sozinhos.

`purchaseHelp`: requestId, runId, help, levelId → approved/balance. O servidor calcula preços e guarda recibos vinculados à partida, com idempotência.

`submitResult`: runId, levelId, seed, configVersion, score, stars, won, assisted, elapsed, moves, daily/dailyDay, events → balance, awarded, previousRecord, progress. Validar replay, compras e tempos; atualizar carteira/progresso/ranking em transação. A submissão repetida deve devolver o mesmo recibo.

`getRanking`: mode, levelId, seed, configVersion → userId/name/score/assisted/seed/configVersion. Filtrar a mesma configuração e autorizar membros no backend.

Preservar `Progress.version: 1` e dados anteriores. Ausência de configVersion significa 1; novas fases usam 2. Usar `levelForVersion` e não reprocessar recibos antigos. Não apagar saldo, estrelas, recordes, desbloqueios ou recibos para integrar. Migração de dados locais para uma conta real exige política definida pelo host: não creditar o saldo simulado de 50 moedas na carteira real.

## Pendências reais

- Backend, autenticação, carteira, ranking compartilhado e navegação do Saudômetro não foram fornecidos nem conectados.
- O componente gera runId no cliente e o contrato atual NÃO tem startSession/pauseSession/endSession. Antes de moedas/ranking reais, definir no host registro autenticado da partida, semente autorizada, vínculo usuário/runId, horário e política de pausas. Se isso exigir estender o contrato, fazer alteração mínima e testes, sem reconstruir a interface.
- Progresso carregado inicia a campanha atual; o contrato não seleciona uma competição antiga em andamento. Definir entrada/sessão para competições versionadas se o host precisar delas.
- Não há recuperação de partida em andamento após reload nem sincronização multiaba/dispositivo. Progresso concluído persiste no simulador.
- CSS usa `.app` e layout de tela inteira/fixo: verificar colisão com o shell do host. Usar uma rota dedicada e evitar duplicar barras de navegação; preservar o visual interno aprovado. Não importar o CSS global standalone no host.
- Se o Saudômetro for React Native ou outro host sem DOM, avaliar WebView com ponte autenticada; este módulo React web não é um componente nativo pronto.
- Validar em aparelhos físicos e navegadores suportados pelo Saudômetro; os testes atuais são emulação no Edge.

## Critério de entrega da integração

Visual e jogabilidade preservados; serviços reais no lugar do simulador em produção; identidade do host e mesma carteira; preços/recompensas/replay/relacionamentos validados pelo servidor; tentativas repetidas sem débitos/créditos duplicados; dados anteriores preservados; testes locais e testes de integração do host aprovados. Documentar diferenças e obter revisão antes de publicar.
