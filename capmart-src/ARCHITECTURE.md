# Arquitetura

## Fronteiras

```text
Aplicativo Saudômetro / executável local
                ↓ CapMartServices
Interface React (CapMart, Board, foco)
                ↓ comandos / estado
Motor TypeScript puro ← configuração / fases
                ↓ eventos / Result
Adaptador → persistência, economia, rankings existentes
```

O motor não importa React, navegador, localStorage, rede ou identidade. `startGame`, `move`, `tick`, `applyHelp` e `stars` são funções independentes. A configuração e o algoritmo pseudoaleatório não dependem da interface. A mesma semente reproduz o tabuleiro e a reorganização, viabilizando desafios compartilhados e replay.

## Módulos

| Arquivo | Responsabilidade |
|---|---|
| `engine/types.ts` | Produtos, espaços, tabuleiro, fase, snapshot, estado, eventos e resultado |
| `engine/config.ts` | Catálogo visual de produtos, pontos, preços e recompensas |
| `engine/random.ts` | Aleatoriedade semeada e embaralhamento |
| `engine/game.ts` | Movimentação, resolução, obstáculos, tempo, objetivos, ajudas e estrelas |
| `engine/replay.ts` | Reconstrução determinística e verificação do resultado informado |
| `levels/index.ts` | 60 configurações, seis conjuntos e semente diária |
| `services/progress.ts` | Defaults, mesclagem monotônica e dia civil |
| `services/local.ts` | Adaptador simulado e armazenamento único por usuário |
| `services/sound.ts` | Notas curtas com Web Audio, ativadas pelo usuário |
| `components/Board.tsx` | Controles de mouse, toque e teclado; sem regras de negócio |
| `components/CapMart.tsx` | Telas, ciclo da sessão, compras, submissão e preferências |
| `components/useDialogFocus.ts` | Entrada, retenção e restauração do foco modal |
| `integration/contracts.ts` | Interface do host, progresso, economia e rankings |
| `integration/hostAdapter.ts` | Ligação tipada às funções existentes do aplicativo |

## Estado e resolução

Cada espaço guarda produto atual, fila escondida e quantidade de trios para desbloqueio. Somente o item atual pode ser movido. Estoque escondido pertence ao espaço, não acompanha o produto movido. A camada da prateleira é revelada depois de esvaziar sua frente inteira. Buffers extras começam vazios e não têm fila.

Cada movimento válido cria um snapshot anterior para desfazer, faz a troca e resolve trios até estabilizar. O motor atualiza estoque, totais por produto, cadeados, combo e pontuação. Verifica vitória antes de derrota por limites. Não cria snapshots para movimentos inválidos. Desfazer não apaga eventos do replay: registra outro comando que restaura o snapshot.

O estado guarda tempo ativo decorrido para validar combos. Eventos de movimento e ajuda carregam esse tempo. `validateReplay` aplica os deltas, repete os comandos e compara pontuação, vitória, estrelas, movimentos e marcação de assistência. O servidor precisa complementar a validação com relógio confiável e recibos autenticados.

## Persistência e consistência

`Persistence` tem leitura/escrita de strings; o adaptador local usa uma chave versionada por identidade. Uma gravação guarda progresso, saldo, chaves de recompensa, recibos de resultados e compras juntos. Cada compra guarda sua partida, fase, tipo e aprovação; o replay só aceita ajudas pagas com recibo correspondente, além da dica gratuita da fase 1. `saveProgress` atualiza preferências/tutorial; somente um resultado validado pode atualizar desbloqueios e recordes. Os resultados recentes (até 200) alimentam a comparação local. Recibos e chaves não são descartados para manter idempotência.

O simulador garante repetição segura dentro da mesma instância/dispositivo, mas não oferece transações multiaba, sincronização ou proteção contra edição local. O servidor real deve usar restrições únicas e transação para manter os mesmos invariantes em acessos concorrentes. O componente só permite continuar após receber o recibo de resultado; em caso de falha oferece repetição da mesma submissão.

