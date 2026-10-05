-- CapMart: progresso, compras de ajuda e resultados de partida. A validação de replay (o
-- motor do jogo em si) roda nas Edge Functions capmart-purchase/capmart-submit (reaproveitam
-- o código do motor TypeScript sem alteração) — aqui só ficam as tabelas e o que é SQL puro
-- (progresso pessoal e ranking). É seguro rodar mais de uma vez.

create table if not exists capmart_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  unlocked int not null default 1,
  records jsonb not null default '{}'::jsonb,
  tutorial_done boolean not null default false,
  preferences jsonb not null default '{"sound":true,"reducedMotion":false}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table capmart_progress enable row level security;
drop policy if exists "capmart_progress: own row" on capmart_progress;
create policy "capmart_progress: own row" on capmart_progress for select using (user_id = auth.uid());
-- sem policy de insert/update: unlocked/records só mudam via capmart-submit (service role);
-- tutorial_done/preferences só mudam via capmart_save_progress abaixo
revoke all on capmart_progress from public, authenticated;
grant select on capmart_progress to authenticated;

create table if not exists capmart_purchases (
  request_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  run_id text not null,
  help text not null,
  level_id int not null,
  approved boolean not null,
  created_at timestamptz not null default now()
);
alter table capmart_purchases enable row level security;
drop policy if exists "capmart_purchases: own rows" on capmart_purchases;
create policy "capmart_purchases: own rows" on capmart_purchases for select using (user_id = auth.uid());
revoke all on capmart_purchases from public, authenticated;
grant select on capmart_purchases to authenticated;

create table if not exists capmart_rewards (
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, reward_id)
);
alter table capmart_rewards enable row level security;
revoke all on capmart_rewards from public, authenticated;

