-- Fase 1: nomes, gênero e emoji de cada pessoa do casal (configuração própria de cada casal).
-- Casal sem linha aqui continua funcionando exatamente como antes (Gabriel/Tata).
-- É seguro rodar mais de uma vez.

create table if not exists couple_settings (
  couple_id uuid primary key references couples(id) on delete cascade,
  names jsonb not null default '{}'::jsonb,
  genders jsonb not null default '{}'::jsonb,
  emojis jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table couple_settings enable row level security;

drop policy if exists "couple_settings: read own couple" on couple_settings;
create policy "couple_settings: read own couple" on couple_settings
  for select using (couple_id = my_couple_id());

drop policy if exists "couple_settings: insert own couple" on couple_settings;
create policy "couple_settings: insert own couple" on couple_settings
  for insert with check (couple_id = my_couple_id());

drop policy if exists "couple_settings: update own couple" on couple_settings;
create policy "couple_settings: update own couple" on couple_settings
  for update using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- criar casal agora já grava os nomes/gênero/emoji (a versão antiga com 1 parâmetro é substituída)
drop function if exists create_couple(text);
create or replace function create_couple(
  p_code text,
  p_names jsonb default '{}'::jsonb,
  p_genders jsonb default '{}'::jsonb,
  p_emojis jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into couples (code) values (upper(trim(p_code))) returning couples.id into new_id;
  if p_names <> '{}'::jsonb or p_genders <> '{}'::jsonb then
    insert into couple_settings (couple_id, names, genders, emojis)
    values (new_id, p_names, p_genders, p_emojis);
  end if;
  return new_id;
end;
$$;

revoke all on function create_couple(text, jsonb, jsonb, jsonb) from public;
grant execute on function create_couple(text, jsonb, jsonb, jsonb) to anon, authenticated;

-- quem vai entrar pelo código vê os nomes já salvos (só busca exata, nunca uma lista)
create or replace function find_couple_preview(p_code text)
returns table (id uuid, code text, names jsonb, genders jsonb, emojis jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.code,
         coalesce(s.names, '{}'::jsonb), coalesce(s.genders, '{}'::jsonb), coalesce(s.emojis, '{}'::jsonb)
  from couples c
  left join couple_settings s on s.couple_id = c.id
  where c.code = p_code
$$;

grant execute on function find_couple_preview(text) to anon, authenticated;

-- gênero de quem está logado (sem configuração: Tata = mulher, Gabriel = homem, como sempre foi)
create or replace function my_gender()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(s.genders ->> p.role, case when p.role = 'tata' then 'mulher' else 'homem' end)
  from profiles p
  left join couple_settings s on s.couple_id = p.couple_id
  where p.id = auth.uid()
$$;

-- ciclo: qualquer mulher do casal pode ativar (antes era só o papel "tata")
alter table cycle_settings drop constraint if exists cycle_settings_role_check;
alter table cycle_settings add constraint cycle_settings_role_check check (role in ('gabriel', 'tata'));

drop policy if exists "cycle_settings: insert own" on cycle_settings;
create policy "cycle_settings: insert own" on cycle_settings
  for insert with check (couple_id = my_couple_id() and role = my_role() and my_gender() = 'mulher');
