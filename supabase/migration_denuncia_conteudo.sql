-- Moderação de conteúdo (Modo Amigos): denúncia + revisão manual, sem esconder nada
-- automaticamente. Mesmo padrão de "só grava, ninguém lê pelo app" que já existe pra
-- app_errors/code_attempts: RLS ligado, zero policy, escrita só via RPC, leitura só via
-- RPC protegida pela senha do "modo dono" que já existe.
-- É seguro rodar mais de uma vez.

create table if not exists content_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null,
  target_kind text not null check (target_kind in ('achado', 'feed_post', 'feed_comment', 'find_comment')),
  target_id uuid not null,
  reason text not null,
  created_at timestamptz not null default now()
);
alter table content_reports enable row level security; -- sem policies: só as funções abaixo mexem
create index if not exists content_reports_target_idx on content_reports (target_kind, target_id);

-- denunciar: exige login de verdade, limita 20 denúncias/hora por pessoa (reaproveita o
-- throttle genérico criado na rodada de segurança técnica) pra evitar spam de denúncia.
create or replace function report_content(p_kind text, p_target_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'não autenticado';
  end if;
  if p_kind not in ('achado', 'feed_post', 'feed_comment', 'find_comment') then
    raise exception 'tipo inválido';
  end if;
  perform assert_action_not_throttled('report_content', 20, interval '1 hour');
  insert into content_reports (reporter_id, target_kind, target_id, reason)
  values (auth.uid(), p_kind, p_target_id, left(coalesce(p_reason, 'outro'), 60));
end;
$$;

revoke all on function report_content(text, uuid, text) from public;
grant execute on function report_content(text, uuid, text) to authenticated;

-- modo dono: denúncias dos últimos 30 dias, agrupadas por conteúdo denunciado, com um
-- preview de até 200 caracteres do conteúdo de verdade (pra revisar sem abrir o Table Editor).
create or replace function admin_content_reports(p_key text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  ok boolean;
begin
  select exists(select 1 from app_admin_secret where key = p_key) into ok;
  if not ok then
    perform pg_sleep(1.5);
    raise exception 'acesso negado';
  end if;

  return (
    select coalesce(json_agg(row_to_json(t)), '[]'::json) from (
      select
        target_kind,
        target_id,
        count(*) as reports,
        count(distinct reporter_id) as reporters,
        max(created_at) as last_reported,
        max(reason) as sample_reason,
        case target_kind
          when 'achado' then (select left(coalesce(title, '') || ' — ' || coalesce(note, ''), 200) from friend_finds where id = target_id)
          when 'feed_post' then (select left(coalesce(caption, ''), 200) from friend_feed_posts where id = target_id)
          when 'feed_comment' then (select left(coalesce(text, ''), 200) from friend_feed_comments where id = target_id)
          when 'find_comment' then (select left(coalesce(text, ''), 200) from friend_find_comments where id = target_id)
        end as content_preview
      from content_reports
      where created_at > now() - interval '30 days'
      group by target_kind, target_id
      order by max(created_at) desc
      limit 50
    ) t
  );
end;
$$;

revoke all on function admin_content_reports(text) from public;
grant execute on function admin_content_reports(text) to anon, authenticated;
