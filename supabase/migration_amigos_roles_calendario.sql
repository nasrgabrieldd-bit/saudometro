-- Modo Amigos: aba Rolês vira calendário de verdade (mês inteiro, igual o do casal), com
-- categoria por evento (rolê/trabalho/outro) — antes era só uma lista dos próximos.
-- É seguro rodar mais de uma vez.

alter table friend_events add column if not exists category text not null default 'amigos'
  check (category in ('amigos', 'trabalho', 'outro'));
