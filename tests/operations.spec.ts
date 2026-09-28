import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Preferences, SampleDetail } from '../shared/types';
import { account, createSpecimen, signIn } from './helpers';

async function csrfHeaders(page: Page) {
  const response = await page.request.get('/api/auth/session');
  expect(response.ok()).toBeTruthy();
  const session = await response.json();
  return { 'X-CSRF-Token': session.csrfToken as string };
}

async function savePreferences(page: Page, preferences: Preferences) {
  const response = await page.request.put('/api/preferences', {
    headers: await csrfHeaders(page),
    data: preferences,
  });
  expect(response.ok()).toBeTruthy();
}

async function requestRecollection(page: Page, sample: SampleDetail) {
  const response = await page.request.post(
    `/api/samples/${sample.id}/recollection`,
    {
      headers: await csrfHeaders(page),
      data: {
        version: sample.version,
        reason: 'Test specimen was unsuitable for analysis.',
        instructions:
          'Collect a replacement specimen and record its collection time.',
      },
    },
  );
  expect(response.ok()).toBeTruthy();
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  const violations = results.violations.map(({ id, help, nodes }) => ({
    id,
    help,
    nodes: nodes.map(({ target, failureSummary }) => ({
      target,
      failureSummary,
    })),
  }));
  expect(violations).toEqual([]);
}

test('notification preferences persist after reload and settings are accessible', async ({
  page,
}) => {
  await signIn(page);
  const response = await page.request.get('/api/preferences');
  expect(response.ok()).toBeTruthy();
  const original: Preferences = await response.json();

  try {
    await page.goto('/settings');
    const verification = page.getByRole('switch', {
      name: 'Verification queue activity',
    });
    const save = page.getByRole('button', {
      name: 'Save preferences',
      exact: true,
    });
    await expect(verification).toHaveAttribute(
      'aria-checked',
      String(original.verification),
    );
    await expect(save).toBeDisabled();
    await verification.click();
    await expect(verification).toHaveAttribute(
      'aria-checked',
      String(!original.verification),
    );
    await expect(
      page.getByText('You have unsaved changes.', { exact: true }),
    ).toBeVisible();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(
      page.getByText('Preferences saved', { exact: true }),
    ).toBeVisible();
    await expect(save).toBeDisabled();

    await page.reload();
    await expect(verification).toHaveAttribute(
      'aria-checked',
      String(!original.verification),
    );
    await expect(
      page.getByRole('switch', { name: 'Urgent sample events' }),
    ).toHaveAttribute('aria-checked', String(original.urgent));
    await expect(
      page.getByRole('switch', { name: 'Delay and recollection events' }),
    ).toHaveAttribute('aria-checked', String(original.delays));
    await expect(save).toBeDisabled();
    await expect(
      page.getByRole('heading', { name: 'Team access', exact: true }),
    ).toBeVisible();
    await expectAccessible(page);
  } finally {
    await savePreferences(page, original);
  }
});

test('sample alerts filter accurately and acknowledgement survives navigation and reload', async ({
  page,
}) => {
  await signIn(page);
  const first: SampleDetail = await createSpecimen(
    page,
    'First alert filter patient',
  );
  const second: SampleDetail = await createSpecimen(
    page,
    'Second alert filter patient',
  );
  await requestRecollection(page, first);
  await requestRecollection(page, second);

  await page.goto(`/alerts?sampleId=${first.id}`);
  const results = page.getByRole('region', { name: 'Alert results' });
  await expect(results.getByRole('article')).toHaveCount(1);
  await expect(results).toContainText(first.patientName);
  await expect(results).not.toContainText(second.patientName);
  await expect(
    page.getByRole('button', { name: /^critical · 1$/i }),
  ).toBeVisible();
  await expect(
    results.getByRole('link', {
      name: `View ${first.sampleNumber}`,
      exact: true,
    }),
  ).toHaveAttribute('href', `/samples/${first.id}`);

  await page.getByRole('button', { name: /^info · 0$/i }).click();
  await expect(results.getByRole('article')).toHaveCount(0);
  await expect(
    results.getByRole('heading', { name: 'No alerts match these filters' }),
  ).toBeVisible();
  await expect(results).toContainText(
    '1 active across all severities for this sample',
  );
  await expect(
    page.getByRole('button', { name: /^critical · 1$/i }),
  ).toBeVisible();

  await page.getByRole('button', { name: /^critical · 1$/i }).click();
  await results
    .getByRole('button', { name: 'Acknowledge', exact: true })
    .click();
  await expect(results).toContainText(`Acknowledged by ${account.name}`);
  await expect(
    results.getByRole('button', { name: 'Acknowledge', exact: true }),
  ).toHaveCount(0);
  await expect(results.getByRole('article')).toHaveCount(1);

  await page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { name: 'Command center', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Command center', exact: true }),
  ).toBeVisible();
  await page.goto(`/alerts?sampleId=${first.id}`);
  await page.reload();
  await expect(results).toContainText(`Acknowledged by ${account.name}`);
  await expect(results.getByRole('article')).toHaveCount(1);
  await expectAccessible(page);

  await page
    .getByRole('button', { name: 'Clear sample filter', exact: true })
    .click();
  await expect(page).toHaveURL('/alerts');
  await expect(results).toContainText(second.patientName);
  await expect(results).toContainText(first.patientName);

  await page.goto('/alerts?sampleId=invalid');
  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: 'The sample filter is invalid.' }),
  ).toBeVisible();
  await expect(results.getByRole('article')).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Clear sample filter', exact: true })
    .click();
  await expect(page).toHaveURL('/alerts');
  await expect(page.getByLabel('Status', { exact: true })).toBeFocused();
});

