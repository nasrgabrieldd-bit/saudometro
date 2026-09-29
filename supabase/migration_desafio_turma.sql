-- Turma: Desafio do dia, com texto próprio (perguntas de grupo, não de casal) —
-- ver FRIEND_CHALLENGES em js/challenges.js. Seguro rodar mais de uma vez.

create table if not exists friend_challenge_answers (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  day date not null,
  user_id uuid not null references auth.users(id),
  answer text not null check (char_length(answer) between 1 and 500),
  created_at timestamptz not null default now(),
  unique (friend_group_id, day, user_id)
);
alter table friend_challenge_answers enable row level security;
drop policy if exists "friend_challenge_answers: group access" on friend_challenge_answers;
create policy "friend_challenge_answers: group access" on friend_challenge_answers
  for all using (friend_group_id = any(my_friend_group_ids())) with check (friend_group_id = any(my_friend_group_ids()));

alter publication supabase_realtime add table friend_challenge_answers;
