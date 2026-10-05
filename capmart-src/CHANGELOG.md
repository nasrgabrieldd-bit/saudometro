# Histórico

## 1.1.0 — 2026-10-03

- Refinamento mobile com HUD compacto, tabuleiro de duas prateleiras por fileira e ajudas em barra pequena; em orientação horizontal, ajudas laterais.
- Identidade rosa claro, rosa e vinho orientada pela landing page do Saudômetro, com tokens de tema e estrutura desktop preservada.
- Fases 11–60 mais cheias, seis espaços estratégicos e estoque progressivo até 189 produtos; primeiras dez fases preservadas.
- Limites de tempo/movimentos, pedidos e metas ajustados e soluções sem ajudas verificadas.
- Representação do produto durante arraste, transição curta de troca, pulso de trios e estrelas animadas, respeitando movimento reduzido.
- Configuração 2 com leitura/replay da configuração 1 e filtro de versão no ranking; nenhum recorde, saldo ou progresso reinicializado.
- Ícones oficiais 64/128/256/512 com a imagem original intacta e prévias reais em mobile/desktop.
- Testes adicionais de densidade, alvos de toque, orientação, arraste sem rolagem, acessibilidade e dados antigos.


## 1.0.0 — 2026-10-03

- Estrutura React/TypeScript/Vite independente, interfaces de host e persistência substituível.
- Motor puro com seleção, troca, arraste, trios, cascatas, combos, pontuação e estrelas.
- 60 fases determinísticas em seis conjuntos; estoque escondido, buffers bloqueados, limites, pedidos e metas.
- Início, mapa, partida, tutorial, resultados, regras, pausa e comparação de resultados.
- Quatro ajudas opcionais com confirmação e idempotência de compra.
- Recordes monotônicos, desbloqueios, recompensas únicas, saldo simulado e recuperação local.
- Desafio diário por dia civil de São Paulo e contratos Individual/Casal/Turma.
- Histórico de eventos, reprodução determinística e validador de replay para apoiar o servidor do host.
- Personagem fornecido pelo usuário, animações leves, som opcional e preferência de movimento reduzido.
- Testes de motor, economia, progresso, replay, interface em três tamanhos e acessibilidade.
- Correção da revelação de camadas quando há buffer, pedidos limitados ao estoque real e preservação de oportunidades de pontuação ao reorganizar.
- Atualização do Vitest para corrigir avisos de segurança e ajustes de contraste/foco encontrados pela auditoria automatizada.
- Documentação técnica e catálogo completo gerado das configurações reais.

- Painel superior de partida com nível destacado e combo, incluindo barra da janela de cinco segundos no mobile e desktop.

## Preparação de transferência — 2026-10-03

- Motor, UI, fases, recursos e identidade aprovados preservados.
- Documentação de entrega e CLAUDE_HANDOFF.md acrescentados; contratos e pendências do host descritos.
- Comando separado de tipos, navegador de testes selecionável e dependência direta do gerador de fases declarada.
- Scripts históricos organizados; preparação de pasta por lista explícita e manifesto SHA-256, sem dependências instaladas ou ambiente.
- Integração real ao Saudômetro ainda pendente; nenhum sistema paralelo de identidade/carteira criado.
