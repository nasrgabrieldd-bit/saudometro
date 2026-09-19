-- Monitoramento de erros (gratuito, sem serviço externo): o app manda pra cá os erros de JavaScript
-- que acontecem no celular das pessoas, e o modo dono mostra os mais recentes.
-- Só guarda: mensagem curta, arquivo/linha, versão e tipo de aparelho. Nenhum conteúdo de casal.
-- É seguro rodar mais de uma vez.

create table if not exists app_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  message text not null,
  place text,
  ua text
);
alter table app_errors enable row level security; -- sem policies: só as funções abaixo mexem

create index if not exists app_errors_created_idx on app_errors (created_at desc);

-- o app chama isso quando dá erro. Limite: 20 por pessoa por hora (evita alguém encher o banco).
create or replace function log_error(p_message text, p_place text, p_ua text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  if (select count(*) from app_errors where user_id = uid and created_at > now() - interval '1 hour') >= 20 then
    return;
  end if;
  insert into app_errors (user_id, message, place, ua)
  values (uid, left(coalesce(p_message, ''), 300), left(p_place, 200), left(p_ua, 200));
end;
$$;

revoke all on function log_error(text, text, text) from public;
grant execute on function log_error(text, text, text) to authenticated;

-- modo dono: erros dos últimos 7 dias agrupados por mensagem
create or replace function admin_errors(p_key text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  select exists(select 1 from app_admin_secret where key = p_key) into ok;
  if not ok then
    perform pg_sleep(1.5);
    raise exception 'acesso negado';
  end if;

  return (
    select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
      select
        message,
        max(place) as place,
        count(*) as times,
        count(distinct user_id) as people,
        max(created_at) as last_at
      from app_errors
      where created_at > now() - interval '7 days'
      group by message
      order by max(created_at) desc
      limit 30
    ) t
  );
end;
$$;

revoke all on function admin_errors(text) from public;
grant execute on function admin_errors(text) to anon, authenticated;

-- limpeza: erros com mais de 30 dias saem sozinhos quando alguém registra um novo
create or replace function app_errors_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from app_errors where created_at < now() - interval '30 days';
  return null;
end;
$$;

drop trigger if exists app_errors_cleanup_trg on app_errors;
create trigger app_errors_cleanup_trg
  after insert on app_errors
  for each statement execute function app_errors_cleanup();
