# Adapta a experiência desktop do Saudômetro

O app ficava restrito a uma coluna de até 640 px e um menu inferior em computadores. Esta mudança reaproveita as telas e os serviços existentes: a partir de 1024 px, a navegação vira lateral, os hubs usam duas colunas e os calendários mostram os detalhes do dia ao lado.

Mantém as seções mobile, os tokens/temas originais, os ícones, o mascote e as mecânicas dos jogos. Adiciona o CSS responsivo ao cache offline. Não altera migrations, banco, autenticação, dados de usuários ou economia de moedas; não inclui landing ou evolução administrativa.

## Validação

- 59 testes existentes passaram.
- Teste de navegador passou para Casal/Turma, navegação, calendários, modal e formulário de recado, loja/prêmios, humor e tabuleiro original.
- Responsividade verificada em 390/768/1024/1366/1920 px; temas claro/escuro na Home do Casal.
- Duas telas compartilham mensagem através de persistência/eventos simulados em teste.
- Job desktop de CI configurado com Chromium, sem usar o banco publicado.

OAuth e sincronização reais entre dispositivos ainda precisam de validação em homologação. Os dados de teste existem somente nas respostas interceptadas pelo Playwright. Instruções, arquivos e limites estão em DESKTOP.md. Solicita revisão desta etapa antes de iniciar administração; não fazer merge ou publicação automaticamente.
