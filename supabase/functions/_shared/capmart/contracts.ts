// Cópia local só dos tipos de Progress usados pelo motor/progress.ts aqui no servidor —
// a fonte real é o pacote CapMart (capmart-src/integration/contracts.ts), que não é
// importável daqui (fica fora de supabase/functions). Mantém os dois em sincronia se o
// formato de Progress mudar.
export interface RecordEntry { stars: number; score: number; completed: boolean }
export interface Preferences { sound: boolean; reducedMotion: boolean }
export interface Progress { version: 1; unlocked: number; records: Record<number, RecordEntry>; tutorialDone: boolean; preferences: Preferences }
