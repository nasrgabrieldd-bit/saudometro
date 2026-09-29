-- Minigames multiplayer — Fase 3: motor de regras do Stop/Adedonha. Letra sorteada, 6
-- categorias, todo mundo responde contra o relógio, qualquer um aperta STOP pra fechar a rodada
-- na hora. Pontuação (única/repetida/inválida) é calculada no cliente, em cima de respostas já
-- travadas pela RPC — não precisa validação server-side de "quanto vale". Sem mecanismo de
-- contestar resposta por votação nessa rodada (lacuna conhecida, fica pra depois).
-- É seguro rodar mais de uma vez.

create table if not exists stop_matches (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references game_rooms(id) on delete cascade,
  status text not null default 'playing' check (status in ('playing', 'finished')),
  round_number int not null default 1,
  total_rounds int not null default 5,
  phase text not null default 'answering' check (phase in ('answering', 'results')),
  current_letter text not null check (char_length(current_letter) = 1),
  used_letters text[] not null default '{}',
  round_ends_at timestamptz not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table stop_matches enable row level security;
drop policy if exists "stop_matches: room sees" on stop_matches;
create policy "stop_matches: room sees" on stop_matches
  for select using (exists (
    select 1 from game_rooms r where r.id = room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  ));
create unique index if not exists stop_matches_room_active_idx on stop_matches (room_id) where status = 'playing';

-- resposta de cada um, por rodada e categoria. Visível pro dono sempre; pro resto da sala só
-- quando a rodada "vira passado" (a partida já avançou pra rodada seguinte, ou essa rodada
-- entrou em fase de resultado) — assim rodada antiga fica visível pra sempre (placar final),
-- sem reabrir segredo de rodada nova quando volta pra fase de resposta
create table if not exists stop_answers (
  match_id uuid not null references stop_matches(id) on delete cascade,
  round_number int not null,
  user_id uuid not null references auth.users(id),
  category text not null check (category in ('nome', 'animal', 'comida', 'cidade', 'objeto', 'filme_serie')),
  answer text not null default '',
  submitted_at timestamptz not null default now(),
  primary key (match_id, round_number, user_id, category)
);
alter table stop_answers enable row level security;
drop policy if exists "stop_answers: dono sempre, sala quando revelado" on stop_answers;
create policy "stop_answers: dono sempre, sala quando revelado" on stop_answers
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from stop_matches m join game_rooms r on r.id = m.room_id
      where m.id = stop_answers.match_id
        and ((r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
             or (r.couple_id is not null and r.couple_id = my_couple_id()))
        and (stop_answers.round_number < m.round_number
             or (stop_answers.round_number = m.round_number and m.phase = 'results'))
    )
  );

-- sorteia uma letra do conjunto A-Z sem K/W/Y, evitando repetir uma já usada nessa partida
create or replace function pick_stop_letter(p_used text[])
returns text
language sql
as $$
  select letter from unnest(array['A','B','C','D','E','F','G','H','I','J','L','M','N','O','P','Q','R','S','T','U','V','X','Z']) as letter
  where letter <> all (coalesce(p_used, '{}'::text[]))
  order by random()
  limit 1;
$$;
revoke all on function pick_stop_letter(text[]) from public;

-- começa (ou, se já tem uma em andamento pra essa sala, devolve) a partida de Stop — idempotente
-- de propósito: reconectar ou revanche caem na mesma chamada
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

  letter := pick_stop_letter('{}'::text[]);
  insert into stop_matches (room_id, current_letter, used_letters, round_ends_at)
    values (p_room_id, letter, array[letter], now() + interval '90 seconds')
    returning id into mid;

  return json_build_object('match_id', mid);
end;
$$;
revoke all on function start_stop_match(uuid) from public;
grant execute on function start_stop_match(uuid) to authenticated;

-- grava (ou atualiza) as respostas da rodada atual — pode ser chamado várias vezes (a cada
-- campo preenchido), só aceita durante a fase de resposta da própria rodada
create or replace function submit_stop_answers(p_match_id uuid, p_answers jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m stop_matches%rowtype;
  has_access boolean;
  cat text;
begin
  select * into m from stop_matches where id = p_match_id for update;
  has_access := found and exists (
    select 1 from game_rooms r where r.id = m.room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access then raise exception 'partida não encontrada'; end if;
  if m.status <> 'playing' or m.phase <> 'answering' then
    raise exception 'não dá mais pra responder essa rodada';
  end if;

  for cat in select jsonb_object_keys(p_answers) loop
    if cat in ('nome', 'animal', 'comida', 'cidade', 'objeto', 'filme_serie') then
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

-- fecha a rodada atual (mostra os resultados pra todo mundo). Sem p_force, só fecha de verdade
-- se já passou do horário (revalidado aqui, nunca confia no relógio do cliente); com p_force
-- (botão STOP), fecha na hora. Idempotente: não faz nada se a fase já não for 'answering'.
create or replace function finish_round(p_match_id uuid, p_force boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  m stop_matches%rowtype;
  has_access boolean;
begin
  select * into m from stop_matches where id = p_match_id for update;
  has_access := found and exists (
    select 1 from game_rooms r where r.id = m.room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access then raise exception 'partida não encontrada'; end if;
  if m.status <> 'playing' or m.phase <> 'answering' then return; end if;
  if not p_force and now() < m.round_ends_at then return; end if;

  update stop_matches set phase = 'results' where id = p_match_id;
end;
$$;
revoke all on function finish_round(uuid, boolean) from public;
grant execute on function finish_round(uuid, boolean) to authenticated;

-- avança pra próxima rodada (ou encerra a partida se já era a última) — qualquer jogador da
-- sala pode chamar, mesmo espírito do STOP ser "de qualquer um" (evita travar esperando uma
-- pessoa específica clicar)
create or replace function advance_stop_round(p_match_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  m stop_matches%rowtype;
  has_access boolean;
  letter text;
begin
  select * into m from stop_matches where id = p_match_id for update;
  has_access := found and exists (
    select 1 from game_rooms r where r.id = m.room_id and (
      (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
      or (r.couple_id is not null and r.couple_id = my_couple_id())
    )
  );
  if not has_access then raise exception 'partida não encontrada'; end if;
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

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'stop_matches') then
    alter publication supabase_realtime add table stop_matches;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'stop_answers') then
    alter publication supabase_realtime add table stop_answers;
  end if;
end;
$$;
