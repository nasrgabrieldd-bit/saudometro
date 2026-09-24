-- Modo Amigos: achados (filme/série/jogo/playlist) agora podem ter uma foto, pra aparecer
-- misturados com o feed de fotos numa lista só (uma etiqueta pequena diferencia "Feed" de
-- "Achado"). Também adiciona a opção da pessoa sair da turma sozinha, sem precisar de votação
-- (votação continua sendo só pra remover OUTRA pessoa). É seguro rodar mais de uma vez.

alter table friend_finds add column if not exists photo_path text;

create or replace function leave_friend_group(p_friend_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from friend_members where friend_group_id = p_friend_group_id and user_id = auth.uid();
end;
$$;
