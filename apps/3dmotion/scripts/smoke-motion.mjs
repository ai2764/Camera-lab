import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const browserCandidates = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const browserPath = browserCandidates.find((candidate) => existsSync(candidate));
if (!browserPath) throw new Error('No Chrome or Edge executable found.');

const port = 9333 + Math.floor(Math.random() * 1000);
const userDataDir = mkdtempSync(join(tmpdir(), '3dmotion-smoke-'));
const targetUrl = process.argv[2] ?? 'http://127.0.0.1:5173';

const browser = spawn(browserPath, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  targetUrl,
], { stdio: 'ignore' });

let nextId = 1;
const pending = new Map();

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForExit(child) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    child.once('exit', resolve);
  });
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function waitForPageTarget() {
  const deadline = Date.now() + 12_000;
  while (Date.now() < deadline) {
    try {
      const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      await wait(200);
    }
  }
  throw new Error('Timed out waiting for browser target.');
}

function connectCdp(wsUrl) {
  const ws = new WebSocket(wsUrl);
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (!message.id) return;
    const callbacks = pending.get(message.id);
    if (!callbacks) return;
    pending.delete(message.id);
    if (message.error) callbacks.reject(new Error(message.error.message));
    else callbacks.resolve(message.result);
  });

  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => {
      resolve({
        send(method, params = {}) {
          const id = nextId++;
          ws.send(JSON.stringify({ id, method, params }));
          return new Promise((methodResolve, methodReject) => {
            pending.set(id, { resolve: methodResolve, reject: methodReject });
          });
        },
        close() {
          ws.close();
        },
      });
    });
    ws.addEventListener('error', reject);
  });
}

async function evaluate(cdp, expression, awaitPromise = true) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const result = await cdp.send('Runtime.evaluate', {
        expression,
        awaitPromise,
        returnByValue: true,
      });
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'Runtime.evaluate failed');
      }
      return result.result.value;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('Execution context was destroyed') || attempt === 4) throw error;
      await wait(300);
    }
  }
  throw new Error('Runtime.evaluate failed.');
}

function hashString(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

try {
  const target = await waitForPageTarget();
  const cdp = await connectCdp(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');

  await evaluate(cdp, `new Promise((resolve, reject) => {
    const deadline = Date.now() + 20000;
    const tick = () => {
      const text = document.body.innerText;
      const hasCanvas = document.querySelectorAll('.stage-wrap canvas').length >= 1;
      const hasNodeAction = [...document.querySelectorAll('button')].some((node) => node.textContent.trim() === 'Dance_Loop');
      if (hasCanvas && hasNodeAction) resolve(true);
      else if (Date.now() > deadline) reject(new Error(text.slice(0, 500)));
      else setTimeout(tick, 250);
    };
    tick();
  })`);

  const beforeFrame = await evaluate(cdp, `document.querySelector('.stage-wrap canvas').toDataURL('image/png')`);

  await evaluate(cdp, `(() => {
    const button = [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === 'Dance_Loop');
    if (!button) throw new Error('Dance_Loop button not found');
    button.click();
  })()`);

  await wait(900);
  const afterFrame = await evaluate(cdp, `document.querySelector('.stage-wrap canvas').toDataURL('image/png')`);
  const afterTime = await evaluate(cdp, `[...document.querySelectorAll('.time-strip span')][0].textContent`);
  const rows = await evaluate(cdp, `[...document.querySelectorAll('.timeline-row')].map((node) => node.innerText)`);

  if (beforeFrame === afterFrame) throw new Error('Canvas frame did not change after playing Dance_Loop.');
  if (Number.parseFloat(afterTime) <= 0) throw new Error(`Playhead did not advance: ${afterTime}`);

  console.log(JSON.stringify({
    ok: true,
    afterTime,
    rows,
    beforeFrameHash: hashString(beforeFrame),
    afterFrameHash: hashString(afterFrame),
  }, null, 2));

  cdp.close();
} finally {
  browser.kill();
  await waitForExit(browser);
  rmSync(userDataDir, { recursive: true, force: true });
}
