-- Modo Amigos: gestão da turma — excluir grupo, trocar código, remover alguém por votação
-- da turma toda, e comentar num achado (Experiências).
-- É seguro rodar mais de uma vez.

-- excluir a turma inteira (cascata já apaga tudo ligado a ela: membros, rolês, humor,
-- achados, prêmios, cofre, ofensiva)
drop policy if exists "friend_groups: members delete" on friend_groups;
create policy "friend_groups: members delete" on friend_groups
  for delete using (id = any(my_friend_group_ids()));

-- trocar o código da turma (ex: se vazou pra gente de fora sem querer)
create or replace function regenerate_friend_group_code(p_friend_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_code text;
begin
  if not (p_friend_group_id = any(my_friend_group_ids())) then
    raise exception 'sem acesso a essa turma';
  end if;
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update friend_groups set code = new_code where id = p_friend_group_id;
  return new_code;
end;
$$;
revoke all on function regenerate_friend_group_code(uuid) from public;
grant execute on function regenerate_friend_group_code(uuid) to authenticated;

-- ---------- remover alguém por votação de todo mundo ----------

create table if not exists friend_kick_votes (
  id uuid primary key default gen_random_uuid(),
  friend_group_id uuid not null references friend_groups(id) on delete cascade,
  target_user_id uuid not null references auth.users(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  resolved boolean not null default false
);
alter table friend_kick_votes enable row level security;
drop policy if exists "friend_kick_votes: group sees" on friend_kick_votes;
create policy "friend_kick_votes: group sees" on friend_kick_votes
  for select using (friend_group_id = any(my_friend_group_ids()));

create table if not exists friend_kick_ballots (
  id uuid primary key default gen_random_uuid(),
  kick_vote_id uuid not null references friend_kick_votes(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  vote boolean not null,
  created_at timestamptz not null default now(),
  unique (kick_vote_id, user_id)
);
alter table friend_kick_ballots enable row level security;
drop policy if exists "friend_kick_ballots: group sees" on friend_kick_ballots;
create policy "friend_kick_ballots: group sees" on friend_kick_ballots
  for select using (exists (select 1 from friend_kick_votes v where v.id = kick_vote_id and v.friend_group_id = any(my_friend_group_ids())));

-- propõe remover alguém: já conta como o primeiro voto (a favor) de quem propôs
create or replace function propose_kick_vote(p_friend_group_id uuid, p_target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  vid uuid;
begin
  if not (p_friend_group_id = any(my_friend_group_ids())) then
    raise exception 'sem acesso a essa turma';
  end if;
  if p_target_user_id = auth.uid() then
    raise exception 'nao_pode_votar_em_si';
  end if;
  if not exists (select 1 from friend_members where friend_group_id = p_friend_group_id and user_id = p_target_user_id) then
    raise exception 'pessoa_nao_esta_na_turma';
  end if;
  if exists (select 1 from friend_kick_votes where friend_group_id = p_friend_group_id and target_user_id = p_target_user_id and resolved = false) then
    raise exception 'ja_tem_votacao_ativa';
  end if;
  insert into friend_kick_votes (friend_group_id, target_user_id, created_by)
    values (p_friend_group_id, p_target_user_id, auth.uid()) returning id into vid;
  insert into friend_kick_ballots (kick_vote_id, user_id, vote) values (vid, auth.uid(), true);
  return vid;
end;
$$;
revoke all on function propose_kick_vote(uuid, uuid) from public;
grant execute on function propose_kick_vote(uuid, uuid) to authenticated;

-- vota sim/não numa votação ativa; se atingir maioria dos elegíveis (todo mundo menos o
-- alvo), remove a pessoa da turma automaticamente e fecha a votação
create or replace function cast_kick_ballot(p_kick_vote_id uuid, p_vote boolean)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v friend_kick_votes%rowtype;
  eligible int;
  yes_count int;
begin
  select * into v from friend_kick_votes where id = p_kick_vote_id;
  if not found or not (v.friend_group_id = any(my_friend_group_ids())) then
    raise exception 'votação não encontrada';
  end if;
  if v.resolved then
    return json_build_object('resolved', true);
  end if;
  if auth.uid() = v.target_user_id then
    raise exception 'nao_pode_votar_em_si';
  end if;

  insert into friend_kick_ballots (kick_vote_id, user_id, vote) values (p_kick_vote_id, auth.uid(), p_vote)
    on conflict (kick_vote_id, user_id) do update set vote = excluded.vote;

  select count(*) into eligible from friend_members where friend_group_id = v.friend_group_id and user_id <> v.target_user_id;
  select count(*) into yes_count from friend_kick_ballots where kick_vote_id = p_kick_vote_id and vote = true;

  if eligible > 0 and yes_count > eligible / 2.0 then
    delete from friend_members where friend_group_id = v.friend_group_id and user_id = v.target_user_id;
    update friend_kick_votes set resolved = true where id = p_kick_vote_id;
    return json_build_object('resolved', true, 'removed', true, 'yes', yes_count, 'eligible', eligible);
  end if;
  return json_build_object('resolved', false, 'yes', yes_count, 'eligible', eligible);
end;
$$;
revoke all on function cast_kick_ballot(uuid, boolean) from public;
grant execute on function cast_kick_ballot(uuid, boolean) to authenticated;

-- ---------- comentar num achado (Experiências) ----------

create table if not exists friend_find_comments (
  id uuid primary key default gen_random_uuid(),
  find_id uuid not null references friend_finds(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  text text not null check (char_length(text) between 1 and 300),
  created_at timestamptz not null default now()
);
alter table friend_find_comments enable row level security;

drop policy if exists "friend_find_comments: group sees" on friend_find_comments;
create policy "friend_find_comments: group sees" on friend_find_comments
  for select using (exists (select 1 from friend_finds f where f.id = find_id and f.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_find_comments: write own" on friend_find_comments;
create policy "friend_find_comments: write own" on friend_find_comments
  for insert with check (user_id = auth.uid() and exists (select 1 from friend_finds f where f.id = find_id and f.friend_group_id = any(my_friend_group_ids())));

drop policy if exists "friend_find_comments: delete own" on friend_find_comments;
create policy "friend_find_comments: delete own" on friend_find_comments
  for delete using (user_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_kick_votes') then
    alter publication supabase_realtime add table friend_kick_votes;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_kick_ballots') then
    alter publication supabase_realtime add table friend_kick_ballots;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'friend_find_comments') then
    alter publication supabase_realtime add table friend_find_comments;
  end if;
end;
$$;
