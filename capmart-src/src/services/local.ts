import type { CapMartServices, Persistence, Progress, Receipt, RankingEntry } from '../../integration/contracts';
import type { Result } from '../engine/types';
import { RULES, type Help } from '../engine/config';
import { defaultProgress, localDay, mergeResult } from './progress';
import { dailyLevel, levelForVersion } from '../levels';
import { validateReplay } from '../engine/replay';
interface Purchase { approved: boolean; runId: string; help: Help; levelId: number }
interface Store { progress: Progress; balance: number; rewards: string[]; receipts: Record<string, Receipt>; purchases: Record<string, Purchase>; results: Result[] }
export const browserPersistence: Persistence = { read: key => localStorage.getItem(key), write: (key, value) => localStorage.setItem(key, value) };
export function createLocalServices(persistence: Persistence = browserPersistence, userId = 'local-capivara', day = localDay): CapMartServices {
  const key = `capmart:v1:${userId}`;
  const read = (): Store => {
    const raw = persistence.read(key);
    if (raw) { try { const v = JSON.parse(raw); if (v.progress?.version === 1 && Number.isFinite(v.balance) && v.balance >= 0 && Array.isArray(v.rewards) && v.receipts && v.purchases && Array.isArray(v.results)) return v; } catch { /* Recover damaged local data with a clean development profile. */ } }
    return { progress: defaultProgress(), balance: 50, rewards: [], receipts: {}, purchases: {}, results: [] };
  };
  const write = (s: Store) => persistence.write(key, JSON.stringify(s));
  return {
    identity: { id: userId, displayName: 'Capivara' },
    async loadProgress() { return structuredClone(read().progress); },
    async saveProgress(p) { const s = read(); s.progress = { ...s.progress, tutorialDone: p.tutorialDone, preferences: { ...p.preferences } }; write(s); },
    async getBalance() { return read().balance; },
    async purchaseHelp({ requestId, runId, help, levelId }) { const s = read(); if (!requestId || !runId || !Object.hasOwn(RULES.costs, help)) throw new Error('Compra inválida.'); if (Object.hasOwn(s.purchases, requestId)) { const p = s.purchases[requestId]; if (p.runId !== runId || p.help !== help || p.levelId !== levelId) throw new Error('Recibo usado para outra compra.'); return { approved: p.approved, balance: s.balance }; } const approved = s.balance >= RULES.costs[help]; if (approved) s.balance -= RULES.costs[help]; s.purchases = { ...s.purchases, [requestId]: { approved, runId, help, levelId } }; write(s); return { approved, balance: s.balance }; },
    async submitResult(r) {
      const s = read(); if (Object.hasOwn(s.receipts, r.runId)) return structuredClone(s.receipts[r.runId]);
      if (!Number.isInteger(r.levelId) || r.levelId < 1 || r.levelId > 60 || (!r.daily && r.levelId > s.progress.unlocked) || !Number.isFinite(r.score) || r.score < 0 || !Number.isInteger(r.stars) || r.stars < 0 || r.stars > 3 || (r.won && r.stars === 0)) throw new Error('Resultado inválido.');
      if (!r.runId || !Array.isArray(r.events)) throw new Error('Resultado inválido.');
      if (!r.daily && r.seed !== r.levelId * 7919) throw new Error('Configuração de campanha inválida.');
      const today = day(), yesterday = new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
      const challengeDay = r.dailyDay ?? today;
      if (r.daily && challengeDay !== today && challengeDay !== yesterday) throw new Error('Desafio diário expirado.');
      if (r.daily && (r.levelId !== 45 || r.seed !== dailyLevel(challengeDay).seed)) throw new Error('Desafio diário inválido.');
      validateReplay(levelForVersion(r.levelId, r.seed, r.configVersion ?? 1), r);
      const paid = Object.values(s.purchases).filter(p => p.approved && p.runId === r.runId && p.levelId === r.levelId);
      const used: Partial<Record<Help, number>> = {};
      for (const event of r.events) if (event.kind === 'help' && !(r.levelId === 1 && event.help === 'hint')) {
        used[event.help] = (used[event.help] ?? 0) + 1;
        if (used[event.help]! > paid.filter(p => p.help === event.help).length) throw new Error('Ajuda sem compra confirmada.');
      }
      const previousRecord = r.daily ? Math.max(0, ...s.results.filter(x => x.daily && x.seed === r.seed).map(x => x.score)) : s.progress.records[r.levelId]?.score ?? 0;
      let awarded = 0;
      const grant = (id: string, amount: number) => { if (!s.rewards.includes(id)) { s.rewards.push(id); awarded += amount; } };
      if (r.won) { if (!r.daily) { grant(`level:${r.levelId}`, RULES.rewards.completion); if (r.stars === 3) grant(`stars:${r.levelId}`, RULES.rewards.threeStars); } grant(`win:${today}`, RULES.rewards.firstDailyWin); if (r.daily) grant(`daily:${challengeDay}`, RULES.rewards.dailyChallenge); }
      s.progress = mergeResult(s.progress, r); s.balance += awarded; s.results.push(r); s.results = s.results.slice(-200);
      const receipt = { balance: s.balance, awarded, previousRecord, progress: s.progress }; s.receipts = { ...s.receipts, [r.runId]: structuredClone(receipt) }; write(s); return receipt;
    },
    async getRanking({ levelId, seed, configVersion = 1 }) { const rows: RankingEntry[] = read().results.filter(r => r.won && r.levelId === levelId && r.seed === seed && (r.configVersion ?? 1) === configVersion).map(r => ({ userId, name: 'Você · perfil local', score: r.score, assisted: r.assisted, seed, configVersion })); return rows.sort((a, b) => b.score - a.score).slice(0, 10); },
  };
}
