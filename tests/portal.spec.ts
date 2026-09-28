import { expect, test } from '@playwright/test';
import { account, signIn } from './helpers';

const password = 'Portal-browser-check-2026!';

async function csrf(page: import('@playwright/test').Page) {
  return (await (await page.request.get('/api/auth/session')).json())
    .csrfToken as string;
}

async function apiPost(
  page: import('@playwright/test').Page,
  path: string,
  data: object,
) {
  return page.request.post(path, {
    headers: { 'X-CSRF-Token': await csrf(page) },
    data,
  });
}

async function browserLogin(
  page: import('@playwright/test').Page,
  email: string,
) {
  await page.goto('/');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

test('a clinician controls patient visibility of a clinician-requested result', async ({
  page,
}) => {
  await signIn(page);
  const patient = await apiPost(page, '/api/users', {
    name: 'Portal Patient',
    email: 'patient.browser@lablink.test',
    password,
    role: 'patient',
  });
  const clinician = await apiPost(page, '/api/users', {
    name: 'Portal Clinician',
    email: 'clinician.browser@lablink.test',
    password,
    role: 'clinician',
  });
  expect(patient.ok()).toBeTruthy();
  expect(clinician.ok()).toBeTruthy();
  const patientUser = await patient.json();
  const clinicianUser = await clinician.json();
  const created = await apiPost(page, '/api/samples', {
    patientName: 'Portal Patient',
    patientId: 'PORTAL-001',
    testName: 'Portal privacy test',
    sampleType: 'Test specimen',
    facility: 'Portal clinic',
    referringDoctor: 'Portal Clinician',
    department: 'Test laboratory',
    priority: 'routine',
    collectedAt: new Date(Date.now() - 60_000).toISOString(),
    requestKind: 'clinician',
    contacts: {
      patient: { portalUserId: patientUser.id, channels: [] },
      clinician: { portalUserId: clinicianUser.id, channels: [] },
    },
  });
  expect(created.ok()).toBeTruthy();
  let sample = await created.json();
  for (const body of [
    { action: 'start_processing' },
    {
      action: 'submit_verification',
      resultSummary: 'CLINICIAN-PRIVATE-RESULT',
      qualityChecked: true,
    },
    { action: 'release', releaseConfirmed: true },
  ]) {
    const response = await apiPost(
      page,
      `/api/samples/${sample.id}/transition`,
      {
        version: sample.version,
        ...body,
      },
    );
    expect(response.ok()).toBeTruthy();
    sample = await response.json();
  }

  await page.getByRole('button', { name: 'Sign out' }).click();
  await browserLogin(page, 'patient.browser@lablink.test');
  await expect(
    page.getByRole('heading', { name: 'My requests' }),
  ).toBeVisible();
  await page.getByText(sample.sampleNumber, { exact: true }).click();
  await expect(page.getByText('CLINICIAN-PRIVATE-RESULT')).toHaveCount(0);
  await expect(
    page.getByText(
      /assigned clinician manages when the result becomes visible/i,
    ),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await browserLogin(page, 'clinician.browser@lablink.test');
  await page.getByText(sample.sampleNumber, { exact: true }).click();
  await expect(page.getByText('CLINICIAN-PRIVATE-RESULT')).toBeVisible();
  await page
    .getByRole('button', { name: 'Allow patient to view result' })
    .click();
  await expect(page.getByText('Patient result access enabled.')).toBeVisible();

  await page.getByRole('button', { name: 'Sign out' }).click();
  await browserLogin(page, 'patient.browser@lablink.test');
  await page.getByText(sample.sampleNumber, { exact: true }).click();
  await expect(page.getByText('CLINICIAN-PRIVATE-RESULT')).toBeVisible();
  await expect(page.getByText(account.email, { exact: true })).toHaveCount(0);
});
