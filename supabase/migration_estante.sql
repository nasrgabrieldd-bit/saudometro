-- Estante: contador de livros lidos (inclui os que não são do Kindle), com progresso, nota, humor e palavras-chave.
-- Rode este arquivo inteiro no SQL Editor do Supabase (é seguro rodar mais de uma vez).
-- Privacidade: a estante é de cada pessoa; o parceiro só lê se ela ligar "compartilhar" (book_settings.share_with_partner).

create table if not exists book_settings (
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  year_goal int check (year_goal is null or year_goal between 1 and 999),
  goal_year int,
  share_with_partner boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (couple_id, role)
);

alter table book_settings enable row level security;

drop policy if exists "book_settings: read" on book_settings;
create policy "book_settings: read" on book_settings
  for select using (couple_id = my_couple_id() and (role = my_role() or share_with_partner));
drop policy if exists "book_settings: write own" on book_settings;
create policy "book_settings: write own" on book_settings
  for all using (couple_id = my_couple_id() and role = my_role())
  with check (couple_id = my_couple_id() and role = my_role());

create table if not exists books (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
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

alter table books enable row level security;

drop policy if exists "books: read" on books;
create policy "books: read" on books
  for select using (
    couple_id = my_couple_id()
    and (role = my_role() or exists (
      select 1 from book_settings s
      where s.couple_id = books.couple_id and s.role = books.role and s.share_with_partner
    ))
  );
drop policy if exists "books: write own" on books;
create policy "books: write own" on books
  for all using (couple_id = my_couple_id() and role = my_role())
  with check (couple_id = my_couple_id() and role = my_role());

create index if not exists books_owner_idx on books (couple_id, role, status, finished_at desc);
