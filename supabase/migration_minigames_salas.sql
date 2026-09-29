-- Minigames multiplayer (Cartas estilo Uno + Stop/Adedonha) — Fase 1: sistema de salas.
-- Só o esqueleto (criar sala, entrar por código, lobby, pronto, host, sair) — nenhum motor
-- de jogo ainda. Sala vive dentro de uma turma existente (reaproveita 100% da confiança que
-- a turma já estabelece, sem inventar convite pra estranho).
-- É seguro rodar mais de uma vez.

create table if not exists game_rooms (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  game_type text not null check (game_type in ('cartas', 'stop')),
  status text not null default 'waiting' check (status in ('waiting', 'starting', 'playing', 'round_results', 'between_rounds', 'finished', 'rematch_waiting', 'closed')),
  host_user_id uuid not null references auth.users(id),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table game_rooms enable row level security;
drop policy if exists "game_rooms: group sees" on game_rooms;
create policy "game_rooms: group sees" on game_rooms
  for select using (friend_group_id = any(my_friend_group_ids()));

create table if not exists game_room_players (
  room_id uuid not null references game_rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  ready boolean not null default false,
  score int not null default 0,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (room_id, user_id)
);
alter table game_room_players enable row level security;
drop policy if exists "game_room_players: group sees" on game_room_players;
create policy "game_room_players: group sees" on game_room_players
  for select using (exists (select 1 from game_rooms r where r.id = room_id and r.friend_group_id = any(my_friend_group_ids())));

create index if not exists game_rooms_friend_group_idx on game_rooms (friend_group_id, status);
create index if not exists game_room_players_user_idx on game_room_players (user_id, left_at);

-- código curto e fácil de compartilhar, tipo A7K9Q — mesmo estilo do código de turma, sem
-- caracteres confusos (sem 0/O/1/I)
create or replace function generate_room_code()
returns text
language plpgsql
as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_code text;
begin
  loop
    v_code := '';
    for i in 1..5 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from game_rooms where game_rooms.code = v_code);
  end loop;
  return v_code;
end;
$$;

create or replace function create_game_room(p_friend_group_id uuid, p_game_type text, p_settings jsonb default '{}'::jsonb)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  rcode text;
begin
  if not (p_friend_group_id = any(my_friend_group_ids())) then
    raise exception 'sem acesso a essa turma';
  end if;
  if p_game_type not in ('cartas', 'stop') then
    raise exception 'tipo de jogo inválido';
  end if;
  rcode := generate_room_code();
  insert into game_rooms (code, friend_group_id, game_type, host_user_id, settings)
    values (rcode, p_friend_group_id, p_game_type, auth.uid(), coalesce(p_settings, '{}'::jsonb))
    returning id into rid;
  insert into game_room_players (room_id, user_id, ready) values (rid, auth.uid(), true);
  return json_build_object('id', rid, 'code', rcode);
end;
$$;
revoke all on function create_game_room(uuid, text, jsonb) from public;
grant execute on function create_game_room(uuid, text, jsonb) to authenticated;

create or replace function join_game_room(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  r game_rooms%rowtype;
  n_players int;
begin
  select * into r from game_rooms where code = upper(trim(p_code));
  if not found then
    return json_build_object('error', 'sala_nao_encontrada');
  end if;
  if not (r.friend_group_id = any(my_friend_group_ids())) then
    return json_build_object('error', 'sala_nao_encontrada'); -- não revela que existe pra quem não é da turma
  end if;
  if r.status not in ('waiting', 'starting') then
    return json_build_object('error', 'partida_ja_iniciada');
  end if;

  if exists (select 1 from game_room_players where room_id = r.id and user_id = auth.uid()) then
    update game_room_players set left_at = null where room_id = r.id and user_id = auth.uid();
    return json_build_object('id', r.id, 'code', r.code);
  end if;

  select count(*) into n_players from game_room_players where room_id = r.id and left_at is null;
  if n_players >= 8 then
    return json_build_object('error', 'sala_cheia');
  end if;

  insert into game_room_players (room_id, user_id) values (r.id, auth.uid());
  return json_build_object('id', r.id, 'code', r.code);
end;
$$;
revoke all on function join_game_room(text) from public;
grant execute on function join_game_room(text) to authenticated;

create or replace function set_player_ready(p_room_id uuid, p_ready boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update game_room_players set ready = p_ready
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if not found then
    raise exception 'você não está nessa sala';
  end if;
end;
$$;
revoke all on function set_player_ready(uuid, boolean) from public;
grant execute on function set_player_ready(uuid, boolean) to authenticated;

-- por enquanto só muda o status da sala pra "playing" (o motor de cada jogo entra numa
-- rodada futura) — já valida host, jogadores mínimos e todo mundo pronto
create or replace function start_match(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r game_rooms%rowtype;
  n_players int;
  n_ready int;
begin
  select * into r from game_rooms where id = p_room_id;
  if not found or not (r.friend_group_id = any(my_friend_group_ids())) then
    raise exception 'sala não encontrada';
  end if;
  if r.host_user_id <> auth.uid() then
    raise exception 'só o host pode iniciar a partida';
  end if;
  if r.status <> 'waiting' then
    raise exception 'partida já iniciada';
  end if;

  select count(*), count(*) filter (where ready) into n_players, n_ready
  from game_room_players where room_id = p_room_id and left_at is null;

  if n_players < 2 then
    raise exception 'precisa de pelo menos 2 jogadores';
  end if;
  if n_ready < n_players then
    raise exception 'nem todo mundo está pronto';
  end if;

  update game_rooms set status = 'playing' where id = p_room_id;
end;
$$;
revoke all on function start_match(uuid) from public;
grant execute on function start_match(uuid) to authenticated;

-- sair da sala; se era o host, passa a coroa pra quem está conectado (na sala) há mais tempo
create or replace function leave_game_room(p_room_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  r game_rooms%rowtype;
  new_host uuid;
begin
  select * into r from game_rooms where id = p_room_id;
  if not found or not (r.friend_group_id = any(my_friend_group_ids())) then
    raise exception 'sala não encontrada';
  end if;

  update game_room_players set left_at = now() where room_id = p_room_id and user_id = auth.uid();

  if r.host_user_id = auth.uid() then
    select user_id into new_host from game_room_players
    where room_id = p_room_id and left_at is null and user_id <> auth.uid()
    order by joined_at asc limit 1;

    if new_host is not null then
      update game_rooms set host_user_id = new_host where id = p_room_id;
    else
      update game_rooms set status = 'closed' where id = p_room_id;
    end if;
  end if;

  return json_build_object('new_host', new_host);
end;
$$;
revoke all on function leave_game_room(uuid) from public;
grant execute on function leave_game_room(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'game_rooms') then
    alter publication supabase_realtime add table game_rooms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'game_room_players') then
    alter publication supabase_realtime add table game_room_players;
  end if;
end;
$$;