## Interface e substituição visual

React e ReactDOM são as únicas dependências de produção. Não há framework de animação, backend adicional, banco ou autenticação própria. O CSS fica sob `.app` para evitar alterar a interface do host; `standalone.css` contém apenas os ajustes do corpo do executável isolado. Tokens de cor ficam na raiz do módulo, produtos em configuração e o personagem é substituível pela propriedade `mascotUrl`.

O módulo é uma rota/tela completa: sidebar em desktop, navegação inferior em celular, áreas de toque e prateleiras com scroll vertical nas fases maiores. Animações respeitam a preferência do usuário e `prefers-reduced-motion`. Diálogos prendem e restauram o foco. Controles têm nomes acessíveis e foco visível.

## Evolução

Para adicionar fases, amplie o catálogo mantendo totais divisíveis por três, obstáculos que não aprisionem produtos e uma solução testada dentro dos limites. Metas de pedido não podem superar o estoque. Não altere sementes de uma competição iniciada. Para mecânicas novas, estenda os tipos e a resolução pura, inclua orientação de interface e teste o replay.

O snapshot JSON gerado é uma documentação das configurações, não outro armazenamento de progresso. `npm run docs:levels` atualiza tanto o catálogo humano quanto o snapshot. O motor suporta três ou quatro espaços por prateleira; configurações customizadas devem manter capacidade de formar trios.

## Refinamento 1.1: apresentação e configuração versionadas

O motor de troca, resolução de trios, objetivos, cronômetro, ajudas e pontuação não foi reconstruído. `Board` adiciona uma representação visual arrastável e animação de deslocamento, sem alterar os comandos `Move`. O mesmo estado é apresentado em duas prateleiras por fileira no mobile e até três no desktop largo. Cada compartimento continua uma prateleira independente: produtos em compartimentos vizinhos não formam um trio juntos.

`theme.css` adapta as cores por tokens e aplica o layout de altura limitada apenas à partida mobile. A página não rola durante a partida; a região das prateleiras admite rolagem intencional quando a tela é pequena. Produtos bloqueiam a rolagem por gesto durante o arraste; áreas vazias permitem percorrer o estoque. Cancelamento de ponteiro limpa a representação arrastada.

`levels/legacy.ts` conserva integralmente a configuração original. `levels/index.ts` define a versão 2, exporta `CONFIG_VERSION` e resolve as versões com `levelForVersion`. A comparação de replay inclui a versão. Os campos novos são opcionais para leitura de dados antigos; omissão equivale a 1. Nenhuma migração destrutiva ou reinicialização de LocalStorage é executada.

O catálogo revisado conserva a primeira dezena, acrescenta prateleiras de três espaços, seis espaços vazios a partir da fase 11 (três deles podem abrir por trios) e camadas homogêneas atrás nas fases apropriadas. A última prateleira funciona como reserva. Os totais continuam múltiplos de três, mantendo a solução construtiva do motor. Os antigos recordes permanecem máximos gerais; o ranking competitivo distingue versões.



## Entrega e limite dos serviços reais

A entrada pública é `integration/index.ts`. Motor/configuração não dependem da UI; a UI consome `CapMartServices`; o simulador continua disponível para execução independente. Não foi introduzida outra autenticação, carteira ou armazenamento definitivo.

O pacote mantém fontes/testes/configuração/recursos e lockfile. Scripts ativos são de geração e entrega; scripts de transformação anteriores estão em `scripts/history`. `TRANSFER_MANIFEST.json` é inventário de entrega, não armazenamento em runtime. O catálogo JSON é derivado das fases TypeScript.

O componente cria runId por UUID do cliente, sem uma operação de iniciar/pausar sessão no contrato. O host deverá definir registro autenticado e política de tempo no backend; `onOpen` sinaliza montagem do módulo, não início de partida. As fronteiras existentes são pontos de ligação e não provam que os serviços reais já estão conectados. Pendências completas em `CLAUDE_HANDOFF.md`.
