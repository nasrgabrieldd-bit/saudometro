# Regras do CapMart

## Movimentação e combinações

O jogador pode trocar dois produtos acessíveis diferentes ou levar um produto a uma posição acessível vazia. Origem vazia, posição inexistente, mesma posição, dois produtos iguais e posições bloqueadas são rejeitados sem alterar estado, pontuação, histórico ou movimentos.

Clique/toque na origem e no destino ou arraste. Cada troca válida custa um movimento. Três iguais na mesma prateleira são removidos automaticamente, inclusive quando ocupam o buffer. Uma prateleira de quatro espaços pode ter um trio e um item restante. A resolução verifica todas as prateleiras e repete até eliminar combinações em cascata.

O motor é imutável para o chamador: copia o tabuleiro, os estoques e os totais antes de resolver uma jogada. As configurações de fases não são alteradas durante partidas.

## Obstáculos

- **Estoque escondido:** cada espaço principal tem uma fila atrás. Toda a frente da prateleira, incluindo o buffer, cobre a próxima camada. Quando a frente fica vazia, uma camada inteira aparece. Os lotes escondidos das fases atuais contêm trios homogêneos e podem causar cascatas. Não é possível selecionar itens escondidos.
- **Espaço bloqueado:** um buffer vazio abre quando o contador global de trios alcança `unlockAt`. Não se pode usá-lo antes. Nenhum item necessário fica preso num cadeado.
- **Movimentos limitados:** a troca que conclui o objetivo ainda vence quando usa o último movimento. Ajudas não consomem movimentos.
- **Tempo:** o motor recebe segundos decorrido do controlador e limita o cronômetro a zero. A interface usa `performance.now()`, evitando depender da frequência nominal dos intervalos. Abas em segundo plano descontam o tempo decorrido quando o controlador volta a executar. Pausa explícita, navegação fora da partida, introduções e confirmação de compras suspendem o tempo ativo. O combo usa esse mesmo tempo ativo.

## Objetivos

Clássico: eliminar todos os produtos acessíveis e escondidos. Contra o tempo: cumprir o objetivo antes do limite. Trocas limitadas: cumprir o objetivo dentro do orçamento. Pedido: eliminar a quantidade indicada de um produto (inclusive cascatas). Pontuação: alcançar a meta com pontos de combinações; o bônus de conclusão só é aplicado depois da vitória e não serve para cumprir a meta. Obstáculos e limites podem ser combinados.

A derrota ocorre por tempo, movimentos ou ausência real de qualquer movimento válido sem objetivo concluído. Nenhuma derrota cobra moedas. A próxima fase abre após vencer a anterior, mesmo com uma estrela. A fase 60 encerra a campanha e pode ser repetida.

## Pontuação

Valores centralizados em `src/engine/config.ts`:

| Ação | Pontos |
|---|---:|
| Primeiro trio do combo | 100 |
| Segundo trio | 150 |
| Terceiro trio | 200 |
| Quarto e seguintes | 250 |
| Conclusão | 300 |
| Segundo inteiro restante | 5 |
| Movimento restante | 20 |

Um trio ocorrido em até 5 segundos ativos desde o anterior mantém a sequência. Depois disso o combo zera. Cascatas podem conceder os próximos degraus do combo na mesma jogada. Trocas sem trio e movimentos inválidos não pontuam. A reorganização pode remover trios automaticamente sem pontos e reinicia o combo. Em fases de pontuação, o embaralhamento evita trios automáticos para preservar todas as oportunidades de cumprir a meta.

O resultado soma a pontuação de combinações, conclusão, segundos inteiros restantes e movimentos restantes. Ajuda de tempo aumenta o tempo restante e seus potenciais bônus, mas a partida é identificada como assistida. Rankings definitivos devem separar resultados assistidos de resultados sem ajudas.

## Estrelas e recordes

Uma estrela por vitória. Duas ao atingir a primeira meta individual da fase; três ao atingir a segunda. Os limites são inclusivos. Derrota sempre dá zero estrelas. O maior número de estrelas e a maior pontuação são preservados independentemente: repetir pior não reduz nenhum dos dois. As 60 metas aparecem em `LEVELS.md`.

## Ajudas

| Ajuda | Custo simulado | Efeito |
|---|---:|---|
| Desfazer | 5 | Restaura a última jogada válida, incluindo eliminações, estoques, cadeados, pontos e movimentos. Não restaura o tempo gasto; zera combo. |
| Dica | 10 | Destaca origem e destino de uma troca que avança na solução. |
| Tempo extra | 15 | Adiciona 30 segundos; indisponível em fases sem cronômetro. |
| Reorganizar | 20 | Embaralha os produtos acessíveis preservando seus totais e estoques escondidos; elimina combinações sem pontos e limpa histórico de desfazer. |

Só recursos aplicáveis estão habilitados. A compra exige confirmação, e o saldo insuficiente não altera o tabuleiro nem pode deixá-lo negativo. A ajuda de exemplo do tutorial é gratuita e também identifica o resultado como assistido. A interface mantém o mesmo ID ao repetir uma compra cuja resposta falhou, evitando duplicação no serviço idempotente. Enquanto houver resposta incerta, mantém a confirmação aberta para consultar o mesmo recibo.

Todas as fases possuem uma solução sem ajudas, demonstrada pela suíte automatizada. Um jogador ainda pode consumir seus movimentos com trocas pouco úteis; isso é uma derrota legítima, não a exigência de compra.

## Moedas e recompensas

Primeira conclusão de cada fase: 5. Primeira conquista de três estrelas em cada fase: 3 (pode ocorrer numa repetição). Primeira vitória de cada dia: 5. Primeira conclusão do desafio diário daquele dia: 10. O dia civil do simulador é São Paulo. Desafio diário não concede recompensas da fase de campanha usada como base e não desbloqueia a campanha. Uma partida diária iniciada antes da meia-noite pode terminar no dia seguinte: conserva a semente e a recompensa da data de início. A primeira vitória do dia usa a data de conclusão.

Recibos de resultado são idempotentes por `runId`; chaves de recompensa são únicas por identidade/fase, identidade/estrelas e identidade/dia. Ler novamente o mesmo recibo retorna o valor originalmente concedido sem adicionar moedas. A repetição da fase com outro `runId` recebe apenas recompensas ainda não concedidas.

Essas regras são executadas localmente para desenvolvimento. LocalStorage é editável pelo dono do dispositivo; não protege moedas reais contra adulteração. O servidor integrado deve validar replay, usuário, tempo, configuração, recibos de ajudas e chaves de recompensa numa transação única.

## Configuração 2 (refinamento 1.1)

As regras e preços acima continuam os mesmos. As primeiras dez fases mantêm o tabuleiro anterior. Da fase 11 em diante há seis espaços vazios e compartimentos de três posições: parte dos espaços de reserva desbloqueia após 1, 2 ou 3 trios nas fases com cadeados. Pelo menos três espaços vazios estão disponíveis desde o início. A profundidade e os objetivos variam pelos conjuntos; as filas atrás continuam aparecendo quando a frente daquela prateleira inteira fica vazia.

Uma fileira visual pode ter dois compartimentos no celular e até três no desktop; eles são prateleiras independentes. Um trio precisa estar todo dentro do mesmo compartimento. Produtos, pontuação, combos, estrelas, moedas e condições de vitória não mudam entre dispositivos. Metas atuais e quantidades estão em LEVELS.md. Recordes anteriores não são apagados, mesmo com configurações novas.

