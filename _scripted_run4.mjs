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
    document.querySelectorAll('button').forEach(e => { if (e.textContent?.trim() === 'Open Documentation Folder') e.click(); });
  });
  await new Promise(r => setTimeout(r, 8_000));

  await page.evaluate(() => {
    const els = [...document.querySelectorAll('button, li')].filter(e => e.textContent?.trim() === 'Model');
    const leftmost = els.reduce((a, b) => (a.getBoundingClientRect().x <= b.getBoundingClientRect().x ? a : b));
    leftmost.click();
  });
  await new Promise(r => setTimeout(r, 1500));

  // Click the first "Download" button (the recommended Q4_K_M card).
  const clickResult = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(e => e.textContent?.trim() === 'Download');
    if (!btn) return 'NOT_FOUND';
    btn.click();
    return 'clicked';
  });
  log('download click:', clickResult);

  // Poll progress for up to ~90s.
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 3000));
    const state = await page.evaluate(() => {
      const card = [...document.querySelectorAll('div')].find(d => d.textContent?.includes('DocMind Lite 0.5B (v2)') && !d.textContent?.includes('Q5') && !d.textContent?.includes('Q8'));
      return card ? card.innerText.slice(0, 400) : 'CARD_NOT_FOUND';
    });
    log(`poll ${i}:`, JSON.stringify(state.replace(/\n+/g, ' | ')));
    await shot(page, `30-download-poll-${String(i).padStart(2, '0')}`);
    if (/Verifying|Installing|Ready|Active|Use this model|installed/i.test(state)) {
      if (/Ready|Active|Use this model|installed/i.test(state)) { log('looks done, stopping poll'); break; }
    }
  }

  fs.writeFileSync('/tmp/shots/stage4-done.flag', '1');
  log('DONE stage 4');
  await new Promise(() => {});
})().catch(e => {
  console.error('FATAL:', e);
  fs.writeFileSync('/tmp/shots/FATAL4.txt', String(e && e.stack || e));
  process.exit(1);
});
