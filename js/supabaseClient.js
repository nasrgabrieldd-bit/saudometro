import { createClient } from "./vendor/supabase.js";

// Preencha com os dados do SEU projeto Supabase:
// Project Settings > API > "Project URL" e "anon public" key.
// Esses dois valores não são secretos (ficam visíveis no navegador de qualquer jeito),
// então pode deixar aqui sem problema.
const SUPABASE_URL = "https://dqnkgzumwwildwrlioer.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_vqTLMORo1lr0Rs8fZb1gNw_B60LAlpL";

export const isConfigured =
  !SUPABASE_URL.startsWith("COLE_AQUI") && !SUPABASE_ANON_KEY.startsWith("COLE_AQUI");

export const supabase = isConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;
