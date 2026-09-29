-- Turma: datas especiais recorrentes anuais (categoria "comemorativa" + repetição todo ano),
-- igual o casal já tinha no Calendário. Seguro rodar mais de uma vez.

alter table friend_events add column if not exists yearly boolean not null default false;

-- a categoria já tinha um check só com ('amigos','trabalho','outro') — precisa abrir pra 'comemorativa'
alter table friend_events drop constraint if exists friend_events_category_check;
alter table friend_events add constraint friend_events_category_check
  check (category in ('amigos', 'trabalho', 'outro', 'comemorativa'));
