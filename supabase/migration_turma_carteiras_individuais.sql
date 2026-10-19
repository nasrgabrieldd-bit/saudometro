-- Turma: moedas separadas por pessoa, igual já funciona no casal — acaba o "cofre comum"
-- onde qualquer um podia gastar o saldo de todo mundo. Cada membro só gasta o que ele mesmo
-- ganhou (resgates na Lojinha, ajudas do CapMart, envio de Capisurpresa). O saldo que já
-- estava acumulado até agora é dividido em partes iguais entre os membros atuais da turma —
-- não fica perdido, vira o saldo inicial de cada um. As moedas que os jogos já dão (Capibatman,
-- CapMart, Stop) já eram creditadas por pessoa (user_id), então continuam exatamente iguais.
-- É seguro rodar mais de uma vez (a divisão do saldo acumulado só acontece uma vez por turma).

-- 1) friend_coin_balances passa a ser por pessoa, não só por turma
create or replace view friend_coin_balances as
  select friend_group_id, user_id, sum(delta)::int as balance
  from friend_coin_ledger
  group by friend_group_id, user_id;

-- 2) divide o saldo já acumulado em cada turma igualmente entre os membros atuais —
-- só roda uma vez por turma (marca com uma entrada no próprio ledger, igual um "saldo
-- inicial da turma" já funciona hoje)
do $$
declare
  grp record;
  member_count int;
  total_balance int;
  target_share int;
  remainder int;
  mem record;
  idx int;
  current_for_user int;
  extra int;
begin
  for grp in select distinct friend_group_id from friend_coin_ledger loop
    if exists (
      select 1 from friend_coin_ledger
      where friend_group_id = grp.friend_group_id
        and reason = 'divisão igualitária do cofre (migração carteiras individuais)'
    ) then
      continue;
    end if;

    select count(*) into member_count from friend_members where friend_group_id = grp.friend_group_id;
    if member_count = 0 then continue; end if;

    select coalesce(sum(delta), 0) into total_balance from friend_coin_ledger where friend_group_id = grp.friend_group_id;
    target_share := total_balance / member_count;
    remainder := total_balance - (target_share * member_count);

    idx := 0;
    for mem in select user_id from friend_members where friend_group_id = grp.friend_group_id order by joined_at loop
      select coalesce(sum(delta), 0) into current_for_user
        from friend_coin_ledger where friend_group_id = grp.friend_group_id and user_id = mem.user_id;
      extra := case when idx < remainder then 1 else 0 end;
      insert into friend_coin_ledger (friend_group_id, user_id, delta, reason)
        values (grp.friend_group_id, mem.user_id, (target_share + extra) - current_for_user, 'divisão igualitária do cofre (migração carteiras individuais)');
      idx := idx + 1;
    end loop;
  end loop;
end;
$$;

-- 3) Capisurpresa na turma: cobra do saldo de quem ENVIA, não do saldo da turma inteira
create or replace function create_capisurpresa(
  p_mode text, p_couple_id uuid, p_friend_group_id uuid,
  p_recipient_role text, p_recipient_user_id uuid,
  p_composition jsonb, p_duration int, p_scheduled timestamptz, p_operation text
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  existing capisurpresas%rowtype;
  sender_role text;
  sender_uid uuid := auth.uid();
  template text;
  elements jsonb;
  has_photo boolean; has_stroke boolean; has_sticker boolean;
  cost int;
  status text;
  rid uuid;
  balance int;
begin
  select * into existing from capisurpresas where operation = p_operation;
  if found then
    return json_build_object('id', existing.id, 'status', existing.status, 'cost', existing.cost);
  end if;

  if p_operation is null or length(p_operation) = 0 or length(p_operation) > 100 then
    raise exception 'operação inválida';
  end if;
  if p_duration not in (0, 15, 30, 60, 180) then raise exception 'duração inválida'; end if;
  if p_scheduled is not null and p_scheduled <= now() then raise exception 'escolha uma data futura'; end if;

  if p_composition is null or (p_composition->>'version')::int is distinct from 1
     or jsonb_typeof(p_composition->'elements') <> 'array'
     or jsonb_array_length(p_composition->'elements') > 80
     or length(p_composition::text) > 8000000 then
    raise exception 'composição inválida';
  end if;
  template := p_composition->>'template';
  if template not in ('smile', 'sign', 'quote', 'note', 'capi') then raise exception 'composição inválida'; end if;

  elements := p_composition->'elements';
  has_photo := exists (select 1 from jsonb_array_elements(elements) e where e->>'kind' = 'photo');
  has_stroke := exists (select 1 from jsonb_array_elements(elements) e where e->>'kind' = 'stroke');
  has_sticker := exists (select 1 from jsonb_array_elements(elements) e where e->>'kind' = 'sticker');
  cost := case when has_photo then 12 when has_stroke then 10 when template = 'note' and has_sticker then 8 else 5 end;
  status := case when p_scheduled is not null then 'agendada' else 'disponivel' end;

  if p_mode = 'casal' then
    sender_role := my_role();
    if p_couple_id is null or p_couple_id <> my_couple_id() then raise exception 'casal não encontrado'; end if;
    if p_recipient_role is null or p_recipient_role = sender_role or p_recipient_role not in ('gabriel', 'tata') then
      raise exception 'destinatário inválido';
    end if;
    select balance into balance from coin_balances where couple_id = p_couple_id and role = sender_role;
    if coalesce(balance, 0) < cost then raise exception 'Saldo insuficiente'; end if;
    insert into capisurpresas (couple_id, sender_role, recipient_role, composition, cost, operation, status, duration_minutes, scheduled_at, available_at, expires_at)
      values (p_couple_id, sender_role, p_recipient_role, p_composition, cost, p_operation, status, p_duration,
              p_scheduled, case when p_scheduled is null then now() else null end,
              case when p_scheduled is null and p_duration <> 0 then now() + (p_duration || ' minutes')::interval else null end)
      returning id into rid;
    insert into coin_ledger (couple_id, role, delta, reason) values (p_couple_id, sender_role, -cost, 'Capisurpresa enviada');
  elsif p_mode = 'turma' then
    if p_friend_group_id is null or not (p_friend_group_id = any(my_friend_group_ids())) then
      raise exception 'turma não encontrada';
    end if;
    if p_recipient_user_id is null or p_recipient_user_id = sender_uid then raise exception 'destinatário inválido'; end if;
    if not exists (select 1 from friend_members where friend_group_id = p_friend_group_id and user_id = p_recipient_user_id) then
      raise exception 'destinatário não faz parte da turma';
    end if;
    select fcb.balance into balance from friend_coin_balances fcb where fcb.friend_group_id = p_friend_group_id and fcb.user_id = sender_uid;
    if coalesce(balance, 0) < cost then raise exception 'Saldo insuficiente'; end if;
    insert into capisurpresas (friend_group_id, sender_user_id, recipient_user_id, composition, cost, operation, status, duration_minutes, scheduled_at, available_at, expires_at)
      values (p_friend_group_id, sender_uid, p_recipient_user_id, p_composition, cost, p_operation, status, p_duration,
              p_scheduled, case when p_scheduled is null then now() else null end,
              case when p_scheduled is null and p_duration <> 0 then now() + (p_duration || ' minutes')::interval else null end)
      returning id into rid;
    insert into friend_coin_ledger (friend_group_id, user_id, delta, reason) values (p_friend_group_id, sender_uid, -cost, 'Capisurpresa enviada');
  else
    raise exception 'modo inválido';
  end if;

  return json_build_object('id', rid, 'status', status, 'cost', cost);
end;
$$;
revoke all on function create_capisurpresa(text, uuid, uuid, text, uuid, jsonb, int, timestamptz, text) from public;
grant execute on function create_capisurpresa(text, uuid, uuid, text, uuid, jsonb, int, timestamptz, text) to authenticated;

-- 4) saldo reportado pelo CapMart na turma: da pessoa, não da turma inteira
create or replace function capmart_balance(p_wallet_mode text, p_couple_id uuid, p_friend_group_id uuid, p_user_id uuid)
returns int
language sql
stable
set search_path = public
as $$
  select case
    when p_wallet_mode = 'casal' then (
      select cb.balance from coin_balances cb
      where cb.couple_id = p_couple_id and cb.role = (select pr.role from profiles pr where pr.id = p_user_id)
    )
    else (select fcb.balance from friend_coin_balances fcb where fcb.friend_group_id = p_friend_group_id and fcb.user_id = p_user_id)
  end;
$$;
revoke all on function capmart_balance(text, uuid, uuid, uuid) from public, authenticated;
