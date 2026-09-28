import { expect, test } from '@playwright/test';
import { signIn } from './helpers';

test('a patient can create a portal account without being able to self-select staff access', async ({
  page,
}) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByRole('button', { name: 'Create a portal account' }).click();
  await expect(
    page.getByRole('heading', { name: 'Create your portal account' }),
  ).toBeVisible();
  await page.getByLabel('Your name').fill('Public Patient');
  await page
    .getByLabel('Email', { exact: true })
    .fill('public.patient@example.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill('Public-patient-password-2026');
  await expect(page.getByLabel('I am registering as')).toHaveValue('patient');
  await expect(page.getByRole('option', { name: 'Administrator' })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(
    page.getByRole('heading', { name: 'My requests' }),
  ).toBeVisible();
  await expect(page.getByText('No assigned requests')).toBeVisible();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page
    .getByLabel('Email', { exact: true })
    .fill('public.patient@example.test');
  await page
    .getByLabel('Password', { exact: true })
    .fill('Public-patient-password-2026');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'My requests' }),
  ).toBeVisible();
});
