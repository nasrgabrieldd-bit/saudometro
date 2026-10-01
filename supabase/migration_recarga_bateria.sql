-- Recarregar a bateria vira flexível: quem precisa escolhe a data e quantos dias (não mais só
-- sexta-sábado-domingo fixo), e o parceiro precisa aceitar antes de valer. Substitui por
-- completo o antigo weekend_recharge (que era independente por pessoa, sem aceite).
-- É seguro rodar mais de uma vez.

create table if not exists recharge_periods (
  id uuid primary key default gen_random_uuid(),
  couple_id uuid not null references couples(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  proposed_by text not null check (proposed_by in ('gabriel', 'tata')),
  status text not null default 'pendente' check (status in ('pendente', 'aceito', 'recusado', 'cancelado')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

alter table recharge_periods enable row level security;
drop policy if exists "recharge_periods: couple access" on recharge_periods;
create policy "recharge_periods: couple access" on recharge_periods
  for all using (couple_id = my_couple_id()) with check (couple_id = my_couple_id());

create index if not exists recharge_periods_couple_idx on recharge_periods (couple_id, status, end_date);

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'recharge_periods') then
    alter publication supabase_realtime add table recharge_periods;
  end if;
end;
$$;

-- a tabela antiga fica totalmente substituída pela de cima
drop table if exists weekend_recharge;
