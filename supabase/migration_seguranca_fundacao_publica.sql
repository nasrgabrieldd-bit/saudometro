-- Fase 0 (fundação pública): reforço de segurança técnica antes de abrir o app pra gente
-- de fora, além dos pilotos que já usam. Três frentes: (1) limite de frequência genérico,
-- reaproveitando o mesmo estilo do throttle de tentativa de código que já existe;
-- (2) fecha a brecha de sessão anônima/não-autenticada em create_couple/join_couple, que
-- hoje não têm a mesma checagem que create_friend_group/join_friend_group já têm;
-- (3) limite de tamanho onde ainda faltava (recadinho e humor).
-- É seguro rodar mais de uma vez.

-- ------------------------------------------------------------
-- 1) LIMITE DE FREQUÊNCIA GENÉRICO
-- ------------------------------------------------------------

create table if not exists action_throttle (
  id bigserial primary key,
  actor uuid not null,
  action text not null,
  created_at timestamptz not null default now()
);
alter table action_throttle enable row level security; -- sem policies: só a função abaixo mexe
create index if not exists action_throttle_actor_action_idx on action_throttle (actor, action, created_at);

-- conta quantas vezes essa pessoa fez essa ação na janela de tempo; estoura -> exceção.
-- Sempre chamada de dentro de outra função security definer, nunca direto pelo cliente.
create or replace function assert_action_not_throttled(p_action text, p_max int, p_window interval)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  select count(*) into n from action_throttle
  where actor = auth.uid() and action = p_action and created_at > now() - p_window;
  if n >= p_max then
    raise exception 'muitas ações seguidas, aguarde um pouco e tente de novo';
  end if;
  insert into action_throttle (actor, action) values (auth.uid(), p_action);
  delete from action_throttle where created_at < now() - interval '1 day';
end;
$$;
revoke all on function assert_action_not_throttled(text, int, interval) from public, anon, authenticated;

-- gatilho genérico pra tabelas de conteúdo livre (post, comentário, achado, recadinho):
-- os 3 argumentos do trigger são a ação, o máximo e a janela (ex: 'feed_post', 20, 1 hora)
create or replace function throttle_insert_trigger()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_action_not_throttled(TG_ARGV[0], TG_ARGV[1]::int, TG_ARGV[2]::interval);
  return new;
end;
$$;

drop trigger if exists throttle_friend_feed_posts on friend_feed_posts;
create trigger throttle_friend_feed_posts before insert on friend_feed_posts
  for each row execute function throttle_insert_trigger('feed_post', 20, '1 hour');

drop trigger if exists throttle_friend_feed_comments on friend_feed_comments;
create trigger throttle_friend_feed_comments before insert on friend_feed_comments
  for each row execute function throttle_insert_trigger('feed_comment', 60, '1 hour');

drop trigger if exists throttle_friend_find_comments on friend_find_comments;
create trigger throttle_friend_find_comments before insert on friend_find_comments
  for each row execute function throttle_insert_trigger('find_comment', 60, '1 hour');

drop trigger if exists throttle_friend_finds on friend_finds;
create trigger throttle_friend_finds before insert on friend_finds
  for each row execute function throttle_insert_trigger('find', 20, '1 hour');

drop trigger if exists throttle_sweet_notes on sweet_notes;
create trigger throttle_sweet_notes before insert on sweet_notes
  for each row execute function throttle_insert_trigger('sweet_note', 30, '1 hour');

-- ------------------------------------------------------------
-- 2) FECHA A BRECHA DE SESSÃO ANÔNIMA / NÃO AUTENTICADA
-- ------------------------------------------------------------

-- criar casal: hoje não checava autenticação nenhuma (nem sessão anônima, nem uid nulo).
-- Passa a exigir Google de verdade, igual create_friend_group já exige, e ganha o
-- throttle de criação (3 casais por dia por pessoa é mais que suficiente pra uso legítimo).
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
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  new_id uuid;
begin
  if auth.uid() is null or is_anon then
    raise exception 'precisa_login_google';
  end if;
  perform assert_action_not_throttled('create_couple', 3, interval '1 day');
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

revoke all on function create_couple(text, jsonb, jsonb, jsonb) from public, anon;
grant execute on function create_couple(text, jsonb, jsonb, jsonb) to authenticated;

-- entrar num casal: já exigia uid não nulo, mas não recusava sessão anônima (só a tela não
-- oferecia esse caminho, o que não é proteção de verdade — chamar a função direto ainda dava).
create or replace function join_couple(p_code text, p_role text, p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  cid uuid;
  nm text := left(trim(coalesce(p_name, '')), 24);
  prof profiles%rowtype;
begin
  if me is null or is_anon then
    raise exception 'precisa_login_google';
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

revoke all on function join_couple(text, text, text) from public, anon;
grant execute on function join_couple(text, text, text) to authenticated;

-- criar turma: ganha o mesmo throttle de criação (5 turmas por dia por pessoa).
create or replace function create_friend_group(p_name text, p_display_name text, p_emoji text default '👥', p_color_key text default 'azul')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  new_code text;
  gid uuid;
  v_emoji text := coalesce(nullif(trim(p_emoji), ''), '👥');
  v_color text := case when p_color_key in ('azul','verde','roxo','ambar','ceu') then p_color_key else 'azul' end;
begin
  if is_anon then
    raise exception 'precisa_login_google';
  end if;
  perform assert_action_not_throttled('create_friend_group', 5, interval '1 day');
  if p_display_name is null or char_length(trim(p_display_name)) < 1 then
    raise exception 'nome_invalido';
  end if;
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into friend_groups (code, name, emoji, color_key, created_by)
    values (new_code, coalesce(nullif(trim(p_name), ''), 'Minha turma'), v_emoji, v_color, auth.uid())
    returning id into gid;
  insert into friend_members (friend_group_id, user_id, display_name) values (gid, auth.uid(), trim(p_display_name));
  insert into friend_coin_ledger (friend_group_id, user_id, delta, reason) values (gid, auth.uid(), 25, 'saldo inicial da turma');
  return json_build_object('id', gid, 'code', new_code, 'name', coalesce(nullif(trim(p_name), ''), 'Minha turma'), 'emoji', v_emoji, 'color_key', v_color);
end;
$$;

-- RPC morta: nunca é chamada pelo app (o fluxo real usa find_couple_preview/join_couple),
-- não tem throttle nenhum, e continua exposta pra quem quiser chamar direto — só risco.
drop function if exists find_couple_by_code(text);

-- ------------------------------------------------------------
-- 3) LIMITE DE TAMANHO ONDE AINDA FALTAVA
-- ------------------------------------------------------------

alter table sweet_notes drop constraint if exists sweet_notes_message_len;
alter table sweet_notes add constraint sweet_notes_message_len check (char_length(message) <= 500);

alter table moods drop constraint if exists moods_note_len;
alter table moods add constraint moods_note_len check (char_length(note) <= 300);
