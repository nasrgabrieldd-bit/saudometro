-- Modo Amigos: Prêmios mais completo + ofensiva do dia com "congelador" grátis semanal
-- (perda suave, nunca sorteio/caixa-surpresa — ver o estudo sobre gamificação ética).
-- É seguro rodar mais de uma vez.

-- um registro por dia em que a turma teve atividade (qualquer membro abriu o Modo Amigos
-- naquele dia). A sequência é calculada no cliente a partir dessa lista.
create table if not exists friend_streak_days (
  id bigserial primary key,
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  day date not null,
  unique (friend_group_id, day)
);
alter table friend_streak_days enable row level security;
drop policy if exists "friend_streak_days: group access" on friend_streak_days;
create policy "friend_streak_days: group access" on friend_streak_days
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

-- itens de prêmio criados pela própria turma, além do catálogo fixo do app
create table if not exists friend_custom_perks (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  emoji text not null default '🎁',
  title text not null,
  description text not null default '',
  cost int not null check (cost > 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
alter table friend_custom_perks enable row level security;
drop policy if exists "friend_custom_perks: group access" on friend_custom_perks;
create policy "friend_custom_perks: group access" on friend_custom_perks
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_streak_days') then
    alter publication supabase_realtime add table friend_streak_days;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_custom_perks') then
    alter publication supabase_realtime add table friend_custom_perks;
  end if;
end;
$$;
