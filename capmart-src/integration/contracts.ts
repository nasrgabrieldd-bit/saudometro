import type { Result } from '../src/engine/types';
import type { Help } from '../src/engine/config';
export interface Identity { id: string; displayName: string; groupId?: string; partnerId?: string }
export interface RecordEntry { stars: number; score: number; completed: boolean }
export interface Preferences { sound: boolean; reducedMotion: boolean }
export interface Progress { version: 1; unlocked: number; records: Record<number, RecordEntry>; tutorialDone: boolean; preferences: Preferences }
export interface Receipt { balance: number; awarded: number; previousRecord: number; progress: Progress }
export type Mode = 'individual' | 'couple' | 'group';
export interface RankingEntry { userId: string; name: string; score: number; assisted: boolean; seed: number; configVersion?: number }
export interface CapMartServices {
  identity: Identity;
  loadProgress(): Promise<Progress>;
  saveProgress(progress: Progress): Promise<void>;
  getBalance(): Promise<number>;
  purchaseHelp(input: { requestId: string; runId: string; help: Help; levelId: number }): Promise<{ approved: boolean; balance: number }>;
  submitResult(result: Result): Promise<Receipt>;
  getRanking(input: { mode: Mode; levelId: number; seed: number; configVersion?: number }): Promise<RankingEntry[]>;
  onOpen?(): void;
  onClose?(): void;
}
export interface Persistence { read(key: string): string | null; write(key: string, value: string): void }
