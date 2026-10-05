import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('início, mapa, regras, tabuleiro e confirmação acessíveis', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Olá, vizinho.' })).toBeVisible();
  const audit = async () => { const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze(); expect(results.violations.map(v => ({ id: v.id, nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary })) }))).toEqual([]); };
  await audit(); await page.getByRole('button', { name: 'Mapa de fases' }).click(); await audit(); await page.getByRole('button', { name: 'Como jogar' }).click(); await audit(); await page.getByRole('button', { name: /Início/ }).click(); await page.getByRole('button', { name: 'Vamos começar' }).click(); await audit(); await page.getByRole('button', { name: 'Dica 🪙 10' }).click(); await audit();
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); expect(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'))).toBe(true);
});

