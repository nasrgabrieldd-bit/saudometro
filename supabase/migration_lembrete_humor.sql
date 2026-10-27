-- Lembrete de humor das 20h: guarda quem já foi lembrado hoje (casal e turma), pra o aviso
-- sair no máximo uma vez por pessoa por dia, mesmo se o job rodar duas vezes. Só o script do
-- GitHub Actions (chave secreta) mexe aqui — sem policies, ninguém do app enxerga.
create table if not exists mood_reminder_sent (
  scope text not null check (scope in ('casal', 'turma')),
  person_key text not null,
  day date not null,
  sent_at timestamptz not null default now(),
  primary key (scope, person_key, day)
);
alter table mood_reminder_sent enable row level security;
