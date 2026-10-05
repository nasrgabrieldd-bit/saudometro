import { applyHelp, move, startGame, stars, tick, validMove } from './game';
import type { Game, Level, Result } from './types';
// A building block for authoritative server validation, not authentication.
// The host must also validate elapsed time, run identity and paid aid receipts.
export function validateReplay(level: Level, result: Result): Game {
  if ((level.configVersion ?? 1) !== (result.configVersion ?? 1) || level.id !== result.levelId || level.seed !== result.seed || !Number.isFinite(result.elapsed) || result.elapsed < 0 || result.events.length > 10000) throw new Error('Partida inválida.');
  let game = startGame(level);
  for (const event of result.events) {
    if (!Number.isFinite(event.elapsed) || event.elapsed < game.elapsed || event.elapsed > result.elapsed || game.status !== 'playing') throw new Error('Cronologia inválida.');
    game = tick(game, event.elapsed - game.elapsed);
    if (event.kind === 'move') { if (!validMove(game, event.move)) throw new Error('Movimento inválido.'); game = move(game, event.move); }
    else { if (event.kind !== 'help' || !['undo', 'hint', 'time', 'shuffle'].includes(event.help)) throw new Error('Evento inválido.'); const next = applyHelp(game, event.help); if (next === game) throw new Error('Ajuda inválida.'); game = next; }
  }
  game = tick(game, result.elapsed - game.elapsed);
  const score = game.resultScore ?? game.score;
  if (game.status === 'playing' || score !== result.score || (game.status === 'won') !== result.won || game.assisted !== result.assisted || game.movesUsed !== result.moves || stars(score, level.stars, result.won) !== result.stars) throw new Error('Resultado divergente do replay.');
  return game;
}
