# CapMart

Mercadinho da capivara: organize produtos em trios, conclua pedidos e avance por 60 fases. Projeto web independente, com contratos substituíveis para integrar ao Saudômetro. Nenhuma documentação ou tecnologia do aplicativo principal estava presente na pasta inicial; por isso, a implementação utiliza React, TypeScript e Vite, conforme o briefing.

## Executar

Requer Node.js 22.12+ (verificado com 24.18.0) e npm.

```sh
cd CapMart
npm ci
npm run dev
```

Abra `http://127.0.0.1:5173`. Para distribuição estática:

```sh
npm run build
npm run preview
```

O diretório `dist` contém a compilação. O jogo não faz chamadas a serviços externos na versão local: inclusive fontes usam alternativas do sistema. O armazenamento local guarda progresso, preferências, saldo e recibos por identidade. Se o navegador bloquear o armazenamento, a interface informa falha e não declara o salvamento concluído.

## Jogar

Selecione um produto e o destino, ou arraste com mouse ou toque. Três iguais na mesma prateleira são eliminados automaticamente. Enter e Espaço acionam os botões pelo teclado. Nas fases com estoque escondido, esvazie toda a frente da prateleira para revelar a camada seguinte. Espaços de reserva ajudam nas trocas; cadeados abrem após o número indicado de trios.

O primeiro acesso à fase 1 apresenta um tutorial interativo. Fases 21 e 31 explicam novos obstáculos; os pedidos e metas de pontos apresentam seu objetivo antes da partida. O mapa permite repetir fases desbloqueadas sem perder recordes ou estrelas. A tela inicial retoma uma partida ativa nesta sessão, ou começa a próxima fase desbloqueada. Ao fechar/recarregar o navegador, preserva-se o progresso concluído; uma partida em andamento recomeça.

O desafio diário usa uma semente derivada do dia civil de São Paulo. Rankings separam configuração inicial e identificam partidas com ajudas. Na versão local só aparecem partidas do perfil atual; participantes reais de Casal e Turma são fornecidos pelo adaptador do Saudômetro.

## Verificação

```sh
npm test
npm run test:ui
npm run build
npm run docs:levels
```

Os testes de interface usam o Edge instalado no caminho padrão do Windows. Em outro sistema, ajuste `launchOptions.executablePath` no `playwright.config.ts`, ou configure o Chromium do Playwright. A suíte cobre desktop (1440×1000), celular (390×844) e tablet (768×1024), toque, mouse, teclado e auditorias Axe WCAG AA. `TEST_REPORT.md` registra o que foi efetivamente executado.

## Integração e organização

- `src/engine`: estado puro, movimentos, combinações, obstáculos, tempo, pontuação, ajudas e replay.
- `src/levels`: configurações determinísticas e desafio diário.
- `src/components`: interface React, tabuleiro e foco dos diálogos.
- `src/services`: persistência, progresso, economia simulada e som opcional.
- `integration`: contratos, ponto de exportação e adaptador para serviços existentes.
- `tests`: motor, replay, economia, persistência e navegador.
- `public/capivara.jpg`: imagem fornecida pelo usuário, usada sem geração ou cópia da referência de jogabilidade.

Leia `INTEGRATION_GUIDE.md` antes de conectar moedas reais. O saldo inicial de 50 moedas pertence exclusivamente ao simulador de desenvolvimento. Um cliente local não é uma fronteira de segurança: a autoridade das moedas, do tempo, dos recibos, das recompensas e do ranking deve permanecer no servidor do Saudômetro.

Identidade visual: rosa claro, rosa e vinho, alinhados à referência do Saudômetro. Os estilos estão delimitados à raiz `.app`; o arquivo `standalone.css` só é importado pelo executável independente. A imagem do personagem pode ser substituída com a propriedade `mascotUrl`. Não há autenticação paralela nem banco definitivo.

Documentação: `GAME_RULES.md`, `LEVELS.md`, `ARCHITECTURE.md`, `INTEGRATION_GUIDE.md`, `TEST_REPORT.md` e `CHANGELOG.md`.

## Refinamento 1.1 — Saudômetro e mobile

