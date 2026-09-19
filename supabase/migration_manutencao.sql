-- Manutenção do banco (plano gratuito): função de "acordar" chamada todo dia por uma tarefa do GitHub,
-- pra o Supabase não pausar o projeto por inatividade.
-- É seguro rodar mais de uma vez.

create table if not exists keepalive (
  id int primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now()
);
alter table keepalive enable row level security; -- sem policies: só a função abaixo mexe

create or replace function keepalive()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  t timestamptz := now();
begin
  insert into keepalive (id, pinged_at) values (1, t)
  on conflict (id) do update set pinged_at = t;
  return t;
end;
$$;

revoke all on function keepalive() from public;
grant execute on function keepalive() to anon, authenticated;
