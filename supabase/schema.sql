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
  category text check (category is null or category in ('casal', 'trabalho', 'outro', 'comemorativa')), -- só pra kind = 'evento'
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
alter table encounters add column if not exists yearly boolean not null default false; -- data especial que se repete todo ano
alter table encounters drop constraint if exists encounters_category_check;
alter table encounters add constraint encounters_category_check
  check (category is null or category in ('casal', 'trabalho', 'outro', 'comemorativa'));

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

-- ------------------------------------------------------------
-- CICLO MENSTRUAL (opcional) - igual a migration_ciclo.sql
-- ------------------------------------------------------------
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
  role text not null check (role = 'tata'), -- recurso só da Tata
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

-- garante que so a Tata tenha dados de ciclo (idempotente)
alter table cycle_settings drop constraint if exists cycle_settings_role_check;
alter table cycle_settings add constraint cycle_settings_role_check check (role = 'tata');

-- ------------------------------------------------------------
-- CRIAR CASAL via funcao (igual a migration_criar_casal.sql)
-- ------------------------------------------------------------
-- Corrige a criação de casal novo (quebrou quando a leitura da tabela couples ficou restrita aos membros).
-- É seguro rodar mais de uma vez.

create or replace function create_couple(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into couples (code) values (upper(trim(p_code))) returning couples.id into new_id;
  return new_id;
end;
$$;

revoke all on function create_couple(text) from public;
grant execute on function create_couple(text) to anon, authenticated;

-- ------------------------------------------------------------
-- FASE 1: nomes/genero/emoji por casal - igual a migration_fase1_nomes.sql
-- ------------------------------------------------------------
-- Fase 1: nomes, gênero e emoji de cada pessoa do casal (configuração própria de cada casal).
-- Casal sem linha aqui continua funcionando exatamente como antes (Gabriel/Tata).
-- É seguro rodar mais de uma vez.

create table if not exists couple_settings (
  couple_id uuid primary key references couples(id) on delete cascade,
  names jsonb not null default '{}'::jsonb,
  genders jsonb not null default '{}'::jsonb,
  emojis jsonb not null default '{}'::jsonb,
  features jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table couple_settings enable row level security;

drop policy if exists "couple_settings: read own couple" on couple_settings;
create policy "couple_settings: read own couple" on couple_settings
  for select using (couple_id = my_couple_id());

drop policy if exists "couple_settings: insert own couple" on couple_settings;
create policy "couple_settings: insert own couple" on couple_settings
  for insert with check (couple_id = my_couple_id());

drop policy if exists "couple_settings: update own couple" on couple_settings;
create policy "couple_settings: update own couple" on couple_settings
  for update using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

-- criar casal agora já grava os nomes/gênero/emoji (a versão antiga com 1 parâmetro é substituída)
drop function if exists create_couple(text);
create or replace function create_couple(
  p_code text,
  p_names jsonb default '{}'::jsonb,
  p_genders jsonb default '{}'::jsonb,
  p_emojis jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into couples (code) values (upper(trim(p_code))) returning couples.id into new_id;
  if p_names <> '{}'::jsonb or p_genders <> '{}'::jsonb then
    insert into couple_settings (couple_id, names, genders, emojis)
    values (new_id, p_names, p_genders, p_emojis);
  end if;
  return new_id;
end;
$$;

revoke all on function create_couple(text, jsonb, jsonb, jsonb) from public;
grant execute on function create_couple(text, jsonb, jsonb, jsonb) to anon, authenticated;

-- quem vai entrar pelo código vê os nomes já salvos (só busca exata, nunca uma lista)
create or replace function find_couple_preview(p_code text)
returns table (id uuid, code text, names jsonb, genders jsonb, emojis jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.code,
         coalesce(s.names, '{}'::jsonb), coalesce(s.genders, '{}'::jsonb), coalesce(s.emojis, '{}'::jsonb)
  from couples c
  left join couple_settings s on s.couple_id = c.id
  where c.code = p_code
$$;

grant execute on function find_couple_preview(text) to anon, authenticated;

-- gênero de quem está logado (sem configuração: Tata = mulher, Gabriel = homem, como sempre foi)
create or replace function my_gender()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(s.genders ->> p.role, case when p.role = 'tata' then 'mulher' else 'homem' end)
  from profiles p
  left join couple_settings s on s.couple_id = p.couple_id
  where p.id = auth.uid()
$$;

-- ciclo: qualquer mulher do casal pode ativar (antes era só o papel "tata")
alter table cycle_settings drop constraint if exists cycle_settings_role_check;
alter table cycle_settings add constraint cycle_settings_role_check check (role in ('gabriel', 'tata'));

drop policy if exists "cycle_settings: insert own" on cycle_settings;
create policy "cycle_settings: insert own" on cycle_settings
  for insert with check (couple_id = my_couple_id() and role = my_role() and my_gender() = 'mulher');

-- ------------------------------------------------------------
-- FASE 2: tempo real das configuracoes - igual a migration_fase2_personalizar.sql
-- ------------------------------------------------------------
-- Fase 2: mudanças de configuração aparecem na hora pro outro do casal (tempo real).
-- É seguro rodar mais de uma vez.
do $$
begin
  alter publication supabase_realtime add table couple_settings;
exception when duplicate_object then null;
end $$;

-- ------------------------------------------------------------
-- SEGURANCA A: entrar por funcao com codigo (igual a migration_seguranca_a.sql)
-- ------------------------------------------------------------
-- SEGURANÇA, PARTE A (só adiciona; não quebra nada que já funciona).
-- Entrar num casal passa a ser feito por uma função no servidor que confere o código.
-- É seguro rodar mais de uma vez.

create or replace function join_couple(p_code text, p_role text, p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cid uuid;
  nm text := left(trim(coalesce(p_name, '')), 24);
  prof profiles%rowtype;
begin
  if me is null then
    raise exception 'não autenticado';
  end if;
  if p_role not in ('gabriel', 'tata') then
    raise exception 'papel inválido';
  end if;
  if nm = '' then
    raise exception 'nome obrigatório';
  end if;

  select id into cid from couples where code = upper(trim(p_code));
  if cid is null then
    perform pg_sleep(1.5); -- atrapalha tentativa de adivinhar código
    raise exception 'código inválido';
  end if;

  -- já tem perfil com essa conta: só devolve se for o mesmo casal e papel
  select * into prof from profiles where id = me;
  if found then
    if prof.couple_id = cid and prof.role = p_role then
      return json_build_object('id', prof.id, 'couple_id', prof.couple_id, 'role', prof.role, 'display_name', prof.display_name, 'isNew', false);
    end if;
    raise exception 'esta conta já pertence a outro casal';
  end if;

  -- vaga já ocupada (ex: reinstalou o app): assume o lugar, agora só com o código certo
  select * into prof from profiles where couple_id = cid and role = p_role;
  if found then
    update profiles set id = me, display_name = nm where couple_id = cid and role = p_role returning * into prof;
    return json_build_object('id', prof.id, 'couple_id', prof.couple_id, 'role', prof.role, 'display_name', prof.display_name, 'isNew', false);
  end if;

  insert into profiles (id, couple_id, role, display_name) values (me, cid, p_role, nm) returning * into prof;
  return json_build_object('id', prof.id, 'couple_id', prof.couple_id, 'role', prof.role, 'display_name', prof.display_name, 'isNew', true);
end;
$$;

revoke all on function join_couple(text, text, text) from public;
grant execute on function join_couple(text, text, text) to anon, authenticated;

-- a tela de entrada por código passa a receber também quem já está no casal (papel e nome),
-- sem precisar ler a tabela de perfis
drop function if exists find_couple_preview(text);
create or replace function find_couple_preview(p_code text)
returns table (id uuid, code text, names jsonb, genders jsonb, emojis jsonb, roster jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.code,
         coalesce(s.names, '{}'::jsonb), coalesce(s.genders, '{}'::jsonb), coalesce(s.emojis, '{}'::jsonb),
         coalesce((select jsonb_object_agg(p.role, p.display_name) from profiles p where p.couple_id = c.id), '{}'::jsonb)
  from couples c
  left join couple_settings s on s.couple_id = c.id
  where c.code = p_code
$$;

grant execute on function find_couple_preview(text) to anon, authenticated;

-- ------------------------------------------------------------
-- SEGURANCA B: fecha perfis (igual a migration_seguranca_b.sql)
-- ------------------------------------------------------------
-- SEGURANÇA, PARTE B: fecha as regras antigas de perfis.
-- Só rode DEPOIS que o app novo (que entra pela função join_couple) estiver publicado.
-- É seguro rodar mais de uma vez.

drop policy if exists "profiles: anyone can read" on profiles;
drop policy if exists "profiles: insert own" on profiles;
drop policy if exists "profiles: update own or reclaim" on profiles;
drop policy if exists "profiles: read own couple" on profiles;
drop policy if exists "profiles: update own" on profiles;

-- cada pessoa lê o próprio perfil e o do seu casal; ninguém mais
create policy "profiles: read own couple" on profiles
  for select using (id = auth.uid() or couple_id = my_couple_id());

-- só dá pra alterar o próprio perfil (ex: nome). Criar e retomar perfil só pela função join_couple.
create policy "profiles: update own" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- ------------------------------------------------------------
-- SEGURANCA: codigo forte e limite de tentativas (igual a migration_codigo.sql)
-- ------------------------------------------------------------
-- SEGURANÇA: código do casal mais forte e limite de tentativas.
-- Depois de 12 tentativas erradas em 10 minutos (pelo mesmo endereço ou conta), o servidor para de responder.
-- Criar casal exige código com pelo menos 8 caracteres.
-- É seguro rodar mais de uma vez.

create table if not exists code_attempts (
  id bigserial primary key,
  ip text not null default '',
  uid uuid,
  ok boolean not null default false,
  at timestamptz not null default now()
);
alter table code_attempts enable row level security; -- sem policies: só as funções abaixo mexem
create index if not exists code_attempts_at_idx on code_attempts (at);

create or replace function client_ip()
returns text
language sql
stable
as $$
  select trim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1))
$$;

create or replace function assert_not_throttled()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text := client_ip();
  n int;
begin
  select count(*) into n from code_attempts
  where ok = false
    and at > now() - interval '10 minutes'
    and ((v_ip <> '' and ip = v_ip) or (auth.uid() is not null and uid = auth.uid()));
  if n >= 12 then
    raise exception 'muitas tentativas seguidas, aguarde alguns minutos e tente de novo';
  end if;
end;
$$;

create or replace function record_failed_attempt()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into code_attempts (ip, uid, ok) values (client_ip(), auth.uid(), false);
  delete from code_attempts where at < now() - interval '1 day';
end;
$$;

revoke all on function assert_not_throttled() from public, anon, authenticated;
revoke all on function record_failed_attempt() from public, anon, authenticated;

-- entrar: código errado vira RESPOSTA (não exceção) pra a tentativa ficar registrada
create or replace function join_couple(p_code text, p_role text, p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cid uuid;
  nm text := left(trim(coalesce(p_name, '')), 24);
  prof profiles%rowtype;
begin
  if me is null then
    raise exception 'não autenticado';
  end if;
  if p_role not in ('gabriel', 'tata') then
    raise exception 'papel inválido';
  end if;
  if nm = '' then
    raise exception 'nome obrigatório';
  end if;

  perform assert_not_throttled();

  select id into cid from couples where code = upper(trim(p_code));
  if cid is null then
    perform record_failed_attempt();
    perform pg_sleep(1.5);
    return json_build_object('error', 'codigo_invalido');
  end if;

  select * into prof from profiles where id = me;
  if found then
    if prof.couple_id = cid and prof.role = p_role then
      return json_build_object('id', prof.id, 'couple_id', prof.couple_id, 'role', prof.role, 'display_name', prof.display_name, 'isNew', false);
    end if;
    raise exception 'esta conta já pertence a outro casal';
  end if;

  select * into prof from profiles where couple_id = cid and role = p_role;
  if found then
    update profiles set id = me, display_name = nm where couple_id = cid and role = p_role returning * into prof;
    return json_build_object('id', prof.id, 'couple_id', prof.couple_id, 'role', prof.role, 'display_name', prof.display_name, 'isNew', false);
  end if;

  insert into profiles (id, couple_id, role, display_name) values (me, cid, p_role, nm) returning * into prof;
  return json_build_object('id', prof.id, 'couple_id', prof.couple_id, 'role', prof.role, 'display_name', prof.display_name, 'isNew', true);
end;
$$;

revoke all on function join_couple(text, text, text) from public;
grant execute on function join_couple(text, text, text) to anon, authenticated;

-- procurar pelo código: também conta as buscas que não acharam nada
drop function if exists find_couple_preview(text);
create or replace function find_couple_preview(p_code text)
returns table (id uuid, code text, names jsonb, genders jsonb, emojis jsonb, roster jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_not_throttled();
  return query
    select c.id, c.code,
           coalesce(s.names, '{}'::jsonb), coalesce(s.genders, '{}'::jsonb), coalesce(s.emojis, '{}'::jsonb),
           coalesce((select jsonb_object_agg(p.role, p.display_name) from profiles p where p.couple_id = c.id), '{}'::jsonb)
    from couples c
    left join couple_settings s on s.couple_id = c.id
    where c.code = p_code;
  if not found then
    perform record_failed_attempt();
  end if;
end;
$$;

grant execute on function find_couple_preview(text) to anon, authenticated;

-- criar casal: código com pelo menos 8 caracteres (casais antigos não são afetados)
create or replace function create_couple(
  p_code text,
  p_names jsonb default '{}'::jsonb,
  p_genders jsonb default '{}'::jsonb,
  p_emojis jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  if length(regexp_replace(coalesce(p_code, ''), '\s', '', 'g')) < 8 then
    raise exception 'código curto: use pelo menos 8 caracteres';
  end if;
  insert into couples (code) values (upper(trim(p_code))) returning couples.id into new_id;
  if p_names <> '{}'::jsonb or p_genders <> '{}'::jsonb then
    insert into couple_settings (couple_id, names, genders, emojis)
    values (new_id, p_names, p_genders, p_emojis);
  end if;
  return new_id;
end;
$$;

revoke all on function create_couple(text, jsonb, jsonb, jsonb) from public;
grant execute on function create_couple(text, jsonb, jsonb, jsonb) to anon, authenticated;

-- ------------------------------------------------------------
-- CONSENTIMENTO DO CICLO (igual a migration_ciclo_consentimento.sql)
-- ------------------------------------------------------------
-- Consentimento do ciclo menstrual (dado sensível, LGPD art. 11).
-- Guarda quando a pessoa aceitou o aviso e exige o aceite pra criar o registro do ciclo.
-- É seguro rodar mais de uma vez.

alter table cycle_settings add column if not exists consent_at timestamptz;

drop policy if exists "cycle_settings: insert own" on cycle_settings;
create policy "cycle_settings: insert own" on cycle_settings
  for insert with check (
    couple_id = my_couple_id() and role = my_role() and my_gender() = 'mulher' and consent_at is not null
  );

-- ------------------------------------------------------------
-- MANUTENCAO: funcao keepalive (igual a migration_manutencao.sql)
-- ------------------------------------------------------------
-- Manutenção do banco (plano gratuito): função de "acordar" chamada todo dia por uma tarefa do GitHub,
-- pra o Supabase não pausar o projeto por inatividade.
-- É seguro rodar mais de uma vez.

create table if not exists keepalive (
  id int primary key default 1 check (id = 1),
  pinged_at timestamptz not null default now()
);
alter table keepalive enable row level security; -- sem policies: só a função abaixo mexe

create or replace function keepalive()
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  t timestamptz := now();
begin
  insert into keepalive (id, pinged_at) values (1, t)
  on conflict (id) do update set pinged_at = t;
  return t;
end;
$$;

revoke all on function keepalive() from public;
grant execute on function keepalive() to anon, authenticated;

-- ============ monitoramento de erros (migration_erros.sql) ============
-- Monitoramento de erros (gratuito, sem serviço externo): o app manda pra cá os erros de JavaScript
-- que acontecem no celular das pessoas, e o modo dono mostra os mais recentes.
-- Só guarda: mensagem curta, arquivo/linha, versão e tipo de aparelho. Nenhum conteúdo de casal.
-- É seguro rodar mais de uma vez.

create table if not exists app_errors (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id uuid,
  message text not null,
  place text,
  ua text
);
alter table app_errors enable row level security; -- sem policies: só as funções abaixo mexem

create index if not exists app_errors_created_idx on app_errors (created_at desc);

-- o app chama isso quando dá erro. Limite: 20 por pessoa por hora (evita alguém encher o banco).
create or replace function log_error(p_message text, p_place text, p_ua text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then return; end if;
  if (select count(*) from app_errors where user_id = uid and created_at > now() - interval '1 hour') >= 20 then
    return;
  end if;
  insert into app_errors (user_id, message, place, ua)
  values (uid, left(coalesce(p_message, ''), 300), left(p_place, 200), left(p_ua, 200));
end;
$$;

revoke all on function log_error(text, text, text) from public;
grant execute on function log_error(text, text, text) to authenticated;

-- modo dono: erros dos últimos 7 dias agrupados por mensagem
create or replace function admin_errors(p_key text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  select exists(select 1 from app_admin_secret where key = p_key) into ok;
  if not ok then
    perform pg_sleep(1.5);
    raise exception 'acesso negado';
  end if;

  return (
    select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
      select
        message,
        max(place) as place,
        count(*) as times,
        count(distinct user_id) as people,
        max(created_at) as last_at
      from app_errors
      where created_at > now() - interval '7 days'
      group by message
      order by max(created_at) desc
      limit 30
    ) t
  );
end;
$$;

revoke all on function admin_errors(text) from public;
grant execute on function admin_errors(text) to anon, authenticated;

-- limpeza: erros com mais de 30 dias saem sozinhos quando alguém registra um novo
create or replace function app_errors_cleanup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from app_errors where created_at < now() - interval '30 days';
  return null;
end;
$$;

drop trigger if exists app_errors_cleanup_trg on app_errors;
create trigger app_errors_cleanup_trg
  after insert on app_errors
  for each statement execute function app_errors_cleanup();

-- ============ reações (migration_reacoes.sql) ============
-- Reações com um toque: cada pessoa pode reagir (❤️ 🤗 😘 🥹 💪) ao humor do dia e aos recadinhos do par.
-- Uma reação por pessoa em cada item (tocar em outra troca; tocar na mesma tira).
-- É seguro rodar mais de uma vez.

create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  kind text not null check (kind in ('mood', 'note')),
  target_id uuid not null,
  role text not null check (role in ('gabriel', 'tata')),
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  unique (kind, target_id, role)
);

create index if not exists reactions_couple_idx on reactions (couple_id, kind);

alter table reactions enable row level security;

drop policy if exists "reactions: couple access" on reactions;
create policy "reactions: couple access" on reactions
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'reactions') then
    alter publication supabase_realtime add table reactions;
  end if;
end;
$$;

-- ============ Lembrei de você (migration_lembrei_de_voce.sql) ============
-- "Lembrei de você": dentro de Recados, a pessoa manda uma foto de algo que lembrou o par, com uma
-- observação. O par pode reagir com emoji e/ou responder com um comentário. Assim que o par reage
-- (de qualquer um dos dois jeitos), os dois ganham moeda. Fotos são apagadas de vez depois de 30 dias
-- (arquivo incluído, não só o registro) por uma tarefa diária no GitHub Actions.
-- É seguro rodar mais de uma vez.

-- ---------- espaço de arquivos (bucket) ----------
insert into storage.buckets (id, name, public)
values ('memories', 'memories', false)
on conflict (id) do nothing;

drop policy if exists "memories: couple read" on storage.objects;
create policy "memories: couple read" on storage.objects
  for select using (bucket_id = 'memories' and (storage.foldername(name))[1] = my_couple_id()::text);

drop policy if exists "memories: couple write" on storage.objects;
create policy "memories: couple write" on storage.objects
  for insert with check (bucket_id = 'memories' and (storage.foldername(name))[1] = my_couple_id()::text);

drop policy if exists "memories: couple delete" on storage.objects;
create policy "memories: couple delete" on storage.objects
  for delete using (bucket_id = 'memories' and (storage.foldername(name))[1] = my_couple_id()::text);

-- ---------- tabela ----------
create table if not exists memory_photos (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  photo_path text not null, -- caminho dentro do bucket "memories" (não é a URL: o bucket é privado)
  caption text not null check (char_length(caption) between 1 and 300),
  reply_text text check (reply_text is null or char_length(reply_text) <= 300),
  reply_role text check (reply_role in ('gabriel', 'tata')),
  replied_at timestamptz,
  points_awarded boolean not null default false,
  created_at timestamptz not null default now()
);

alter table memory_photos enable row level security;

drop policy if exists "memory_photos: couple access" on memory_photos;
create policy "memory_photos: couple access" on memory_photos
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

create index if not exists memory_photos_couple_idx on memory_photos (couple_id, created_at desc);

-- limite de 5 fotos por pessoa por dia (conferido de novo no servidor, não só no app)
create or replace function memory_photos_daily_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from memory_photos
      where couple_id = new.couple_id and role = new.role
        and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'limite_diario';
  end if;
  return new;
end;
$$;

drop trigger if exists memory_photos_daily_limit_trg on memory_photos;
create trigger memory_photos_daily_limit_trg
  before insert on memory_photos
  for each row execute function memory_photos_daily_limit();

-- ---------- reações também valem pra "lembrei de você" ----------
alter table reactions drop constraint if exists reactions_kind_check;
alter table reactions add constraint reactions_kind_check check (kind in ('mood', 'note', 'memory'));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'memory_photos') then
    alter publication supabase_realtime add table memory_photos;
  end if;
end;
$$;

-- ============ Modo Amigos (migration_amigos.sql) ============
-- Modo Amigos: contas separadas do casal, que uma pessoa pode ter várias ao mesmo tempo
-- (diferente do casal, que é só 1 por pessoa). Moedas e dados de cada turma não se
-- misturam entre turmas nem com o casal. Exige login de verdade (Google), não anônimo —
-- por isso as funções abaixo recusam sessão anônima.
-- É seguro rodar mais de uma vez.

create table if not exists friend_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default '',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  max_members int not null default 8 check (max_members between 2 and 20)
);

create table if not exists friend_members (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null check (char_length(display_name) between 1 and 24),
  joined_at timestamptz not null default now(),
  unique (friend_group_id, user_id)
);

alter table friend_groups enable row level security;
alter table friend_members enable row level security;

-- todas as turmas que a pessoa faz parte (ela pode estar em várias)
create or replace function my_friend_group_ids()
returns uuid[]
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(array_agg(friend_group_id), '{}') from friend_members where user_id = auth.uid()
$$;

drop policy if exists "friend_groups: members see" on friend_groups;
create policy "friend_groups: members see" on friend_groups
  for select using (id = any(my_friend_group_ids()));

drop policy if exists "friend_members: group access" on friend_members;
create policy "friend_members: group access" on friend_members
  for select using (friend_group_id = any(my_friend_group_ids()));

drop policy if exists "friend_members: update own name" on friend_members;
create policy "friend_members: update own name" on friend_members
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- criar uma turma nova. Recusa sessão anônima: precisa ter feito login com o Google antes.
create or replace function create_friend_group(p_name text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  new_code text;
  gid uuid;
begin
  if is_anon then
    raise exception 'precisa_login_google';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) < 1 then
    raise exception 'nome_invalido';
  end if;
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into friend_groups (code, name, created_by) values (new_code, coalesce(nullif(trim(p_name), ''), 'Minha turma'), auth.uid()) returning id into gid;
  insert into friend_members (friend_group_id, user_id, display_name) values (gid, auth.uid(), trim(p_display_name));
  return json_build_object('id', gid, 'code', new_code);
end;
$$;

-- entrar numa turma existente com o código. Também recusa sessão anônima.
create or replace function join_friend_group(p_code text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  g record;
  cnt int;
begin
  if is_anon then
    raise exception 'precisa_login_google';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) < 1 then
    raise exception 'nome_invalido';
  end if;
  select * into g from friend_groups where code = upper(trim(p_code));
  if not found then
    perform pg_sleep(1); -- atrapalha tentativa de adivinhar código
    raise exception 'codigo_invalido';
  end if;
  select count(*) into cnt from friend_members where friend_group_id = g.id;
  if cnt >= g.max_members and not exists (select 1 from friend_members where friend_group_id = g.id and user_id = auth.uid()) then
    raise exception 'grupo_cheio';
  end if;
  insert into friend_members (friend_group_id, user_id, display_name)
  values (g.id, auth.uid(), trim(p_display_name))
  on conflict (friend_group_id, user_id) do update set display_name = excluded.display_name;
  return json_build_object('id', g.id, 'name', g.name, 'code', g.code);
end;
$$;

revoke all on function create_friend_group(text, text) from public;
grant execute on function create_friend_group(text, text) to authenticated;
revoke all on function join_friend_group(text, text) from public;
grant execute on function join_friend_group(text, text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_groups') then
    alter publication supabase_realtime add table friend_groups;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_members') then
    alter publication supabase_realtime add table friend_members;
  end if;
end;
$$;

-- Modo Amigos: mesma proteção contra adivinhar código que o casal já tem (assert_not_throttled /
-- record_failed_attempt, de migration_seguranca_a.sql/migration_seguranca_b.sql). Depois de 12
-- tentativas erradas em 10 minutos (mesmo IP ou mesma conta), o servidor para de responder.
-- O código da turma já é único por natureza (gerado pelo servidor, coluna "unique" na tabela) —
-- isso aqui é só pra também travar quem fica tentando adivinhar o código de uma turma alheia.
-- É seguro rodar mais de uma vez.

create or replace function join_friend_group(p_code text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  g record;
  cnt int;
begin
  if is_anon then
    raise exception 'precisa_login_google';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) < 1 then
    raise exception 'nome_invalido';
  end if;

  perform assert_not_throttled();

  select * into g from friend_groups where code = upper(trim(p_code));
  if not found then
    -- registra a tentativa errada como RESPOSTA (não exceção): se fosse "raise exception" aqui,
    -- a transação inteira desfazia o insert do record_failed_attempt() junto.
    perform record_failed_attempt();
    perform pg_sleep(1);
    return json_build_object('error', 'codigo_invalido');
  end if;

  select count(*) into cnt from friend_members where friend_group_id = g.id;
  if cnt >= g.max_members and not exists (select 1 from friend_members where friend_group_id = g.id and user_id = auth.uid()) then
    raise exception 'grupo_cheio';
  end if;
  insert into friend_members (friend_group_id, user_id, display_name)
  values (g.id, auth.uid(), trim(p_display_name))
  on conflict (friend_group_id, user_id) do update set display_name = excluded.display_name;
  return json_build_object('id', g.id, 'name', g.name, 'code', g.code);
end;
$$;

revoke all on function join_friend_group(text, text) from public;
grant execute on function join_friend_group(text, text) to authenticated;

-- Modo Amigos: dados de verdade pras abas Hoje (humor da turma) e Prêmios (cofre de moedas
-- do grupo). Mesmo modelo de confiança que o casal já usa (qualquer um do grupo lê/escreve
-- os dados do próprio grupo) — só trocando "é do casal" (my_couple_id) por "é dessa turma"
-- (friend_group_id = any(my_friend_group_ids())). Rolês e Recados ficam "em breve" por
-- enquanto, entram numa próxima leva.
-- É seguro rodar mais de uma vez.

create table if not exists friend_moods (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  day date not null,
  mood text not null,
  created_at timestamptz not null default now(),
  unique (friend_group_id, user_id, day)
);
alter table friend_moods enable row level security;
drop policy if exists "friend_moods: group access" on friend_moods;
create policy "friend_moods: group access" on friend_moods
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()) and user_id = auth.uid());

create table if not exists friend_coin_ledger (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid references auth.users(id),
  delta int not null,
  reason text not null default '',
  created_at timestamptz not null default now()
);
alter table friend_coin_ledger enable row level security;
drop policy if exists "friend_coin_ledger: group access" on friend_coin_ledger;
create policy "friend_coin_ledger: group access" on friend_coin_ledger
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

create or replace view friend_coin_balances as
  select friend_group_id, coalesce(sum(delta), 0) as balance
  from friend_coin_ledger
  group by friend_group_id;

create table if not exists friend_redemptions (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id), -- quem resgatou
  perk_id text not null,
  title text not null,
  cost int not null,
  status text not null default 'pendente' check (status in ('pendente', 'cumprido')),
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz
);
alter table friend_redemptions enable row level security;
drop policy if exists "friend_redemptions: group access" on friend_redemptions;
create policy "friend_redemptions: group access" on friend_redemptions
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

-- agora também dá 25 moedas iniciais pro cofre da turma quando ela nasce (igual o casal)
create or replace function create_friend_group(p_name text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  new_code text;
  gid uuid;
begin
  if is_anon then
    raise exception 'precisa_login_google';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) < 1 then
    raise exception 'nome_invalido';
  end if;
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into friend_groups (code, name, created_by) values (new_code, coalesce(nullif(trim(p_name), ''), 'Minha turma'), auth.uid()) returning id into gid;
  insert into friend_members (friend_group_id, user_id, display_name) values (gid, auth.uid(), trim(p_display_name));
  insert into friend_coin_ledger (friend_group_id, user_id, delta, reason) values (gid, auth.uid(), 25, 'saldo inicial da turma');
  return json_build_object('id', gid, 'code', new_code);
end;
$$;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_moods') then
    alter publication supabase_realtime add table friend_moods;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_coin_ledger') then
    alter publication supabase_realtime add table friend_coin_ledger;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_redemptions') then
    alter publication supabase_realtime add table friend_redemptions;
  end if;
end;
$$;

-- Modo Amigos: aba Rolês — agenda de encontros da turma (versão lista, não o calendário
-- mensal completo do casal). Qualquer um do grupo cria/edita/apaga um rolê (mesmo modelo de
-- confiança já usado no resto do Modo Amigos), mas cada um só mexe na própria confirmação de
-- presença.
-- É seguro rodar mais de uma vez.

create table if not exists friend_events (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  title text not null,
  start_date date not null,
  start_time time,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table friend_events enable row level security;
drop policy if exists "friend_events: group access" on friend_events;
create policy "friend_events: group access" on friend_events
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

create table if not exists friend_event_rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references friend_events(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  status text not null check (status in ('sim', 'talvez', 'nao')),
  updated_at timestamptz not null default now(),
  unique (event_id, user_id)
);
alter table friend_event_rsvps enable row level security;

drop policy if exists "friend_event_rsvps: group sees" on friend_event_rsvps;
create policy "friend_event_rsvps: group sees" on friend_event_rsvps
  for select using (exists (select 1 from friend_events e where e.id = event_id and e.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_event_rsvps: write own" on friend_event_rsvps;
create policy "friend_event_rsvps: write own" on friend_event_rsvps
  for insert with check (user_id = auth.uid() and exists (select 1 from friend_events e where e.id = event_id and e.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_event_rsvps: update own" on friend_event_rsvps;
create policy "friend_event_rsvps: update own" on friend_event_rsvps
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "friend_event_rsvps: delete own" on friend_event_rsvps;
create policy "friend_event_rsvps: delete own" on friend_event_rsvps
  for delete using (user_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_events') then
    alter publication supabase_realtime add table friend_events;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_event_rsvps') then
    alter publication supabase_realtime add table friend_event_rsvps;
  end if;
end;
$$;

-- Modo Amigos: aba Rolês vira calendário de verdade (mês inteiro, igual o do casal), com
-- categoria por evento (rolê/trabalho/outro) — antes era só uma lista dos próximos.
-- É seguro rodar mais de uma vez.

alter table friend_events add column if not exists category text not null default 'amigos'
  check (category in ('amigos', 'trabalho', 'outro'));

-- Modo Amigos: Rolês ganha um campo de detalhes opcional (endereço, o que levar) —
-- do estudo sobre Partiful (o "Text Blast" resolve dúvida de última hora dos convidados).
-- É seguro rodar mais de uma vez.

alter table friend_events add column if not exists details text not null default '';

-- Modo Amigos: Prêmios mais completo + ofensiva do dia com "congelador" grátis semanal
-- (perda suave, nunca sorteio/caixa-surpresa — ver o estudo sobre gamificação ética).
-- É seguro rodar mais de uma vez.

-- um registro por dia em que a turma teve atividade (qualquer membro abriu o Modo Amigos
-- naquele dia). A sequência é calculada no cliente a partir dessa lista.
create table if not exists friend_streak_days (
  id bigserial primary key,
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  day date not null,
  unique (friend_group_id, day)
);
alter table friend_streak_days enable row level security;
drop policy if exists "friend_streak_days: group access" on friend_streak_days;
create policy "friend_streak_days: group access" on friend_streak_days
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

-- itens de prêmio criados pela própria turma, além do catálogo fixo do app
create table if not exists friend_custom_perks (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  emoji text not null default '🎁',
  title text not null,
  description text not null default '',
  cost int not null check (cost > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table friend_custom_perks enable row level security;
drop policy if exists "friend_custom_perks: group access" on friend_custom_perks;
create policy "friend_custom_perks: group access" on friend_custom_perks
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_streak_days') then
    alter publication supabase_realtime add table friend_streak_days;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_custom_perks') then
    alter publication supabase_realtime add table friend_custom_perks;
  end if;
end;
$$;
