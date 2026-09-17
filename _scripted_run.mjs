import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';

const APP_DIR = '/home/marco/Scrivania/proj/docMindApp';
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
    return els.slice(0, 80).map(e => (e.textContent || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
  });
  log('clickable texts:', JSON.stringify(items));
}

async function clickText(page, text) {
  const r = await page.evaluate(t => {
    const els = [...document.querySelectorAll('button, a, [role="button"], [role="tab"], [role="menuitem"], li, div, span')];
    const exact = els.find(e => e.textContent?.trim() === t);
    const el = exact ?? els.find(e => e.textContent?.trim().includes(t));
    if (!el) return 'NOT_FOUND';
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

  app.on('window', w => log('new window:', w.url()));

  await new Promise(r => setTimeout(r, 6_000));
  let page = app.windows().find(w => !w.url().startsWith('devtools://')) ?? await app.firstWindow();
  log('main page url:', page.url());
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await new Promise(r => setTimeout(r, 3_000));

  await shot(page, '01-landing');
  await dumpClickables(page);

  // Try to reach AI Models -> Local models. Try a few likely labels.
  for (const label of ['AI Models', 'Models', 'Settings', 'Impostazioni']) {
    const r = await clickText(page, label);
    if (r !== 'NOT_FOUND') { await new Promise(r2 => setTimeout(r2, 1500)); break; }
  }
  await shot(page, '02-after-nav1');
  await dumpClickables(page);

  for (const label of ['Local models', 'Local Models', 'Modelli locali']) {
    const r = await clickText(page, label);
    if (r !== 'NOT_FOUND') { await new Promise(r2 => setTimeout(r2, 1500)); break; }
  }
  await shot(page, '03-local-models');
  await dumpClickables(page);

  const bodyText = await page.evaluate(() => document.body.innerText);
  log('body text length:', bodyText.length);
  fs.writeFileSync('/tmp/shots/03-body.txt', bodyText);
  log('body text snippet:', bodyText.slice(0, 1500));

  await new Promise(r => setTimeout(r, 2000));
  await shot(page, '04-final');

  log('DONE (leaving app open for further driving)');
  fs.writeFileSync('/tmp/shots/done.flag', '1');
  // Keep process alive so the window stays open for inspection / further steps.
  await new Promise(() => {});
})().catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
