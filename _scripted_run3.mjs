import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR = '/home/marco/Scrivania/proj/docMindApp';
const DEMO_DOCS = path.join(APP_DIR, 'demo/example-project');
const SHOT_DIR = '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/electron');
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function shot(page, name) {
  const f = path.join(SHOT_DIR, name + '.png');
  await page.screenshot({ path: f });
  log('screenshot:', f);
}

(async () => {
  log('launching...');
  const app = await electron.launch({
    executablePath: electronBin,
    args: ['--no-sandbox', APP_DIR],
    env: { ...process.env, DOCMIND_MODEL_REGISTRY_URL: 'https://huggingface.co/markuz89/docmind-lite-0.5b/resolve/main/manifest.json' },
    timeout: 30_000,
  });
  await app.evaluate(({ dialog }, demoPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [demoPath] });
  }, DEMO_DOCS);

  await new Promise(r => setTimeout(r, 6_000));
  let page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await new Promise(r => setTimeout(r, 2_000));

  await page.evaluate(() => {
    const el = [...document.querySelectorAll('button')].find(e => e.textContent?.trim() === 'Open Documentation Folder');
    el?.click();
  });
  await new Promise(r => setTimeout(r, 8_000));

  // Inspect all "Model" text nodes to disambiguate sidebar nav vs settings tab.
  const modelEls = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a, [role="button"], li')];
    return els
      .filter(e => e.textContent?.trim() === 'Model')
      .map(e => ({
        tag: e.tagName, cls: e.className, parentCls: e.parentElement?.className,
        rect: e.getBoundingClientRect(),
      }));
  });
  log('Model elements found:', JSON.stringify(modelEls));

  // Click the sidebar one: heuristic = smallest x (left sidebar).
  const clicked = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a, [role="button"], li')]
      .filter(e => e.textContent?.trim() === 'Model');
    if (!els.length) return 'NOT_FOUND';
    const leftmost = els.reduce((a, b) => (a.getBoundingClientRect().x <= b.getBoundingClientRect().x ? a : b));
    leftmost.click();
    return 'clicked x=' + leftmost.getBoundingClientRect().x;
  });
  log('sidebar Model click:', clicked);
  await new Promise(r => setTimeout(r, 2_000));
  await shot(page, '20-model-page');
  fs.writeFileSync('/tmp/shots/20-body.txt', await page.evaluate(() => document.body.innerText));

  const clickables = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a, [role="button"], [role="tab"]')];
    return els.map(e => (e.textContent || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  });
  log('clickables on Model page:', JSON.stringify(clickables));

  fs.writeFileSync('/tmp/shots/stage3-done.flag', '1');
  log('DONE stage 3 (leaving app open)');
  await new Promise(() => {});
})().catch(e => {
  console.error('FATAL:', e);
  fs.writeFileSync('/tmp/shots/FATAL3.txt', String(e && e.stack || e));
  process.exit(1);
});
