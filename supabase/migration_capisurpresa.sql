-- Capisurpresa: bilhete/desenho/foto com Capilovers, enviado pro parceiro (casal) ou pra
-- alguém da turma, que expira sozinho depois de um tempo. Moedas reais (coin_ledger no
-- casal, cofre da friend_coin_ledger na turma), débito/criação atômicos numa função só,
-- idempotência por "operation" (evita cobrar 2x se o app reenviar por falha de rede),
-- e status calculado na hora da leitura (agendada->disponível, disponível->expirada) —
-- mesmo truque de "libera por data" que recharge_periods/cápsula do tempo já usam, sem
-- precisar de cron. É seguro rodar mais de uma vez.

create table if not exists capisurpresas (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid references couples(id) on delete cascade,
  friend_group_id uuid references friend_groups(id) on delete cascade,
  sender_role text check (sender_role in ('gabriel', 'tata')),
  recipient_role text check (recipient_role in ('gabriel', 'tata')),
  sender_user_id uuid references auth.users(id),
  recipient_user_id uuid references auth.users(id),
  composition jsonb not null,
  cost int not null,
  operation text not null unique,
  status text not null default 'disponivel' check (status in ('agendada', 'disponivel', 'visualizada', 'expirada', 'cancelada', 'falha')),
  duration_minutes int not null check (duration_minutes in (0, 15, 30, 60, 180)),
  scheduled_at timestamptz,
  available_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  viewed_at timestamptz,
  constraint capisurpresas_owner_check check (
    (couple_id is not null and friend_group_id is null and sender_role is not null and recipient_role is not null and sender_user_id is null and recipient_user_id is null)
    or
    (friend_group_id is not null and couple_id is null and sender_user_id is not null and recipient_user_id is not null and sender_role is null and recipient_role is null)
  )
);
create index if not exists capisurpresas_couple_idx on capisurpresas (couple_id, status);
create index if not exists capisurpresas_friend_idx on capisurpresas (friend_group_id, status);

alter table capisurpresas enable row level security;
drop policy if exists "capisurpresas: sender or recipient sees" on capisurpresas;
create policy "capisurpresas: sender or recipient sees" on capisurpresas
  for select using (
    (couple_id is not null and couple_id = my_couple_id() and (sender_role = my_role() or recipient_role = my_role()))
    or
    (friend_group_id is not null and friend_group_id = any(my_friend_group_ids()) and (sender_user_id = auth.uid() or recipient_user_id = auth.uid()))
  );
-- sem policy de insert/update/delete: só as funções abaixo (security definer) escrevem,
-- garantindo preço calculado no servidor e débito atômico junto com a criação.
revoke all on capisurpresas from public, authenticated;
grant select on capisurpresas to authenticated; -- a policy acima já restringe às próprias linhas

-- cria e cobra numa transação só: preço calculado aqui (nunca confia no preço do
-- cliente), idempotente por "operation" (reenvio por falha de rede devolve o mesmo
-- registro em vez de cobrar de novo), confere saldo antes de debitar.
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
    select fcb.balance into balance from friend_coin_balances fcb where fcb.friend_group_id = p_friend_group_id;
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

