-- Modo Amigos: dados de verdade pras abas Hoje (humor da turma) e Prêmios (cofre de moedas
-- do grupo). Mesmo modelo de confiança que o casal já usa (qualquer um do grupo lê/escreve
-- os dados do próprio grupo) — só trocando "é do casal" (my_couple_id) por "é dessa turma"
-- (friend_group_id = any(my_friend_group_ids())). Rolês e Recados ficam "em breve" por
-- enquanto, entram numa próxima leva.
-- É seguro rodar mais de uma vez.

create table if not exists friend_moods (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  day date not null,
  mood text not null,
  created_at timestamptz not null default now(),
  unique (friend_group_id, user_id, day)
);
alter table friend_moods enable row level security;
drop policy if exists "friend_moods: group access" on friend_moods;
create policy "friend_moods: group access" on friend_moods
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()) and user_id = auth.uid());

create table if not exists friend_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid references auth.users(id),
  delta int not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
alter table friend_coin_ledger enable row level security;
drop policy if exists "friend_coin_ledger: group access" on friend_coin_ledger;
create policy "friend_coin_ledger: group access" on friend_coin_ledger
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

create or replace view friend_coin_balances as
  select friend_group_id, coalesce(sum(delta), 0) as balance
  from friend_coin_ledger
  group by friend_group_id;

create table if not exists friend_redemptions (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id), -- quem resgatou
  perk_id text not null,
  title text not null,
  cost int not null,
  status text not null default 'pendente' check (status in ('pendente', 'cumprido')),
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);
alter table friend_redemptions enable row level security;
drop policy if exists "friend_redemptions: group access" on friend_redemptions;
create policy "friend_redemptions: group access" on friend_redemptions
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

-- agora também dá 25 moedas iniciais pro cofre da turma quando ela nasce (igual o casal)
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
  insert into friend_coin_ledger (friend_group_id, user_id, delta, reason) values (gid, auth.uid(), 25, 'saldo inicial da turma');
  return json_build_object('id', gid, 'code', new_code);
end;
$$;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_moods') then
    alter publication supabase_realtime add table friend_moods;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_coin_ledger') then
    alter publication supabase_realtime add table friend_coin_ledger;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_redemptions') then
    alter publication supabase_realtime add table friend_redemptions;
  end if;
end;
$$;
