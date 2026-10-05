# Relatório de testes — CapMart 1.1 — 2026-10-03

## Resultados executados

| Verificação | Resultado |
|---|---|
| Testes de motor, fases, replay e persistência | 330 aprovados, quatro arquivos |
| Playwright no Edge | 30 aprovados, desktop, celular e tablet |
| TypeScript e build Vite | Aprovados |
| Catálogo e snapshot das 60 fases | Gerados |
| Auditoria npm durante instalação | Zero vulnerabilidades |

Build: JavaScript 269,52 kB (84,95 kB gzip), CSS 32,65 kB (7,20 kB gzip). Não são notas de Lighthouse.

## Refinamento verificado

As dez primeiras fases preservam tabuleiro e metas anteriores. As demais usam compartimentos de três espaços e estoque progressivo, chegando a 189 produtos entre frente e reservas na fase 60. Todas as 60 fases têm solução automatizada dentro dos limites; também foram verificadas reorganizações, metas, estoque oculto, cadeados e ausência de combinações iniciais indevidas. A regra de formar trios permanece.

A configuração anterior permanece disponível para validar replays antigos. Testes com dados persistidos da versão anterior confirmam preservação de saldo, desbloqueios, recordes e recibos, sem recompensa duplicada. Rankings distinguem versões da configuração. Os testes usam perfis isolados e não alteram o progresso pessoal do usuário.

## Navegador e layout

Fluxos de início, mapa, tutorial, vitória, recompensa, recarregamento, compra e cancelamento, pausa, teclado e desafio diário passaram nos três perfis. Auditorias Axe WCAG 2 A/AA e 2.1 AA passaram nas telas auditadas.

Foram acrescentados testes em 320×568, 390×844 e 844×390, repetidos nos três perfis. Eles verificam ausência de transbordamento da página, alvos de toque de pelo menos 44 px, ícones de pelo menos 25 px, metas acessíveis e arraste efetivo sem rolar a página ou o tabuleiro durante o gesto. O tabuleiro permite rolagem intencional para alcançar outras prateleiras.

Na medição de 390×844: tabuleiro com 582,2 px de altura; 53 produtos visíveis; menor espaço com 55,3×46,4 px; ícones de 28 px. As prévias finais em `previews/mobile.png` e `previews/desktop.png` foram inspecionadas visualmente. A identidade rosa/vinho segue a captura fornecida do Saudômetro; a referência de prateleiras orienta a densidade. A capivara original e os produtos foram preservados.

## Limitações

Os testes mobile e tablet foram emulados no Edge; não houve execução em aparelhos físicos, Safari ou Firefox. Não houve Lighthouse nem estudo com jogadores. Solução automatizada demonstra possibilidade de conclusão, não equilíbrio definitivo para jogadores humanos.

Não houve integração com backend, identidade ou carteira reais do Saudômetro. O adaptador local valida replay e recibos, mas um servidor real precisa validar autenticação, transações e concorrência. Partidas em andamento não são recuperadas após recarregar; o progresso concluído persiste.

Painel superior atualizado com nível, pontuação, tempo, movimentos e combo. A barra acompanha a janela real de cinco segundos do motor, inclusive sua expiração, e respeita movimento reduzido.


## Validação da entrega ao Claude — 2026-10-03

Executados novamente: `npm test` (330 aprovados, quatro arquivos), `npm run test:ui` (30 aprovados, 50,3 s, Edge), `npm run typecheck` (aprovado), `npm run build` (aprovado) e `npm run docs:levels` (catálogo de 60 fases). Auditoria npm ao sincronizar o lockfile: zero vulnerabilidades. Nenhum teste da suíte local ficou pendente. A seleção de navegador em outros sistemas foi preparada mas o fallback Chromium fora do Windows não foi executado aqui.

Os hashes de produção permanecem `index-B7ZkcQ_X.css` e `index-DlZrytVS.js`, os mesmos da versão visual aprovada antes da preparação da entrega. Não foram alteradas funcionalidades, fases ou estilos. Organização: scripts históricos separados, tipos e configuração de navegador verificados, dependência esbuild do gerador declarada explicitamente e script de preparação com inventário SHA-256.

A pasta não está ligada a um repositório Git: `git status` e `git remote -v` retornaram que não é um repositório. Entrega por ZIP, sem branch/PR. O pacote contém os recursos originais e ícones, 60 configurações/snapshot, CSS, contratos, código e testes; exclui node_modules, dist, dados temporários, .env e material de chaves. Prévias são capturas de perfis isolados.

Testes com serviços reais do Saudômetro, registro autenticado de partidas, políticas de tempo/pausa, autorização de participantes e concorrência do backend NÃO foram executados: o projeto/serviços principais não foram fornecidos. A integração permanece pendente para o Claude, conforme CLAUDE_HANDOFF.md.
