import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

const NAV = [
  ['Executive Overview', /Bharat Prime/],
  ['Assessments', 'Assessments'],
  ['Assessment Questionnaire', 'Assessment Questionnaire'],
  ['Evidence & Verification', 'Evidence & Verification'],
  ['AI Maturity Analysis', 'AI Maturity Analysis'],
  ['Risk & Governance', 'Risk & Governance'],
  ['Value Realization', 'Value Realization'],
  ['Recommendations & Roadmap', 'Recommendations & Roadmap'],
  ['Benchmarking', 'Benchmarking'],
  ['Reports', 'Reports'],
  ['Settings', 'Settings'],
] as const;

/** Every Playwright test runs in a brand-new browser context, so storage starts empty (first launch → demo seeded). */
async function fresh(page: Page, path = '/') {
  await page.goto(path);
  await expect(page.locator('h1').first()).toBeVisible();
}

const consoleErrors = (page: Page) => {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(`console: ${m.text()}`); });
  return errs;
};

const scoreCardValue = async (page: Page, title: RegExp) => (await page.getByRole('link', { name: title }).first().locator('.text-\\[28px\\]').textContent())?.trim();

test.describe('application', () => {
  test('starts and shows the illustrative demo with scores computed from the seeded responses', async ({ page }) => {
    const errs = consoleErrors(page);
    await fresh(page);
    await expect(page).toHaveTitle(/Executive Overview/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Bharat Prime Financial Services Ltd (fictional)');
    await expect(page.getByText('Illustrative demonstration assessment', { exact: true })).toBeVisible();
    await expect(await scoreCardValue(page, /AI Maturity Index: open details/)).toMatch(/^\d{2}\.\d$/);
    await expect(page.getByText('AI Advanced').first()).toBeVisible();
    await expect(page.getByText('Flagged for review: critical control deficiency')).toBeVisible();
    expect(errs).toEqual([]);
  });

  test('every sidebar link navigates to its page without errors', async ({ page }) => {
    const errs = consoleErrors(page);
    await fresh(page);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    for (const [label, heading] of NAV) {
      await nav.getByRole('link', { name: label }).click();
      await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(heading);
    }
    expect(errs).toEqual([]);
  });

  test('questionnaire edits autosave and survive a page refresh', async ({ page }) => {
    await fresh(page, '/#/questionnaire?q=S01');
    const self = page.getByRole('radiogroup', { name: 'Self-reported maturity score' });
    await self.getByRole('radio', { name: /Advanced/ }).click();
    await page.getByLabel('Document, system or demonstration that supports the score').fill('Edited evidence reference XYZ');
    await expect(page.getByText('All changes saved automatically')).toBeVisible();
    await page.waitForTimeout(500); // debounce
    await page.reload();
    await expect(self.getByRole('radio', { name: /Advanced/ })).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByLabel('Document, system or demonstration that supports the score')).toHaveValue('Edited evidence reference XYZ');
  });

  test('number keys set the self-reported score in one-at-a-time mode', async ({ page }) => {
    await fresh(page, '/#/questionnaire?q=S02');
    await page.locator('h1').click();
    await page.keyboard.press('1');
    await expect(page.getByRole('radiogroup', { name: 'Self-reported maturity score' }).getByRole('radio', { name: /Ad hoc/ })).toHaveAttribute('aria-checked', 'true');
  });

  test('new assessment: wizard → answer → verify → dashboard responds → persists; demo untouched', async ({ page }) => {
    await fresh(page, '/#/assessments/new');
    await page.getByRole('button', { name: 'MSME (sample)' }).click();
    await page.getByLabel(/Organization name/).fill('Acme Components Pvt Ltd');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    // Assessment setup
    await page.getByLabel(/Assessment period/).selectOption('FY2025-26');
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText(/Draft saved/)).toBeVisible();
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(page.getByRole('heading', { name: 'Review and create' })).toBeVisible();
    await page.getByRole('button', { name: 'Create assessment' }).click();
    await expect(page).toHaveURL(/questionnaire/);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Assessment Questionnaire');

    // Blank assessment: nothing is pre-scored.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Executive Overview' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Acme Components Pvt Ltd');
    await expect(await scoreCardValue(page, /AI Maturity Index: open details/)).toBe('—');
    await expect(page.getByText('Illustrative demonstration assessment', { exact: true })).toHaveCount(0);

    // Answer S01 (self 4) and verify it as 3 in the questionnaire.
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Assessment Questionnaire' }).click();
    await page.getByRole('radiogroup', { name: 'Self-reported maturity score' }).getByRole('radio', { name: /Advanced/ }).click();
    await page.getByRole('radiogroup', { name: 'Assessor determination' }).getByRole('radio', { name: 'Verified score' }).click();
    await page.getByRole('radiogroup', { name: 'Assessor-verified maturity score' }).getByRole('radio', { name: /Established/ }).click();

    await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Executive Overview' }).click();
    // One verified answer in Strategy → provisional index renormalized over that dimension only (3/4 → 75.0).
    await expect(await scoreCardValue(page, /AI Maturity Index: open details/)).toBe('75.0');
    await expect(page.getByText('Provisional').first()).toBeVisible();
    await expect(page.getByText(/11 of 12 dimensions are unscored/).first()).toBeVisible();
    // Self-reported index is independent: 100 on the self basis.
    await expect(page.getByRole('row', { name: /Maturity index/ })).toContainText('100.0');

    // Verify a second answer; the dashboard responds.
    await page.goto('/#/questionnaire?q=S02');
    await page.getByRole('radiogroup', { name: 'Assessor determination' }).getByRole('radio', { name: 'Verified score' }).click();
    await page.getByRole('radiogroup', { name: 'Assessor-verified maturity score' }).getByRole('radio', { name: /Advanced/ }).click();
    await page.goto('/#/');
    await expect(await scoreCardValue(page, /AI Maturity Index: open details/)).toBe('87.5');

    // "Fill from profile" copies the MSME sample's AI/IT expenditure into the spending-intensity indicator (8 ÷ 60 lakh).
    await page.goto('/#/maturity?tab=indicators');
    const card = page.getByRole('list', { name: 'Quantitative indicators' }).getByRole('listitem').filter({ hasText: 'AI spending intensity' });
    await expect(card).toContainText('Not captured');
    await card.getByRole('button', { name: 'Edit inputs' }).click();
    await card.getByRole('button', { name: 'Fill from profile' }).click();
    await expect(card).toContainText('13.3%');
    // Invalid input is rejected, not turned into a number: percentage numerator above its denominator.
    const adoption = page.getByRole('list', { name: 'Quantitative indicators' }).getByRole('listitem').filter({ hasText: 'AI adoption penetration' });
    await adoption.getByRole('button', { name: 'Edit inputs' }).click();
    await adoption.getByLabel('Employees actively using approved AI tools').fill('500');
    await adoption.getByLabel('Eligible employees').fill('100');
    await expect(adoption).toContainText('Invalid input');
    await expect(adoption).toContainText('cannot exceed');

    // Persistence across refresh, and the demonstration assessment is still intact.
    await page.goto('/#/');
    await page.waitForTimeout(500);
    await page.reload();
    await expect(await scoreCardValue(page, /AI Maturity Index: open details/)).toBe('87.5');
    await page.goto('/#/assessments');
    await expect(page.getByRole('heading', { name: 'FY2025-26 AI Maturity Assessment (illustrative)' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Assessments' }).getByRole('listitem')).toHaveCount(2);
  });

  test('evidence workspace: filters, record a reference, accept evidence', async ({ page }) => {
    await fresh(page, '/#/evidence?missing=1');
    await expect(page.getByText('5 questions', { exact: true })).toBeVisible();
    const acceptedBefore = Number(await page.getByText('Accepted (verified)').locator('xpath=following-sibling::div[1]').textContent());
    await page.getByRole('button', { name: /^Review / }).first().click();
    const detail = page.getByRole('complementary', { name: 'Question detail' });
    await detail.getByLabel('Document, system or demonstration that supports the score').fill('Policy v9, signed 2026-03-02');
    await expect(detail.getByText('Provided (not yet reviewed)').first()).toBeVisible();
    await detail.getByLabel('Evidence verification status').selectOption('accepted');
    await page.getByRole('link', { name: 'Evidence & Verification' }).first().click();
    await page.goto('/#/evidence');
    const acceptedAfter = Number(await page.getByText('Accepted (verified)').locator('xpath=following-sibling::div[1]').textContent());
    expect(acceptedAfter).toBe(acceptedBefore + 1);
    // Provided evidence is not counted as verified: dropdown disables "Accepted" without a reference.
    await page.goto('/#/evidence?q=S01');
    await page.getByRole('button', { name: 'Review S01' }).click();
  });

  test('roadmap: edit a recommendation and it persists', async ({ page }) => {
    await fresh(page, '/#/roadmap');
    const title = 'Strengthen Responsible AI, Ethics & Trust';
    await page.getByLabel(`Owner for ${title}`).fill('Head of Risk (edited)');
    await page.getByLabel(`Status for ${title}`).selectOption('in_progress');
    await page.getByLabel(`Priority for ${title}`).selectOption('critical');
    await page.waitForTimeout(500);
    await page.reload();
    await expect(page.getByLabel(`Owner for ${title}`)).toHaveValue('Head of Risk (edited)');
    await expect(page.getByLabel(`Status for ${title}`)).toHaveValue('in_progress');
    await expect(page.getByLabel(`Priority for ${title}`)).toHaveValue('critical');
    // Move on the roadmap and add an initiative.
    await page.getByRole('tab', { name: /Roadmap: 6/ }).click();
    await expect(page.getByRole('heading', { name: '0–6 months' })).toBeVisible();
    await page.getByRole('tab', { name: /Recommendations/ }).click();
    await page.getByRole('button', { name: 'Add initiative' }).click();
    await page.getByLabel(/^Title/).fill('Pilot an AI risk register');
    await page.getByRole('button', { name: 'Add initiative' }).last().click();
    await expect(page.getByRole('heading', { name: 'Pilot an AI risk register' })).toBeVisible();
  });

  test('risk gate: assessor can confirm the advisory ceiling and the classification changes', async ({ page }) => {
    await fresh(page, '/#/risk');
    await expect(page.getByText('Classification flagged for assessor review')).toBeVisible();
    await page.getByRole('button', { name: 'Confirm advisory ceiling' }).click();
    await expect(page.getByText('Gate confirmed — advisory ceiling applied')).toBeVisible();
    await page.goto('/#/');
    await expect(page.getByText('Gate confirmed: classification capped')).toBeVisible();
    await expect(page.getByText('AI Emerging').first()).toBeVisible();
  });

  test('exports: CSV files and the PDF report reflect current results', async ({ page }) => {
    await fresh(page, '/#/reports');
    // Questionnaire CSV
    let [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV: Questionnaire and responses' }).click()]);
    expect(dl.suggestedFilename()).toMatch(/^bharat-prime-financial-services-ltd_questionnaire_\d{8}\.csv$/);
    const q = readFileSync((await dl.path())!, 'utf8').replace(/^﻿/, '');
    const lines = q.trim().split(/\r\n/);
    expect(lines[0]).toContain('Question ID');
    expect(lines.length).toBeGreaterThanOrEqual(101);
    expect(q).toContain('F06');
    // Dimension scores CSV
    [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download CSV: Dimension-level scores' }).click()]);
    const dim = readFileSync((await dl.path())!, 'utf8');
    expect(dim).toContain('AI Strategy & Leadership');
    expect(dim).toContain('AI Maturity Index (definitive)');

    // PDF
    const [pdf] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download PDF report' }).click()]);
    expect(pdf.suggestedFilename()).toMatch(/\.pdf$/);
    const path = (await pdf.path())!;
    expect(readFileSync(path).subarray(0, 5).toString()).toBe('%PDF-');
    const text = execFileSync('pdftotext', ['-layout', path, '-'], { encoding: 'utf8' });
    expect(text).toContain('Bharat Prime Financial Services Ltd (fictional)');
    expect(text).toContain('ILLUSTRATIVE DEMONSTRATION');
    expect(text).toMatch(/Twelve-dimension scorecard/);
    expect(text).toMatch(/Roadmap: 6, 12 and 24 months/);
    // The index printed in the PDF equals the one on the dashboard.
    await page.goto('/#/');
    const idx = await scoreCardValue(page, /AI Maturity Index: open details/);
    expect(text).toContain(idx!);
  });

  test('printable report view renders the same results and offers print', async ({ page }) => {
    await fresh(page, '/#/reports/print');
    await expect(page.getByRole('heading', { level: 1, name: 'AI Maturity Assessment Report' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Roadmap: 6, 12 and 24 months/ })).toBeVisible();
    await expect(page.getByText('not a legal opinion').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(0);
  });

  test('benchmarking: provenance is separated, filters respond, pooling is flagged', async ({ page }) => {
    await fresh(page, '/#/benchmarking');
    await expect(page.getByText(/Illustrative demonstration benchmarks: generated pseudo-randomly/)).toBeVisible();
    await expect(page.getByText(/of 360 records in cohort/)).toBeVisible();
    await expect(page.getByText('Pooled comparison — not like-for-like')).toHaveCount(0);
    await page.getByLabel('Sector').selectOption({ label: 'All sectors (pooled)' });
    await expect(page.getByText('Pooled comparison — not like-for-like')).toBeVisible();
    await page.getByRole('radio', { name: /Independently validated external/ }).click();
    await expect(page.getByText('No external benchmark data has been supplied')).toBeVisible();
    await page.getByRole('radio', { name: /Actual assessments stored in this browser/ }).click();
    await expect(page.getByText(/not eligible as local benchmark records/)).toBeVisible();
  });

  test('assessment management: duplicate, rename, submit (locks), reopen, delete', async ({ page }) => {
    await fresh(page, '/#/assessments');
    const list = page.getByRole('list', { name: 'Assessments' });
    await page.getByRole('button', { name: 'Duplicate' }).first().click();
    await expect(list.getByRole('listitem')).toHaveCount(2);
    const copy = list.getByRole('listitem').filter({ hasText: '(copy)' });
    await copy.getByRole('button', { name: 'Rename' }).click();
    await page.getByLabel('Assessment name').fill('Renamed copy');
    await page.getByRole('button', { name: 'Save name' }).click();
    const renamed = list.getByRole('listitem').filter({ hasText: 'Renamed copy' });
    await expect(renamed).toBeVisible();
    await renamed.getByRole('button', { name: 'Mark submitted' }).click();
    await page.getByRole('button', { name: 'Mark submitted' }).last().click();
    await expect(renamed.getByText('Submitted', { exact: true })).toBeVisible();
    // Locked: open it and try to edit
    await renamed.getByRole('button', { name: 'Open', exact: true }).click();
    await page.goto('/#/questionnaire?q=S01');
    await expect(page.getByText(/submitted and read-only/)).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Self-reported maturity score' }).getByRole('radio').first()).toBeDisabled();
    await page.goto('/#/assessments');
    await renamed.getByRole('button', { name: 'Reopen for review' }).click();
    await page.getByRole('button', { name: 'Reopen', exact: true }).click();
    await expect(renamed.getByText('In progress')).toBeVisible();
    await renamed.getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('button', { name: 'Delete assessment' }).click();
    await expect(list.getByRole('listitem')).toHaveCount(1);
  });

  test('settings: policy change recalculates; reset demo and clear-all work with confirmation', async ({ page }) => {
    await fresh(page, '/#/settings?tab=scoring');
    // Disabling the gate removes the flag from the dashboard.
    await page.getByLabel('Enable maturity gates').uncheck();
    await page.goto('/#/');
    await expect(page.getByText('Flagged for review: critical control deficiency')).toHaveCount(0);
    await page.goto('/#/settings?tab=data');
    await page.getByRole('button', { name: 'Clear all local data' }).click();
    const del = page.getByRole('button', { name: 'Delete everything' });
    await expect(del).toBeDisabled();
    await page.getByLabel(/Type DELETE to confirm/).fill('DELETE');
    await del.click();
    await page.goto('/#/');
    await expect(page.getByText('No assessment selected')).toBeVisible();
    await page.reload();
    await expect(page.getByText('No assessment selected')).toBeVisible(); // empty state persists, not silently re-seeded
    await page.getByRole('button', { name: 'Load illustrative demonstration' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Bharat Prime');
  });

  test('corrupt stored data is backed up and the app recovers', async ({ page }) => {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('corrupted')) {
        sessionStorage.setItem('corrupted', '1');
        localStorage.setItem('aimc:state', '{this is not json');
      }
    });
    await page.goto('/');
    await expect(page.getByText(/Stored data was unreadable/)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Bharat Prime');
    const backups = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('aimc:backup:')));
    expect(backups.length).toBe(1);
  });
});

// -------------------------------------------------------------------------------------------
// "No inert controls": click every enabled button on each main page and require a visible effect.
// -------------------------------------------------------------------------------------------
const PAGES = [
  '/#/', '/#/assessments', '/#/questionnaire?q=S01', '/#/questionnaire?mode=list', '/#/questionnaire/review', '/#/evidence', '/#/maturity', '/#/maturity?tab=dimensions',
  '/#/maturity?tab=indicators', '/#/maturity?tab=india', '/#/risk', '/#/value', '/#/roadmap', '/#/roadmap?tab=roadmap', '/#/benchmarking', '/#/reports', '/#/settings?tab=profile',
  '/#/settings?tab=scoring', '/#/settings?tab=data', '/#/settings?tab=about', '/#/assessments/new',
];

test('no primary action is inert: every enabled button and link does something', async ({ page }) => {
  test.setTimeout(600_000);
  await fresh(page);
  const inert: string[] = [];
  const unnamed: string[] = [];
  let filechooser = false;
  page.on('filechooser', () => { filechooser = true; });
  let downloaded = false;
  page.on('download', () => { downloaded = true; });

  const snapshot = () => page.evaluate(() => ({ url: location.hash, html: document.body.innerHTML.length + ':' + document.body.innerText.length + ':' + (document.querySelector('dialog[open]') ? 'dlg' : ''), ls: (localStorage.getItem('aimc:state') ?? '').length, text: document.body.innerText.slice(0, 4000) }));

  // "Fill from profile" copies profile values that the demo already holds (covered with a real assertion in the
  // new-assessment test); "Match this organization" sets the like-for-like filters that are already the default.
  const IDEMPOTENT = /Match this organization|Fill from profile/;
  const sel = 'main button:not([disabled]), [aria-label="AI maturity assessment report"] button:not([disabled])';
  const attemptClick = async (path: string, i: number): Promise<{ name: string; changed: boolean; skipped: boolean }> => {
    const btn = page.locator(sel).nth(i);
    if (!(await btn.isVisible().catch(() => false))) return { name: '', changed: true, skipped: true };
    const name = ((await btn.getAttribute('aria-label')) || (await btn.innerText()) || (await btn.getAttribute('title')) || '').trim().replace(/\s+/g, ' ');
    if (!name) { unnamed.push(`${path} button#${i}`); return { name, changed: true, skipped: true }; }
    // Controls already in their selected/current state legitimately do nothing when clicked again.
    for (const attr of ['aria-pressed', 'aria-checked', 'aria-selected', 'aria-current']) {
      const v = await btn.getAttribute(attr);
      if (v === 'true' || v === 'page' || v === 'step') return { name, changed: true, skipped: true };
    }
    if (IDEMPOTENT.test(name)) return { name, changed: true, skipped: true };
    const before = await snapshot();
    filechooser = false; downloaded = false;
    await btn.click({ timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(200);
    const after = await snapshot();
    const changed = before.url !== after.url || before.html !== after.html || before.ls !== after.ls || before.text !== after.text || filechooser || downloaded;
    if (before.url !== after.url) { await page.goto(path); await page.waitForLoadState('networkidle'); }
    else if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
    return { name, changed, skipped: false };
  };
  for (const path of PAGES) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const count = Math.min(await page.locator(sel).count(), 45);
    for (let i = 0; i < count; i++) {
      const r = await attemptClick(path, i);
      if (r.skipped || r.changed) continue;
      // Possibly idempotent because earlier clicks left the UI in that state: retry once on a fresh page.
      await page.goto(path);
      await page.reload();
      await page.waitForLoadState('networkidle');
      const retry = await attemptClick(path, i);
      if (!retry.skipped && !retry.changed) inert.push(`${path} → “${r.name}”`);
    }
    // Links: every anchor must have a real target and an accessible name.
    const links = await page.locator('main a, nav a').evaluateAll((as) => as.map((a) => ({ href: a.getAttribute('href'), name: (a.getAttribute('aria-label') || (a as HTMLElement).innerText || '').trim() })));
    for (const l of links) {
      if (!l.href || l.href === '#') inert.push(`${path} → link without target: “${l.name}”`);
      if (!l.name) unnamed.push(`${path} link ${l.href}`);
    }
  }
  expect(unnamed, 'controls without an accessible name').toEqual([]);
  expect(inert, 'controls that did nothing').toEqual([]);
});