create table if not exists capmart_results (
  run_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  couple_id uuid references couples(id) on delete cascade,
  friend_group_id uuid references friend_groups(id) on delete cascade,
  level_id int not null,
  seed bigint not null,
  config_version int not null default 1,
  score int not null,
  stars int not null,
  won boolean not null,
  assisted boolean not null,
  elapsed numeric not null,
  moves int not null,
  daily boolean not null default false,
  daily_day text,
  awarded int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists capmart_results_ranking_idx on capmart_results (level_id, seed, config_version);
alter table capmart_results enable row level security;
drop policy if exists "capmart_results: own or same couple/turma" on capmart_results;
create policy "capmart_results: own or same couple/turma" on capmart_results
  for select using (
    user_id = auth.uid()
    or (couple_id is not null and couple_id = my_couple_id())
    or (friend_group_id is not null and friend_group_id = any(my_friend_group_ids()))
  );
revoke all on capmart_results from public, authenticated;
grant select on capmart_results to authenticated;

-- só tutorial/preferences — nunca unlocked/records (isso é só via resultado validado)
create or replace function capmart_save_progress(p_tutorial_done boolean, p_preferences jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into capmart_progress (user_id, tutorial_done, preferences)
    values (auth.uid(), p_tutorial_done, p_preferences)
  on conflict (user_id) do update set
    tutorial_done = p_tutorial_done, preferences = p_preferences, updated_at = now();
end;
$$;
revoke all on function capmart_save_progress(boolean, jsonb) from public;
grant execute on function capmart_save_progress(boolean, jsonb) to authenticated;

-- ranking: individual = só suas partidas; couple/group = todo mundo visível pela policy
-- acima, filtrado pela MESMA fase+semente+versão (nunca compara configurações diferentes)
create or replace function capmart_get_ranking(p_mode text, p_level_id int, p_seed bigint, p_config_version int)
returns table (user_id uuid, name text, score int, assisted boolean, seed bigint, config_version int)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
    select best.user_id, best.name, best.score, best.assisted, best.seed, best.config_version
    from (
      select distinct on (r.user_id)
        r.user_id, coalesce(p.display_name, 'Jogador') as name, r.score, r.assisted, r.seed, r.config_version, r.created_at
      from capmart_results r
      left join lateral (
        select coalesce(fm.display_name, cs.names ->> prof.role, initcap(prof.role)) as display_name
        from profiles prof
        left join friend_members fm on fm.user_id = r.user_id and fm.friend_group_id = r.friend_group_id
        left join couple_settings cs on cs.couple_id = r.couple_id
        where prof.id = r.user_id
      ) p on true
      where r.level_id = p_level_id and r.seed = p_seed and r.config_version = p_config_version and r.won
        and (
          (p_mode = 'individual' and r.user_id = auth.uid())
          or (p_mode = 'couple' and r.couple_id is not null and r.couple_id = my_couple_id())
          or (p_mode = 'group' and r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
        )
      order by r.user_id, r.score desc, r.created_at asc
    ) best
    order by best.score desc
    limit 50;
end;
$$;
revoke all on function capmart_get_ranking(text, int, bigint, int) from public;
grant execute on function capmart_get_ranking(text, int, bigint, int) to authenticated;

-- saldo da carteira certa conforme o contexto (casal = por role, turma = cofre compartilhado)
create or replace function capmart_balance(p_wallet_mode text, p_couple_id uuid, p_friend_group_id uuid, p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select case
    when p_wallet_mode = 'casal' then (
      select cb.balance from coin_balances cb
      where cb.couple_id = p_couple_id and cb.role = (select pr.role from profiles pr where pr.id = p_user_id)
    )
    else (select fcb.balance from friend_coin_balances fcb where fcb.friend_group_id = p_friend_group_id)
  end;
$$;
-- sem grant pra authenticated: aceita ids arbitrários como parâmetro, só deve ser chamada
-- por outra função SECURITY DEFINER (capmart_commit_result) ou pelo service role
revoke all on function capmart_balance(text, uuid, uuid, uuid) from public, authenticated;

create or replace function capmart_progress_json(p capmart_progress)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('version', 1, 'unlocked', coalesce(p.unlocked, 1), 'records', coalesce(p.records, '{}'::jsonb), 'tutorialDone', coalesce(p.tutorial_done, false), 'preferences', coalesce(p.preferences, '{"sound":true,"reducedMotion":false}'::jsonb));
$$;

-- grava o resultado já validado (a validação de replay roda ANTES disso, na Edge Function
-- capmart-submit, que é a única autorizada a chamar isto — por isso usa p_user_id em vez de
-- auth.uid(): não é exposta a authenticated, só ao service role). Tudo numa transação só:
-- idempotente por run_id, concede recompensa só na primeira vez (chave única em
-- capmart_rewards), avança desbloqueio/recordes de forma monotônica, credita a carteira
-- certa. p_candidate_rewards: [{"id":"level:5","amount":5}, ...] calculado pela Edge Function
-- a partir das mesmas regras do motor (RULES.rewards).
create or replace function capmart_commit_result(
  p_user_id uuid, p_run_id text, p_level_id int, p_seed bigint, p_config_version int,
  p_score int, p_stars int, p_won boolean, p_assisted boolean, p_elapsed numeric, p_moves int,
  p_daily boolean, p_daily_day text, p_wallet_mode text, p_couple_id uuid, p_friend_group_id uuid,
  p_candidate_rewards jsonb
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  role text;
  existing capmart_results%rowtype;
  progress capmart_progress%rowtype;
  previous_record int := 0;
  awarded int := 0;
  reward jsonb;
  new_unlocked int;
  new_records jsonb;
  old_entry jsonb;
begin
  select * into existing from capmart_results where run_id = p_run_id;
  if found then
    select * into progress from capmart_progress where user_id = p_user_id;
    return json_build_object('balance', capmart_balance(p_wallet_mode, p_couple_id, p_friend_group_id, p_user_id),
      'awarded', existing.awarded, 'previousRecord', 0, 'progress', capmart_progress_json(progress));
  end if;

  if p_wallet_mode = 'casal' then
    select pr.role into role from profiles pr where pr.id = p_user_id and pr.couple_id = p_couple_id;
    if role is null then raise exception 'acesso não autorizado'; end if;
  else
    if not exists (select 1 from friend_members where friend_group_id = p_friend_group_id and user_id = p_user_id) then
      raise exception 'acesso não autorizado';
    end if;
  end if;

  select * into progress from capmart_progress where user_id = p_user_id;
  if not found then
    insert into capmart_progress (user_id) values (p_user_id) returning * into progress;
  end if;

  if not p_daily and p_level_id > progress.unlocked then raise exception 'fase ainda não desbloqueada'; end if;

  if p_daily then
    previous_record := coalesce((select max(score) from capmart_results where user_id = p_user_id and daily and seed = p_seed), 0);
  else
    old_entry := progress.records -> p_level_id::text;
    previous_record := coalesce((old_entry ->> 'score')::int, 0);
  end if;

  insert into capmart_results (run_id, user_id, couple_id, friend_group_id, level_id, seed, config_version, score, stars, won, assisted, elapsed, moves, daily, daily_day, awarded)
    values (p_run_id, p_user_id, case when p_wallet_mode = 'casal' then p_couple_id else null end, case when p_wallet_mode = 'turma' then p_friend_group_id else null end,
      p_level_id, p_seed, p_config_version, p_score, p_stars, p_won, p_assisted, p_elapsed, p_moves, p_daily, p_daily_day, 0);

  if p_won then
    for reward in select * from jsonb_array_elements(p_candidate_rewards) loop
      insert into capmart_rewards (user_id, reward_id) values (p_user_id, reward ->> 'id') on conflict do nothing;
      if found then
        awarded := awarded + (reward ->> 'amount')::int;
      end if;
    end loop;
  end if;

  if not p_daily and p_won then
    new_unlocked := greatest(progress.unlocked, least(60, p_level_id + 1));
    new_records := progress.records || jsonb_build_object(p_level_id::text, jsonb_build_object(
      'completed', true,
      'stars', greatest(coalesce((old_entry ->> 'stars')::int, 0), p_stars),
      'score', greatest(coalesce((old_entry ->> 'score')::int, 0), p_score)
    ));
    update capmart_progress set unlocked = new_unlocked, records = new_records, updated_at = now() where user_id = p_user_id
      returning * into progress;
  end if;

  if awarded > 0 then
    if p_wallet_mode = 'casal' then
      insert into coin_ledger (couple_id, role, delta, reason) values (p_couple_id, role, awarded, 'CapMart: recompensa');
    else
      insert into friend_coin_ledger (friend_group_id, user_id, delta, reason) values (p_friend_group_id, p_user_id, awarded, 'CapMart: recompensa');
    end if;
  end if;

  update capmart_results set awarded = awarded where run_id = p_run_id;

  return json_build_object('balance', capmart_balance(p_wallet_mode, p_couple_id, p_friend_group_id, p_user_id),
    'awarded', awarded, 'previousRecord', previous_record, 'progress', capmart_progress_json(progress));
end;
$$;
-- de propósito SEM grant pra authenticated: só o service role (a Edge Function
-- capmart-submit, depois de validar o replay) pode chamar isto — por isso usa p_user_id em
-- vez de auth.uid(), e por isso não pode ficar aberta pra qualquer usuário autenticado
-- chamar direto (poderia inventar resultado/recompensa sem validar nada).
revoke all on function capmart_commit_result(uuid, text, int, bigint, int, int, int, boolean, boolean, numeric, int, boolean, text, text, uuid, uuid, jsonb) from public, authenticated;
