-- Minigames multiplayer — Fase 2: motor de regras do jogo de Cartas (baralho de descarte por
-- cor, inspirado em Uno mas sem nome/logo/verso da Mattel — ícones e visual próprios). A partida
-- roda inteira aqui dentro (validação server-side, RPCs security definer); o cliente nunca
-- escreve resultado direto. Privacidade da mão: cada jogador só lê a própria (RLS por linha),
-- o monte de compra não é lido por ninguém além das RPCs. É seguro rodar mais de uma vez.

create table if not exists card_matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references game_rooms(id) on delete cascade,
  status text not null default 'playing' check (status in ('playing', 'finished')),
  direction smallint not null default 1 check (direction in (1, -1)),
  current_turn_user_id uuid not null references auth.users(id),
  active_color text check (active_color in ('vermelho', 'amarelo', 'verde', 'azul')),
  discard_top jsonb not null default '{}'::jsonb,
  draw_pile_count int not null default 0,
  has_drawn_this_turn boolean not null default false,
  last_move jsonb,
  winner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table card_matches enable row level security;
drop policy if exists "card_matches: room sees" on card_matches;
create policy "card_matches: room sees" on card_matches
  for select using (exists (
    select 1 from game_rooms r where r.id = room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  ));
create unique index if not exists card_matches_room_active_idx on card_matches (room_id) where status = 'playing';

-- estado público por jogador (contagem de cartas, nunca as cartas em si)
create table if not exists card_match_players (
  match_id uuid not null references card_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  seat_order int not null,
  hand_count int not null default 0,
  primary key (match_id, user_id)
);
alter table card_match_players enable row level security;
drop policy if exists "card_match_players: room sees" on card_match_players;
create policy "card_match_players: room sees" on card_match_players
  for select using (exists (
    select 1 from card_matches m join game_rooms r on r.id = m.room_id
    where m.id = match_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  ));

