-- ============================================================
-- Vem Ver Tata — schema do Supabase
-- Rode este arquivo inteiro no SQL Editor do seu projeto Supabase
-- (Project > SQL Editor > New query > colar > Run).
-- ============================================================

-- extensão pra gerar uuid
create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- CASAIS
-- ------------------------------------------------------------
create table if not exists couples (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  created_at timestamptz not null default now()
);

alter table couples enable row level security;

-- qualquer pessoa autenticada (inclusive anônima) pode procurar um casal pelo código,
-- e pode criar um casal novo. O código funciona como "senha" de entrada.
create policy "couples: anyone can read" on couples
  for select using (true);

create policy "couples: anyone can create" on couples
  for insert with check (true);

-- ------------------------------------------------------------
-- PERFIS (um por dispositivo/pessoa, ligado a auth.uid())
-- ------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  display_name text not null,
  created_at timestamptz not null default now(),
  unique (couple_id, role)
);

alter table profiles enable row level security;

-- função auxiliar (roda sem RLS) pra descobrir o couple_id de quem tá logado,
-- sem isso as políticas abaixo cairiam em recursão infinita ao consultar a própria tabela profiles
create or replace function my_couple_id()
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select couple_id from profiles where id = auth.uid()
$$;

-- leitura aberta: nome e papel não são dados sensíveis (mesmo padrão da tabela couples),
-- e o Postgres precisa que UPDATE consiga "enxergar" a linha pra "retomar" um papel abaixo
create policy "profiles: anyone can read" on profiles
  for select using (true);

create policy "profiles: insert own" on profiles
  for insert with check (id = auth.uid());

-- permite "retomar" um papel já existente (ex: dado local apagado ao reinstalar o app) —
-- quem já é dono do perfil pode atualizá-lo, e quem ainda não tem perfil pode assumir um
-- papel existente, desde que o resultado final continue sendo dele mesmo (id = auth.uid()).
create policy "profiles: update own or reclaim" on profiles
  for update using (true) with check (id = auth.uid());

-- ------------------------------------------------------------
-- PLANOS DO MÊS (meta de encontros por mês + saldo que veio do mês anterior)
-- ------------------------------------------------------------
create table if not exists month_plans (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  month text not null, -- formato 'YYYY-MM'
  base_target int not null default 2,
  carry_in int not null default 0,
  created_at timestamptz not null default now(),
  unique (couple_id, month)
);

alter table month_plans enable row level security;

create policy "month_plans: couple access" on month_plans
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- ENCONTROS (planejados do mês, saudade avulsa, convites de evento)
-- ------------------------------------------------------------
create table if not exists encounters (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  month text not null, -- 'YYYY-MM' a que pertence (pro cálculo de pontos)
  start_date date not null,
  end_date date, -- opcional, pra encontros de mais de um dia
  title text not null default '',
  kind text not null check (kind in ('planejado', 'saudade', 'convite')),
  status text not null default 'agendado'
    check (status in ('agendado', 'confirmado', 'aconteceu', 'nao_aconteceu', 'pendente', 'recusado')),
  counts_as_point boolean not null default false,
  created_by text not null check (created_by in ('gabriel', 'tata')),
  created_at timestamptz not null default now()
);

alter table encounters enable row level security;

create policy "encounters: couple access" on encounters
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- HUMOR DO DIA
-- ------------------------------------------------------------
create table if not exists moods (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  day date not null,
  role text not null check (role in ('gabriel', 'tata')),
  mood text not null,
  wants_to_talk text not null default 'talvez' check (wants_to_talk in ('sim', 'nao', 'talvez')),
  note text not null default '',
  updated_at timestamptz not null default now(),
  unique (couple_id, day, role)
);

alter table moods enable row level security;

create policy "moods: couple access" on moods
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- FIM DE SEMANA DE RECARREGAR A BATERIA
-- ------------------------------------------------------------
create table if not exists weekend_recharge (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  week_start date not null, -- sexta-feira daquele fim de semana
  role text not null check (role in ('gabriel', 'tata')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (couple_id, week_start, role)
);

alter table weekend_recharge enable row level security;

create policy "weekend_recharge: couple access" on weekend_recharge
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- MOEDAS (ledger: cada linha é um ganho ou gasto, saldo = soma)
-- ------------------------------------------------------------
create table if not exists coin_ledger (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  delta int not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);

alter table coin_ledger enable row level security;

create policy "coin_ledger: couple access" on coin_ledger
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

create or replace view coin_balances as
  select couple_id, role, coalesce(sum(delta), 0) as balance
  from coin_ledger
  group by couple_id, role;

-- ------------------------------------------------------------
-- PERGUNTA DA SEMANA (uma por semana, sorteada da lista fixa do app)
-- ------------------------------------------------------------
create table if not exists weekly_answers (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  week_index int not null, -- semanas desde a criação do casal
  role text not null check (role in ('gabriel', 'tata')),
  answer text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (couple_id, week_index, role)
);

alter table weekly_answers enable row level security;

create policy "weekly_answers: couple access" on weekly_answers
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- Habilitar Realtime nas tabelas que o app escuta ao vivo
-- ------------------------------------------------------------
alter publication supabase_realtime add table encounters;
alter publication supabase_realtime add table moods;
alter publication supabase_realtime add table weekend_recharge;
alter publication supabase_realtime add table coin_ledger;
alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table weekly_answers;
