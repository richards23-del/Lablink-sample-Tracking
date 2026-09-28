import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createSpecimen, signIn } from './helpers';

test('dashboard refreshes real queries and has accessible desktop content', async ({
  page,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  await signIn(page);
  await createSpecimen(page, 'Dashboard Test Specimen');
  let summaryReads = 0;
  let sampleReads = 0;
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname === '/api/dashboard') summaryReads++;
    if (url.pathname === '/api/samples') sampleReads++;
  });
  await page.getByRole('button', { name: 'Sync workspace' }).click();
  await expect(
    page.getByText('Workspace refreshed', { exact: true }),
  ).toBeVisible();
  expect(summaryReads).toBeGreaterThan(0);
  expect(sampleReads).toBeGreaterThan(0);
  await expect(
    page.getByRole('link').filter({ hasText: 'Dashboard Test Specimen' }),
  ).toBeVisible();
  await expect(page.getByText('NaN%')).toHaveCount(0);
  await expect(page.getByText('NaNd ago')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('dashboard.png'),
    fullPage: true,
  });
  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(runtimeErrors).toEqual([]);
});

test('failed recent-sample reads show an error rather than an empty queue', async ({
  page,
}) => {
  await signIn(page);
  await page.route('**/api/samples?*', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Sample service temporarily unavailable.',
      }),
    }),
  );
  await page.reload();
  const panel = page.getByRole('region', { name: 'Latest in the queue' });
  await expect(panel.getByRole('alert')).toHaveText(
    'Sample service temporarily unavailable.',
  );
  await expect(panel.getByText('No samples registered')).toHaveCount(0);
  await page.unroute('**/api/samples?*');
  await panel.getByRole('button', { name: 'Try again' }).click();
  await expect(panel.getByRole('alert')).toHaveCount(0);
});

test('sign-out removes access to previously viewed records', async ({
  page,
}) => {
  await signIn(page);
  const sample = await createSpecimen(page, 'Session Boundary Specimen');
  await page.goto(`/samples/${sample.id}`);
  await expect(
    page.getByRole('heading', {
      name: 'Session Boundary Specimen',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Sign in', exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', {
      name: 'Session Boundary Specimen',
      exact: true,
    }),
  ).toHaveCount(0);
  expect((await page.request.get(`/api/samples/${sample.id}`)).status()).toBe(
    401,
  );
});
