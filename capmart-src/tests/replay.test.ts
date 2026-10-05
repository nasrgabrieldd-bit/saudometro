import { expect, it } from 'vitest';
import { applyHelp, hint, move, startGame, stars, tick } from '../src/engine/game';
import { validateReplay } from '../src/engine/replay';
import { LEVELS } from '../src/levels';
import type { Game, Result } from '../src/engine/types';
function asResult(g: Game): Result { return { runId: 'replay', levelId: g.level.id, seed: g.level.seed, configVersion: g.level.configVersion, score: g.resultScore ?? g.score, stars: stars(g.resultScore ?? g.score, g.level.stars, g.status === 'won'), won: g.status === 'won', assisted: g.assisted, elapsed: g.elapsed, moves: g.movesUsed, daily: false, events: g.events }; }
it.each(LEVELS.map(l => [l.id, l] as const))('replay reproduz resultado da fase %i', (_, l) => { let g = startGame(l); while (g.status === 'playing') { g = tick(g, .75); g = move(g, hint(g)!); } expect(validateReplay(l, asResult(g)).resultScore).toBe(g.resultScore); });
it('replay inclui ajudas e desfazer sem apagar o histórico', () => { let g = applyHelp(startGame(LEVELS[20]), 'time'); g = tick(g, .4); g = move(g, hint(g)!); g = applyHelp(g, 'undo'); g = applyHelp(g, 'shuffle'); g = applyHelp(g, 'hint'); while (g.status === 'playing') g = move(g, hint(g)!); expect(validateReplay(g.level, asResult(g)).resultScore).toBe(g.resultScore); });
it('replay rejeita pontuação adulterada e cronologia inválida', () => { let g = startGame(LEVELS[0]); while (g.status === 'playing') g = move(g, hint(g)!); const result = asResult(g); expect(() => validateReplay(g.level, { ...result, score: result.score + 1 })).toThrow(); expect(() => validateReplay(g.level, { ...result, events: [{ ...result.events[0], elapsed: -1 }] })).toThrow(); });
it('reorganizações repetidas em fases de pontuação preservam oportunidades', () => { for (const l of LEVELS.filter(l => l.objective.kind === 'score')) { let g = startGame(l); for (let i = 0; i < 20; i++) g = applyHelp(tick(g, .01), 'shuffle'); expect(g.score).toBe(0); expect(g.matches).toBe(0); while (g.status === 'playing') g = move(g, hint(g)!); expect(g.status).toBe('won'); } });

