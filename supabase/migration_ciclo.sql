-- Rode este arquivo inteiro no SQL Editor do Supabase (é seguro rodar mais de uma vez).
-- Ciclo menstrual opcional: só a própria pessoa lê, e o parceiro só lê se ela compartilhar.

create or replace function my_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role from profiles where id = auth.uid()
$$;

create table if not exists cycle_settings (
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  visibility text not null default 'me' check (visibility in ('me', 'basic', 'full')),
  last_period_start date not null,
  cycle_length int not null default 28 check (cycle_length between 21 and 40),
  period_length int not null default 5 check (period_length between 2 and 10),
  period_starts date[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (couple_id, role)
);

alter table cycle_settings enable row level security;

drop policy if exists "cycle_settings: read own or shared" on cycle_settings;
create policy "cycle_settings: read own or shared" on cycle_settings
  for select using (
    couple_id = my_couple_id() and (role = my_role() or visibility in ('basic', 'full'))
  );

drop policy if exists "cycle_settings: insert own" on cycle_settings;
create policy "cycle_settings: insert own" on cycle_settings
  for insert with check (couple_id = my_couple_id() and role = my_role());

drop policy if exists "cycle_settings: update own" on cycle_settings;
create policy "cycle_settings: update own" on cycle_settings
  for update using (couple_id = my_couple_id() and role = my_role())
  with check (couple_id = my_couple_id() and role = my_role());

drop policy if exists "cycle_settings: delete own" on cycle_settings;
create policy "cycle_settings: delete own" on cycle_settings
  for delete using (couple_id = my_couple_id() and role = my_role());
