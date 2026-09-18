-- SEGURANÇA, PARTE B: fecha as regras antigas de perfis.
-- Só rode DEPOIS que o app novo (que entra pela função join_couple) estiver publicado.
-- É seguro rodar mais de uma vez.

drop policy if exists "profiles: anyone can read" on profiles;
drop policy if exists "profiles: insert own" on profiles;
drop policy if exists "profiles: update own or reclaim" on profiles;
drop policy if exists "profiles: read own couple" on profiles;
drop policy if exists "profiles: update own" on profiles;

-- cada pessoa lê o próprio perfil e o do seu casal; ninguém mais
create policy "profiles: read own couple" on profiles
  for select using (id = auth.uid() or couple_id = my_couple_id());

-- só dá pra alterar o próprio perfil (ex: nome). Criar e retomar perfil só pela função join_couple.
create policy "profiles: update own" on profiles
  for update using (id = auth.uid()) with check (id = auth.uid());
