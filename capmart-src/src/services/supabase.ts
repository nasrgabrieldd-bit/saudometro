// Serviços reais do Saudômetro pro CapMart — substitui o simulador (services/local.ts) em
// produção. Reaproveita a sessão já autenticada do app principal (mesmo projeto Supabase,
// mesma origem, localStorage compartilhado) e as duas Edge Functions que fazem a validação
// de verdade (capmart-purchase/capmart-submit) — nenhuma lógica de preço/recompensa/replay
// foi duplicada aqui, só a ligação com o host.
import { createClient } from '@supabase/supabase-js';
import type { CapMartServices, Identity, Progress, Receipt, RankingEntry, Mode } from '../../integration/contracts';

// mesmos valores públicos já usados em js/supabaseClient.js do app principal — não são
// segredo (RLS que protege), então reaproveitar aqui é seguro.
const SUPABASE_URL = 'https://dqnkgzumwwildwrlioer.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_vqTLMORo1lr0Rs8fZb1gNw_B60LAlpL';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export interface LaunchContext {
  walletMode: 'casal' | 'turma';
  coupleId: string | null;
  friendGroupId: string | null;
}

// lê quem está logado e resolve o contexto (casal ou turma) a partir da URL
// (?mode=casal ou ?mode=turma&group=<id>) — o app principal manda esses parâmetros ao abrir
// o CapMart, porque só ele sabe em qual modo/turma a pessoa estava.
export async function resolveLaunch(): Promise<{ identity: Identity; context: LaunchContext } | { error: string }> {
  const { data: sessionData } = await supabase.auth.getSession();
  const user = sessionData?.session?.user;
  if (!user) return { error: 'Não encontramos sua sessão. Volte pro Saudômetro e entre de novo.' };

  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');

  if (mode === 'turma') {
    const groupId = params.get('group');
    if (!groupId) return { error: 'Turma não informada.' };
    const { data: member } = await supabase.from('friend_members').select('display_name').eq('friend_group_id', groupId).eq('user_id', user.id).maybeSingle();
    if (!member) return { error: 'Você não faz parte dessa turma.' };
    return {
      identity: { id: user.id, displayName: member.display_name || 'Jogador', groupId },
      context: { walletMode: 'turma', coupleId: null, friendGroupId: groupId },
    };
  }

  const { data: profile } = await supabase.from('profiles').select('couple_id, role, display_name').eq('id', user.id).maybeSingle();
  if (!profile?.couple_id) return { error: 'Não encontramos seu casal.' };
  return {
    identity: { id: user.id, displayName: profile.display_name || (profile.role === 'tata' ? 'Tata' : 'Gabriel'), partnerId: profile.couple_id },
    context: { walletMode: 'casal', coupleId: profile.couple_id, friendGroupId: null },
  };
}

async function authedFetch(path: string, body: unknown) {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('não autenticado');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || 'não deu certo');
  return json;
}

export function createSupabaseServices(identity: Identity, context: LaunchContext, onNavOpen?: () => void, onNavClose?: () => void): CapMartServices {
  return {
    identity,
    async loadProgress(): Promise<Progress> {
      const { data } = await supabase.from('capmart_progress').select('*').eq('user_id', identity.id).maybeSingle();
      return {
        version: 1,
        unlocked: data?.unlocked ?? 1,
        records: data?.records ?? {},
        tutorialDone: data?.tutorial_done ?? false,
        preferences: data?.preferences ?? { sound: true, reducedMotion: false },
      };
    },
    async saveProgress(progress: Progress) {
      const { error } = await supabase.rpc('capmart_save_progress', { p_tutorial_done: progress.tutorialDone, p_preferences: progress.preferences });
      if (error) throw error;
    },
    async getBalance(): Promise<number> {
      if (context.walletMode === 'casal') {
        const { data: profile } = await supabase.from('profiles').select('role').eq('id', identity.id).maybeSingle();
        const { data } = await supabase.from('coin_balances').select('balance').eq('couple_id', context.coupleId).eq('role', profile?.role).maybeSingle();
        return data?.balance ?? 0;
      }
      const { data } = await supabase.from('friend_coin_balances').select('balance').eq('friend_group_id', context.friendGroupId).maybeSingle();
      return data?.balance ?? 0;
    },
    async purchaseHelp(input) {
      return authedFetch('capmart-purchase', { ...input, walletMode: context.walletMode, coupleId: context.coupleId, friendGroupId: context.friendGroupId });
    },
    async submitResult(result): Promise<Receipt> {
      return authedFetch('capmart-submit', { result, walletMode: context.walletMode, coupleId: context.coupleId, friendGroupId: context.friendGroupId });
    },
    async getRanking(input): Promise<RankingEntry[]> {
      const mode: Mode = input.mode;
      const { data, error } = await supabase.rpc('capmart_get_ranking', {
        p_mode: mode, p_level_id: input.levelId, p_seed: input.seed, p_config_version: input.configVersion ?? 1,
      });
      if (error) throw error;
      return (data || []).map((r: any) => ({ userId: r.user_id, name: r.name, score: r.score, assisted: r.assisted, seed: Number(r.seed), configVersion: r.config_version }));
    },
    onOpen: onNavOpen,
    onClose: onNavClose,
  };
}
