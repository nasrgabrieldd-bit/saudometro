-- Modo Amigos: corrige um bug real (listMyFriendGroups trazia uma linha por MEMBRO de cada
-- turma, não uma por turma — por isso turmas com 3 pessoas apareciam repetidas 3x na tela de
-- trocar de conta) e adiciona personalização de turma (emoji + cor, além do nome que já dava
-- pra escolher). A cor é uma de 5 opções fixas, já conferidas pra manter contraste bom nos
-- dois temas — não é uma cor livre, pra não colidir com o rosa do casal nem quebrar contraste.
-- É seguro rodar mais de uma vez.

alter table friend_groups add column if not exists emoji text not null default '🧭' check (char_length(emoji) between 1 and 8);
alter table friend_groups add column if not exists color_key text not null default 'azul' check (color_key in ('azul', 'verde', 'roxo', 'ambar', 'ceu'));

-- até agora só dava pra ver a turma (select); agora qualquer membro também pode
-- personalizar nome/emoji/cor da turma
drop policy if exists "friend_groups: members update" on friend_groups;
create policy "friend_groups: members update" on friend_groups
  for update using (id = any(my_friend_group_ids()))
  with check (id = any(my_friend_group_ids()));

-- criar turma agora aceita emoji e cor escolhidos na hora de criar (com valores padrão se não vier nada)
create or replace function create_friend_group(p_name text, p_display_name text, p_emoji text default '🧭', p_color_key text default 'azul')
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  new_code text;
  gid uuid;
  v_emoji text := coalesce(nullif(trim(p_emoji), ''), '🧭');
  v_color text := case when p_color_key in ('azul','verde','roxo','ambar','ceu') then p_color_key else 'azul' end;
begin
  if is_anon then
    raise exception 'precisa_login_google';
  end if;
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

-- devolve emoji/cor também, pra tela que acabou de entrar já vir personalizada
create or replace function join_friend_group(p_code text, p_display_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  is_anon boolean := coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
  g record;
  cnt int;
begin
  if is_anon then
    raise exception 'precisa_login_google';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) < 1 then
    raise exception 'nome_invalido';
  end if;

  perform assert_not_throttled();

  select * into g from friend_groups where code = upper(trim(p_code));
  if not found then
    perform record_failed_attempt();
    perform pg_sleep(1);
    return json_build_object('error', 'codigo_invalido');
  end if;

  select count(*) into cnt from friend_members where friend_group_id = g.id;
  if cnt >= g.max_members and not exists (select 1 from friend_members where friend_group_id = g.id and user_id = auth.uid()) then
    raise exception 'grupo_cheio';
  end if;
  insert into friend_members (friend_group_id, user_id, display_name)
  values (g.id, auth.uid(), trim(p_display_name))
  on conflict (friend_group_id, user_id) do update set display_name = excluded.display_name;
  return json_build_object('id', g.id, 'name', g.name, 'code', g.code, 'emoji', g.emoji, 'color_key', g.color_key);
end;
$$;
