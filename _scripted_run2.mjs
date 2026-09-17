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

async function dumpClickables(page) {
  const items = await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"]')];
    return els.slice(0, 120).map(e => (e.textContent || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  });
  log('clickable texts:', JSON.stringify(items));
  return items;
}

async function clickText(page, text) {
  const r = await page.evaluate(t => {
    const els = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"], li, div, span, h1,h2,h3')];
    const exact = els.find(e => e.textContent?.trim() === t);
    const el = exact ?? els.find(e => e.textContent?.trim().includes(t));
    if (!el) return 'NOT_FOUND';
    el.scrollIntoView({ block: 'center' });
    el.click();
    return 'OK:' + el.tagName;
  }, text);
  log('click-text', JSON.stringify(text), '->', r);
  return r;
}

(async () => {
  log('launching...');
  const app = await electron.launch({
    executablePath: electronBin,
    args: ['--no-sandbox', APP_DIR],
    env: {
      ...process.env,
      DOCMIND_MODEL_REGISTRY_URL: 'https://huggingface.co/markuz89/docmind-lite-0.5b/resolve/main/manifest.json',
    },
    timeout: 30_000,
  });

  // Mock the native folder picker to hand back the demo docs folder.
  await app.evaluate(({ dialog }, demoPath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [demoPath] });
  }, DEMO_DOCS);
  log('mocked dialog.showOpenDialog ->', DEMO_DOCS);

  await new Promise(r => setTimeout(r, 6_000));
  let page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow();
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await new Promise(r => setTimeout(r, 2_000));

  await clickText(page, 'Open Documentation Folder');
  log('waiting for indexing...');
  await new Promise(r => setTimeout(r, 8_000));
  await shot(page, '10-after-open-folder');
  await dumpClickables(page);
  fs.writeFileSync('/tmp/shots/10-body.txt', await page.evaluate(() => document.body.innerText));

  // Try to reach AI Models settings.
  for (const label of ['AI Models', 'Models', 'Settings', 'AI', 'Impostazioni']) {
    const r = await clickText(page, label);
    if (r !== 'NOT_FOUND') { await new Promise(r2 => setTimeout(r2, 1500)); break; }
  }
  await shot(page, '11-after-nav-models');
  await dumpClickables(page);
  fs.writeFileSync('/tmp/shots/11-body.txt', await page.evaluate(() => document.body.innerText));

  for (const label of ['Local models', 'Local Models', 'Modelli locali']) {
    const r = await clickText(page, label);
    if (r !== 'NOT_FOUND') { await new Promise(r2 => setTimeout(r2, 1500)); break; }
  }
  await shot(page, '12-local-models-tab');
  const clickables = await dumpClickables(page);
  fs.writeFileSync('/tmp/shots/12-body.txt', await page.evaluate(() => document.body.innerText));

  log('DONE stage 1 (leaving app open)');
  fs.writeFileSync('/tmp/shots/stage1-done.flag', JSON.stringify(clickables));
  await new Promise(() => {});
})().catch(e => {
  console.error('FATAL:', e);
  fs.writeFileSync('/tmp/shots/FATAL.txt', String(e && e.stack || e));
  process.exit(1);
});
