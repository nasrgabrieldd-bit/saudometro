-- "Lembrei de você": dentro de Recados, a pessoa manda uma foto de algo que lembrou o par, com uma
-- observação. O par pode reagir com emoji e/ou responder com um comentário. Assim que o par reage
-- (de qualquer um dos dois jeitos), os dois ganham moeda. Fotos são apagadas de vez depois de 30 dias
-- (arquivo incluído, não só o registro) por uma tarefa diária no GitHub Actions.
-- É seguro rodar mais de uma vez.

-- ---------- espaço de arquivos (bucket) ----------
insert into storage.buckets (id, name, public)
values ('memories', 'memories', false)
on conflict (id) do nothing;

drop policy if exists "memories: couple read" on storage.objects;
create policy "memories: couple read" on storage.objects
  for select using (bucket_id = 'memories' and (storage.foldername(name))[1] = my_couple_id()::text);

drop policy if exists "memories: couple write" on storage.objects;
create policy "memories: couple write" on storage.objects
  for insert with check (bucket_id = 'memories' and (storage.foldername(name))[1] = my_couple_id()::text);

drop policy if exists "memories: couple delete" on storage.objects;
create policy "memories: couple delete" on storage.objects
  for delete using (bucket_id = 'memories' and (storage.foldername(name))[1] = my_couple_id()::text);

-- ---------- tabela ----------
create table if not exists memory_photos (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  photo_path text not null, -- caminho dentro do bucket "memories" (não é a URL: o bucket é privado)
  caption text not null check (char_length(caption) between 1 and 300),
  reply_text text check (reply_text is null or char_length(reply_text) <= 300),
  reply_role text check (reply_role in ('gabriel', 'tata')),
  replied_at timestamptz,
  points_awarded boolean not null default false,
  created_at timestamptz not null default now()
);

alter table memory_photos enable row level security;

drop policy if exists "memory_photos: couple access" on memory_photos;
create policy "memory_photos: couple access" on memory_photos
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

create index if not exists memory_photos_couple_idx on memory_photos (couple_id, created_at desc);

-- limite de 5 fotos por pessoa por dia (conferido de novo no servidor, não só no app)
create or replace function memory_photos_daily_limit()
returns trigger
language plpgsql
as $$
begin
  if (select count(*) from memory_photos
      where couple_id = new.couple_id and role = new.role
        and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'limite_diario';
  end if;
  return new;
end;
$$;

drop trigger if exists memory_photos_daily_limit_trg on memory_photos;
create trigger memory_photos_daily_limit_trg
  before insert on memory_photos
  for each row execute function memory_photos_daily_limit();

-- ---------- reações também valem pra "lembrei de você" ----------
alter table reactions drop constraint if exists reactions_kind_check;
alter table reactions add constraint reactions_kind_check check (kind in ('mood', 'note', 'memory'));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'memory_photos') then
    alter publication supabase_realtime add table memory_photos;
  end if;
end;
$$;
