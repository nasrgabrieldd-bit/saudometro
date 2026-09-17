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
  mood text not null, -- "como você está" (humor geral)
  mood_partner text, -- "como você está com seu parceiro" hoje
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
-- INSCRIÇÕES DE NOTIFICAÇÃO PUSH (uma por dispositivo)
-- ------------------------------------------------------------
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table push_subscriptions enable row level security;

create policy "push_subscriptions: couple access" on push_subscriptions
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- LOJINHA (trocar moedas por recompensas)
-- ------------------------------------------------------------
create table if not exists shop_redemptions (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')), -- quem resgatou
  perk_id text not null,
  title text not null,
  cost int not null,
  status text not null default 'pendente' check (status in ('pendente', 'cumprido')),
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);

alter table shop_redemptions enable row level security;

create policy "shop_redemptions: couple access" on shop_redemptions
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- MARCOS DO CASAL (cronômetro do último beijo, etc.)
-- ------------------------------------------------------------
create table if not exists couple_stats (
  couple_id uuid primary key references couples(id) on delete cascade,
  last_kiss_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table couple_stats enable row level security;

create policy "couple_stats: couple access" on couple_stats
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- RECADINHOS FOFOS
-- ------------------------------------------------------------
create table if not exists sweet_notes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  message text not null,
  created_at timestamptz not null default now()
);

alter table sweet_notes enable row level security;

create policy "sweet_notes: couple access" on sweet_notes
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- CÁPSULA DO TEMPO
-- ------------------------------------------------------------
create table if not exists time_capsules (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  from_role text not null check (from_role in ('gabriel', 'tata')),
  message text not null,
  open_on date not null,
  created_at timestamptz not null default now()
);

alter table time_capsules enable row level security;

create policy "time_capsules: couple access" on time_capsules
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- DESAFIO DO DIA (banco de perguntas fica no código, só a resposta é salva)
-- ------------------------------------------------------------
create table if not exists daily_challenge_answers (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  day date not null,
  role text not null check (role in ('gabriel', 'tata')),
  answer text not null,
  created_at timestamptz not null default now(),
  unique (couple_id, day, role)
);

alter table daily_challenge_answers enable row level security;

create policy "daily_challenge_answers: couple access" on daily_challenge_answers
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- DESEJOS SECRETOS
-- ------------------------------------------------------------
create table if not exists secret_wishes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')), -- dono do desejo
  slot int not null check (slot in (1, 2, 3)),
  text text not null default '',
  updated_at timestamptz not null default now(),
  unique (couple_id, role, slot)
);

alter table secret_wishes enable row level security;

create policy "secret_wishes: couple access" on secret_wishes
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- cada resgate guarda o texto do desejo sorteado (mesmo que a lista mude depois),
-- e só pode ser revelado na tela a partir de reveal_on — o resgate é às cegas
create table if not exists wish_redemptions (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  redeemed_by text not null check (redeemed_by in ('gabriel', 'tata')),
  wish_owner text not null check (wish_owner in ('gabriel', 'tata')),
  wish_text text not null,
  reveal_on date not null,
  fulfilled boolean not null default false,
  created_at timestamptz not null default now()
);

alter table wish_redemptions enable row level security;

create policy "wish_redemptions: couple access" on wish_redemptions
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- SEQUÊNCIA DE USO DO APP (o "🔥 N dias" estilo Duolingo)
-- ------------------------------------------------------------
create table if not exists app_opens (
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  day date not null,
  created_at timestamptz not null default now(),
  primary key (couple_id, role, day)
);

alter table app_opens enable row level security;

create policy "app_opens: couple access" on app_opens
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- dias "congelados" com moeda pra não perder a sequência de uso
create table if not exists streak_freezes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  day date not null,
  created_at timestamptz not null default now(),
  unique (couple_id, role, day)
);

alter table streak_freezes enable row level security;

create policy "streak_freezes: couple access" on streak_freezes
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ------------------------------------------------------------
-- Habilitar Realtime nas tabelas que o app escuta ao vivo
-- ------------------------------------------------------------
alter publication supabase_realtime add table encounters;
alter publication supabase_realtime add table moods;
alter publication supabase_realtime add table weekend_recharge;
alter publication supabase_realtime add table couple_stats;
alter publication supabase_realtime add table coin_ledger;
alter publication supabase_realtime add table profiles;
alter publication supabase_realtime add table weekly_answers;
alter publication supabase_realtime add table sweet_notes;
alter publication supabase_realtime add table app_opens;
alter publication supabase_realtime add table streak_freezes;
alter publication supabase_realtime add table shop_redemptions;
alter publication supabase_realtime add table time_capsules;
alter publication supabase_realtime add table daily_challenge_answers;
alter publication supabase_realtime add table secret_wishes;
alter publication supabase_realtime add table wish_redemptions;
