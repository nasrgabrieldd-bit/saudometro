-- Minigames — Fase 4 (refino): contestar resposta do STOP por votação. Lacuna deixada de
-- propósito na Fase 3. Mesmo molde do kick-vote da turma (propose_kick_vote/cast_kick_ballot,
-- schema.sql), mas elegibilidade vem de game_room_players (não friend_members), porque o STOP
-- roda em Casal e Turma. É seguro rodar mais de uma vez.

alter table stop_answers add column if not exists invalidated boolean not null default false;

create table if not exists stop_contests (
  id uuid primary key default gen_random_uuid(),
  match_id uuid not null references stop_matches(id) on delete cascade,
  round_number int not null,
  category text not null check (category in ('nome', 'animal', 'comida', 'cidade', 'objeto', 'filme_serie')),
  target_user_id uuid not null references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  voting_ends_at timestamptz not null,
  resolved boolean not null default false,
  invalid boolean not null default false
);
alter table stop_contests enable row level security;
drop policy if exists "stop_contests: room sees" on stop_contests;
create policy "stop_contests: room sees" on stop_contests
  for select using (exists (
    select 1 from stop_matches m join game_rooms r on r.id = m.room_id
    where m.id = match_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  ));
create unique index if not exists stop_contests_active_idx on stop_contests (match_id, round_number, category, target_user_id) where resolved = false;

create table if not exists stop_contest_ballots (
  id uuid primary key default gen_random_uuid(),
  contest_id uuid not null references stop_contests(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  vote boolean not null,
  created_at timestamptz not null default now(),
  unique (contest_id, user_id)
);
alter table stop_contest_ballots enable row level security;
drop policy if exists "stop_contest_ballots: room sees" on stop_contest_ballots;
create policy "stop_contest_ballots: room sees" on stop_contest_ballots
  for select using (exists (
    select 1 from stop_contests c
    join stop_matches m on m.id = c.match_id
    join game_rooms r on r.id = m.room_id
    where c.id = contest_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  ));

-- propõe contestar uma resposta: já conta como o primeiro voto (a favor de invalidar) de quem
-- propôs. Só dá pra contestar a rodada atual, já em fase de resultado.
create or replace function propose_stop_contest(p_match_id uuid, p_round_number int, p_category text, p_target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  m stop_matches%rowtype;
  has_access boolean;
  cid uuid;
begin
  select * into m from stop_matches where id = p_match_id;
  has_access := found and exists (
    select 1 from game_rooms r where r.id = m.room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access then raise exception 'partida não encontrada'; end if;
  if p_target_user_id = auth.uid() then
    raise exception 'nao_pode_contestar_a_propria_resposta';
  end if;
  if m.round_number <> p_round_number or m.phase <> 'results' then
    raise exception 'só dá pra contestar a rodada atual, depois que ela fechar';
  end if;
  if not exists (select 1 from stop_answers where match_id = p_match_id and round_number = p_round_number and user_id = p_target_user_id and category = p_category) then
    raise exception 'resposta não encontrada';
  end if;
  if exists (select 1 from stop_contests where match_id = p_match_id and round_number = p_round_number and category = p_category and target_user_id = p_target_user_id and resolved = false) then
    raise exception 'ja_tem_contestacao_ativa';
  end if;

  insert into stop_contests (match_id, round_number, category, target_user_id, created_by, voting_ends_at)
    values (p_match_id, p_round_number, p_category, p_target_user_id, auth.uid(), now() + interval '10 seconds')
    returning id into cid;
  insert into stop_contest_ballots (contest_id, user_id, vote) values (cid, auth.uid(), true);
  return cid;
end;
$$;
revoke all on function propose_stop_contest(uuid, int, text, uuid) from public;
grant execute on function propose_stop_contest(uuid, int, text, uuid) to authenticated;

-- vota se a resposta é inválida; maioria dos elegíveis (todo mundo na sala menos quem
-- respondeu) resolve na hora e já marca a resposta como invalidada
create or replace function cast_stop_contest_ballot(p_contest_id uuid, p_vote boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  c stop_contests%rowtype;
  has_access boolean;
  eligible int;
  yes_count int;
begin
  select * into c from stop_contests where id = p_contest_id for update;
  has_access := found and exists (
    select 1 from stop_matches m join game_rooms r on r.id = m.room_id
    where m.id = c.match_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access then raise exception 'contestação não encontrada'; end if;
  if c.resolved then
    return json_build_object('resolved', true, 'invalid', c.invalid);
  end if;
  if auth.uid() = c.target_user_id then
    raise exception 'nao_pode_votar_na_propria_resposta';
  end if;

  insert into stop_contest_ballots (contest_id, user_id, vote) values (p_contest_id, auth.uid(), p_vote)
    on conflict (contest_id, user_id) do update set vote = excluded.vote;

  select count(*) into eligible from game_room_players grp
    join stop_matches m on m.room_id = grp.room_id
    where m.id = c.match_id and grp.left_at is null and grp.user_id <> c.target_user_id;
  select count(*) into yes_count from stop_contest_ballots where contest_id = p_contest_id and vote = true;

  if eligible > 0 and yes_count > eligible / 2.0 then
    update stop_contests set resolved = true, invalid = true where id = p_contest_id;
    update stop_answers set invalidated = true
      where match_id = c.match_id and round_number = c.round_number and user_id = c.target_user_id and category = c.category;
    return json_build_object('resolved', true, 'invalid', true, 'yes', yes_count, 'eligible', eligible);
  end if;
  return json_build_object('resolved', false, 'yes', yes_count, 'eligible', eligible);
end;
$$;
revoke all on function cast_stop_contest_ballot(uuid, boolean) from public;
grant execute on function cast_stop_contest_ballot(uuid, boolean) to authenticated;

-- fecha a votação quando o prazo vence sem maioria — idempotente, revalida o horário no
-- servidor (nunca confia no relógio de quem chamou), mesmo padrão do finish_round
create or replace function finish_stop_contest(p_contest_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c stop_contests%rowtype;
  has_access boolean;
  eligible int;
  yes_count int;
begin
  select * into c from stop_contests where id = p_contest_id for update;
  has_access := found and exists (
    select 1 from stop_matches m join game_rooms r on r.id = m.room_id
    where m.id = c.match_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access or c.resolved or now() < c.voting_ends_at then return; end if;

  select count(*) into eligible from game_room_players grp
    join stop_matches m on m.room_id = grp.room_id
    where m.id = c.match_id and grp.left_at is null and grp.user_id <> c.target_user_id;
  select count(*) into yes_count from stop_contest_ballots where contest_id = p_contest_id and vote = true;

  if eligible > 0 and yes_count > eligible / 2.0 then
    update stop_contests set resolved = true, invalid = true where id = p_contest_id;
    update stop_answers set invalidated = true
      where match_id = c.match_id and round_number = c.round_number and user_id = c.target_user_id and category = c.category;
  else
    update stop_contests set resolved = true, invalid = false where id = p_contest_id;
  end if;
end;
$$;
revoke all on function finish_stop_contest(uuid) from public;
grant execute on function finish_stop_contest(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'stop_contests') then
    alter publication supabase_realtime add table stop_contests;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'stop_contest_ballots') then
    alter publication supabase_realtime add table stop_contest_ballots;
  end if;
end;
$$;
