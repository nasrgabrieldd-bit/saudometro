-- Foto de perfil: tocar no avatar (o círculo com a inicial, lá em cima) abre editar nome
-- e foto — pro casal e pro Modo Amigos. Bucket público (a foto de perfil não é segredo,
-- precisa carregar rápido em toda tela que mostra alguém), mas só a própria pessoa pode
-- enviar/trocar/apagar a sua, guardada na própria pasta (nome do arquivo = seu user id).
-- É seguro rodar mais de uma vez.

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars: own write" on storage.objects;
create policy "avatars: own write" on storage.objects
  for insert with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: own update" on storage.objects;
create policy "avatars: own update" on storage.objects
  for update using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "avatars: own delete" on storage.objects;
create policy "avatars: own delete" on storage.objects
  for delete using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

alter table profiles add column if not exists avatar_url text;
alter table friend_members add column if not exists avatar_url text;
