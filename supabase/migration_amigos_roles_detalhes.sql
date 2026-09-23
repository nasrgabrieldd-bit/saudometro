-- Modo Amigos: Rolês ganha um campo de detalhes opcional (endereço, o que levar) —
-- do estudo sobre Partiful (o "Text Blast" resolve dúvida de última hora dos convidados).
-- É seguro rodar mais de uma vez.

alter table friend_events add column if not exists details text not null default '';
