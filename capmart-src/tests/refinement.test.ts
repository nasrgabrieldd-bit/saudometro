import { describe, expect, it } from 'vitest';
import { LEVELS, CONFIG_VERSION, levelForVersion } from '../src/levels';
import { LEVELS as LEGACY } from '../src/levels/legacy';
import { applyHelp, hint, move, startGame, stars, tick } from '../src/engine/game';
import { validateReplay } from '../src/engine/replay';
import { createLocalServices } from '../src/services/local';
import type { Game, Result } from '../src/engine/types';
import { defaultProgress, localDay } from '../src/services/progress';
const count = (l: typeof LEVELS[number]) => l.board.flat().filter(s => s.item !== null).length;
function solve(g: Game) { for (let i = 0; g.status === 'playing' && i < 500; i++) { const m = hint(g); if (!m) throw new Error('Sem solução'); g = move(g, m); } return g; }
function result(g: Game, id: string): Result { const score = g.resultScore ?? g.score; return { runId: id, levelId: g.level.id, seed: g.level.seed, configVersion: g.level.configVersion, score, stars: stars(score, g.level.stars, g.status === 'won'), won: g.status === 'won', assisted: g.assisted, elapsed: g.elapsed, moves: g.movesUsed, daily: false, events: g.events }; }
describe('refinamento de fases e compatibilidade', () => {
  it.each(LEVELS.slice(0, 10).map(l => [l.id, l] as const))('fase introdutória %i mantém tabuleiro e metas', (id, l) => { expect(l.board).toEqual(LEGACY[id - 1].board); expect(l.stars).toEqual(LEGACY[id - 1].stars); });
  // fases 61-110 são novas (não existiam na v1, então não têm equivalente em LEGACY pra
  // comparar) — ficam cobertas pelo teste de crescimento monotônico logo abaixo, que não
  // depende de LEGACY.
  it.each(LEVELS.slice(10, 60).map(l => [l.id, l] as const))('fase %i contém mais produtos, seis espaços estratégicos e estoque em trios', (id, l) => {
    expect(count(l)).toBeGreaterThan(count(LEGACY[id - 1]));
    expect(l.board.flat().filter(s => s.item === null)).toHaveLength(6);
    expect(l.board.flat().filter(s => s.item === null && s.unlockAt === 0).length).toBeGreaterThanOrEqual(3);
    expect(l.board.every(r => r.length === 3)).toBe(true);
    for (const row of l.board) expect(row.filter(s => s.item !== null).length !== 3 || new Set(row.map(s => s.item)).size > 1).toBe(true);
    if (l.pack >= 2) expect(l.board.flat().some(s => s.unlockAt > 0)).toBe(true);
  });
  it('estoque acessível cresce sem recuos nas transições de conjuntos', () => { for (let i = 1; i < LEVELS.length; i++) expect(count(LEVELS[i])).toBeGreaterThanOrEqual(count(LEVELS[i - 1])); });
  it('metas de três estrelas são alcançáveis com tempo ativo e sem ajudas', () => { for (const level of LEVELS) { let g = startGame(level); for (let i = 0; g.status === 'playing' && i < 500; i++) { g = tick(g, .75); g = move(g, hint(g)!); } expect(g.status).toBe('won'); expect(stars(g.resultScore!, level.stars)).toBe(3); } });
  it('legado pode ser reproduzido e versões não podem ser confundidas', () => { const old = solve(startGame(LEGACY[20])), r = result(old, 'old'); expect(validateReplay(levelForVersion(21, old.level.seed), r).status).toBe('won'); expect(() => validateReplay(LEVELS[20], r)).toThrow(); expect(() => levelForVersion(1, 7919, 9)).toThrow(); });
  it('progresso, recordes, carteira e recibos v1 são mantidos sem reinicialização', async () => {
    const g = solve(startGame(LEGACY[0])), old = result(g, 'legacy-run'), p = { ...defaultProgress(), unlocked: 34, records: { 1: { score: 9999, stars: 3, completed: true } }, tutorialDone: true };
    let raw = JSON.stringify({ progress: p, balance: 128, rewards: ['level:1', 'stars:1', `win:${localDay()}`], receipts: { 'legacy-run': { progress: p, balance: 128, awarded: 13, previousRecord: 0 } }, purchases: {}, results: [old] });
    const original = raw, services = createLocalServices({ read: () => raw, write: (_, v) => { raw = v; } });
    expect(await services.loadProgress()).toEqual(p); expect(await services.getBalance()).toBe(128); expect(raw).toBe(original);
    expect((await services.submitResult(old)).balance).toBe(128);
    const current = result(solve(startGame(LEVELS[0])), 'new-run'); expect((await services.submitResult(current)).awarded).toBe(0);
    expect((await services.loadProgress()).records[1]).toEqual(p.records[1]); expect((await services.loadProgress()).unlocked).toBe(34);
    expect(await services.getBalance()).toBe(128);
    expect((await services.getRanking({ mode: 'individual', levelId: 1, seed: 7919, configVersion: CONFIG_VERSION }))).toHaveLength(1);
    expect((await services.getRanking({ mode: 'individual', levelId: 1, seed: 7919 }))).toHaveLength(1);
  });
  it.each(LEVELS.filter(l => l.pack >= 1).map(l => [l.id, l] as const))('trocas livres e reorganização intermediária preservam solução da fase %i', (_, l) => { let g = startGame(l); const first = hint(g)!; g = move(g, first); if (g.status === 'playing') g = applyHelp(g, 'shuffle'); expect(solve(g).status).toBe('won'); });
});