-- lista as surpresas (enviadas e recebidas) do contexto atual (casal OU turma, só um dos
-- dois parâmetros), calculando o status efetivo na hora (agendada->disponível quando
-- chega a hora; disponível/visualizada->expirada quando passa o prazo) e escondendo a
-- composição de quem já expirou/cancelou/falhou, igual o pacote original fazia.
create or replace function list_capisurpresas(p_couple_id uuid, p_friend_group_id uuid)
returns table (
  id uuid, couple_id uuid, friend_group_id uuid,
  sender_role text, recipient_role text, sender_user_id uuid, recipient_user_id uuid,
  composition jsonb, cost int, status text, duration_minutes int,
  scheduled_at timestamptz, available_at timestamptz, expires_at timestamptz,
  created_at timestamptz, viewed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  now_ts timestamptz := now();
begin
  if p_couple_id is not null then
    if p_couple_id <> my_couple_id() then raise exception 'casal não encontrado'; end if;
    update capisurpresas c set status = 'disponivel', available_at = now_ts,
      expires_at = case when c.duration_minutes = 0 then null else now_ts + (c.duration_minutes || ' minutes')::interval end
      where c.couple_id = p_couple_id and c.status = 'agendada' and c.scheduled_at <= now_ts;
    update capisurpresas c set status = 'expirada'
      where c.couple_id = p_couple_id and c.status in ('disponivel', 'visualizada') and c.expires_at is not null and c.expires_at <= now_ts;
    return query select c.id, c.couple_id, c.friend_group_id, c.sender_role, c.recipient_role, c.sender_user_id, c.recipient_user_id,
      case when c.status in ('expirada', 'cancelada', 'falha') then null else c.composition end,
      c.cost, c.status, c.duration_minutes, c.scheduled_at, c.available_at, c.expires_at, c.created_at, c.viewed_at
      from capisurpresas c
      where c.couple_id = p_couple_id and (c.sender_role = my_role() or c.recipient_role = my_role())
      order by c.created_at desc;
  elsif p_friend_group_id is not null then
    if not (p_friend_group_id = any(my_friend_group_ids())) then raise exception 'turma não encontrada'; end if;
    update capisurpresas c set status = 'disponivel', available_at = now_ts,
      expires_at = case when c.duration_minutes = 0 then null else now_ts + (c.duration_minutes || ' minutes')::interval end
      where c.friend_group_id = p_friend_group_id and c.status = 'agendada' and c.scheduled_at <= now_ts;
    update capisurpresas c set status = 'expirada'
      where c.friend_group_id = p_friend_group_id and c.status in ('disponivel', 'visualizada') and c.expires_at is not null and c.expires_at <= now_ts;
    return query select c.id, c.couple_id, c.friend_group_id, c.sender_role, c.recipient_role, c.sender_user_id, c.recipient_user_id,
      case when c.status in ('expirada', 'cancelada', 'falha') then null else c.composition end,
      c.cost, c.status, c.duration_minutes, c.scheduled_at, c.available_at, c.expires_at, c.created_at, c.viewed_at
      from capisurpresas c
      where c.friend_group_id = p_friend_group_id and (c.sender_user_id = auth.uid() or c.recipient_user_id = auth.uid())
      order by c.created_at desc;
  else
    raise exception 'contexto inválido';
  end if;
end;
$$;
revoke all on function list_capisurpresas(uuid, uuid) from public;
grant execute on function list_capisurpresas(uuid, uuid) to authenticated;

-- abre (só o destinatário): marca como visualizada, se a duração for "até abrir" expira
-- na hora, devolve a composição pra exibir
create or replace function open_capisurpresa(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r capisurpresas%rowtype;
  is_recipient boolean;
  now_ts timestamptz := now();
begin
  select * into r from capisurpresas where id = p_id for update;
  if not found then raise exception 'surpresa não encontrada'; end if;
  is_recipient := (r.couple_id is not null and r.recipient_role = my_role() and r.couple_id = my_couple_id())
    or (r.friend_group_id is not null and r.recipient_user_id = auth.uid());
  if not is_recipient then raise exception 'acesso não autorizado'; end if;

  if r.status = 'agendada' and r.scheduled_at <= now_ts then
    update capisurpresas set status = 'disponivel', available_at = now_ts,
      expires_at = case when duration_minutes = 0 then null else now_ts + (duration_minutes || ' minutes')::interval end
      where id = p_id;
    select * into r from capisurpresas where id = p_id;
  end if;
  if r.expires_at is not null and r.expires_at <= now_ts and r.status in ('disponivel', 'visualizada') then
    update capisurpresas set status = 'expirada' where id = p_id;
    raise exception 'surpresa indisponível';
  end if;
  if r.status not in ('disponivel', 'visualizada') then raise exception 'surpresa indisponível'; end if;

  update capisurpresas set status = 'visualizada', viewed_at = coalesce(viewed_at, now_ts) where id = p_id;
  if r.duration_minutes = 0 then
    update capisurpresas set expires_at = now_ts where id = p_id;
  end if;
  return r.composition;
end;
$$;
revoke all on function open_capisurpresa(uuid) from public;
grant execute on function open_capisurpresa(uuid) to authenticated;

-- cancela (só o remetente, só enquanto ainda agendada) e estorna a moeda
create or replace function cancel_capisurpresa(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r capisurpresas%rowtype;
  is_sender boolean;
begin
  select * into r from capisurpresas where id = p_id for update;
  if not found then raise exception 'surpresa não encontrada'; end if;
  is_sender := (r.couple_id is not null and r.sender_role = my_role() and r.couple_id = my_couple_id())
    or (r.friend_group_id is not null and r.sender_user_id = auth.uid());
  if not is_sender then raise exception 'acesso não autorizado'; end if;
  if r.status <> 'agendada' then raise exception 'cancelamento indisponível'; end if;

  update capisurpresas set status = 'cancelada' where id = p_id;
  if r.couple_id is not null then
    insert into coin_ledger (couple_id, role, delta, reason) values (r.couple_id, r.sender_role, r.cost, 'Capisurpresa cancelada: estorno');
  else
    insert into friend_coin_ledger (friend_group_id, user_id, delta, reason) values (r.friend_group_id, r.sender_user_id, r.cost, 'Capisurpresa cancelada: estorno');
  end if;
end;
$$;
revoke all on function cancel_capisurpresa(uuid) from public;
grant execute on function cancel_capisurpresa(uuid) to authenticated;
