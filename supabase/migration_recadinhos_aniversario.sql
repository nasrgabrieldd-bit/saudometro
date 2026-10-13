-- Recadinhos de Aniversário: bilhetes que um dos dois escreve com antecedência, cada um
-- programado pra "chegar" num dia específico (entre hoje e o dia do aniversário). Quem recebe
-- só enxerga o conteúdo quando chega o dia — igual já funciona com a Cápsula do Tempo. A
-- notificação de cada um é disparada pelo job diário do GitHub Actions (scripts/deliver-
-- birthday-notes.mjs), não na hora em que o bilhete é escrito. Seguro rodar mais de uma vez.

create table if not exists birthday_notes (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  from_role text not null check (from_role in ('gabriel', 'tata')),
  to_role text not null check (to_role in ('gabriel', 'tata')),
  title text not null default 'Recadinho de Aniversário',
  message text not null,
  deliver_on date not null,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);

alter table birthday_notes enable row level security;

drop policy if exists "birthday_notes: couple access" on birthday_notes;
create policy "birthday_notes: couple access" on birthday_notes
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'birthday_notes') then
    alter publication supabase_realtime add table birthday_notes;
  end if;
end;
$$;
