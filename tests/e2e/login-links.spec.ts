// Collegamenti tra i due accessi (richiesta dell'utente dopo la fetta 8, non da spec-qa): "Accesso
// staff" in fondo a /accedi e nel piè di pagina della home, "Sei un cliente? Accedi qui" su
// /admin/login. Chi apre la pagina sbagliata trova subito quella giusta.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { expectPath, s } from './admin-helpers';

const link = (scope: Page | Locator, key: string): Locator => scope.getByRole('link', { name: s(key), exact: true });

const expectTapTarget = async (target: Locator): Promise<void> => {
  expect((await target.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
};

test.describe('Collegamenti tra accesso cliente e accesso staff', () => {
  test('home: "Accesso staff" nel piè di pagina porta a /admin/login', async ({ page }) => {
    await page.goto('/');
    const staff = link(page.getByRole('contentinfo'), 'auth.customerLogin.staffLink');
    await expect(staff).toBeVisible();
    await expectTapTarget(staff);
    await staff.click();
    await expectPath(page, '/admin/login');
    await expect(page.getByRole('heading', { name: s('auth.staffLogin.title') })).toBeVisible();
  });

  test('/accedi: "Accesso staff" in fondo, dopo il modulo, porta a /admin/login', async ({ page }) => {
    await page.goto('/accedi');
    const staff = link(page.getByRole('main'), 'auth.customerLogin.staffLink');
    await expect(staff).toBeVisible();
    await expectTapTarget(staff);
    const submit = page.getByRole('button', { name: s('auth.customerLogin.submit') });
    expect((await staff.boundingBox())?.y ?? 0).toBeGreaterThan((await submit.boundingBox())?.y ?? Infinity);
    await staff.click();
    await expectPath(page, '/admin/login');
  });

  test('/admin/login: "Sei un cliente? Accedi qui" porta a /accedi', async ({ page }) => {
    await page.goto('/admin/login');
    const customer = link(page, 'auth.staffLogin.customerLink');
    await expect(customer).toBeVisible();
    await expectTapTarget(customer);
    await customer.click();
    await expectPath(page, '/accedi');
    await expect(page.getByRole('heading', { name: s('auth.customerLogin.title') })).toBeVisible();
  });
});
