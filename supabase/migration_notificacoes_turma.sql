-- Notificações push pra Turma. Tabela própria (não reaproveita push_subscriptions do casal,
-- que é keyed por couple_id/role): aqui é por user_id, porque um push de dispositivo vale pra
-- todas as turmas da pessoa de uma vez. Seguro rodar mais de uma vez.

create table if not exists friend_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table friend_push_subscriptions enable row level security;
drop policy if exists "friend_push_subscriptions: own access" on friend_push_subscriptions;
create policy "friend_push_subscriptions: own access" on friend_push_subscriptions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
