-- Libera Cartas/STOP também pro Casal (antes era só Turma). Sala pode pertencer a uma
-- turma OU a um casal, nunca os dois. Seguro rodar mais de uma vez.

alter table game_rooms alter column friend_group_id drop not null;
alter table game_rooms add column if not exists couple_id uuid references couples(id) on delete cascade;

alter table game_rooms drop constraint if exists game_rooms_owner_check;
alter table game_rooms add constraint game_rooms_owner_check
  check ((friend_group_id is not null and couple_id is null) or (friend_group_id is null and couple_id is not null));

create index if not exists game_rooms_couple_idx on game_rooms (couple_id, status);

drop policy if exists "game_rooms: group sees" on game_rooms;
create policy "game_rooms: owner sees" on game_rooms
  for select using (
    (friend_group_id is not null and friend_group_id = any(my_friend_group_ids()))
    or (couple_id is not null and couple_id = my_couple_id())
  );

drop policy if exists "game_room_players: group sees" on game_room_players;
create policy "game_room_players: owner sees" on game_room_players
  for select using (exists (
    select 1 from game_rooms r where r.id = room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  ));

create or replace function create_game_room(p_friend_group_id uuid, p_game_type text, p_settings jsonb default '{}'::jsonb, p_couple_id uuid default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  rid uuid;
  v_code text;
begin
  if p_friend_group_id is null and p_couple_id is null then
    raise exception 'precisa de uma turma ou um casal pra criar a sala';
  end if;
  if p_friend_group_id is not null and p_couple_id is not null then
    raise exception 'a sala é de uma turma OU de um casal, não dos dois';
  end if;
  if p_friend_group_id is not null and not (p_friend_group_id = any(my_friend_group_ids())) then
    raise exception 'sem acesso a essa turma';
  end if;
  if p_couple_id is not null and p_couple_id <> my_couple_id() then
    raise exception 'sem acesso a esse casal';
  end if;
  if p_game_type not in ('cartas', 'stop') then
    raise exception 'tipo de jogo inválido';
  end if;
  v_code := generate_room_code();
  insert into game_rooms (code, friend_group_id, couple_id, game_type, host_user_id, settings)
    values (v_code, p_friend_group_id, p_couple_id, p_game_type, auth.uid(), coalesce(p_settings, '{}'::jsonb))
    returning id into rid;
  insert into game_room_players (room_id, user_id, ready) values (rid, auth.uid(), true);
  return json_build_object('id', rid, 'code', v_code);
end;
$$;
revoke all on function create_game_room(uuid, text, jsonb, uuid) from public;
grant execute on function create_game_room(uuid, text, jsonb, uuid) to authenticated;

create or replace function join_game_room(p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  r game_rooms%rowtype;
  n_players int;
  has_access boolean;
begin
  select * into r from game_rooms where code = upper(trim(p_code));
  if not found then
    return json_build_object('error', 'sala_nao_encontrada');
  end if;

  has_access := (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
    or (r.couple_id is not null and r.couple_id = my_couple_id());
  if not has_access then
    return json_build_object('error', 'sala_nao_encontrada'); -- não revela que existe pra quem não tem acesso
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
  has_access boolean;
begin
  select * into r from game_rooms where id = p_room_id;
  has_access := found and (
    (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
    or (r.couple_id is not null and r.couple_id = my_couple_id())
  );
  if not has_access then
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

create or replace function leave_game_room(p_room_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  r game_rooms%rowtype;
  new_host uuid;
  has_access boolean;
begin
  select * into r from game_rooms where id = p_room_id;
  has_access := found and (
    (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
    or (r.couple_id is not null and r.couple_id = my_couple_id())
  );
  if not has_access then
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
