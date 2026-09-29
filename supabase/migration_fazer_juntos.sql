-- Fazer Juntos: ideias de rolê (casal e turma) com ranking por estrelas.
-- Substitui o "Sinal de Saudade" nos Recadinhos (o Encontro de Saudade do
-- Calendário continua existindo, é uma coisa separada).
-- Seguro rodar mais de uma vez.

-- ================= CASAL =================

insert into storage.buckets (id, name, public)
values ('date-ideas', 'date-ideas', false)
on conflict (id) do nothing;

drop policy if exists "date-ideas: couple read" on storage.objects;
create policy "date-ideas: couple read" on storage.objects
  for select using (bucket_id = 'date-ideas' and (storage.foldername(name))[1] = my_couple_id()::text);

drop policy if exists "date-ideas: couple write" on storage.objects;
create policy "date-ideas: couple write" on storage.objects
  for insert with check (bucket_id = 'date-ideas' and (storage.foldername(name))[1] = my_couple_id()::text);

drop policy if exists "date-ideas: couple delete" on storage.objects;
create policy "date-ideas: couple delete" on storage.objects
  for delete using (bucket_id = 'date-ideas' and (storage.foldername(name))[1] = my_couple_id()::text);

create table if not exists date_ideas (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  created_by text not null check (created_by in ('gabriel', 'tata')),
  title text not null check (char_length(title) between 1 and 120),
  link text check (link is null or char_length(link) <= 500),
  photo_path text,
  created_at timestamptz not null default now()
);
alter table date_ideas enable row level security;
drop policy if exists "date_ideas: couple access" on date_ideas;
create policy "date_ideas: couple access" on date_ideas
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

create table if not exists date_idea_ratings (
  idea_id uuid not null references date_ideas(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  stars int not null check (stars between 1 and 5),
  rated_at timestamptz not null default now(),
  primary key (idea_id, role)
);
alter table date_idea_ratings enable row level security;
drop policy if exists "date_idea_ratings: couple access" on date_idea_ratings;
create policy "date_idea_ratings: couple access" on date_idea_ratings
  for all using (idea_id in (select id from date_ideas where couple_id = my_couple_id()))
  with check (idea_id in (select id from date_ideas where couple_id = my_couple_id()));

alter publication supabase_realtime add table date_ideas;
alter publication supabase_realtime add table date_idea_ratings;

-- ================= TURMA =================

insert into storage.buckets (id, name, public)
values ('friend-date-ideas', 'friend-date-ideas', false)
on conflict (id) do nothing;

drop policy if exists "friend-date-ideas: group read" on storage.objects;
create policy "friend-date-ideas: group read" on storage.objects
  for select using (bucket_id = 'friend-date-ideas' and (storage.foldername(name))[1]::uuid = any(my_friend_group_ids()));

drop policy if exists "friend-date-ideas: group write" on storage.objects;
create policy "friend-date-ideas: group write" on storage.objects
  for insert with check (bucket_id = 'friend-date-ideas' and (storage.foldername(name))[1]::uuid = any(my_friend_group_ids()));

drop policy if exists "friend-date-ideas: group delete" on storage.objects;
create policy "friend-date-ideas: group delete" on storage.objects
  for delete using (bucket_id = 'friend-date-ideas' and (storage.foldername(name))[1]::uuid = any(my_friend_group_ids()));

create table if not exists friend_date_ideas (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  created_by uuid not null references auth.users(id),
  title text not null check (char_length(title) between 1 and 120),
  link text check (link is null or char_length(link) <= 500),
  photo_path text,
  created_at timestamptz not null default now()
);
alter table friend_date_ideas enable row level security;
drop policy if exists "friend_date_ideas: group access" on friend_date_ideas;
create policy "friend_date_ideas: group access" on friend_date_ideas
  for all using (friend_group_id = any(my_friend_group_ids())) with check (friend_group_id = any(my_friend_group_ids()));

create table if not exists friend_date_idea_ratings (
  idea_id uuid not null references friend_date_ideas(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  stars int not null check (stars between 1 and 5),
  rated_at timestamptz not null default now(),
  primary key (idea_id, user_id)
);
alter table friend_date_idea_ratings enable row level security;
drop policy if exists "friend_date_idea_ratings: group access" on friend_date_idea_ratings;
create policy "friend_date_idea_ratings: group access" on friend_date_idea_ratings
  for all using (idea_id in (select id from friend_date_ideas where friend_group_id = any(my_friend_group_ids())))
  with check (idea_id in (select id from friend_date_ideas where friend_group_id = any(my_friend_group_ids())));

alter publication supabase_realtime add table friend_date_ideas;
alter publication supabase_realtime add table friend_date_idea_ratings;