O layout desktop aprovado foi mantido. O tema agora usa rosa claro, rosa e vinho da referência enviada do Saudômetro. A tela da partida mobile usa a altura disponível do dispositivo: fase/pausa, objetivo/metas e indicadores compactos no topo; tabuleiro no centro; quatro ajudas numa barra pequena. Em orientação horizontal, as ajudas ficam ao lado para liberar altura.

A partir da fase 11, duas prateleiras independentes de três espaços aparecem por fileira no celular; desktop largo apresenta até três. A fase 60 tem 63 produtos acessíveis, 126 atrás e seis espaços vazios (189 mercadorias ao todo), contra 24 acessíveis e 48 atrás anteriormente. As primeiras dez fases conservam seus tabuleiros e metas. O estoque cresce gradualmente; tempo, movimentos, pedidos e metas foram recalibrados. Os mesmos 12 produtos foram reutilizados.

Os itens mantêm alvos de pelo menos 44 × 44 px mesmo em 320 px de largura. Nas telas mais baixas, o estoque pode ser percorrido intencionalmente dentro do tabuleiro, tocando os espaços vazios ou os intervalos. Arrastar um produto não desloca o tabuleiro ou a página. O produto acompanha o dedo, as trocas têm transição breve, trios pulsam e estrelas aparecem em sequência. Movimento reduzido desativa esses efeitos.

Importe também `src/theme.css` ao integrar. Os tokens `--accent`, `--accent-strong`, `--canvas`, `--surface`, `--shelf` e `--shelf-edge` podem ser ajustados pelo host. `--green` permanece como alias compatível do destaque, sem exigir reescrever componentes.

Ícones oficiais proporcionais: `public/icons/capmart-{64,128,256,512}.svg`. Eles incorporam os bytes da imagem original, sem redesenhá-la. `public/mascot-assets.json` lista os caminhos; `npm run assets:mascot` regenera as versões.

Progresso e chave de armazenamento continuam em versão 1. As novas fases usam `configVersion: 2`; resultados sem esse campo são tratados como configuração 1. Recordes, estrelas, carteira e recibos existentes continuam intactos. Rankings comparam fase + semente + versão. Veja o guia de integração para validar partidas antigas.

Prévias locais: [mobile](previews/mobile.png) e [desktop](previews/desktop.png). São capturas reais de uma fase avançada, geradas pelos testes de navegador.



## Transferência para o Claude

A integração ainda será feita no Saudômetro. Comece por `CLAUDE_HANDOFF.md`; o projeto principal do aplicativo deve ser fornecido separadamente. Preserve o jogo aprovado e substitua apenas os vínculos de serviços necessários.

Dependências de produção: React e ReactDOM 19. Desenvolvimento: TypeScript 5.7, Vite 6/plugin React, Vitest 4, Playwright/Axe, esbuild para gerar o catálogo e tipos Node/React. `package-lock.json` fixa a árvore; instale com `npm ci`, sem copiar `node_modules`. Node >=22.12 (execução verificada com Node 24). Não há variáveis de ambiente de aplicação obrigatórias nem credenciais neste módulo.

Comandos adicionais:

```sh
npm run typecheck
npm run assets:mascot
npm run docs:levels
npm run handoff:prepare
```

Testes UI usam Edge instalado no Windows quando disponível; caso contrário, `npx playwright install chromium` instala o navegador de testes. `CAPMART_BROWSER_PATH` opcional seleciona outro executável Chromium. Não é uma credencial. A porta 5173 deve estar livre ou servindo este projeto. A suíte está configurada para um worker, pois as capturas e métricas têm caminhos fixos.

`handoff:prepare` cria uma pasta `transfer/<data>/CapMart` com lista explícita de fontes, testes, recursos, documentação, configs e lockfile. Não copia dependências instaladas, build, relatórios temporários, Git ou arquivos .env. O manifesto `TRANSFER_MANIFEST.json` registra tamanhos e SHA-256 para conferir a transferência. Compacte essa pasta e envie o ZIP, juntamente com acesso ao projeto do Saudômetro.

Scripts em `scripts/history` são registros de transformações da implementação anterior e não fazem parte da instalação/build; não os execute na integração. Os scripts ativos geram catálogo, ícones e a pasta de entrega. Os ícones e configurações já estão incluídos, portanto não é necessário regenerá-los para executar o jogo.

