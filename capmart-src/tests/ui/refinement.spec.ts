import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { LEVELS } from '../../src/levels';
import { defaultProgress } from '../../src/services/progress';
import { writeFileSync } from 'node:fs';
const viewports = [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 844, height: 390 }];
for (const viewport of viewports) test(`tabuleiro ${viewport.width}×${viewport.height}: legibilidade e arraste sem rolagem`, async ({ page }, info) => {
  await page.setViewportSize(viewport);
  await page.addInitScript(p => localStorage.setItem('capmart:v1:local-capivara', JSON.stringify({ progress: { ...p, unlocked: 60, tutorialDone: true, records: { 1: { score: 9000, stars: 3, completed: true } } }, balance: 128, rewards: [], receipts: {}, purchases: {}, results: [] })), defaultProgress());
  await page.goto('/'); await page.getByRole('button', { name: 'Continuar jornada' }).click(); await page.getByRole('button', { name: 'Entendi →', exact: true }).click();
  await expect(page.locator('.level-stat strong')).toHaveText('60'); await expect(page.locator('.combo-panel')).toContainText('Combo');
  const metrics = await page.evaluate(() => {
    const board = document.querySelector('.shelves')!, rect = board.getBoundingClientRect();
    const products = [...document.querySelectorAll<HTMLElement>('.slot.has-product')];
    return { pageWidth: document.documentElement.scrollWidth, pageHeight: document.documentElement.scrollHeight, width: innerWidth, height: innerHeight, boardHeight: rect.height, minWidth: Math.min(...products.map(p => p.getBoundingClientRect().width)), minHeight: Math.min(...products.map(p => p.getBoundingClientRect().height)), icon: parseFloat(getComputedStyle(products[0].querySelector('.product-icon')!).fontSize), label: parseFloat(getComputedStyle(products[0].querySelector('.product-name')!).fontSize), visibleProducts: products.filter(p => { const r = p.getBoundingClientRect(); return r.top >= rect.top && r.bottom <= rect.bottom; }).length, scrollTop: board.scrollTop, scrollY };
  });
  expect(metrics.pageWidth).toBeLessThanOrEqual(metrics.width); expect(metrics.pageHeight).toBeLessThanOrEqual(metrics.height);
  expect(metrics.minWidth).toBeGreaterThanOrEqual(44); expect(metrics.minHeight).toBeGreaterThanOrEqual(44);
  expect(metrics.icon).toBeGreaterThanOrEqual(25); expect(metrics.label).toBeGreaterThanOrEqual(8); expect(metrics.visibleProducts).toBeGreaterThanOrEqual(viewport.height > 500 ? 24 : 12);
  expect(metrics.boardHeight / metrics.height).toBeGreaterThan(.48);
  writeFileSync(`test-results/metrics-${viewport.width}-${info.project.name}.json`, JSON.stringify(metrics, null, 2));
  let from: { row: number; col: number } | undefined, to: typeof from;
  for (let r = 0; r < 2; r++) for (let c = 0; c < 3; c++) { const s = LEVELS[59].board[r][c]; if (s.item !== null && s.unlockAt === 0) { if (!from) from = { row: r, col: c }; else if (!to && s.item !== LEVELS[59].board[from.row][from.col].item) to = { row: r, col: c }; } }
  const a = (await page.locator(`[data-row="${from!.row}"][data-col="${from!.col}"]`).boundingBox())!, b = (await page.locator(`[data-row="${to!.row}"][data-col="${to!.col}"]`).boundingBox())!;
  if (info.project.name === 'desktop') { await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 5 }); await expect(page.locator('.drag-ghost')).toBeVisible(); await page.mouse.up(); }
  else { const cdp = await page.context().newCDPSession(page); await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x + a.width / 2, y: a.y + a.height / 2 }] }); await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] }); await expect(page.locator('.drag-ghost')).toBeVisible(); await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); }
  await expect(page.locator('.game-stats > div').nth(3).locator('strong')).toHaveText(String(LEVELS[59].moves! - 1));
  await expect(page.locator('.drag-ghost')).toHaveCount(0);
  expect(await page.locator('.shelves').evaluate(el => el.scrollTop)).toBe(metrics.scrollTop); expect(await page.evaluate(() => scrollY)).toBe(metrics.scrollY);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(axe.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  await page.locator('summary').click(); await expect(page.locator('.mobile-goals > div')).toBeVisible(); await expect(page.locator('.mobile-goals > div')).toContainText(`${LEVELS[59].stars[0]} pontos`); await page.locator('summary').click();
  await page.screenshot({ path: `test-results/dense-${viewport.width}-${info.project.name}.png` });
});


