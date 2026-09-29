-- Cartas: alinha com as regras oficiais do Uno em 2 pontos que estavam diferentes.
-- (1) Curinga+4 só pode ser jogado se a pessoa não tiver nenhuma carta da cor ativa na mão —
-- antes podia jogar a qualquer momento. (2) "Chamar UNO" com 1 carta na mão + "flagrar" quem
-- não chamou (penalidade de 2 cartas) — regra que não existia. É seguro rodar mais de uma vez.

alter table card_match_players add column if not exists uno_called boolean not null default false;

create or replace function play_card(p_match_id uuid, p_card_index int, p_chosen_color text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  m card_matches%rowtype;
  has_access boolean;
  my_cards jsonb;
  card jsonb;
  card_count int;
  legal boolean;
  new_color text;
  new_direction int;
  my_seat int;
  n int;
  next_seat int;
  next_user uuid;
  effect_target_seat int;
  effect_amount int;
  just_won boolean;
begin
  select * into m from card_matches where id = p_match_id for update;
  has_access := found and exists (
    select 1 from game_rooms r where r.id = m.room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access then raise exception 'partida não encontrada'; end if;
  if m.status <> 'playing' then raise exception 'partida já terminou'; end if;
  if m.current_turn_user_id <> auth.uid() then raise exception 'não é sua vez'; end if;

  select cards into my_cards from card_hands where match_id = p_match_id and user_id = auth.uid();
  card_count := coalesce(jsonb_array_length(my_cards), 0);
  if p_card_index < 0 or p_card_index >= card_count then
    raise exception 'carta inválida';
  end if;
  card := my_cards -> p_card_index;

  legal := (card->>'kind') in ('wild', 'wild4')
    or (card->>'color') = m.active_color
    or ((card->>'kind') = 'number' and (m.discard_top->>'kind') = 'number' and (card->>'value') = (m.discard_top->>'value'))
    or ((card->>'kind') <> 'number' and (card->>'kind') = (m.discard_top->>'kind'));
  if not legal then
    raise exception 'essa carta não pode ser jogada agora';
  end if;
  if (card->>'kind') in ('wild', 'wild4') then
    if p_chosen_color is null or p_chosen_color not in ('vermelho', 'amarelo', 'verde', 'azul') then
      raise exception 'escolhe uma cor pro curinga';
    end if;
  end if;
  -- regra oficial do Uno: curinga+4 só é jogável se não tiver carta da cor ativa na mão
  -- (nunca dá falso-positivo contra a própria carta jogada, porque curinga não tem cor)
  if (card->>'kind') = 'wild4' and exists (
    select 1 from jsonb_array_elements(my_cards) as c where c->>'color' = m.active_color
  ) then
    raise exception 'só pode jogar curinga+4 se não tiver carta da cor atual na mão';
  end if;

  update card_hands set cards = (my_cards - p_card_index) where match_id = p_match_id and user_id = auth.uid();
  update card_match_players set hand_count = card_count - 1, uno_called = false where match_id = p_match_id and user_id = auth.uid();
  update card_decks set discard_pile = discard_pile || m.discard_top where match_id = p_match_id;

  select seat_order into my_seat from card_match_players where match_id = p_match_id and user_id = auth.uid();
  select count(*) into n from card_match_players where match_id = p_match_id;

  new_color := coalesce(nullif(p_chosen_color, ''), card->>'color');
  new_direction := m.direction;
  effect_target_seat := null;
  effect_amount := null;

  if card->>'kind' = 'skip' then
    next_seat := next_active_seat(p_match_id, my_seat, m.direction, 2);
  elsif card->>'kind' = 'reverse' then
    if n = 2 then
      next_seat := next_active_seat(p_match_id, my_seat, m.direction, 2);
    else
      new_direction := -m.direction;
      next_seat := next_active_seat(p_match_id, my_seat, new_direction, 1);
    end if;
  elsif card->>'kind' = 'draw2' then
    effect_target_seat := next_active_seat(p_match_id, my_seat, m.direction, 1);
    effect_amount := 2;
    next_seat := next_active_seat(p_match_id, my_seat, m.direction, 2);
  elsif card->>'kind' = 'wild4' then
    effect_target_seat := next_active_seat(p_match_id, my_seat, m.direction, 1);
    effect_amount := 4;
    next_seat := next_active_seat(p_match_id, my_seat, m.direction, 2);
  else
    next_seat := next_active_seat(p_match_id, my_seat, m.direction, 1);
  end if;

  select user_id into next_user from card_match_players where match_id = p_match_id and seat_order = next_seat;

  if effect_target_seat is not null then
    perform apply_forced_draw(p_match_id, effect_target_seat, effect_amount);
  end if;

  just_won := (card_count - 1 = 0);

  update card_matches set
    direction = new_direction,
    active_color = new_color,
    discard_top = card,
    draw_pile_count = (select jsonb_array_length(draw_pile) from card_decks where match_id = p_match_id),
    current_turn_user_id = next_user,
    has_drawn_this_turn = false,
    last_move = jsonb_build_object('user_id', auth.uid(), 'action', 'play', 'card', card),
    status = case when just_won then 'finished' else 'playing' end,
    winner_user_id = case when just_won then auth.uid() else null end,
    finished_at = case when just_won then now() else null end
  where id = p_match_id;

  return json_build_object('ok', true, 'winner', case when just_won then auth.uid() else null end);
end;
$$;
revoke all on function play_card(uuid, int, text) from public;
grant execute on function play_card(uuid, int, text) to authenticated;

-- reset de uno_called também ao comprar por escolha própria (não é estritamente necessário —
-- só importa quando hand_count = 1 — mas evita flag velha sobrando)
create or replace function draw_card(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  m card_matches%rowtype;
  has_access boolean;
  drawn jsonb;
begin
  select * into m from card_matches where id = p_match_id for update;
  has_access := found and exists (
    select 1 from game_rooms r where r.id = m.room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access then raise exception 'partida não encontrada'; end if;
  if m.status <> 'playing' then raise exception 'partida já terminou'; end if;
  if m.current_turn_user_id <> auth.uid() then raise exception 'não é sua vez'; end if;
  if m.has_drawn_this_turn then raise exception 'já comprou essa rodada'; end if;

  select draw_n_cards(p_match_id, 1) into drawn;
  update card_hands set cards = cards || drawn where match_id = p_match_id and user_id = auth.uid();
  update card_match_players set hand_count = hand_count + 1, uno_called = false where match_id = p_match_id and user_id = auth.uid();
  update card_matches set has_drawn_this_turn = true,
    last_move = jsonb_build_object('user_id', auth.uid(), 'action', 'draw')
  where id = p_match_id;

  return json_build_object('card', drawn -> 0);
end;
$$;
revoke all on function draw_card(uuid) from public;
grant execute on function draw_card(uuid) to authenticated;

create or replace function apply_forced_draw(p_match_id uuid, p_seat int, p_amount int)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user uuid;
  drawn jsonb;
begin
  select user_id into target_user from card_match_players where match_id = p_match_id and seat_order = p_seat;
  select draw_n_cards(p_match_id, p_amount) into drawn;
  update card_hands set cards = cards || drawn where match_id = p_match_id and user_id = target_user;
  update card_match_players set hand_count = hand_count + p_amount, uno_called = false where match_id = p_match_id and user_id = target_user;
end;
$$;
revoke all on function apply_forced_draw(uuid, int, int) from public;

-- chama "UNO": só dá pra chamar com exatamente 1 carta na mão
create or replace function call_uno(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m card_matches%rowtype;
  has_access boolean;
  my_count int;
begin
  select * into m from card_matches where id = p_match_id;
  has_access := found and exists (
    select 1 from game_rooms r where r.id = m.room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access then raise exception 'partida não encontrada'; end if;
  if m.status <> 'playing' then raise exception 'partida já terminou'; end if;

  select hand_count into my_count from card_match_players where match_id = p_match_id and user_id = auth.uid();
  if my_count is distinct from 1 then
    raise exception 'só dá pra chamar uno com exatamente 1 carta na mão';
  end if;

  update card_match_players set uno_called = true where match_id = p_match_id and user_id = auth.uid();
end;
$$;
revoke all on function call_uno(uuid) from public;
grant execute on function call_uno(uuid) to authenticated;

-- flagra quem ficou com 1 carta e não chamou "uno" — penalidade de 2 cartas. Sem efeito (sem
-- punir ninguém à toa) se o alvo já chamou ou não está mais com 1 carta.
create or replace function catch_uno(p_match_id uuid, p_target_user_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  m card_matches%rowtype;
  has_access boolean;
  target_hand_count int;
  target_uno_called boolean;
  target_seat int;
begin
  select * into m from card_matches where id = p_match_id for update;
  has_access := found and exists (
    select 1 from game_rooms r where r.id = m.room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access then raise exception 'partida não encontrada'; end if;
  if m.status <> 'playing' then raise exception 'partida já terminou'; end if;
  if p_target_user_id = auth.uid() then raise exception 'não dá pra flagrar a si mesmo'; end if;

  select hand_count, uno_called, seat_order into target_hand_count, target_uno_called, target_seat
    from card_match_players where match_id = p_match_id and user_id = p_target_user_id;
  if not found then raise exception 'jogador não encontrado'; end if;

  if target_hand_count = 1 and not target_uno_called then
    perform apply_forced_draw(p_match_id, target_seat, 2);
    update card_match_players set uno_called = true where match_id = p_match_id and user_id = p_target_user_id;
    update card_matches set last_move = jsonb_build_object('user_id', p_target_user_id, 'action', 'uno_caught', 'by', auth.uid()) where id = p_match_id;
    return json_build_object('caught', true);
  end if;
  return json_build_object('caught', false);
end;
$$;
revoke all on function catch_uno(uuid, uuid) from public;
grant execute on function catch_uno(uuid, uuid) to authenticated;
