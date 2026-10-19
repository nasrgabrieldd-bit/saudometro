-- Stop: mais variação de letra entre partidas da mesma sala — antes cada partida sorteava a
-- letra olhando só pra ela mesma, então numa sequência de revanches (ex: aproveitando o placar
-- acumulado da sala) a mesma letra podia voltar a aparecer logo na partida seguinte. Agora o
-- sorteio evita repetir qualquer letra já usada em QUALQUER partida anterior da mesma sala, e
-- só reaproveita quando o alfabeto inteiro já foi usado. O campo used_letters de cada partida
-- continua guardando só as letras DAQUELA partida (o app usa isso pra saber qual letra
-- correspondeu a cada rodada) — a combinação com as outras partidas entra só na hora de
-- sortear, nunca é gravada ali. É seguro rodar mais de uma vez.

create or replace function start_stop_match(p_room_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  r game_rooms%rowtype;
  has_access boolean;
  existing_id uuid;
  mid uuid;
  letter text;
  chosen_categories text[];
  room_used text[];
begin
  select * into r from game_rooms where id = p_room_id;
  has_access := found and (
    (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
    or (r.couple_id is not null and r.couple_id = my_couple_id())
  );
  if not has_access then
    raise exception 'sala não encontrada';
  end if;
  if r.game_type <> 'stop' then
    raise exception 'essa sala não é de stop';
  end if;

  select id into existing_id from stop_matches where room_id = p_room_id and status = 'playing';
  if existing_id is not null then
    return json_build_object('match_id', existing_id);
  end if;

  if (select count(*) from game_room_players where room_id = p_room_id and left_at is null) < 2 then
    raise exception 'precisa de pelo menos 2 jogadores pra começar';
  end if;

  select array_agg(key) into chosen_categories from (
    select unnest(array['nome', 'animal', 'comida', 'cep', 'objeto', 'filme_serie', 'cor', 'pais', 'profissao', 'marca', 'fruta', 'apelido_vinculo']) as key
    order by random() limit 6
  ) s;

  select coalesce(array_agg(distinct letter), '{}') into room_used
    from stop_matches sm, unnest(sm.used_letters) as letter
    where sm.room_id = p_room_id;

  letter := pick_stop_letter(room_used);
  if letter is null then letter := pick_stop_letter('{}'::text[]); end if; -- alfabeto inteiro já usado nessa sala: reinicia

  insert into stop_matches (room_id, current_letter, used_letters, round_ends_at, categories)
    values (p_room_id, letter, array[letter], now() + interval '90 seconds', chosen_categories)
    returning id into mid;

  return json_build_object('match_id', mid);
end;
$$;
revoke all on function start_stop_match(uuid) from public;
grant execute on function start_stop_match(uuid) to authenticated;

create or replace function advance_stop_round(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  m stop_matches%rowtype;
  r game_rooms%rowtype;
  has_access boolean;
  letter text;
  room_used text[];
begin
  select * into m from stop_matches where id = p_match_id for update;
  if not found then raise exception 'partida não encontrada'; end if;
  select * into r from game_rooms where id = m.room_id;
  has_access := found and (
    (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
    or (r.couple_id is not null and r.couple_id = my_couple_id())
  );
  if not has_access then raise exception 'partida não encontrada'; end if;
  if r.host_user_id <> auth.uid() then
    raise exception 'só quem criou a sala pode avançar a rodada';
  end if;
  if m.status <> 'playing' or m.phase <> 'results' then
    raise exception 'ainda não terminou essa rodada';
  end if;

  if m.round_number >= m.total_rounds then
    update stop_matches set status = 'finished', finished_at = now() where id = p_match_id;
    return json_build_object('finished', true);
  end if;

  select coalesce(array_agg(distinct letter), '{}') into room_used
    from stop_matches sm, unnest(sm.used_letters) as letter
    where sm.room_id = m.room_id and sm.id <> m.id;

  letter := pick_stop_letter(m.used_letters || room_used);
  if letter is null then letter := pick_stop_letter(m.used_letters); end if; -- letras novas de outras partidas já esgotaram: só evita repetir dentro desta
  if letter is null then letter := pick_stop_letter('{}'::text[]); end if; -- esgotou tudo: reinicia geral

  update stop_matches set
    round_number = round_number + 1,
    phase = 'answering',
    current_letter = letter,
    used_letters = used_letters || letter,
    round_ends_at = now() + interval '90 seconds'
  where id = p_match_id;

  return json_build_object('finished', false);
end;
$$;
revoke all on function advance_stop_round(uuid) from public;
grant execute on function advance_stop_round(uuid) to authenticated;
