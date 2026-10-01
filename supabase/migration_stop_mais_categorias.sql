-- Stop: mais categorias clássicas (pool de 11, 6 sorteadas por partida), rodada picante opt-in
-- (só modo casal, última rodada), só o host avança a rodada, e moedas de participação/vitória
-- no final da partida (casal e turma). É seguro rodar mais de uma vez.

alter table stop_matches add column if not exists categories text[] not null default '{}';
alter table stop_matches add column if not exists coins_awarded boolean not null default false;

-- amplia a constraint de categoria: pool clássico (11) + pool picante (6, fixo, só rodada final
-- de sala de casal com o modo ligado)
alter table stop_answers drop constraint if exists stop_answers_category_check;
alter table stop_answers add constraint stop_answers_category_check check (category in (
  'nome', 'animal', 'comida', 'cidade', 'objeto', 'filme_serie', 'cor', 'pais', 'profissao', 'marca', 'fruta',
  'lugar_beijo', 'elogio_picante', 'apelido_safado', 'fantasia_leve', 'peca_intima', 'programa_noite'
));

-- começa a partida sorteando 6 categorias do pool clássico (fica fixo a partida toda, só a
-- letra muda a cada rodada) — mesma função de antes, só ganhou o sorteio de categorias
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
    select unnest(array['nome', 'animal', 'comida', 'cidade', 'objeto', 'filme_serie', 'cor', 'pais', 'profissao', 'marca', 'fruta']) as key
    order by random() limit 6
  ) s;

  letter := pick_stop_letter('{}'::text[]);
  insert into stop_matches (room_id, current_letter, used_letters, round_ends_at, categories)
    values (p_room_id, letter, array[letter], now() + interval '90 seconds', chosen_categories)
    returning id into mid;

  return json_build_object('match_id', mid);
end;
$$;
revoke all on function start_stop_match(uuid) from public;
grant execute on function start_stop_match(uuid) to authenticated;

-- grava as respostas da rodada: a chave de categoria precisa estar no pool certo pra rodada
-- atual (clássico sorteado da partida, ou picante na última rodada de sala de casal com o
-- modo ligado) — mesma regra usada no cliente pra decidir o que mostrar na tela
create or replace function submit_stop_answers(p_match_id uuid, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m stop_matches%rowtype;
  r game_rooms%rowtype;
  has_access boolean;
  is_spicy_round boolean;
  valid_keys text[];
  cat text;
begin
  select * into m from stop_matches where id = p_match_id for update;
  if not found then raise exception 'partida não encontrada'; end if;
  select * into r from game_rooms where id = m.room_id;
  has_access := found and (
    (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
    or (r.couple_id is not null and r.couple_id = my_couple_id())
  );
  if not has_access then raise exception 'partida não encontrada'; end if;
  if m.status <> 'playing' or m.phase <> 'answering' then
    raise exception 'não dá mais pra responder essa rodada';
  end if;

  is_spicy_round := coalesce((r.settings->>'spicy')::boolean, false)
    and r.couple_id is not null
    and m.round_number = m.total_rounds;
  valid_keys := case when is_spicy_round
    then array['lugar_beijo', 'elogio_picante', 'apelido_safado', 'fantasia_leve', 'peca_intima', 'programa_noite']
    else m.categories
  end;

  for cat in select jsonb_object_keys(p_answers) loop
    if cat = any(valid_keys) then
      insert into stop_answers (match_id, round_number, user_id, category, answer)
        values (p_match_id, m.round_number, auth.uid(), cat, coalesce(p_answers->>cat, ''))
      on conflict (match_id, round_number, user_id, category)
        do update set answer = excluded.answer, submitted_at = now();
    end if;
  end loop;
end;
$$;
revoke all on function submit_stop_answers(uuid, jsonb) from public;
grant execute on function submit_stop_answers(uuid, jsonb) to authenticated;

-- avança pra próxima rodada: agora só o host da sala pode chamar (antes era qualquer jogador —
-- mudou a pedido, pra evitar que alguém avance antes da hora)
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

  letter := pick_stop_letter(m.used_letters);
  if letter is null then
    -- 23 letras pra no máximo 5 rodadas: não deveria esgotar, mas por segurança reinicia o pool
    letter := pick_stop_letter('{}'::text[]);
  end if;

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

-- idempotente: só o primeiro cliente a chamar depois da partida terminar recebe awarded=true —
-- evita conceder moeda em dobro se os dois celulares abrirem a tela de fim ao mesmo tempo
create or replace function mark_stop_coins_awarded(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  m stop_matches%rowtype;
  has_access boolean;
  did_award boolean := false;
begin
  select * into m from stop_matches where id = p_match_id for update;
  if not found then raise exception 'partida não encontrada'; end if;
  has_access := exists (
    select 1 from game_rooms r where r.id = m.room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access then raise exception 'partida não encontrada'; end if;

  if m.status = 'finished' and not m.coins_awarded then
    update stop_matches set coins_awarded = true where id = p_match_id;
    did_award := true;
  end if;
  return json_build_object('awarded', did_award);
end;
$$;
revoke all on function mark_stop_coins_awarded(uuid) from public;
grant execute on function mark_stop_coins_awarded(uuid) to authenticated;
