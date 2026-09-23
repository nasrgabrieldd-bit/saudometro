-- Modo Amigos: contas separadas do casal, que uma pessoa pode ter várias ao mesmo tempo
-- (diferente do casal, que é só 1 por pessoa). Moedas e dados de cada turma não se
-- misturam entre turmas nem com o casal. Exige login de verdade (Google), não anônimo —
-- por isso as funções abaixo recusam sessão anônima.
-- É seguro rodar mais de uma vez.

create table if not exists friend_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  max_members int not null default 8 check (max_members between 2 and 20)
);

create table if not exists friend_members (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null check (char_length(display_name) between 1 and 24),
  joined_at timestamptz not null default now(),
  unique (friend_group_id, user_id)
);

alter table friend_groups enable row level security;
alter table friend_members enable row level security;

-- todas as turmas que a pessoa faz parte (ela pode estar em várias)
create or replace function my_friend_group_ids()
returns uuid[]
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(array_agg(friend_group_id), '{}') from friend_members where user_id = auth.uid()
$$;

drop policy if exists "friend_groups: members see" on friend_groups;
create policy "friend_groups: members see" on friend_groups
  for select using (id = any(my_friend_group_ids()));

drop policy if exists "friend_members: group access" on friend_members;
create policy "friend_members: group access" on friend_members
  for select using (friend_group_id = any(my_friend_group_ids()));

drop policy if exists "friend_members: update own name" on friend_members;
create policy "friend_members: update own name" on friend_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- criar uma turma nova. Recusa sessão anônima: precisa ter feito login com o Google antes.
create or replace function create_friend_group(p_name text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  new_code text;
  gid uuid;
begin
  if is_anon then
    raise exception 'precisa_login_google';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) < 1 then
    raise exception 'nome_invalido';
  end if;
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into friend_groups (code, name, created_by) values (new_code, coalesce(nullif(trim(p_name), ''), 'Minha turma'), auth.uid()) returning id into gid;
  insert into friend_members (friend_group_id, user_id, display_name) values (gid, auth.uid(), trim(p_display_name));
  return json_build_object('id', gid, 'code', new_code);
end;
$$;

-- entrar numa turma existente com o código. Também recusa sessão anônima.
create or replace function join_friend_group(p_code text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  g record;
  cnt int;
begin
  if is_anon then
    raise exception 'precisa_login_google';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) < 1 then
    raise exception 'nome_invalido';
  end if;
  select * into g from friend_groups where code = upper(trim(p_code));
  if not found then
    perform pg_sleep(1); -- atrapalha tentativa de adivinhar código
    raise exception 'codigo_invalido';
  end if;
  select count(*) into cnt from friend_members where friend_group_id = g.id;
  if cnt >= g.max_members and not exists (select 1 from friend_members where friend_group_id = g.id and user_id = auth.uid()) then
    raise exception 'grupo_cheio';
  end if;
  insert into friend_members (friend_group_id, user_id, display_name)
  values (g.id, auth.uid(), trim(p_display_name))
  on conflict (friend_group_id, user_id) do update set display_name = excluded.display_name;
  return json_build_object('id', g.id, 'name', g.name, 'code', g.code);
end;
$$;

revoke all on function create_friend_group(text, text) from public;
grant execute on function create_friend_group(text, text) to authenticated;
revoke all on function join_friend_group(text, text) from public;
grant execute on function join_friend_group(text, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_groups') then
    alter publication supabase_realtime add table friend_groups;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_members') then
    alter publication supabase_realtime add table friend_members;
  end if;
end;
$$;
