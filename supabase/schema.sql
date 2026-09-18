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

-- qualquer pessoa autenticada (inclusive anônima) pode criar um casal novo.
create policy "couples: anyone can create" on couples
  for insert with check (true);

-- a policy de leitura ("couples: members can read own") fica logo depois da
-- função my_couple_id() mais abaixo, porque depende dela existir primeiro.

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

-- só quem já é membro pode listar o próprio casal (evita que qualquer pessoa
-- consiga listar todos os códigos cadastrados no banco). Procurar um casal
-- pra entrar usa a função find_couple_by_code() abaixo, que só devolve UM
-- resultado exato — nunca uma lista.
create policy "couples: members can read own" on couples
  for select using (id = my_couple_id());

-- busca um casal pelo código exato, sem expor os outros. security definer
-- pra rodar sem RLS (senão cairia na mesma restrição da policy acima).
create or replace function find_couple_by_code(p_code text)
returns table (id uuid, code text)
language sql
security definer
set search_path = public
stable
as $$
  select id, code from couples where code = p_code
$$;

grant execute on function find_couple_by_code(text) to anon, authenticated;

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
  kind text not null check (kind in ('planejado', 'saudade', 'convite', 'evento')),
  category text check (category is null or category in ('casal', 'trabalho', 'outro')), -- só pra kind = 'evento'
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
  fulfilled_at timestamptz,
  reward_paid int -- quanto foi pago de recompensa a quem cumpriu (guarda o valor exato, incluindo dia da sorte, pra dar pra desfazer certinho)
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

-- ------------------------------------------------------------
-- MIGRACAO (lojinha personalizada, eventos, modo dono) - igual a migration_lojinha_eventos_admin.sql
-- ------------------------------------------------------------
-- Rode este arquivo inteiro no SQL Editor do Supabase (é seguro rodar mais de uma vez).
-- Itens da lojinha criados pelo casal + eventos no calendário + modo dono.

-- ---------- itens da lojinha criados pelo casal ----------
create table if not exists custom_perks (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  emoji text not null default '🎁',
  title text not null,
  description text not null default '',
  cost int not null check (cost between 1 and 200),
  fulfill_reward int not null default 1 check (fulfill_reward between 0 and 100),
  created_by text not null check (created_by in ('gabriel', 'tata')),
  created_at timestamptz not null default now()
);

alter table custom_perks enable row level security;

drop policy if exists "custom_perks: couple access" on custom_perks;
create policy "custom_perks: couple access" on custom_perks
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- ---------- eventos no calendário (casal, trabalho, outros) ----------
alter table encounters drop constraint if exists encounters_kind_check;
alter table encounters add constraint encounters_kind_check
  check (kind in ('planejado', 'saudade', 'convite', 'evento'));
alter table encounters add column if not exists category text;
alter table encounters drop constraint if exists encounters_category_check;
alter table encounters add constraint encounters_category_check
  check (category is null or category in ('casal', 'trabalho', 'outro'));

-- ---------- modo dono ----------
-- a senha fica numa tabela SEM nenhuma policy: ninguém consegue ler pela API.
create table if not exists app_admin_secret (key text primary key);
alter table app_admin_secret enable row level security;

create or replace function admin_stats(p_key text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
  hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  result json;
begin
  select exists(select 1 from app_admin_secret where key = p_key) into ok;
  if not ok then
    perform pg_sleep(1.5); -- atrapalha tentativa de adivinhar a senha
    raise exception 'acesso negado';
  end if;

  select json_build_object(
    'couples', (select count(*) from couples),
    'users', (select count(*) from profiles),
    'couples_complete', (select count(*) from (select couple_id from profiles group by couple_id having count(*) = 2) x),
    'new_7d', (select count(*) from couples where created_at > now() - interval '7 days'),
    'active_today', (select count(distinct couple_id) from app_opens where day = hoje),
    'active_7d', (select count(distinct couple_id) from app_opens where day >= hoje - 6),
    'list', (
      select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
        select
          c.created_at,
          (select count(*) from profiles p where p.couple_id = c.id) as members,
          (select max(day) from app_opens o where o.couple_id = c.id) as last_open
        from couples c
        order by c.created_at desc
        limit 200
      ) t
    )
  ) into result;
  return result;
end;
$$;

revoke all on function admin_stats(text) from public;
grant execute on function admin_stats(text) to anon, authenticated;

-- DEPOIS de rodar tudo acima, rode esta linha UMA vez trocando pela senha que você quiser:
-- insert into app_admin_secret (key) values ('SUA-SENHA-AQUI');
