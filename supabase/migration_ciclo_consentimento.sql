-- Consentimento do ciclo menstrual (dado sensível, LGPD art. 11).
-- Guarda quando a pessoa aceitou o aviso e exige o aceite pra criar o registro do ciclo.
-- É seguro rodar mais de uma vez.

alter table cycle_settings add column if not exists consent_at timestamptz;

drop policy if exists "cycle_settings: insert own" on cycle_settings;
create policy "cycle_settings: insert own" on cycle_settings
  for insert with check (
    couple_id = my_couple_id() and role = my_role() and my_gender() = 'mulher' and consent_at is not null
  );
