-- Cápsula do tempo pra Turma: coletiva — qualquer membro sela, a turma toda
-- abre junto na data escolhida. Seguro rodar mais de uma vez.

create table if not exists friend_time_capsules (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  from_user_id uuid not null references auth.users(id),
  message text not null check (char_length(message) between 1 and 1000),
  open_on date not null,
  created_at timestamptz not null default now()
);
alter table friend_time_capsules enable row level security;
drop policy if exists "friend_time_capsules: group access" on friend_time_capsules;
create policy "friend_time_capsules: group access" on friend_time_capsules
  for all using (friend_group_id = any(my_friend_group_ids())) with check (friend_group_id = any(my_friend_group_ids()));

alter publication supabase_realtime add table friend_time_capsules;
