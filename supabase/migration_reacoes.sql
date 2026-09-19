-- Reações com um toque: cada pessoa pode reagir (❤️ 🤗 😘 🥹 💪) ao humor do dia e aos recadinhos do par.
-- Uma reação por pessoa em cada item (tocar em outra troca; tocar na mesma tira).
-- É seguro rodar mais de uma vez.

create table if not exists reactions (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  kind text not null check (kind in ('mood', 'note')),
  target_id uuid not null,
  role text not null check (role in ('gabriel', 'tata')),
  emoji text not null check (char_length(emoji) between 1 and 8),
  created_at timestamptz not null default now(),
  unique (kind, target_id, role)
);

create index if not exists reactions_couple_idx on reactions (couple_id, kind);

alter table reactions enable row level security;

drop policy if exists "reactions: couple access" on reactions;
create policy "reactions: couple access" on reactions
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'reactions') then
    alter publication supabase_realtime add table reactions;
  end if;
end;
$$;
