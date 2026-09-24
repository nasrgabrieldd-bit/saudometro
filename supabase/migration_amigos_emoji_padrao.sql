-- Modo Amigos: troca o emoji padrão da turma de 🧭 (bússola, achado estranho) pra 👥
-- (pessoas, mais comum/reconhecível). Atualiza turmas que ainda estão no padrão antigo e
-- muda o valor padrão de coluna pras turmas novas.
-- É seguro rodar mais de uma vez.

update friend_groups set emoji = '👥' where emoji = '🧭';
alter table friend_groups alter column emoji set default '👥';

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
