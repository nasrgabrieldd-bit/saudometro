-- Modo Amigos: feed de fotos estilo Instagram dentro de Experiências — cada turma tem o
-- próprio feed privado (um grupo nunca vê o feed de outro grupo). Post pode ser "fofoca"
-- (fica destacado com cor diferente e uma hashtag) e pode ser temporário (some da vista de
-- todo mundo depois de alguns minutos, apagado de verdade depois por uma limpeza diária,
-- igual já acontece com "Lembrei de você") ou permanente. Comenta em thread, dá like.
-- É seguro rodar mais de uma vez.

insert into storage.buckets (id, name, public)
values ('friend-feed', 'friend-feed', false)
on conflict (id) do nothing;

drop policy if exists "friend-feed: group read" on storage.objects;
create policy "friend-feed: group read" on storage.objects
  for select using (bucket_id = 'friend-feed' and (storage.foldername(name))[1]::uuid = any(my_friend_group_ids()));

drop policy if exists "friend-feed: group write" on storage.objects;
create policy "friend-feed: group write" on storage.objects
  for insert with check (bucket_id = 'friend-feed' and (storage.foldername(name))[1]::uuid = any(my_friend_group_ids()));

drop policy if exists "friend-feed: group delete" on storage.objects;
create policy "friend-feed: group delete" on storage.objects
  for delete using (bucket_id = 'friend-feed' and (storage.foldername(name))[1]::uuid = any(my_friend_group_ids()));

create table if not exists friend_feed_posts (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  photo_path text not null,
  caption text not null default '',
  is_fofoca boolean not null default false,
  hashtag text,
  expires_at timestamptz, -- nulo = permanente
  created_at timestamptz not null default now()
);
alter table friend_feed_posts enable row level security;
drop policy if exists "friend_feed_posts: group access" on friend_feed_posts;
create policy "friend_feed_posts: group access" on friend_feed_posts
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

create table if not exists friend_feed_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references friend_feed_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  text text not null check (char_length(text) between 1 and 300),
  created_at timestamptz not null default now()
);
alter table friend_feed_comments enable row level security;

drop policy if exists "friend_feed_comments: group sees" on friend_feed_comments;
create policy "friend_feed_comments: group sees" on friend_feed_comments
  for select using (exists (select 1 from friend_feed_posts p where p.id = post_id and p.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_feed_comments: write own" on friend_feed_comments;
create policy "friend_feed_comments: write own" on friend_feed_comments
  for insert with check (user_id = auth.uid() and exists (select 1 from friend_feed_posts p where p.id = post_id and p.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_feed_comments: delete own" on friend_feed_comments;
create policy "friend_feed_comments: delete own" on friend_feed_comments
  for delete using (user_id = auth.uid());

create table if not exists friend_feed_likes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references friend_feed_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (post_id, user_id)
);
alter table friend_feed_likes enable row level security;

drop policy if exists "friend_feed_likes: group sees" on friend_feed_likes;
create policy "friend_feed_likes: group sees" on friend_feed_likes
  for select using (exists (select 1 from friend_feed_posts p where p.id = post_id and p.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_feed_likes: write own" on friend_feed_likes;
create policy "friend_feed_likes: write own" on friend_feed_likes
  for insert with check (user_id = auth.uid() and exists (select 1 from friend_feed_posts p where p.id = post_id and p.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_feed_likes: delete own" on friend_feed_likes;
create policy "friend_feed_likes: delete own" on friend_feed_likes
  for delete using (user_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_feed_posts') then
    alter publication supabase_realtime add table friend_feed_posts;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_feed_comments') then
    alter publication supabase_realtime add table friend_feed_comments;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_feed_likes') then
    alter publication supabase_realtime add table friend_feed_likes;
  end if;
end;
$$;
