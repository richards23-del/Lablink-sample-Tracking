import { expect, type Page } from '@playwright/test';

export const account = {
  name: 'Test Administrator',
  email: 'administrator@lablink.test',
  password: 'Integration-check-2026!',
};

export async function signIn(page: Page) {
  await page.goto('/');
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
  if (
    await page
      .getByRole('button', { name: 'Create workspace', exact: true })
      .count()
  ) {
    await page.getByLabel('Workspace name').fill('Integration Laboratory');
    await page.getByLabel('Your name').fill(account.name);
    await page.getByLabel('Laboratory timezone').fill('Africa/Johannesburg');
  }
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page
    .getByRole('button', { name: /^(Sign in|Create workspace)$/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Command center', exact: true }),
  ).toBeVisible();
}

export async function createSpecimen(
  page: Page,
  patientName: string,
  priority = 'urgent',
) {
  const session = await (await page.request.get('/api/auth/session')).json();
  const response = await page.request.post('/api/samples', {
    headers: { 'X-CSRF-Token': session.csrfToken },
    data: {
      patientName,
      patientId: `TEST-${Date.now()}`,
      testName: 'Workflow verification test',
      sampleType: 'Test specimen',
      facility: 'Test facility',
      referringDoctor: 'Test clinician',
      department: 'Test laboratory',
      priority,
      collectedAt: new Date(Date.now() - 60_000).toISOString(),
    },
  });
  expect(response.ok()).toBeTruthy();
  return response.json();
}
