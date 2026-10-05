import { test, expect } from '@playwright/test';
import { LEVELS, dailyLevel } from '../../src/levels';
import { hint, move, startGame } from '../../src/engine/game';
import { defaultProgress, localDay } from '../../src/services/progress';
import { mkdirSync } from 'node:fs';
async function noOverflow(page: import('@playwright/test').Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
test('início, mapa, tutorial, vitória, recompensas e recuperação', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Olá, vizinho.' })).toBeVisible(); await noOverflow(page);
  await page.screenshot({ path: `test-results/home-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Mapa de fases' }).click(); await expect(page.getByRole('button', { name: 'Fase 2, bloqueada', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Fase 1, disponível', exact: true }).click(); await expect(page.getByText('1. Escolha um produto', { exact: true })).toBeVisible();
  await noOverflow(page); await page.screenshot({ path: `test-results/game-${info.project.name}.png`, fullPage: true });
  let g = startGame(LEVELS[0]);
  while (g.status === 'playing') { const m = hint(g)!; await page.locator(`[data-row="${m.from.row}"][data-col="${m.from.col}"]`).click(); await page.locator(`[data-row="${m.to.row}"][data-col="${m.to.col}"]`).click(); g = move(g, m); }
  await expect(page.getByRole('heading', { name: 'Que organização linda!' })).toBeVisible(); await expect(page.getByRole('button', { name: 'Próxima fase →' })).toBeEnabled();
  await page.getByRole('button', { name: 'Concluir tutorial' }).click(); await page.screenshot({ path: `test-results/result-${info.project.name}.png`, fullPage: true });
  await page.getByRole('button', { name: 'Voltar ao mapa', exact: true }).click(); await expect(page.getByRole('button', { name: 'Fase 2, disponível', exact: true })).toBeEnabled();
  const balance = await page.locator('.wallet strong').textContent(); await page.reload(); await expect(page.locator('.wallet strong')).toHaveText(balance!);
  await page.getByRole('button', { name: 'Mapa de fases' }).click(); await expect(page.getByRole('button', { name: 'Fase 2, disponível', exact: true })).toBeEnabled(); await page.screenshot({ path: `test-results/map-${info.project.name}.png`, fullPage: true }); expect(errors).toEqual([]);
});
test('ajuda exige confirmação, cancelar preserva saldo, compra desconta uma vez', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Vamos começar' }).click();
  await page.getByRole('button', { name: 'Dica 🪙 10' }).click(); await expect(page.getByRole('dialog', { name: 'Dica?' })).toBeVisible(); await page.getByRole('button', { name: 'Cancelar', exact: true }).click(); await expect(page.locator('.wallet strong')).toHaveText('50');
  await page.getByRole('button', { name: 'Dica 🪙 10' }).click(); await page.getByRole('button', { name: 'Confirmar compra' }).click(); await expect(page.locator('.wallet strong')).toHaveText('40'); await expect(page.locator('.hinted')).toHaveCount(2); await noOverflow(page);
});
test('arrastar com mouse ou toque realiza troca', async ({ page }, info) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Vamos começar' }).click(); const m = hint(startGame(LEVELS[0]))!;
  const a = page.locator(`[data-row="${m.from.row}"][data-col="${m.from.col}"]`), b = page.locator(`[data-row="${m.to.row}"][data-col="${m.to.col}"]`); const from = (await a.boundingBox())!, to = (await b.boundingBox())!;
  if (info.project.name === 'mobile' || info.project.name === 'tablet') {
    const cdp = await page.context().newCDPSession(page); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x + to.width / 2, y: to.y + to.height / 2 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else { await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down(); await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 }); await page.mouse.up(); }
  await expect(page.locator('.game-stats > div').nth(3).locator('strong')).toHaveText('1');
});
test('fase avançada e pausa funcionam sem transbordar', async ({ page }, info) => {
  await page.addInitScript((p) => localStorage.setItem('capmart:v1:local-capivara', JSON.stringify({ progress: { ...p, unlocked: 60, tutorialDone: true, records: { 1: { stars: 1, score: 100, completed: true } } }, balance: 50, rewards: [], receipts: {}, purchases: {}, results: [] })), defaultProgress());
  await page.goto('/'); await page.getByRole('button', { name: 'Continuar jornada' }).click(); await page.getByRole('button', { name: 'Entendi →', exact: true }).click(); await noOverflow(page); await expect(page.locator('.shelf')).toHaveCount(LEVELS[59].board.length); await page.screenshot({ path: `test-results/advanced-${info.project.name}.png`, fullPage: true });
  if (info.project.name !== 'tablet') { mkdirSync('previews', { recursive: true }); await page.screenshot({ path: `previews/${info.project.name}.png` }); }
  await page.getByRole('button', { name: 'Ⅱ Pausar' }).click(); const remaining = await page.locator('.game-stats > div').nth(2).locator('strong').textContent(); await page.waitForTimeout(1200); await expect(page.locator('.game-stats > div').nth(2).locator('strong')).toHaveText(remaining!); await page.getByRole('button', { name: 'Continuar partida', exact: true }).click(); await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('teclado seleciona e troca produtos', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Vamos começar' }).click(); const m = hint(startGame(LEVELS[0]))!;
  const a = page.locator(`[data-row="${m.from.row}"][data-col="${m.from.col}"]`), b = page.locator(`[data-row="${m.to.row}"][data-col="${m.to.col}"]`); await a.focus(); await page.keyboard.press('Enter'); await expect(a).toHaveAttribute('aria-pressed', 'true'); await b.focus(); await page.keyboard.press('Space'); await expect(page.locator('.game-stats > div').nth(3).locator('strong')).toHaveText('1');
});
test('desafio diário concede recompensa sem abrir fases da campanha', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: /Lista do dia/ }).click(); await page.getByRole('button', { name: 'Entendi →', exact: true }).click(); let g = startGame(dailyLevel(localDay()));
  while (g.status === 'playing') { const m = hint(g)!; await page.locator(`[data-row="${m.from.row}"][data-col="${m.from.col}"]`).click(); await page.locator(`[data-row="${m.to.row}"][data-col="${m.to.col}"]`).click(); g = move(g, m); }
  await expect(page.getByRole('heading', { name: 'Que organização linda!' })).toBeVisible(); await expect(page.locator('.wallet strong')).toHaveText('65'); await page.getByRole('button', { name: 'Voltar ao mapa', exact: true }).click(); await page.locator('.pack-tabs button').first().click(); await expect(page.getByRole('button', { name: 'Fase 2, bloqueada', exact: true })).toBeDisabled();
});


