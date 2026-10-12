import { expect, test } from '@playwright/test';

const storageKey = 'precommunity-theme';
const startupCases = [
  { saved: 'dark', system: 'light', expected: 'dark' },
  { saved: 'light', system: 'dark', expected: 'light' },
  { saved: 'system', system: 'dark', expected: 'dark' },
  { saved: 'system', system: 'light', expected: 'light' },
  { saved: 'night', system: 'dark', expected: 'dark' },
  { saved: null, system: 'dark', expected: 'dark' },
] as const;

for (const { saved, system, expected } of startupCases) {
  test(`applies saved ${saved ?? 'unset'} theme with system ${system} before hydration`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: system });
    await page.addInitScript(
      ({ key, value }) => {
        if (value === null) localStorage.removeItem(key);
        else localStorage.setItem(key, value);
      },
      { key: storageKey, value: saved },
    );
    let blockedScripts = 0;
    await page.route(/\/_next\/.*\.js(?:\?.*)?$/, (route) => {
      blockedScripts += 1;
      return route.abort();
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', expected);
    await expect(page.locator('html')).toHaveCSS('color-scheme', expected);
    await expect(page.locator('body')).toHaveCSS(
      'background-color',
      expected === 'dark' ? 'rgb(13, 27, 45)' : 'rgb(248, 251, 255)',
    );
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute(
      'content',
      expected === 'dark' ? '#07172a' : '#2d8eff',
    );
    expect(blockedScripts).toBeGreaterThan(0);
  });
}

test('uses the system theme before hydration when browser storage is unavailable', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new Error('Storage unavailable');
      },
    });
  });
  await page.route(/\/_next\/.*\.js(?:\?.*)?$/, (route) => route.abort());

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(13, 27, 45)');
});

test('keeps theme choices after reload and follows system changes', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.addInitScript((key) => {
    if (localStorage.getItem(key) === null) localStorage.setItem(key, 'dark');
  }, storageKey);

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Choose color theme' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Dark', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.getByRole('button', { name: 'Choose color theme' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Light', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  await page.getByRole('menuitemradio', { name: 'System', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'dark');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Choose color theme' }).click();
  await expect(page.getByRole('menuitemradio', { name: 'System', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  );
});

test('theme choices still work when theme preference storage is unavailable', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript((themeKey) => {
    const getItem = Storage.prototype.getItem;
    const setItem = Storage.prototype.setItem;
    Storage.prototype.getItem = function (key) {
      if (key === themeKey) throw new Error('Theme preference storage unavailable');
      return getItem.call(this, key);
    };
    Storage.prototype.setItem = function (key, value) {
      if (key === themeKey) throw new Error('Theme preference storage unavailable');
      setItem.call(this, key, value);
    };
  }, storageKey);

  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Choose color theme' }).click();
  await page.getByRole('menuitemradio', { name: 'Light', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveCSS('color-scheme', 'light');
  await page.getByRole('button', { name: 'Choose color theme' }).click();
  await page.getByRole('menuitemradio', { name: 'System', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});
