import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { account, createSpecimen, signIn } from './helpers';

async function localDateTime(page: Page, offsetMinutes = 0) {
  return page.evaluate((offset) => {
    const date = new Date(Date.now() + offset * 60_000);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  }, offsetMinutes);
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test('registers a specimen through the intake form with required and future-date validation', async ({
  page,
}) => {
  const patientName = `Intake workflow ${Date.now()}`;
  await page.goto('/samples');
  await page
    .getByRole('button', { name: 'Register sample', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Register a sample' });
  const submit = dialog.getByRole('button', {
    name: 'Register sample',
    exact: true,
  });

  await submit.click();
  await expect(
    dialog.getByText('Enter patient name.', { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel('Patient name', { exact: true }),
  ).toBeFocused();
  await dialog
    .getByLabel('Patient name', { exact: true })
    .fill(`  ${patientName}  `);
  await dialog
    .getByLabel('Patient identifier', { exact: true })
    .fill('  INTAKE-TEST  ');
  await dialog
    .getByLabel('Requested test', { exact: true })
    .fill('Intake workflow test');
  await dialog
    .getByLabel('Specimen type', { exact: true })
    .fill('Test specimen');
  await dialog
    .getByLabel('Referring facility', { exact: true })
    .fill('Test facility');
  await dialog
    .getByLabel('Referring doctor', { exact: true })
    .fill('Test clinician');
  await dialog
    .getByLabel('Laboratory department', { exact: true })
    .fill('Test laboratory');
  await dialog.getByLabel('Priority', { exact: true }).selectOption('high');
  await dialog
    .getByLabel('Collected at', { exact: true })
    .fill(await localDateTime(page, 60));
  await submit.click();
  await expect(
    dialog.getByText('Collection time cannot be in the future.', {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByLabel('Collected at', { exact: true }),
  ).toBeFocused();

  await dialog
    .getByLabel('Collected at', { exact: true })
    .fill(await localDateTime(page, -5));
  await submit.click();
  await expect(page).toHaveURL(/\/samples\/[1-9]\d*$/);
  await expect(
    page.getByRole('heading', { name: patientName, exact: true }),
  ).toBeVisible();
  await expect(page.getByText('high priority', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start processing', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Sample record', exact: true }),
  ).toContainText('INTAKE-TEST');
  await page.reload();
  await expect(
    page.getByRole('heading', { name: patientName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Sample received', exact: true }),
  ).toBeVisible();
});

test('persists attributed notes and completes processing, verified results and confirmed release', async ({
  page,
}) => {
  const sample = await createSpecimen(
    page,
    `Result workflow ${Date.now()}`,
    'routine',
  );
  const noteText = 'Workflow handoff checked by the signed-in administrator.';
  const nextDraft = 'Unsaved follow-up draft retained during the first save.';
  const resultSummary =
    'Workflow test result: processing complete; recorded values and quality evidence reviewed.';
  await page.goto(`/samples/${sample.id}`);
  const noteInput = page.getByLabel('Add an operational note', { exact: true });
  const addNote = page.getByRole('button', { name: 'Add note', exact: true });
  const noteEndpoint = `**/api/samples/${sample.id}/notes`;
  let releaseRequest!: () => void;
  const holdRequest = new Promise<void>((resolve) => {
    releaseRequest = resolve;
  });
  await page.route(noteEndpoint, async (route) => {
    await holdRequest;
    await route.continue();
  });
  await noteInput.fill(noteText);
  await addNote.click();
  try {
    await expect(addNote).toBeDisabled();
    await noteInput.fill(nextDraft);
  } finally {
    releaseRequest();
  }
  const savedNote = page.getByRole('article').filter({ hasText: noteText });
  await expect(savedNote).toContainText(account.name);
  await expect(noteInput).toHaveValue(nextDraft);
  await page.unroute(noteEndpoint);
  await page.reload();
  await expect(
    page.getByRole('article').filter({ hasText: noteText }),
  ).toContainText(account.name);
  await expect(
    page.getByRole('article').filter({ hasText: nextDraft }),
  ).toHaveCount(0);

  await page
    .getByRole('button', { name: 'Start processing', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Processing started', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Submit for verification', exact: true })
    .click();
  const verification = page.getByRole('dialog', {
    name: 'Submit for verification',
    exact: true,
  });
  await verification
    .getByLabel('Result summary', { exact: true })
    .fill(resultSummary);
  await verification
    .getByRole('button', { name: 'Submit for verification', exact: true })
    .click();
  await expect(
    verification.getByText(
      'Confirm that the required quality checks are complete.',
      { exact: true },
    ),
  ).toBeVisible();
  await verification
    .getByRole('checkbox', {
      name: /I confirm that the required quality checks/,
    })
    .check();
  await verification
    .getByRole('button', { name: 'Submit for verification', exact: true })
    .click();
  await expect(verification).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Recorded result', exact: true }),
  ).toContainText(resultSummary);

  await page
    .getByRole('button', { name: 'Review and release', exact: true })
    .click();
  const release = page.getByRole('dialog', {
    name: 'Review and release result',
    exact: true,
  });
  await expect(release).toContainText(resultSummary);
  await expect(release).toContainText(`Entered by: ${account.name}`);
  await release
    .getByRole('button', { name: 'Release result', exact: true })
    .click();
  await expect(
    release.getByText('Confirm your review before releasing the result.', {
      exact: true,
    }),
  ).toBeVisible();
  await release
    .getByRole('checkbox', { name: /I have reviewed the patient/ })
    .check();
  await release
    .getByRole('button', { name: 'Release result', exact: true })
    .click();
  await expect(release).not.toBeVisible();
  await expect(
    page.getByRole('region', { name: 'Released result', exact: true }),
  ).toContainText(resultSummary);
  await expect(
    page.getByRole('heading', { name: 'Result released', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start processing', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Request recollection', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Released result', exact: true }),
  ).toContainText(account.name);
  await expect(
    page.getByRole('article').filter({ hasText: noteText }),
  ).toContainText(account.name);
});

test('registers a recollected replacement with a persistent link to the terminal original', async ({
  page,
}) => {
  const original = await createSpecimen(
    page,
    `Recollection workflow ${Date.now()}`,
    'routine',
  );
  const reason =
    'Specimen identification requires a new collection for this workflow test.';
  const instructions =
    'Confirm the test identifier and record the new collection time.';
  await page.goto(`/samples/${original.id}`);
  await page
    .getByRole('button', { name: 'Request recollection', exact: true })
    .click();
  const recollection = page.getByRole('dialog', {
    name: 'Request recollection',
    exact: true,
  });
  await recollection
    .getByLabel('Recollection reason', { exact: true })
    .fill(reason);
  await recollection
    .getByLabel('Collection instructions', { exact: true })
    .fill(instructions);
  await recollection
    .getByRole('button', { name: 'Request recollection', exact: true })
    .click();
  await expect(recollection).not.toBeVisible();
  await expect(
    page.getByText('Recollection required', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Start processing', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Register replacement', exact: true })
    .click();
  const replacement = page.getByRole('dialog', {
    name: 'Register replacement specimen',
    exact: true,
  });
  await expect(replacement).toContainText(instructions);
  await replacement
    .getByLabel('New specimen collected at', { exact: true })
    .fill(await localDateTime(page, -10));
  await replacement
    .getByRole('button', { name: 'Register replacement', exact: true })
    .click();
  await expect(
    replacement.getByText(
      'The new collection cannot precede the original collection.',
      { exact: true },
    ),
  ).toBeVisible();
  await replacement
    .getByLabel('New specimen collected at', { exact: true })
    .fill(await localDateTime(page));
  await replacement
    .getByRole('button', { name: 'Register replacement', exact: true })
    .click();
  await expect(replacement).not.toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(`/samples/${original.id}$`));
  const replacementUrl = page.url();
  await expect(
    page.getByRole('button', { name: 'Start processing', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('link', { name: 'View original specimen', exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/samples/${original.id}$`));
  await expect(
    page.getByRole('region', { name: 'Recollection record', exact: true }),
  ).toContainText(reason);
  await expect(
    page.getByText('Recollection required', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Register replacement', exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await page
    .getByRole('link', { name: 'View replacement specimen', exact: true })
    .click();
  await expect(page).toHaveURL(replacementUrl);
  await expect(
    page.getByRole('link', { name: 'View original specimen', exact: true }),
  ).toBeVisible();
});

test('shows not-found states for invalid identifiers without querying an invalid sample ID', async ({
  page,
}) => {
  const sampleRequests: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/samples\//.test(request.url()))
      sampleRequests.push(request.url());
  });
  for (const id of ['0', '-1', '1.5', 'not-a-number', '9007199254740992']) {
    await page.goto(`/samples/${id}`);
    await expect(
      page.getByRole('heading', { name: 'Sample not found', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Back to samples', exact: true }),
    ).toBeVisible();
  }
  expect(sampleRequests).toEqual([]);
  await page.goto('/samples/999999999');
  await expect(
    page.getByRole('heading', { name: 'Sample not found', exact: true }),
  ).toBeVisible();
  expect(sampleRequests).toHaveLength(1);
  await page
    .getByRole('link', { name: 'Back to samples', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Sample queue', exact: true }),
  ).toBeVisible();
});

test('keeps specimen status, test, priority and due time visible in the mobile queue', async ({
  page,
}) => {
  const sample = await createSpecimen(
    page,
    `Mobile queue ${Date.now()}`,
    'high',
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/samples');
  await page
    .getByLabel('Search samples', { exact: true })
    .fill(sample.patientName);
  const row = page.getByTestId(`link-sample-${sample.id}`);
  await expect(row.getByText('Received', { exact: true })).toBeVisible();
  await expect(row.getByText(sample.testName, { exact: true })).toBeVisible();
  await expect(row.getByText('high priority', { exact: true })).toBeVisible();
  await expect(row.getByText(/^Due /)).toBeVisible();
  await expect(
    page.getByText('Showing 1–1 of 1 samples', { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test('intake dialog is accessible, traps keyboard focus and restores its opener on Escape', async ({
  page,
}) => {
  await page.goto('/samples');
  const opener = page.getByRole('button', {
    name: 'Register sample',
    exact: true,
  });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Register a sample' });
  const firstInput = dialog.getByLabel('Patient name', { exact: true });
  await expect(firstInput).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(
    dialog.getByRole('button', { name: 'Close', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(firstInput).toBeFocused();
  const accessibility = await new AxeBuilder({ page })
    .include('[role="dialog"]')
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(opener).toBeFocused();
});
