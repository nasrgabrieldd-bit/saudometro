-- Excluir conta: apaga a conta de quem está logado e tudo que ela escreveu (casal e turmas).
-- Exigido pela Google Play. Rode este arquivo inteiro no SQL Editor do Supabase (é seguro rodar mais de uma vez).
-- Quem chama é a própria pessoa, pelo app (Perfil > Privacidade > Excluir minha conta); só apaga a conta de quem chamou.

create or replace function delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth, storage
as $$
declare
  uid uuid := auth.uid();
  my_couple uuid;
  my_role text;
  r record;
begin
  if uid is null then
    raise exception 'precisa estar logado';
  end if;

  select couple_id, role into my_couple, my_role from profiles where id = uid;

  -- 1) casal: o que eu escrevi nas tabelas do casal (colunas que guardam o "papel": gabriel/tata)
  if my_couple is not null and my_role is not null then
    for r in
      select c.table_name, c.column_name
      from information_schema.columns c
      join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
      where c.table_schema = 'public'
        and c.data_type in ('text', 'character varying')
        and c.column_name in ('role', 'from_role', 'redeemed_by', 'created_by', 'sender_role')
        and exists (select 1 from information_schema.columns k where k.table_schema = 'public' and k.table_name = c.table_name and k.column_name = 'couple_id')
    loop
      begin
        execute format('delete from public.%I where couple_id = $1 and %I = $2', r.table_name, r.column_name) using my_couple, my_role;
      exception when others then
        raise notice 'não apaguei % (%): %', r.table_name, r.column_name, sqlerrm;
      end;
    end loop;
  end if;

  -- 2) tudo que aponta pra minha conta (turmas, planos, notificações, jogos...)
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.data_type = 'uuid'
      and c.column_name in ('user_id', 'created_by', 'target_user_id', 'winner_user_id', 'sender_user_id', 'recipient_user_id', 'host_user_id', 'from_user_id', 'current_turn_user_id')
      and c.table_name <> 'profiles'
  loop
    begin
      execute format('delete from public.%I where %I = $1', r.table_name, r.column_name) using uid;
    exception
      when foreign_key_violation then
        begin
          execute format('update public.%I set %I = null where %I = $1', r.table_name, r.column_name, r.column_name) using uid;
        exception when others then
          raise notice 'não limpei % (%): %', r.table_name, r.column_name, sqlerrm;
        end;
      when others then
        raise notice 'não limpei % (%): %', r.table_name, r.column_name, sqlerrm;
    end;
  end loop;

  -- 3) turmas que ficaram sem ninguém somem
  delete from friend_groups g where not exists (select 1 from friend_members m where m.friend_group_id = g.id);

  -- 4) perfil; se não sobrou ninguém no casal, o casal inteiro vai embora (as tabelas ligadas apagam em cascata)
  delete from profiles where id = uid;
  if my_couple is not null and not exists (select 1 from profiles where couple_id = my_couple) then
    begin
      delete from storage.objects where bucket_id = 'memories' and name like my_couple::text || '/%';
    exception when others then null;
    end;
    delete from couples where id = my_couple;
  end if;

  -- 5) foto de perfil
  begin
    delete from storage.objects where bucket_id = 'avatars' and name like uid::text || '/%';
  exception when others then null;
  end;

  -- 6) por fim, a conta de login
  delete from auth.users where id = uid;
end;
$$;

revoke all on function delete_my_account() from public, anon;
grant execute on function delete_my_account() to authenticated;
