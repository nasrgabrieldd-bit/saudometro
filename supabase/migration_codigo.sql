-- SEGURANÇA: código do casal mais forte e limite de tentativas.
-- Depois de 12 tentativas erradas em 10 minutos (pelo mesmo endereço ou conta), o servidor para de responder.
-- Criar casal exige código com pelo menos 8 caracteres.
-- É seguro rodar mais de uma vez.

create table if not exists code_attempts (
  id bigserial primary key,
  ip text not null default '',
  uid uuid,
  ok boolean not null default false,
  at timestamptz not null default now()
);
alter table code_attempts enable row level security; -- sem policies: só as funções abaixo mexem
create index if not exists code_attempts_at_idx on code_attempts (at);

create or replace function client_ip()
returns text
language sql
stable
as $$
  select trim(split_part(coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ''), ',', 1))
$$;

create or replace function assert_not_throttled()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text := client_ip();
  n int;
begin
  select count(*) into n from code_attempts
  where ok = false
    and at > now() - interval '10 minutes'
    and ((v_ip <> '' and ip = v_ip) or (auth.uid() is not null and uid = auth.uid()));
  if n >= 12 then
    raise exception 'muitas tentativas seguidas, aguarde alguns minutos e tente de novo';
  end if;
end;
$$;

create or replace function record_failed_attempt()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into code_attempts (ip, uid, ok) values (client_ip(), auth.uid(), false);
  delete from code_attempts where at < now() - interval '1 day';
end;
$$;

revoke all on function assert_not_throttled() from public, anon, authenticated;
revoke all on function record_failed_attempt() from public, anon, authenticated;

-- entrar: código errado vira RESPOSTA (não exceção) pra a tentativa ficar registrada
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

revoke all on function join_couple(text, text, text) from public;
grant execute on function join_couple(text, text, text) to anon, authenticated;

-- procurar pelo código: também conta as buscas que não acharam nada
drop function if exists find_couple_preview(text);
create or replace function find_couple_preview(p_code text)
returns table (id uuid, code text, names jsonb, genders jsonb, emojis jsonb, roster jsonb)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform assert_not_throttled();
  return query
    select c.id, c.code,
           coalesce(s.names, '{}'::jsonb), coalesce(s.genders, '{}'::jsonb), coalesce(s.emojis, '{}'::jsonb),
           coalesce((select jsonb_object_agg(p.role, p.display_name) from profiles p where p.couple_id = c.id), '{}'::jsonb)
    from couples c
    left join couple_settings s on s.couple_id = c.id
    where c.code = p_code;
  if not found then
    perform record_failed_attempt();
  end if;
end;
$$;

grant execute on function find_couple_preview(text) to anon, authenticated;

-- criar casal: código com pelo menos 8 caracteres (casais antigos não são afetados)
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
  new_id uuid;
begin
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

revoke all on function create_couple(text, jsonb, jsonb, jsonb) from public;
grant execute on function create_couple(text, jsonb, jsonb, jsonb) to anon, authenticated;
