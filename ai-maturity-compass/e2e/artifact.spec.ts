/**
 * The published Artifact page, loaded the way the Claude viewer loads it: inside a sandboxed iframe, under a strict
 * Content-Security-Policy, wrapped in the viewer's page skeleton, with the `downloads` capability mocked.
 * Requires `npm run build:artifact` (the Playwright web server runs it).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const ARTIFACT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'dist-artifact', 'artifact.html');
const ORIGIN = 'https://viewer.test';

const SKELETON_HEAD =
  '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">' +
  '<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>';

// Approximates the viewer CSP: inline script/style only, no network, no external hosts.
const CSP = "default-src 'none'; script-src 'unsafe-inline' https://cdnjs.cloudflare.com; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

type Dl = 'accept' | 'decline' | 'none';

async function openViewer(page: Page, opts: { sameOrigin: boolean; dl?: Dl; width?: number }) {
  const body = readFileSync(ARTIFACT, 'utf8');
  const violations: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') violations.push(m.text()); });
  page.on('pageerror', (e) => violations.push(`pageerror: ${e.message}`));
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/frame.html') {
      const dl = url.searchParams.get('dl');
      const mock = dl === 'none' ? '' :
        `<script>window.__saved=[];window.claude={use:async function(n){if(n!=='downloads')return null;return{save:async function(r){` +
        (dl === 'decline' ? `throw {code:'declined',message:'no'};` : `window.__saved.push({filename:r.filename,kind:typeof r.data==='string'?'string':'blob',size:typeof r.data==='string'?r.data.length:r.data.size,head:typeof r.data==='string'?r.data.slice(0,40):''});return{status:'saved'};`) +
        `}}}};</script>`;
      await route.fulfill({ contentType: 'text/html', headers: { 'content-security-policy': CSP }, body: `${SKELETON_HEAD}${mock}</head><body>${body}</body></html>` });
    } else {
      const sandbox = opts.sameOrigin ? 'allow-scripts allow-same-origin allow-modals' : 'allow-scripts allow-modals';
      await route.fulfill({ contentType: 'text/html', body: `<!doctype html><body style="margin:0"><iframe id="v" title="artifact" sandbox="${sandbox}" src="/frame.html?dl=${opts.dl ?? 'accept'}" style="border:0;width:100vw;height:100vh"></iframe></body>` });
    }
  });
  if (opts.width) await page.setViewportSize({ width: opts.width, height: 844 });
  await page.goto(`${ORIGIN}/`);
  const frame = page.frameLocator('#v');
  await expect(frame.getByRole('heading', { level: 1 })).toContainText('Bharat Prime Financial Services Ltd (fictional)');
  return { frame, violations, saved: async () => page.frames().find((f) => f.url().includes('frame.html'))!.evaluate(() => (window as unknown as { __saved: unknown[] }).__saved) };
}

test.beforeAll(() => { test.skip(!existsSync(ARTIFACT), 'run `npm run build:artifact` first'); });

test.describe('artifact page in a sandboxed viewer frame', () => {
  test('renders the demo under the strict CSP with no errors; every nav item works and the URL is untouched', async ({ page }) => {
    const { frame, violations } = await openViewer(page, { sameOrigin: true });
    await expect(frame.getByText('Illustrative demonstration assessment', { exact: true })).toBeVisible();
    await expect(frame.getByText('Flagged for review: critical control deficiency')).toBeVisible();
    for (const [label, heading] of [['Assessments', 'Assessments'], ['Assessment Questionnaire', 'Assessment Questionnaire'], ['Evidence & Verification', 'Evidence & Verification'], ['AI Maturity Analysis', 'AI Maturity Analysis'], ['Risk & Governance', 'Risk & Governance'], ['Value Realization', 'Value Realization'], ['Recommendations & Roadmap', 'Recommendations & Roadmap'], ['Benchmarking', 'Benchmarking'], ['Reports', 'Reports'], ['Settings', 'Settings'], ['Executive Overview', 'Bharat Prime']] as const) {
      await frame.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: label }).click();
      await expect(frame.getByRole('heading', { level: 1 }).first()).toContainText(heading);
    }
    expect(page.url()).toBe(`${ORIGIN}/`); // the viewer's own URL is never rewritten
    expect(violations).toEqual([]);
  });

  test('changes persist across a reload when storage is available', async ({ page }) => {
    const { frame } = await openViewer(page, { sameOrigin: true });
    await frame.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Assessment Questionnaire' }).click();
    await frame.getByRole('radiogroup', { name: 'Self-reported maturity score' }).getByRole('radio', { name: /Not initiated/ }).click();
    await expect(frame.getByText('All changes saved automatically')).toBeVisible();
    await page.waitForTimeout(500);
    await page.frames().find((f) => f.url().includes('frame.html'))!.evaluate(() => location.reload());
    await expect(frame.getByRole('heading', { level: 1 })).toContainText('Bharat Prime');
    await frame.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Assessment Questionnaire' }).click();
    await expect(frame.getByRole('radiogroup', { name: 'Self-reported maturity score' }).getByRole('radio', { name: /Not initiated/ })).toHaveAttribute('aria-checked', 'true');
  });

  test('still fully usable when the viewer blocks browser storage (opaque-origin sandbox)', async ({ page }) => {
    const { frame, violations } = await openViewer(page, { sameOrigin: false });
    await expect(frame.getByText('Changes last for this visit only')).toBeVisible();
    await frame.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Risk & Governance' }).click();
    await frame.getByRole('button', { name: 'Confirm advisory ceiling' }).click();
    await expect(frame.getByText('Gate confirmed — advisory ceiling applied')).toBeVisible();
    await frame.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Executive Overview' }).click();
    await expect(frame.getByText('Gate confirmed: classification capped')).toBeVisible();
    // create a new assessment from the switcher, in memory
    await frame.getByRole('button', { name: 'Switch assessment' }).click();
    await frame.getByRole('menuitem', { name: 'New assessment' }).click();
    await frame.getByRole('button', { name: 'Government institution (sample)' }).click();
    await expect(frame.getByLabel(/Organization name/)).toHaveValue(/Department of Citizen Services/);
    expect(violations.filter((v) => !/Failed to read the 'localStorage'|SecurityError/.test(v))).toEqual([]);
  });

  test('exports go through the viewer downloads capability (PDF, CSV, JSON), and a declined save is reported calmly', async ({ page }) => {
    const { frame, saved } = await openViewer(page, { sameOrigin: true, dl: 'accept' });
    await frame.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Reports' }).click();
    await frame.getByRole('button', { name: 'Download PDF report' }).click();
    await expect(frame.getByText(/PDF report .* ready/)).toBeVisible();
    await frame.getByRole('button', { name: 'Download CSV: Questionnaire and responses' }).click();
    await frame.getByRole('button', { name: 'Download JSON: complete assessment' }).click();
    await expect.poll(async () => ((await saved()) as unknown[]).length).toBe(3);
    const s = (await saved()) as { filename: string; kind: string; size: number; head: string }[];
    const pdf = s.find((x) => x.filename.endsWith('.pdf'))!;
    expect(pdf.kind).toBe('blob');
    expect(pdf.size).toBeGreaterThan(20_000);
    const csv = s.find((x) => x.filename.endsWith('.csv'))!;
    expect(csv.kind).toBe('string');
    expect(csv.head.replace('﻿', '')).toContain('Question ID');
    expect(s.find((x) => x.filename.endsWith('.json'))).toBeTruthy();
  });

  test('a declined download shows a neutral message', async ({ page }) => {
    const { frame } = await openViewer(page, { sameOrigin: true, dl: 'decline' });
    await frame.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Reports' }).click();
    await frame.getByRole('button', { name: 'Download CSV: Dimension-level scores' }).click();
    await expect(frame.getByText(/not saved \(cancelled\)/)).toBeVisible();
  });

  test('the report view has no Print button (print dialogs are unavailable in the viewer) but keeps Download PDF', async ({ page }) => {
    const { frame } = await openViewer(page, { sameOrigin: true });
    await frame.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Reports' }).click();
    await frame.getByRole('link', { name: 'Open printable view' }).click();
    await expect(frame.getByRole('heading', { level: 1, name: 'AI Maturity Assessment Report' })).toBeVisible();
    await expect(frame.getByRole('button', { name: 'Print', exact: true })).toHaveCount(0);
    await expect(frame.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  });

  test('phone width: no horizontal page scroll on the main pages', async ({ page }) => {
    const { frame } = await openViewer(page, { sameOrigin: true, width: 390 });
    const f = page.frames().find((x) => x.url().includes('frame.html'))!;
    for (const label of ['Executive Overview', 'Assessments', 'Assessment Questionnaire', 'Evidence & Verification', 'AI Maturity Analysis', 'Risk & Governance', 'Value Realization', 'Recommendations & Roadmap', 'Benchmarking', 'Reports', 'Settings']) {
      await frame.getByRole('button', { name: 'Open navigation menu' }).click();
      await frame.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: label }).click();
      await expect(frame.getByRole('heading', { level: 1 }).first()).toBeVisible();
      const over = await f.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(over, `horizontal overflow on ${label}`).toBeLessThanOrEqual(1);
    }
  });
});