-- a mão de verdade: só o dono lê a própria linha (RLS por linha, não por coluna)
create table if not exists card_hands (
  match_id uuid not null references card_matches(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  cards jsonb not null default '[]'::jsonb,
  primary key (match_id, user_id)
);
alter table card_hands enable row level security;
drop policy if exists "card_hands: só o dono vê" on card_hands;
create policy "card_hands: só o dono vê" on card_hands
  for select using (user_id = auth.uid());

-- monte de compra e descarte "morto" (tudo que já foi jogado, menos o topo visível em
-- card_matches.discard_top) — ninguém lê isso pelo cliente, nem o dono da partida, só as RPCs
create table if not exists card_decks (
  match_id uuid primary key references card_matches(id) on delete cascade,
  draw_pile jsonb not null default '[]'::jsonb,
  discard_pile jsonb not null default '[]'::jsonb
);
alter table card_decks enable row level security;

-- baralho completo: 0-9 em 4 cores (um 0 + dois de cada 1-9), bloqueio/inversão/+2 (2 de cada
-- cor), curinga/curinga+4 (4 de cada) = 108 cartas
create or replace function build_card_deck()
returns jsonb
language sql
immutable
as $$
  select jsonb_agg(card) from (
    select jsonb_build_object('kind', 'number', 'color', color, 'value', value) as card
    from unnest(array['vermelho', 'amarelo', 'verde', 'azul']) as color,
         unnest(array[0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9]) as value
    union all
    select jsonb_build_object('kind', kind, 'color', color)
    from unnest(array['vermelho', 'amarelo', 'verde', 'azul']) as color,
         unnest(array['skip', 'skip', 'reverse', 'reverse', 'draw2', 'draw2']) as kind
    union all
    select jsonb_build_object('kind', kind)
    from unnest(array['wild', 'wild', 'wild', 'wild', 'wild4', 'wild4', 'wild4', 'wild4']) as kind
  ) t;
$$;
revoke all on function build_card_deck() from public;

-- acha o próximo assento "ativo" (jogador ainda na sala, left_at nulo), andando p_steps
-- assentos ativos em p_direction a partir de p_from_seat — pula quem já saiu automaticamente
create or replace function next_active_seat(p_match_id uuid, p_from_seat int, p_direction int, p_steps int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
  room uuid;
  cur int := p_from_seat;
  moved int := 0;
  guard int := 0;
begin
  select room_id into room from card_matches where id = p_match_id;
  select count(*) into n from card_match_players where match_id = p_match_id;
  if n = 0 then raise exception 'sem jogadores na partida'; end if;
  while moved < p_steps loop
    cur := ((cur + p_direction) % n + n) % n;
    guard := guard + 1;
    if guard > n * 4 then raise exception 'ninguém ativo pra jogar (todo mundo saiu da sala)'; end if;
    if exists (
      select 1 from card_match_players cmp
      join game_room_players grp on grp.room_id = room and grp.user_id = cmp.user_id
      where cmp.match_id = p_match_id and cmp.seat_order = cur and grp.left_at is null
    ) then
      moved := moved + 1;
    end if;
  end loop;
  return cur;
end;
$$;
revoke all on function next_active_seat(uuid, int, int, int) from public;

-- puxa p_amount cartas do monte de compra (reembaralhando o descarte morto se faltar); devolve
-- as cartas puxadas e já atualiza card_decks + card_matches.draw_pile_count
create or replace function draw_n_cards(p_match_id uuid, p_amount int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  pile jsonb;
  discard jsonb;
  reshuffled jsonb;
  avail int;
  drawn jsonb;
begin
  select draw_pile, discard_pile into pile, discard from card_decks where match_id = p_match_id for update;
  avail := jsonb_array_length(pile);
  if avail < p_amount and jsonb_array_length(discard) > 0 then
    select jsonb_agg(c order by random()) into reshuffled from jsonb_array_elements(discard) as c;
    pile := pile || reshuffled;
    discard := '[]'::jsonb;
  end if;
  avail := jsonb_array_length(pile);
  if avail = 0 then
    update card_decks set draw_pile = pile, discard_pile = discard where match_id = p_match_id;
    return '[]'::jsonb;
  end if;
  select coalesce(jsonb_agg(c), '[]'::jsonb) into drawn
    from jsonb_array_elements(pile) with ordinality as t(c, i) where i <= least(p_amount, avail);
  select coalesce(jsonb_agg(c), '[]'::jsonb) into pile
    from jsonb_array_elements(pile) with ordinality as t(c, i) where i > least(p_amount, avail);
  update card_decks set draw_pile = pile, discard_pile = discard where match_id = p_match_id;
  update card_matches set draw_pile_count = jsonb_array_length(pile) where id = p_match_id;
  return drawn;
end;
$$;
revoke all on function draw_n_cards(uuid, int) from public;

-- aplica compra forçada (+2/+4) em quem está no assento-alvo
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
  update card_match_players set hand_count = hand_count + p_amount where match_id = p_match_id and user_id = target_user;
end;
$$;
revoke all on function apply_forced_draw(uuid, int, int) from public;

-- começa (ou, se já tem uma em andamento pra essa sala, devolve) a partida de Cartas —
-- idempotente de propósito: reconectar ou revanche caem na mesma chamada
create or replace function start_card_match(p_room_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  r game_rooms%rowtype;
  has_access boolean;
  existing_id uuid;
  mid uuid := gen_random_uuid();
  n int;
  hand_size int := 7;
  dealt int;
  discard_pos int;
  discard_top jsonb;
  first_user uuid;
begin
  select * into r from game_rooms where id = p_room_id;
  has_access := found and (
    (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
    or (r.couple_id is not null and r.couple_id = my_couple_id())
  );
  if not has_access then
    raise exception 'sala não encontrada';
  end if;
  if r.game_type <> 'cartas' then
    raise exception 'essa sala não é de cartas';
  end if;

  select id into existing_id from card_matches where room_id = p_room_id and status = 'playing';
  if existing_id is not null then
    return json_build_object('match_id', existing_id);
  end if;

  select count(*) into n from game_room_players where room_id = p_room_id and left_at is null;
  if n < 2 then
    raise exception 'precisa de pelo menos 2 jogadores pra começar';
  end if;

  create temporary table tmp_seats on commit drop as
    select user_id, (row_number() over (order by joined_at))::int - 1 as seat_order
    from game_room_players where room_id = p_room_id and left_at is null;

  create temporary table tmp_deck on commit drop as
    select c as card, (row_number() over ())::int as pos
    from (select c from jsonb_array_elements(build_card_deck()) as c order by random()) t(c);

  dealt := n * hand_size;
  select user_id into first_user from tmp_seats where seat_order = 0;

  select pos into discard_pos from tmp_deck
    where pos > dealt and card->>'kind' = 'number' order by pos limit 1;
  if discard_pos is null then
    raise exception 'baralho sem carta número disponível pra abrir (não deveria acontecer)';
  end if;
  select card into discard_top from tmp_deck where pos = discard_pos;

  insert into card_matches (id, room_id, status, direction, current_turn_user_id, active_color, discard_top, draw_pile_count, has_drawn_this_turn)
    values (mid, p_room_id, 'playing', 1, first_user, discard_top->>'color', discard_top, 108 - dealt - 1, false);

  insert into card_match_players (match_id, user_id, seat_order, hand_count)
  select mid, user_id, seat_order, hand_size from tmp_seats;

  insert into card_hands (match_id, user_id, cards)
  select mid, s.user_id, coalesce(jsonb_agg(d.card order by d.pos), '[]'::jsonb)
  from tmp_seats s
  join tmp_deck d on d.pos > s.seat_order * hand_size and d.pos <= (s.seat_order + 1) * hand_size
  group by s.user_id;

  insert into card_decks (match_id, draw_pile, discard_pile)
  select mid,
    coalesce((select jsonb_agg(d.card order by d.pos) from tmp_deck d where d.pos > dealt and d.pos <> discard_pos), '[]'::jsonb),
    '[]'::jsonb;

  return json_build_object('match_id', mid);
end;
$$;
revoke all on function start_card_match(uuid) from public;
grant execute on function start_card_match(uuid) to authenticated;

-- joga uma carta da própria mão (índice 0-based); p_chosen_color obrigatório pra curinga/curinga+4
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

  update card_hands set cards = (my_cards - p_card_index) where match_id = p_match_id and user_id = auth.uid();
  update card_match_players set hand_count = card_count - 1 where match_id = p_match_id and user_id = auth.uid();
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

-- compra 1 carta (chamado quando não tem jogada, ou por escolha) — no máx. 1 compra por turno
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
  update card_match_players set hand_count = hand_count + 1 where match_id = p_match_id and user_id = auth.uid();
  update card_matches set has_drawn_this_turn = true,
    last_move = jsonb_build_object('user_id', auth.uid(), 'action', 'draw')
  where id = p_match_id;

  return json_build_object('card', drawn -> 0);
end;
$$;
revoke all on function draw_card(uuid) from public;
grant execute on function draw_card(uuid) to authenticated;

-- passa a vez depois de comprar (só permitido depois de já ter comprado nesse turno)
create or replace function pass_turn(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m card_matches%rowtype;
  has_access boolean;
  my_seat int;
  next_seat int;
  next_user uuid;
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
  if not m.has_drawn_this_turn then raise exception 'precisa comprar antes de passar'; end if;

  select seat_order into my_seat from card_match_players where match_id = p_match_id and user_id = auth.uid();
  next_seat := next_active_seat(p_match_id, my_seat, m.direction, 1);
  select user_id into next_user from card_match_players where match_id = p_match_id and seat_order = next_seat;

  update card_matches set current_turn_user_id = next_user, has_drawn_this_turn = false,
    last_move = jsonb_build_object('user_id', auth.uid(), 'action', 'pass')
  where id = p_match_id;
end;
$$;
revoke all on function pass_turn(uuid) from public;
grant execute on function pass_turn(uuid) to authenticated;

-- chamado pelo cliente quando percebe (via tempo real) que alguém saiu da sala: se era a vez de
-- quem saiu, passa pro próximo ativo automaticamente; se só sobrou 1 jogador, ele vence por W.O.
create or replace function skip_departed_turn(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m card_matches%rowtype;
  has_access boolean;
  turn_left boolean;
  active_count int;
  sole_survivor uuid;
  my_seat int;
  next_seat int;
  next_user uuid;
begin
  select * into m from card_matches where id = p_match_id for update;
  has_access := found and exists (
    select 1 from game_rooms r where r.id = m.room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access or m.status <> 'playing' then return; end if;

  select (grp.left_at is not null) into turn_left
  from card_match_players cmp join game_room_players grp on grp.room_id = m.room_id and grp.user_id = cmp.user_id
  where cmp.match_id = p_match_id and cmp.user_id = m.current_turn_user_id;
  if not coalesce(turn_left, true) then
    return;
  end if;

  select count(*), (array_agg(cmp.user_id))[1] into active_count, sole_survivor
  from card_match_players cmp join game_room_players grp on grp.room_id = m.room_id and grp.user_id = cmp.user_id
  where cmp.match_id = p_match_id and grp.left_at is null;

  if active_count = 0 then
    update card_matches set status = 'finished', finished_at = now() where id = p_match_id;
    return;
  end if;
  if active_count = 1 then
    update card_matches set status = 'finished', winner_user_id = sole_survivor, finished_at = now() where id = p_match_id;
    return;
  end if;

  select seat_order into my_seat from card_match_players where match_id = p_match_id and user_id = m.current_turn_user_id;
  next_seat := next_active_seat(p_match_id, my_seat, m.direction, 1);
  select user_id into next_user from card_match_players where match_id = p_match_id and seat_order = next_seat;

  update card_matches set current_turn_user_id = next_user, has_drawn_this_turn = false,
    last_move = jsonb_build_object('action', 'auto_pass')
  where id = p_match_id;
end;
$$;
revoke all on function skip_departed_turn(uuid) from public;
grant execute on function skip_departed_turn(uuid) to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'card_matches') then
    alter publication supabase_realtime add table card_matches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'card_match_players') then
    alter publication supabase_realtime add table card_match_players;
  end if;
end;
$$;
