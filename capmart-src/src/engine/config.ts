export const RULES = { match: [100, 150, 200, 250], comboSeconds: 5, completion: 300, second: 5, move: 20, extraSeconds: 30, costs: { undo: 5, hint: 10, time: 15, shuffle: 20 }, rewards: { completion: 5, threeStars: 3, firstDailyWin: 5, dailyChallenge: 10 } } as const;
export type Help = keyof typeof RULES.costs;
export const PRODUCTS = [
  { name: 'Maçã', icon: '🍎', color: '#ffe1dd' }, { name: 'Leite', icon: '🥛', color: '#e1effc' },
  { name: 'Pão', icon: '🍞', color: '#ffeccc' }, { name: 'Abacate', icon: '🥑', color: '#e1efcf' },
  { name: 'Morango', icon: '🍓', color: '#ffe1ed' }, { name: 'Mel', icon: '🍯', color: '#fff0bb' },
  { name: 'Queijo', icon: '🧀', color: '#fff1cf' }, { name: 'Uva', icon: '🍇', color: '#efe1ff' },
  { name: 'Cenoura', icon: '🥕', color: '#ffe6cc' }, { name: 'Milho', icon: '🌽', color: '#edf4ce' },
  { name: 'Biscoito', icon: '🍪', color: '#eddfd2' }, { name: 'Coco', icon: '🥥', color: '#e9eee5' },
];
