import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Game, Move, Position } from '../engine/types';
import { PRODUCTS } from '../engine/config';
interface Props { game: Game; selected: Position | null; select: (p: Position) => void; onMove: (m: Move) => void; disabled: boolean; reducedMotion?: boolean }
export function Board({ game, selected, select, onMove, disabled, reducedMotion = false }: Props) {
  const root = useRef<HTMLDivElement>(null), origin = useRef<Position | null>(null), pointerStart = useRef({ x: 0, y: 0 }), dragItem = useRef<number | null>(null);
  const suppress = useRef(false), moveRef = useRef(onMove); moveRef.current = onMove;
  const [ghost, setGhost] = useState<{ x: number; y: number; item: number } | null>(null), [flashes, setFlashes] = useState<Position[]>([]);
  useEffect(() => {
    const moving = (e: PointerEvent) => { if (!origin.current || dragItem.current === null || Math.hypot(e.clientX - pointerStart.current.x, e.clientY - pointerStart.current.y) < 7) return; setGhost({ x: e.clientX, y: e.clientY, item: dragItem.current }); };
    const cancel = () => { origin.current = null; dragItem.current = null; setGhost(null); };
    const up = (e: PointerEvent) => { const from = origin.current; cancel(); if (!from) return; const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-slot]'); if (!target || !root.current?.contains(target)) return; const to = { row: Number(target.dataset.row), col: Number(target.dataset.col) }; if (from.row !== to.row || from.col !== to.col) { suppress.current = true; moveRef.current({ from, to }); window.setTimeout(() => { suppress.current = false; }, 150); } };
    window.addEventListener('pointermove', moving); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
    return () => { window.removeEventListener('pointermove', moving); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); };
  }, []);
  useLayoutEffect(() => {
    const event = game.events.at(-1); if (event?.kind !== 'move' || reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const from = root.current?.querySelector<HTMLElement>(`[data-row="${event.move.from.row}"][data-col="${event.move.from.col}"]`);
    const to = root.current?.querySelector<HTMLElement>(`[data-row="${event.move.to.row}"][data-col="${event.move.to.col}"]`);
    const item = to?.querySelector<HTMLElement>('.product-icon'); if (!from || !to || !item) return;
    const a = from.getBoundingClientRect(), b = to.getBoundingClientRect();
    item.animate([{ transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(1.08)` }, { transform: 'translate(0,0) scale(1)' }], { duration: 170, easing: 'ease-out' });
  }, [game.events, reducedMotion]);
  useEffect(() => { setFlashes(game.lastCleared); const id = window.setTimeout(() => setFlashes([]), 430); return () => window.clearTimeout(id); }, [game.events]);
  const dense = game.level.pack > 0;
  return <><div ref={root} className={`shelves ${dense ? 'dense' : ''} ${ghost ? 'is-dragging' : ''}`} style={{ '--shelf-rows': dense ? Math.ceil(game.board.length / 2) : game.board.length } as React.CSSProperties} aria-label="Prateleiras do mercado">{game.board.map((row, r) => <div className="shelf" key={r}><div className="shelf-label"><span>PRATELEIRA {String(r + 1).padStart(2, '0')}</span><span>{row.reduce((n, s) => n + s.behind.length, 0) > 0 ? 'Estoque atrás ↓' : 'Tudo à vista'}</span></div><div className="slots" style={{ gridTemplateColumns: `repeat(${row.length}, 1fr)` }}>{row.map((s, c) => {
    const locked = s.unlockAt > game.matches, product = s.item === null ? null : PRODUCTS[s.item];
    const active = selected?.row === r && selected.col === c;
    const hinted = game.hints && [game.hints.from, game.hints.to].some(p => p.row === r && p.col === c);
    const cleared = flashes.some(p => p.row === r && p.col === c);
    return <button key={c} data-slot="true" data-row={r} data-col={c} className={`slot ${product ? 'has-product' : ''} ${active ? 'selected' : ''} ${hinted ? 'hinted' : ''} ${cleared ? 'cleared' : ''} ${locked ? 'locked' : ''}`} disabled={disabled || locked} aria-pressed={active} aria-label={`Prateleira ${r + 1}, espaço ${c + 1}: ${locked ? `bloqueado até ${s.unlockAt} trios` : product?.name ?? 'vazio'}${s.behind.length ? `, ${s.behind.length} escondidos` : ''}`} onPointerDown={e => { if (!disabled && !locked && s.item !== null) { origin.current = { row: r, col: c }; pointerStart.current = { x: e.clientX, y: e.clientY }; dragItem.current = s.item; e.currentTarget.setPointerCapture(e.pointerId); } }} onClick={() => { if (!suppress.current) select({ row: r, col: c }); }} style={product ? { '--product-color': product.color } as React.CSSProperties : undefined}>
      {locked ? <><span className="lock-icon">▣</span><small>{s.unlockAt} trios</small></> : product ? <><span className="product-icon" aria-hidden="true">{product.icon}</span><span className="product-name">{product.name}</span>{s.behind.length > 0 && <span className="stock-count" title="Produtos escondidos">+{s.behind.length}</span>}</> : <span className="empty">+</span>}
    </button>;
  })}</div><div className="shelf-edge"/></div>)}</div>{ghost && <div className="drag-ghost" aria-hidden="true" style={{ left: ghost.x, top: ghost.y, background: PRODUCTS[ghost.item].color }}>{PRODUCTS[ghost.item].icon}</div>}</>;
}
