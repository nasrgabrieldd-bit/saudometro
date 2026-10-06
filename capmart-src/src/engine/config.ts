export const RULES = { match: [100, 150, 200, 250], comboSeconds: 5, completion: 300, second: 5, move: 20, extraSeconds: 30, costs: { undo: 5, hint: 10, time: 15, shuffle: 20 }, rewards: { completion: 5, threeStars: 3, firstDailyWin: 5, dailyChallenge: 10 } } as const;
export type Help = keyof typeof RULES.costs;
// os 12 primeiros são os originais aprovados, intocados (índice de cada um continua igual,
// então fases antigas que já usavam esses produtos não mudam). Os 13 de baixo são novos, só
// pra dar mais variedade nas fases 61-110 — mesmo formato (nome/emoji/cor pastel) dos originais.
export const PRODUCTS = [
  { name: 'Maçã', icon: '🍎', color: '#ffe1dd' }, { name: 'Leite', icon: '🥛', color: '#e1effc' },
  { name: 'Pão', icon: '🍞', color: '#ffeccc' }, { name: 'Abacate', icon: '🥑', color: '#e1efcf' },
  { name: 'Morango', icon: '🍓', color: '#ffe1ed' }, { name: 'Mel', icon: '🍯', color: '#fff0bb' },
  { name: 'Queijo', icon: '🧀', color: '#fff1cf' }, { name: 'Uva', icon: '🍇', color: '#efe1ff' },
  { name: 'Cenoura', icon: '🥕', color: '#ffe6cc' }, { name: 'Milho', icon: '🌽', color: '#edf4ce' },
  { name: 'Biscoito', icon: '🍪', color: '#eddfd2' }, { name: 'Coco', icon: '🥥', color: '#e9eee5' },
  { name: 'Banana', icon: '🍌', color: '#fff6cf' }, { name: 'Laranja', icon: '🍊', color: '#ffe8cc' },
  { name: 'Tomate', icon: '🍅', color: '#ffe0dc' }, { name: 'Brócolis', icon: '🥦', color: '#e3f0d9' },
  { name: 'Pimentão', icon: '🫑', color: '#e6f5df' }, { name: 'Ovo', icon: '🥚', color: '#fff8e8' },
  { name: 'Peixe', icon: '🐟', color: '#e3eefc' }, { name: 'Pera', icon: '🍐', color: '#eef5d9' },
  { name: 'Melancia', icon: '🍉', color: '#ffe2e6' }, { name: 'Abacaxi', icon: '🍍', color: '#fff4cc' },
  { name: 'Cereja', icon: '🍒', color: '#ffe0e6' }, { name: 'Pimenta', icon: '🌶️', color: '#ffe3dc' },
  { name: 'Castanha', icon: '🌰', color: '#f2e2d0' },
];
