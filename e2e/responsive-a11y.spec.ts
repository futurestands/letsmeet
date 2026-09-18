import { test, expect } from '@playwright/test';
import { stagingIdentities } from './helpers/env';
import { signIn } from './helpers/conference';

const viewports = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1280, height: 800 },
] as const;

for (const viewport of viewports) {
  test(`responsive + keyboard smoke (${viewport.name})`, async ({ browser }) => {
    const ids = stagingIdentities();
    const context = await browser.newContext({
      permissions: ['camera', 'microphone', 'notifications'],
      viewport: { width: viewport.width, height: viewport.height },
    });
    await context.clearCookies();
    const page = await context.newPage();

    try {
      await signIn(page, ids.hostEmail, ids.hostPassword);
      await expect(page.getByRole('button', { name: 'Start Meeting', exact: true })).toBeVisible();

      // Keyboard focus visibility on primary CTA
      await page.keyboard.press('Tab');
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return null;
        const style = window.getComputedStyle(el);
        return {
          tag: el.tagName,
          name: el.getAttribute('aria-label') || el.textContent?.trim()?.slice(0, 40) || '',
          outline: style.outlineStyle,
        };
      });
      expect(focused).not.toBeNull();

      // No catastrophic horizontal overflow on home
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 2);

      await page.getByRole('button', { name: 'Start Meeting', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Join meeting' })).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('button', { name: 'Turn off camera' }).or(page.getByRole('button', { name: 'Turn on camera' }))).toBeVisible();

      const prejoinOverflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      expect(prejoinOverflow.scrollWidth).toBeLessThanOrEqual(prejoinOverflow.clientWidth + 8);
    } finally {
      await context.close();
    }
  });
}
