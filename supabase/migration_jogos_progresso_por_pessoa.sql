-- Corrige o progresso do Capibatman pra ser por PESSOA, não compartilhado: cada um no casal
-- (ou cada membro da turma) tem sua própria fase e suas próprias moedas ganhas jogando. O
-- nível atual (compartilhado) vira o ponto de partida de cada pessoa, ninguém perde progresso.
-- É seguro rodar mais de uma vez, MAS só rode uma vez de verdade (a segunda vez a tabela já
-- não tem mais a coluna antiga pra copiar).

alter table couple_game_progress rename to couple_game_progress_old;

create table couple_game_progress (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  role text not null check (role in ('gabriel', 'tata')),
  game_id text not null,
  current_level int not null default 1,
  updated_at timestamptz not null default now(),
  unique (couple_id, role, game_id)
);
alter table couple_game_progress enable row level security;
create policy "couple_game_progress: casal" on couple_game_progress
  for all using (couple_id = my_couple_id())
  with check (couple_id = my_couple_id());

insert into couple_game_progress (couple_id, role, game_id, current_level)
select couple_id, 'gabriel', game_id, current_level from couple_game_progress_old
union all
select couple_id, 'tata', game_id, current_level from couple_game_progress_old;

drop table couple_game_progress_old;

alter table friend_game_progress rename to friend_game_progress_old;

create table friend_game_progress (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  game_id text not null,
  current_level int not null default 1,
  updated_at timestamptz not null default now(),
  unique (friend_group_id, user_id, game_id)
);
alter table friend_game_progress enable row level security;
create policy "friend_game_progress: turma" on friend_game_progress
  for all using (friend_group_id = any(my_friend_group_ids()))
  with check (friend_group_id = any(my_friend_group_ids()));

insert into friend_game_progress (friend_group_id, user_id, game_id, current_level)
select o.friend_group_id, m.user_id, o.game_id, o.current_level
from friend_game_progress_old o
join friend_members m on m.friend_group_id = o.friend_group_id;

drop table friend_game_progress_old;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'couple_game_progress') then
    alter publication supabase_realtime add table couple_game_progress;
  end if;
end;
$$;
