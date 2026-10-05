# Integração do CapMart ao Saudômetro

## Incorporar sem reconstruir

O projeto não recebeu arquivos do Saudômetro. Os contratos abaixo evitam escolher seu banco, autenticação ou serviço de moedas antecipadamente. Se o aplicativo aceitar React web, copie os módulos `src`, `integration` e o CSS para o projeto, mantendo os imports. Importe o componente e forneça os serviços existentes. O motor também pode ser usado num host diferente, porque não importa React ou APIs de navegador.

```tsx
import { CapMart, createHostAdapter } from './CapMart/integration';
import './CapMart/src/styles.css';
import './CapMart/src/theme.css';

const services = createHostAdapter({
  identity: { id: authenticatedUser.id, displayName: authenticatedUser.name },
  loadProgress: () => existingGames.loadProgress('capmart'),
  saveProgress: progress => existingGames.saveProgress('capmart', progress),
  getBalance: () => existingWallet.balance(),
  purchaseHelp: input => existingWallet.authorizeGamePurchase('capmart', input),
  submitResult: result => existingGames.validateAndReward('capmart', result),
  getRanking: input => existingRankings.forGame('capmart', input),
  onOpen: () => existingNavigation.gameOpened('capmart'),
  onClose: () => existingNavigation.gameClosed('capmart'),
});

<CapMart services={services} mascotUrl={hostAssets.capmartMascot}
  onClose={() => existingNavigation.closeGame()} />;
```

Os nomes `existingGames`, `existingWallet`, `existingRankings`, `existingNavigation`, `authenticatedUser` e `hostAssets` representam funções e dados já existentes no host; adapte as assinaturas ao seu código. Não instale outro serviço de login nem crie outra moeda. Mantenha a instância `services` estável durante a sessão e remonte o componente ao trocar o usuário. O módulo usa layout de tela inteira, indicado para uma rota do aplicativo. Não importe `standalone.css` no host. A imagem padrão está em `/capivara.jpg`; forneça `mascotUrl` quando os recursos estiverem em outro caminho.

## Contratos

Os tipos completos estão em `integration/contracts.ts`, exportados por `integration/index.ts`.

| Operação | Entrada / resposta | Obrigação do host |
|---|---|---|
| `identity` | ID e nome; IDs de parceiro/grupo opcionais | Identidade já autenticada, sem aceitar um ID arbitrário como autorização |
| `loadProgress` | `Promise<Progress>` | Carregar progresso versionado do usuário autenticado |
| `saveProgress` | `Progress` → `Promise<void>` | Salvar preferências/tutorial; preservar recordes e impedir desbloqueio forjado |
| `getBalance` | `Promise<number>` | Saldo da carteira existente |
| `purchaseHelp` | requestId, runId, ajuda e fase → approved, balance | Preço calculado no servidor, transação, idempotência e recibo por compra |
| `submitResult` | `Result` → `Receipt` | Validar partida, atualizar progresso/ranking e conceder recompensas em transação |
| `getRanking` | mode, levelId, seed, configVersion → entradas | Verificar participantes do casal/turma e filtrar mesma configuração |
| `onOpen` / `onClose` | callbacks opcionais | Receber ciclo de montagem e desmontagem |

`Progress` contém versão 1, fase desbloqueada, registros por fase (concluída/estrelas/pontos), tutorial e preferências. `Receipt` retorna progresso definitivo, saldo, moedas concedidas e recorde anterior. `Result` contém ID da partida, fase, semente, pontos, estrelas, vitória, assistência, segundos ativos, movimentos, indicação de desafio diário, seu `dailyDay` e lista de eventos. O simulador aceita concluir um diário iniciado no dia anterior e concede a recompensa à data desse desafio; a primeira vitória usa o dia da conclusão. O servidor deve vincular essa data ao início autenticado da sessão.

Cada evento informa tempo ativo e uma troca ou ajuda. O motor exporta `validateReplay(level, result)` para reconstruir a partida e rejeitar resultados divergentes. O cliente não deve escolher valores de pontuação ou preço fora da configuração versionada; mesmo assim, o servidor precisa ignorar valores não validados enviados por ele.

## Autoridade e economia

