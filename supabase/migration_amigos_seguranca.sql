-- Modo Amigos: mesma proteção contra adivinhar código que o casal já tem (assert_not_throttled /
-- record_failed_attempt, de migration_seguranca_a.sql/migration_seguranca_b.sql). Depois de 12
-- tentativas erradas em 10 minutos (mesmo IP ou mesma conta), o servidor para de responder.
-- O código da turma já é único por natureza (gerado pelo servidor, coluna "unique" na tabela) —
-- isso aqui é só pra também travar quem fica tentando adivinhar o código de uma turma alheia.
-- É seguro rodar mais de uma vez.

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
    -- registra a tentativa errada como RESPOSTA (não exceção): se fosse "raise exception" aqui,
    -- a transação inteira desfazia o insert do record_failed_attempt() junto.
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
  return json_build_object('id', g.id, 'name', g.name, 'code', g.code);
end;
$$;

revoke all on function join_friend_group(text, text) from public;
grant execute on function join_friend_group(text, text) to authenticated;
