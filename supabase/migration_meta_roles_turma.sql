-- Turma: meta de "X rolês por mês" com barra de progresso, igual o casal já tinha no
-- Calendário. Sem "carry-in" (mês que sobrou não soma no seguinte) pra manter simples.
-- Seguro rodar mais de uma vez.

create table if not exists friend_month_plans (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  month text not null, -- formato 'YYYY-MM'
  target int not null default 2,
  created_at timestamptz not null default now(),
  unique (friend_group_id, month)
);
alter table friend_month_plans enable row level security;
drop policy if exists "friend_month_plans: group access" on friend_month_plans;
create policy "friend_month_plans: group access" on friend_month_plans
  for all using (friend_group_id = any(my_friend_group_ids())) with check (friend_group_id = any(my_friend_group_ids()));