test('notification links open their sample and read state persists after reload', async ({
  page,
}) => {
  await signIn(page);
  const preferencesResponse = await page.request.get('/api/preferences');
  expect(preferencesResponse.ok()).toBeTruthy();
  const preferences: Preferences = await preferencesResponse.json();
  let sample: SampleDetail;
  try {
    await savePreferences(page, { ...preferences, urgent: true });
    sample = await createSpecimen(page, 'Notification persistence patient');
  } finally {
    await savePreferences(page, preferences);
  }

  await page.goto('/notifications');
  const sampleLink = page.getByRole('link', {
    name: `View ${sample.sampleNumber}`,
    exact: true,
  });
  const item = page.getByRole('listitem').filter({ has: sampleLink });
  await expect(item.getByText('Unread', { exact: true })).toBeVisible();
  await sampleLink.click();
  await expect(page).toHaveURL(`/samples/${sample.id}`);
  await expect(
    page.getByText(sample.patientName, { exact: true }),
  ).toBeVisible();

  await page.goto('/notifications');
  await item
    .getByRole('button', {
      name: 'Mark Urgent sample received as read',
      exact: true,
    })
    .click();
  await expect(
    page.getByText('Notification marked as read', { exact: true }),
  ).toBeVisible();
  await expect(item.getByText('Unread', { exact: true })).toHaveCount(0);
  await expect(
    item.getByRole('button', { name: /mark .* as read/i }),
  ).toHaveCount(0);
  await page.reload();
  await expect(sampleLink).toBeVisible();
  await expect(item.getByText('Unread', { exact: true })).toHaveCount(0);
  await expect(
    item.getByRole('button', { name: /mark .* as read/i }),
  ).toHaveCount(0);
  await page.getByRole('button', { name: /^Unread · \d+$/ }).click();
  await expect(sampleLink).toHaveCount(0);
});

test('an administrator can create a technician whose access excludes team management and alert resolution', async ({
  page,
}) => {
  await signIn(page);
  const sample: SampleDetail = await createSpecimen(
    page,
    'Technician access patient',
  );
  await requestRecollection(page, sample);
  const technician = {
    name: 'Operations Technician',
    email: `operations-${Date.now()}@lablink.test`,
    password: 'Operations-check-2026!',
  };

  await page.goto('/settings');
  await page
    .getByRole('button', { name: 'Add team member', exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: 'Add team member',
    exact: true,
  });
  await expect(dialog.getByLabel('Full name', { exact: true })).toBeFocused();
  await dialog.getByLabel('Full name', { exact: true }).fill(technician.name);
  await dialog
    .getByLabel('Email address', { exact: true })
    .fill(technician.email);
  await dialog
    .getByLabel('Password', { exact: true })
    .fill(technician.password);
  await dialog.getByLabel('Role', { exact: true }).selectOption('technician');
  await dialog
    .getByRole('button', { name: 'Create account', exact: true })
    .click();
  await expect(dialog).toBeHidden();
  const accountRow = page
    .getByRole('listitem')
    .filter({ hasText: technician.email });
  await expect(accountRow).toContainText(technician.name);
  await expect(accountRow).toContainText('technician');
  await page.reload();
  await expect(accountRow).toBeVisible();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await page.getByLabel('Email', { exact: true }).fill(technician.email);
  await page.getByLabel('Password', { exact: true }).fill(technician.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await page.goto('/settings');
  await expect(
    page.getByRole('heading', { name: 'Settings', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Add team member', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Team access', exact: true }),
  ).toHaveCount(0);
  expect((await page.request.get('/api/users')).status()).toBe(403);
  await page.goto(`/alerts?sampleId=${sample.id}`);
  const alert = page
    .getByRole('region', { name: 'Alert results' })
    .getByRole('article');
  await expect(
    alert.getByRole('button', { name: 'Acknowledge', exact: true }),
  ).toBeVisible();
  await expect(
    alert.getByRole('button', { name: 'Resolve', exact: true }),
  ).toHaveCount(0);
});

test.describe('mobile navigation', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('navigation traps focus, closes with Escape, and follows links without exposing the desktop menu', async ({
    page,
  }) => {
    await signIn(page);
    const trigger = page.getByRole('button', {
      name: 'Open navigation',
      exact: true,
    });
    const navigation = page.getByRole('navigation', {
      name: 'Main navigation',
    });
    await expect(navigation).toHaveCount(0);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', {
      name: 'LabLink navigation',
      exact: true,
    });
    await expect(dialog).toBeVisible();
    await expect(navigation).toHaveCount(1);
    for (let index = 0; index < 10; index++) {
      await page.keyboard.press('Tab');
      await expect
        .poll(() =>
          dialog.evaluate((element) =>
            element.contains(document.activeElement),
          ),
        )
        .toBe(true);
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await expect(navigation).toHaveCount(0);

    await trigger.click();
    await dialog.getByRole('link', { name: 'Alerts', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole('heading', { name: 'Alerts', exact: true }),
    ).toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(navigation).toHaveCount(0);
    await expect(
      page.getByRole('link', { name: /^Notifications/ }),
    ).toHaveCount(1);
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
  });
});