1. Associe `runId` ao usuário, à configuração/sua versão e ao início autenticado de uma sessão. A implementação local gera UUIDs; no host, registre/autentique essa sessão em seu serviço de partidas. Não confie no UUID como autenticação.
2. Use a configuração e semente autorizadas pelo servidor. No diário, verifique o dia do desafio e a semente correspondente; não aceite uma semente escolhida pelo cliente. Casal e Turma recebem o mesmo tabuleiro.
3. Reconstrua os eventos com `validateReplay` e verifique tempo contra relógio confiável. A pausa é permitida no modo local. Defina com o sistema de desafios existente se a competição permite pausa; registre pausas ou use deadline de servidor conforme essa política. Um replay válido sozinho não prova os tempos alegados.
4. Cada evento de ajuda deve ter uma compra autenticada e aplicável para aquela partida. A dica grátis da fase 1 existe para o tutorial; autorize essa exceção explicitamente. Não confie apenas no campo `assisted`.
5. Calcule estrelas, recordes e recompensas no servidor. Use chaves únicas `(user, phase, firstCompletion)`, `(user, phase, firstThreeStars)`, `(user, civilDay, firstWin)` e `(user, civilDay, dailyChallenge)`. Derrota não debita moedas.
6. Em uma transação, grave o resultado, mescle máximos de estrelas/pontuação, avance a fase, conceda créditos da carteira existente e produza o recibo. Submeter o mesmo `runId` retorna o mesmo recibo. Submeter outro ID da mesma fase não repete recompensas já concedidas.
7. Compra usa `requestId` idempotente vinculado ao usuário, `runId`, tipo e preço. Repetir após timeout consulta a mesma transação; uma chave usada com outro corpo deve ser rejeitada. O componente mantém a chave ao tentar novamente.

O adaptador local usa um saldo inicial simulado de 50 moedas e LocalStorage. Verifica a estrutura, reproduz o replay, confere ajudas com recibos e oferece idempotência; dados editáveis no navegador e tempos informados pelo cliente ainda não impedem fraude. Não reutilize esse adaptador para moedas reais. Também não oferece atomicidade entre abas/dispositivos. A proteção definitiva citada no briefing pertence ao servidor do Saudômetro.

## Casal, Turma e ranking

`Mode` é `individual`, `couple` ou `group`. Forneça membros autenticados e autorização do relacionamento/grupo pelo backend existente. Todas as entradas retornadas devem corresponder à mesma fase, semente e versão de configuração. Exiba ou filtre divisões de resultados com e sem ajudas; o contrato transporta `assisted`. O simulador lista apenas resultados do usuário local e não inventa outro participante.

## Checklist técnico de transferência

- Executar `npm test`, `npm run test:ui` e `npm run build` no projeto independente antes de transferir.
- Importar os contratos e conservar o motor; substituir apenas a ligação de serviços e o caminho dos recursos originais.
- Adaptar callbacks de navegação e identidade. Remontar o módulo quando trocar o usuário.
- Verificar uma compra cancelada, uma compra confirmada e a repetição da mesma compra após timeout.
- Verificar submissão repetida, primeira conclusão, três estrelas numa repetição, vitória diária e desafio diário.
- Confirmar recordes monotônicos, configuração igual entre competidores e autorização do grupo.
- Validar replay e relógio no servidor; rejeitar resultados e moedas adulterados.
- Preservar a versão das fases para desafios já iniciados e testar a integração nos dispositivos suportados pelo host.

Não há implementação de banco ou autenticação definitiva neste repositório. O componente, motor, fases e funcionalidades locais permanecem utilizáveis durante a integração.

## Integração do refinamento 1.1 / configurações 2

Importe os dois arquivos de estilo (ambos delimitados à raiz do módulo):

```tsx
import './CapMart/src/styles.css';
import './CapMart/src/theme.css';
```

Preserve a carteira, os recibos e `Progress.version: 1`. O formato de progresso não mudou e a chave local continua `capmart:v1:<userId>`. Não limpe os registros para trocar a identidade visual ou expandir fases.

`Level`, `Result`, `RankingEntry` e a entrada de `getRanking` aceitam `configVersion?: number`. Ausência significa 1; novas partidas informam 2. Para validar um replay:

```ts
import { levelForVersion, validateReplay } from './CapMart/integration';
const level = levelForVersion(result.levelId, result.seed, result.configVersion ?? 1);
validateReplay(level, result);
```

O servidor continua validando a semente autorizada, o dia do diário, tempos, usuário e recibos. Não compare participantes de versões diferentes: filtre rankings por fase, semente e `configVersion`. Mantenha uma competição já aberta em sua versão original até terminar. Os campos opcionais mantêm a leitura dos dados anteriores; não converta eventos antigos para o tabuleiro novo. Recibos idempotentes antigos devem ser retornados sem recalcular créditos.

