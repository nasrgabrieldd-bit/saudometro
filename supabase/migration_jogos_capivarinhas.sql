-- Progresso do jogo "Capivarinhas" (estilo Star Battle/Queens), um por casal e um por turma,
-- guardando só em que fase cada um está. As moedas ganhas ao completar uma fase usam os
-- sistemas de moeda que já existem (coin_ledger do casal, friend_coin_ledger da turma) — não
-- cria moeda nova nem mistura casal com turma. É seguro rodar mais de uma vez.

create table if not exists couple_game_progress (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  game_id text not null,
  current_level int not null default 1,
  updated_at timestamptz not null default now(),
  unique (couple_id, game_id)
);
alter table couple_game_progress enable row level security;
drop policy if exists "couple_game_progress: casal" on couple_game_progress;
create policy "couple_game_progress: casal" on couple_game_progress
  for all using (couple_id = my_couple_id())
  with check (couple_id = my_couple_id());

create table if not exists friend_game_progress (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  game_id text not null,
  current_level int not null default 1,
  updated_at timestamptz not null default now(),
  unique (friend_group_id, game_id)
);
alter table friend_game_progress enable row level security;
drop policy if exists "friend_game_progress: turma" on friend_game_progress;
create policy "friend_game_progress: turma" on friend_game_progress
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));
