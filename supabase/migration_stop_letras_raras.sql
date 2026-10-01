-- Stop: Q, X e Z continuam podendo sair, mas agora bem mais raramente (pesos desiguais) em vez
-- de terem a mesma chance que as outras 20 letras. É seguro rodar mais de uma vez.

create or replace function pick_stop_letter(p_used text[])
returns text
language sql
as $$
  select letter from (
    select 'A' as letter, 4 as weight union all select 'B', 4 union all select 'C', 4 union all
    select 'D', 4 union all select 'E', 4 union all select 'F', 4 union all select 'G', 4 union all
    select 'H', 4 union all select 'I', 4 union all select 'J', 4 union all select 'L', 4 union all
    select 'M', 4 union all select 'N', 4 union all select 'O', 4 union all select 'P', 4 union all
    select 'Q', 1 union all select 'R', 4 union all select 'S', 4 union all select 'T', 4 union all
    select 'U', 4 union all select 'V', 4 union all select 'X', 1 union all select 'Z', 1
  ) pool
  where letter <> all (coalesce(p_used, '{}'::text[]))
  order by random() ^ (1.0 / weight) desc
  limit 1;
$$;
revoke all on function pick_stop_letter(text[]) from public;
grant execute on function pick_stop_letter(text[]) to authenticated;
