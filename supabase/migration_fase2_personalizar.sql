-- Fase 2: mudanças de configuração aparecem na hora pro outro do casal (tempo real).
-- É seguro rodar mais de uma vez.
do $$
begin
  alter publication supabase_realtime add table couple_settings;
exception when duplicate_object then null;
end $$;
