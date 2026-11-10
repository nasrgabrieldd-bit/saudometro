-- Modo Amigos: Estante (livros lidos de cada pessoa da turma) + reações de um toque no humor dos amigos.
-- Rode este arquivo inteiro no SQL Editor do Supabase (é seguro rodar mais de uma vez).
-- Privacidade: a estante é de cada pessoa; a turma só lê se ela ligar "compartilhar com a turma".

create table if not exists friend_book_settings (
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  year_goal int check (year_goal is null or year_goal between 1 and 999),
  goal_year int,
  share_with_partner boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (friend_group_id, user_id)
);
alter table friend_book_settings enable row level security;

-- a turma pode ver QUEM compartilha (só a chave "compartilha ou não"; os livros têm regra própria abaixo)
drop policy if exists "friend_book_settings: read" on friend_book_settings;
create policy "friend_book_settings: read" on friend_book_settings
  for select using (friend_group_id = any(my_friend_group_ids()));
drop policy if exists "friend_book_settings: write own" on friend_book_settings;
create policy "friend_book_settings: write own" on friend_book_settings
  for all using (friend_group_id = any(my_friend_group_ids()) and user_id = auth.uid())
  with check (friend_group_id = any(my_friend_group_ids()) and user_id = auth.uid());

create table if not exists friend_books (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  author text check (author is null or char_length(author) <= 150),
  cover_url text check (cover_url is null or char_length(cover_url) <= 600),
  pages int check (pages is null or pages between 1 and 20000),
  status text not null default 'quero' check (status in ('quero', 'lendo', 'li', 'larguei')),
  source text not null default 'kindle' check (source in ('kindle', 'fisico', 'pdf', 'wattpad', 'outro')),
  progress int not null default 0 check (progress between 0 and 100),
  rating int check (rating is null or rating between 1 and 5),
  mood text check (mood is null or char_length(mood) <= 30),
  tags text[] not null default '{}',
  started_at date,
  finished_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table friend_books enable row level security;

drop policy if exists "friend_books: read" on friend_books;
create policy "friend_books: read" on friend_books
  for select using (
    friend_group_id = any(my_friend_group_ids())
    and (user_id = auth.uid() or exists (
      select 1 from friend_book_settings s
      where s.friend_group_id = friend_books.friend_group_id and s.user_id = friend_books.user_id and s.share_with_partner
    ))
  );
drop policy if exists "friend_books: write own" on friend_books;
create policy "friend_books: write own" on friend_books
  for all using (friend_group_id = any(my_friend_group_ids()) and user_id = auth.uid())
  with check (friend_group_id = any(my_friend_group_ids()) and user_id = auth.uid());
create index if not exists friend_books_owner_idx on friend_books (friend_group_id, user_id, status, finished_at desc);

-- reações (❤️ 🤗 😂 …) ao humor de um amigo: uma por pessoa em cada humor
create table if not exists friend_mood_reactions (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  mood_id uuid not null references friend_moods(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  unique (mood_id, user_id)
);
alter table friend_mood_reactions enable row level security;
drop policy if exists "friend_mood_reactions: read" on friend_mood_reactions;
create policy "friend_mood_reactions: read" on friend_mood_reactions
  for select using (friend_group_id = any(my_friend_group_ids()));
drop policy if exists "friend_mood_reactions: write own" on friend_mood_reactions;
create policy "friend_mood_reactions: write own" on friend_mood_reactions
  for all using (friend_group_id = any(my_friend_group_ids()) and user_id = auth.uid())
  with check (friend_group_id = any(my_friend_group_ids()) and user_id = auth.uid());
create index if not exists friend_mood_reactions_idx on friend_mood_reactions (friend_group_id, mood_id);
