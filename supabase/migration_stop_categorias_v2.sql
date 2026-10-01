-- Stop: troca "Cidade" por "CEP" (freeform, não exige começar com a letra) e adiciona
-- "Apelido pro namorado(a)/sogra" ao pool clássico (agora 12 categorias, continua sorteando 6
-- por partida). É seguro rodar mais de uma vez.

-- amplia a constraint de categoria: troca 'cidade' por 'cep', acrescenta 'apelido_vinculo'
alter table stop_answers drop constraint if exists stop_answers_category_check;
alter table stop_answers add constraint stop_answers_category_check check (category in (
  'nome', 'animal', 'comida', 'cep', 'objeto', 'filme_serie', 'cor', 'pais', 'profissao', 'marca', 'fruta', 'apelido_vinculo',
  'lugar_beijo', 'elogio_picante', 'apelido_safado', 'fantasia_leve', 'peca_intima', 'programa_noite'
));

-- mesmo sorteio de 6 categorias, só que a partir do pool novo (12 chaves)
create or replace function start_stop_match(p_room_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  r game_rooms%rowtype;
  has_access boolean;
  existing_id uuid;
  mid uuid;
  letter text;
  chosen_categories text[];
begin
  select * into r from game_rooms where id = p_room_id;
  has_access := found and (
    (r.friend_group_id is not null and r.friend_group_id = any(my_friend_group_ids()))
    or (r.couple_id is not null and r.couple_id = my_couple_id())
  );
  if not has_access then
    raise exception 'sala não encontrada';
  end if;
  if r.game_type <> 'stop' then
    raise exception 'essa sala não é de stop';
  end if;

  select id into existing_id from stop_matches where room_id = p_room_id and status = 'playing';
  if existing_id is not null then
    return json_build_object('match_id', existing_id);
  end if;

  if (select count(*) from game_room_players where room_id = p_room_id and left_at is null) < 2 then
    raise exception 'precisa de pelo menos 2 jogadores pra começar';
  end if;

  select array_agg(key) into chosen_categories from (
    select unnest(array['nome', 'animal', 'comida', 'cep', 'objeto', 'filme_serie', 'cor', 'pais', 'profissao', 'marca', 'fruta', 'apelido_vinculo']) as key
    order by random() limit 6
  ) s;

  letter := pick_stop_letter('{}'::text[]);
  insert into stop_matches (room_id, current_letter, used_letters, round_ends_at, categories)
    values (p_room_id, letter, array[letter], now() + interval '90 seconds', chosen_categories)
    returning id into mid;

  return json_build_object('match_id', mid);
end;
$$;
revoke all on function start_stop_match(uuid) from public;
grant execute on function start_stop_match(uuid) to authenticated;
