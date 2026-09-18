-- Corrige a criação de casal novo (quebrou quando a leitura da tabela couples ficou restrita aos membros).
-- É seguro rodar mais de uma vez.

create or replace function create_couple(p_code text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
begin
  insert into couples (code) values (upper(trim(p_code))) returning couples.id into new_id;
  return new_id;
end;
$$;

revoke all on function create_couple(text) from public;
grant execute on function create_couple(text) to anon, authenticated;
