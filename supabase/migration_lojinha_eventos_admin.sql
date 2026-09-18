-- Rode este arquivo inteiro no SQL Editor do Supabase (é seguro rodar mais de uma vez).
-- Itens da lojinha criados pelo casal + eventos no calendário + modo dono.

-- ---------- itens da lojinha criados pelo casal ----------
create table if not exists custom_perks (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  emoji text not null default '🎁',
  title text not null,
  description text not null default '',
  cost int not null check (cost between 1 and 200),
  fulfill_reward int not null default 1 check (fulfill_reward between 0 and 100),
  created_by text not null check (created_by in ('gabriel', 'tata')),
  created_at timestamptz not null default now()
);

alter table custom_perks enable row level security;

drop policy if exists "custom_perks: couple access" on custom_perks;
create policy "custom_perks: couple access" on custom_perks
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ---------- eventos no calendário (casal, trabalho, outros) ----------
alter table encounters drop constraint if exists encounters_kind_check;
alter table encounters add constraint encounters_kind_check
  check (kind in ('planejado', 'saudade', 'convite', 'evento'));
alter table encounters add column if not exists category text;
alter table encounters drop constraint if exists encounters_category_check;
alter table encounters add constraint encounters_category_check
  check (category is null or category in ('casal', 'trabalho', 'outro'));

-- ---------- modo dono ----------
-- a senha fica numa tabela SEM nenhuma policy: ninguém consegue ler pela API.
create table if not exists app_admin_secret (key text primary key);
alter table app_admin_secret enable row level security;

create or replace function admin_stats(p_key text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  result json;
begin
  select exists(select 1 from app_admin_secret where key = p_key) into ok;
  if not ok then
    perform pg_sleep(1.5); -- atrapalha tentativa de adivinhar a senha
    raise exception 'acesso negado';
  end if;

  select json_build_object(
    'couples', (select count(*) from couples),
    'users', (select count(*) from profiles),
    'couples_complete', (select count(*) from (select couple_id from profiles group by couple_id having count(*) = 2) x),
    'new_7d', (select count(*) from couples where created_at > now() - interval '7 days'),
    'active_today', (select count(distinct couple_id) from app_opens where day = hoje),
    'active_7d', (select count(distinct couple_id) from app_opens where day >= hoje - 6),
    'list', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select
          c.created_at,
          (select count(*) from profiles p where p.couple_id = c.id) as members,
          (select max(day) from app_opens o where o.couple_id = c.id) as last_open
        from couples c
        order by c.created_at desc
        limit 200
      ) t
    )
  ) into result;
  return result;
end;
$$;

revoke all on function admin_stats(text) from public;
grant execute on function admin_stats(text) to anon, authenticated;

-- DEPOIS de rodar tudo acima, rode esta linha UMA vez trocando pela senha que você quiser:
-- insert into app_admin_secret (key) values ('SUA-SENHA-AQUI');
