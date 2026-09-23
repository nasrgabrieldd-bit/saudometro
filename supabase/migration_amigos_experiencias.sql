-- Modo Amigos: "Recados" vira "Experiências" — em vez de um mural de mensagem solta (que
-- compete com o grupo de WhatsApp), uma prateleira de achados (filme/série/jogo/playlist/
-- recado) com reação leve, no espírito do Letterboxd/Goodreads: comunicação por gosto
-- compartilhado, não por texto obrigatório.
-- É seguro rodar mais de uma vez.

create table if not exists friend_finds (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  kind text not null check (kind in ('filme', 'serie', 'jogo', 'playlist', 'recado')),
  title text not null,
  link text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
alter table friend_finds enable row level security;
drop policy if exists "friend_finds: group access" on friend_finds;
create policy "friend_finds: group access" on friend_finds
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

-- uma reação por pessoa por achado (trocar a reação substitui a anterior, como já
-- funciona a reação em humor/recadinho do casal)
create table if not exists friend_find_reactions (
  id uuid primary key default gen_random_uuid(),
  find_id uuid not null references friend_finds(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  reaction text not null check (reaction in ('quero', 'ja_vi', 'recomendo')),
  created_at timestamptz not null default now(),
  unique (find_id, user_id)
);
alter table friend_find_reactions enable row level security;

drop policy if exists "friend_find_reactions: group sees" on friend_find_reactions;
create policy "friend_find_reactions: group sees" on friend_find_reactions
  for select using (exists (select 1 from friend_finds f where f.id = find_id and f.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_find_reactions: write own" on friend_find_reactions;
create policy "friend_find_reactions: write own" on friend_find_reactions
  for insert with check (user_id = auth.uid() and exists (select 1 from friend_finds f where f.id = find_id and f.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_find_reactions: update own" on friend_find_reactions;
create policy "friend_find_reactions: update own" on friend_find_reactions
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "friend_find_reactions: delete own" on friend_find_reactions;
create policy "friend_find_reactions: delete own" on friend_find_reactions
  for delete using (user_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_finds') then
    alter publication supabase_realtime add table friend_finds;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_find_reactions') then
    alter publication supabase_realtime add table friend_find_reactions;
  end if;
end;
$$;