O motor mantém suporte às configurações anteriores, incluindo prateleiras com quatro espaços. O formato atual usa várias prateleiras de três posições, agrupadas somente na apresentação. Nenhuma adaptação do backend precisa recriar o motor ou os componentes.

Ícones oficiais independentes: `icons/capmart-64.svg`, `capmart-128.svg`, `capmart-256.svg`, `capmart-512.svg`; caminhos completos em `mascot-assets.json`. Cada SVG embute a mesma imagem original com proporção preservada. Para a área de minigames, use 128/256; para destaques maiores, 512. A imagem completa continua disponível em `capivara.jpg` e pela propriedade `mascotUrl`.



## Dados que o aplicativo principal deverá fornecer

| Domínio | Campos/garantia |
|---|---|
| Identidade | `Identity.id`, `displayName`; `partnerId/groupId` opcionais, autorizados pelo host |
| Progresso | `version: 1`, `unlocked` (1–60), `records` por fase (`stars`, `score`, `completed`), `tutorialDone`, `preferences.sound/reducedMotion` |
| Carteira | Saldo da carteira existente; preço calculado a partir da política aprovada de `RULES.costs`; nenhuma nova moeda |
| Compras | `requestId/runId/help/levelId`, vínculo autenticado, idempotência e resposta definitiva `approved/balance` |
| Resultados/recompensas | Replay, configuração/semente, dia do desafio, tempos, assistência; recibo `balance/awarded/previousRecord/progress`; chaves únicas por recompensa |
| Rankings | Participantes reais autorizados, modo e mesma fase/semente/configVersion; `userId/name/score/assisted/seed/configVersion` |
| Navegação/recursos | Rota dedicada, ação fechar, caminho público do JPG via `mascotUrl`; manifest/ícones originais |

`saveProgress` não é um endpoint para aceitar recordes arbitrários: atualizar tutorial/preferências e conservar campos autoritativos. O cliente informa preços/resultado apenas pela configuração; o servidor deve validar/calcular os valores antes de movimentar a carteira. Os detalhes das recompensas e custos estão em `GAME_RULES.md` e `src/engine/config.ts`.

## Limite do contrato de sessão atual

`onOpen/onClose` representam montagem/desmontagem, não início/pausa de uma partida. `runId` é gerado no componente e o contrato não expõe início autenticado, pausa ou seleção de uma competição antiga. Para tempo confiável, o Claude deverá propor a ligação mínima ao serviço de partidas existente (eventual extensão tipada e testada), associando usuário, runId, nível, semente, versão, dia e política de pausa. Não criar um serviço de login ou carteira paralelo para resolver isso. Um replay válido sozinho não resolve essas pendências.

A versão local é mantida por omissão de `services`; em produção fornecer explicitamente uma instância estável de `createHostAdapter(bindings)`, originada dos serviços autenticados. Usar `key={authenticatedUser.id}` ao montar/remontar `<CapMart>` evita carregar estado de outra conta. Evitar reconstruir o adaptador a cada render. A prop `onClose` solicita navegação; o callback dos serviços recebe o fechamento efetivo por desmontagem.

O CSS é delimitado a `.app`, mas esse nome e elementos fixos podem coincidir com o shell do Saudômetro. Verificar a integração numa rota dedicada, inclusive altura/scroll, imports e ordem de estilos. Não importar `main.tsx`/`standalone.css` no host, nem montar um segundo ReactDOM root dentro da rota. O exemplo é ilustrativo: requer as funções reais do Saudômetro, não existe endpoint real neste pacote.

## Sequência e aceite para o Claude

1. Inspecionar o aplicativo principal e mapear as operações do contrato aos serviços existentes.
2. Reutilizar o motor, as fases, a interface e os estilos aprovados; publicar os recursos originais no caminho correto.
3. Implementar o adaptador e a validação de servidor, preservando recordes e recibos; não importar automaticamente moedas do simulador para a carteira real.
4. Executar as suítes locais e testes de integração de autorização, concorrência, repetição após timeout, logout/troca de conta, diário e ranking de casal/turma.
5. Verificar dispositivos/navegadores reais do host e preparar a mudança para revisão antes da publicação.

A entrega independente foi revisada; a integração ao Saudômetro permanece pendente. Consulte `CLAUDE_HANDOFF.md` para o resumo operacional.
