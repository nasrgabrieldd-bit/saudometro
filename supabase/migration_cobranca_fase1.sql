-- Fase 1 (infraestrutura de cobrança): estrutura de plano no banco. Só guarda o status —
-- nenhum recurso existente fica travado ainda (isso é a Fase 2, feita numa rodada separada
-- de propósito, pra não arriscar quebrar algo que já é grátis hoje).
-- É seguro rodar mais de uma vez.

-- ------------------------------------------------------------
-- PLANO DO CASAL (compartilhado: quem paga cobre os dois papéis)
-- ------------------------------------------------------------

alter table couples add column if not exists plan text check (plan in ('gratis', 'entrada', 'acessivel', 'premium'));
alter table couples add column if not exists plan_expires_at timestamptz;
alter table couples add column if not exists plan_source text check (plan_source in ('legado', 'mercado_pago', 'manual'));

-- todo casal que já existe hoje é "legado": nunca perde acesso, não importa o valor de `plan`.
-- Só roda essa marcação pros que ainda não têm plan_source nenhum (não sobrescreve de novo).
update couples set plan_source = 'legado' where plan_source is null;

-- ------------------------------------------------------------
-- PLANO DA PESSOA (Modo Amigos: cada um paga o próprio benefício, vale em toda turma sua)
-- ------------------------------------------------------------

create table if not exists user_plans (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text check (plan in ('gratis', 'entrada', 'acessivel', 'premium')),
  plan_expires_at timestamptz,
  plan_source text check (plan_source in ('legado', 'mercado_pago', 'manual')),
  updated_at timestamptz not null default now()
);
alter table user_plans enable row level security;

drop policy if exists "user_plans: read own" on user_plans;
create policy "user_plans: read own" on user_plans
  for select using (user_id = auth.uid());
-- sem policy de insert/update/delete: só a Edge Function (service role) escreve aqui,
-- ignorando RLS — igual ao padrão de app_errors/code_attempts.

-- todo mundo que já é membro de alguma turma hoje é "legado": nunca perde acesso.
insert into user_plans (user_id, plan_source)
select distinct user_id, 'legado' from friend_members
on conflict (user_id) do update set plan_source = 'legado' where user_plans.plan_source is null;
