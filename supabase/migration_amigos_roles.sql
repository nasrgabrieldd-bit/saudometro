-- Modo Amigos: aba Rolês — agenda de encontros da turma (versão lista, não o calendário
-- mensal completo do casal). Qualquer um do grupo cria/edita/apaga um rolê (mesmo modelo de
-- confiança já usado no resto do Modo Amigos), mas cada um só mexe na própria confirmação de
-- presença.
-- É seguro rodar mais de uma vez.

create table if not exists friend_events (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  title text not null,
  start_date date not null,
  start_time time,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table friend_events enable row level security;
drop policy if exists "friend_events: group access" on friend_events;
create policy "friend_events: group access" on friend_events
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

create table if not exists friend_event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references friend_events(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  status text not null check (status in ('sim', 'talvez', 'nao')),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);
alter table friend_event_rsvps enable row level security;

drop policy if exists "friend_event_rsvps: group sees" on friend_event_rsvps;
create policy "friend_event_rsvps: group sees" on friend_event_rsvps
  for select using (exists (select 1 from friend_events e where e.id = event_id and e.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_event_rsvps: write own" on friend_event_rsvps;
create policy "friend_event_rsvps: write own" on friend_event_rsvps
  for insert with check (user_id = auth.uid() and exists (select 1 from friend_events e where e.id = event_id and e.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_event_rsvps: update own" on friend_event_rsvps;
create policy "friend_event_rsvps: update own" on friend_event_rsvps
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "friend_event_rsvps: delete own" on friend_event_rsvps;
create policy "friend_event_rsvps: delete own" on friend_event_rsvps
  for delete using (user_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_events') then
    alter publication supabase_realtime add table friend_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_event_rsvps') then
    alter publication supabase_realtime add table friend_event_rsvps;
  end if;
end;
$$;
