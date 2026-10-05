import type { Progress } from './contracts';
import type { Result } from '../engine/types';
export const defaultProgress = (): Progress => ({ version: 1, unlocked: 1, records: {}, tutorialDone: false, preferences: { sound: false, reducedMotion: false } });
export function mergeResult(p: Progress, r: Result): Progress {
  if (!r.won || r.daily) return p;
  const old = p.records[r.levelId];
  return { ...p, unlocked: Math.max(p.unlocked, Math.min(60, r.levelId + 1)), records: { ...p.records, [r.levelId]: { completed: true, stars: Math.max(old?.stars ?? 0, r.stars), score: Math.max(old?.score ?? 0, r.score) } } };
}
export function localDay(date = new Date()): string { return new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }
