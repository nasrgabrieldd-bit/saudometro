-- Modo Amigos: marcar pessoas específicas num rolê (ex: "só as meninas do grupo"). Lista
-- vazia/nula = todo mundo da turma, do jeito que já era. O rolê continua visível pra turma
-- toda no calendário — a marcação é só um destaque de "você foi convidado(a) especialmente",
-- não esconde o rolê de quem não foi marcado.
-- É seguro rodar mais de uma vez.

alter table friend_events add column if not exists invited_user_ids uuid[];
