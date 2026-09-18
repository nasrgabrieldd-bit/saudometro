-- SEGURANÇA, PARTE A (só adiciona; não quebra nada que já funciona).
-- Entrar num casal passa a ser feito por uma função no servidor que confere o código.
-- É seguro rodar mais de uma vez.

create or replace function join_couple(p_code text, p_role text, p_name text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  cid uuid;
  nm text := left(trim(coalesce(p_name, '')), 24);
  prof profiles%rowtype;
begin
  if me is null then
    raise exception 'não autenticado';
  end if;
  if p_role not in ('gabriel', 'tata') then
    raise exception 'papel inválido';
  end if;
  if nm = '' then
    raise exception 'nome obrigatório';
  end if;

  select id into cid from couples where code = upper(trim(p_code));
  if cid is null then
    perform pg_sleep(1.5); -- atrapalha tentativa de adivinhar código
    raise exception 'código inválido';
  end if;

  -- já tem perfil com essa conta: só devolve se for o mesmo casal e papel
  select * into prof from profiles where id = me;
  if found then
    if prof.couple_id = cid and prof.role = p_role then
      return json_build_object('id', prof.id, 'couple_id', prof.couple_id, 'role', prof.role, 'display_name', prof.display_name, 'isNew', false);
    end if;
    raise exception 'esta conta já pertence a outro casal';
  end if;

  -- vaga já ocupada (ex: reinstalou o app): assume o lugar, agora só com o código certo
  select * into prof from profiles where couple_id = cid and role = p_role;
  if found then
    update profiles set id = me, display_name = nm where couple_id = cid and role = p_role returning * into prof;
    return json_build_object('id', prof.id, 'couple_id', prof.couple_id, 'role', prof.role, 'display_name', prof.display_name, 'isNew', false);
  end if;

  insert into profiles (id, couple_id, role, display_name) values (me, cid, p_role, nm) returning * into prof;
  return json_build_object('id', prof.id, 'couple_id', prof.couple_id, 'role', prof.role, 'display_name', prof.display_name, 'isNew', true);
end;
$$;

revoke all on function join_couple(text, text, text) from public;
grant execute on function join_couple(text, text, text) to anon, authenticated;

-- a tela de entrada por código passa a receber também quem já está no casal (papel e nome),
-- sem precisar ler a tabela de perfis
drop function if exists find_couple_preview(text);
create or replace function find_couple_preview(p_code text)
returns table (id uuid, code text, names jsonb, genders jsonb, emojis jsonb, roster jsonb)
language sql
security definer
set search_path = public
stable
as $$
  select c.id, c.code,
         coalesce(s.names, '{}'::jsonb), coalesce(s.genders, '{}'::jsonb), coalesce(s.emojis, '{}'::jsonb),
         coalesce((select jsonb_object_agg(p.role, p.display_name) from profiles p where p.couple_id = c.id), '{}'::jsonb)
  from couples c
  left join couple_settings s on s.couple_id = c.id
  where c.code = p_code
$$;

grant execute on function find_couple_preview(text) to anon, authenticated;
