-- Turma: adiciona "quer conversar" e recado livre no humor do dia, igual o casal já tinha.
-- Seguro rodar mais de uma vez.

alter table friend_moods add column if not exists wants_to_talk text not null default 'talvez' check (wants_to_talk in ('sim', 'nao', 'talvez'));
alter table friend_moods add column if not exists note text not null default '';
