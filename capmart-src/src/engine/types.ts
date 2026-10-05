export type Product = number;
export interface Slot { item: Product | null; behind: Product[]; unlockAt: number }
export type Board = Slot[][];
export interface Position { row: number; col: number }
export interface Move { from: Position; to: Position }
export type Objective = { kind: 'clear' } | { kind: 'order'; product: Product; count: number } | { kind: 'score'; target: number };
export interface Level { id: number; pack: number; name: string; seed: number; board: Board; types: number; seconds: number | null; moves: number | null; objective: Objective; stars: [number, number]; difficulty: string; mechanics: string[]; dailyDay?: string; configVersion?: number }
export interface Snapshot { board: Board; score: number; movesUsed: number; matches: number; collected: Record<number, number>; combo: number; lastMatchAt: number | null }
export type GameEvent = { elapsed: number; kind: 'move'; move: Move } | { elapsed: number; kind: 'help'; help: 'undo' | 'hint' | 'time' | 'shuffle' };
export interface Game extends Snapshot { level: Level; remaining: number | null; elapsed: number; status: 'playing' | 'won' | 'lost'; reason?: string; history: Snapshot[]; assisted: boolean; hints: Move | null; lastCleared: Position[]; resultScore?: number; events: GameEvent[] }
export interface Result { runId: string; levelId: number; seed: number; score: number; stars: number; won: boolean; assisted: boolean; elapsed: number; moves: number; daily: boolean; dailyDay?: string; events: GameEvent[]; configVersion?: number }
