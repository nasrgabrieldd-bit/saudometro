-- Termômetro de saudade: um nível de 0 a 10 por pessoa por dia (casal e turma).
-- Rode este arquivo inteiro no SQL Editor do Supabase (é seguro rodar mais de uma vez).

create table if not exists saudade_checks (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  day date not null,
  level int not null check (level between 0 and 10),
  updated_at timestamptz not null default now(),
  unique (couple_id, role, day)
);
alter table saudade_checks enable row level security;
drop policy if exists "saudade_checks: couple access" on saudade_checks;
create policy "saudade_checks: couple access" on saudade_checks
  for all using (couple_id = my_couple_id())
  with check (couple_id = my_couple_id() and role = my_role());
create index if not exists saudade_checks_idx on saudade_checks (couple_id, day desc);

create table if not exists friend_saudade_checks (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  level int not null check (level between 0 and 10),
  updated_at timestamptz not null default now(),
  unique (friend_group_id, user_id, day)
);
alter table friend_saudade_checks enable row level security;
drop policy if exists "friend_saudade_checks: group read" on friend_saudade_checks;
create policy "friend_saudade_checks: group read" on friend_saudade_checks
  for select using (friend_group_id = any(my_friend_group_ids()));
drop policy if exists "friend_saudade_checks: write own" on friend_saudade_checks;
create policy "friend_saudade_checks: write own" on friend_saudade_checks
  for all using (friend_group_id = any(my_friend_group_ids()) and user_id = auth.uid())
  with check (friend_group_id = any(my_friend_group_ids()) and user_id = auth.uid());
create index if not exists friend_saudade_checks_idx on friend_saudade_checks (friend_group_id, day desc);
