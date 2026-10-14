import fs from 'node:fs';
// runs a program in Chrome (the installed Google Chrome, through Playwright),
// on real Web Workers sharing one SharedArrayBuffer heap
//   node src/chrome.ts <program> [options]
//   <program>: as run.ts takes it
//   --threads=1,2,4,8   the thread counts the program runs its work with
//   --pool=N            workers started up front (default: the browser's
//                       hardwareConcurrency)
//   --trace=file.json   record a DevTools performance trace (CPU samples of
//                       every thread); open it in DevTools' Performance panel,
//                       or summarize it with trace-summary.ts
//   --headed            show the browser window (default: Chrome's headless
//                       mode)
//   --stats             print the runtime's counters (to stderr)
//   --check             poison freed blocks
//   --timeout=S         how long the program may take, in seconds (default:
//                       600; 0 waits for good)
// needs playwright-core (a dev dependency of this repository), found
// normally or through $PLAYWRIGHT_CORE, the path of an install's
// node_modules/playwright-core
import http from 'node:http';
import {createRequire, stripTypeScriptTypes} from 'node:module';
import type {AddressInfo} from 'node:net';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import type {BrowserType} from 'playwright-core';
import {findProgram, runtimeModule} from './program.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
// the repository: its pages are under src/, what the tsgo fork emits in build/
const repo = path.resolve(here, '..');

const loadChromium = async (): Promise<BrowserType> => {
  const pw = await (process.env.PLAYWRIGHT_CORE
    ? import(
        pathToFileURL(
          createRequire(path.join(process.env.PLAYWRIGHT_CORE, 'x.js')).resolve(
            process.env.PLAYWRIGHT_CORE,
          ),
        ).href
      )
    : import('playwright-core'));
  return pw.chromium ?? pw.default.chromium; // a CommonJS module, imported
};

// a module's imports of the runtime (see runtimeModule), as the browser loads
// them: workers have no import maps
const runtimeImports: (text: string) => string = text =>
  text.replace(
    /(\bfrom\s*|\bimport\s*\(?\s*)(['"])(@arv\/threads[^'"]*)\2/g,
    (all, before: string, q: string, specifier: string) => {
      const m = runtimeModule(specifier);
      return m === null ? all : `${before}${q}/src/runtime/${m}${q}`;
    },
  );

// this repository, cross-origin isolated (SharedArrayBuffer needs COOP and
// COEP)
const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.ts': 'text/javascript; charset=utf-8',
};
const serve = async () => {
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(
      new URL(req.url!, 'http://localhost').pathname,
    );
    const file = path.join(repo, pathname);
    if (
      !file.startsWith(repo) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': types[path.extname(file)] ?? 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'cache-control': 'no-store',
    });
    // a module as the browser can run it: a TypeScript one's types stripped
    const text = fs.readFileSync(file, 'utf8');
    if (file.endsWith('.ts'))
      res.end(runtimeImports(stripTypeScriptTypes(text)));
    else if (file.endsWith('.js')) res.end(runtimeImports(text));
    else res.end(text);
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  // listening on a port, so its address is one
  return server as Omit<http.Server, 'address'> & {address(): AddressInfo};
};

// a program as the page takes it: its module's path in this repository
export const pageProgram: (program: string) => string = program => {
  const file = findProgram(program);
  if (!file.startsWith(repo + path.sep))
    throw new Error(
      `chrome: ${file} is outside ${repo}, which the page serves`,
    );
  return path.relative(repo, file).split(path.sep).join('/');
};

// runs a program (see pageProgram) on index.html to completion. resolves to {
// ok, error, output, counters, version }; rejects when the page fails before
// it reports (an error it throws, a module of its that does not load), or does
// not report within timeout ms (0: no limit)
export const runInChrome = async ({
  query = {},
  trace = null,
  headed = false,
  timeout = 600_000,
}: {
  query?: Record<string, string>;
  trace?: string | null;
  headed?: boolean;
  timeout?: number;
}) => {
  const chromium = await loadChromium();
  const server = await serve();
  const browser = await chromium.launch({channel: 'chrome', headless: !headed});
  try {
    const page = await browser.newPage();
    // a page that fails before it reports never will: the run fails with the
    // first failure (one after the result is no one's)
    let fail!: (e: Error) => void;
    const failed = new Promise<never>((_, reject) => {
      fail = reject;
    });
    failed.catch(() => {});
    page.on('pageerror', e =>
      fail(new Error(`chrome: the page threw ${e.stack ?? e.message}`)),
    );
    page.on('console', m => {
      if (m.type() !== 'error') return;
      const {url} = m.location();
      // a module that did not load: what imports it never runs
      if (
        m.text().startsWith('Failed to load module script') ||
        (m.text().includes('404') && /\.[jt]s$/.test(url))
      )
        fail(new Error(`chrome: ${url} did not load: ${m.text()}`));
      // what else is not found (the page's icon) is no matter
      else if (!m.text().includes('404')) console.error(`console: ${m.text()}`);
    });
    if (trace)
      await browser.startTracing(page, {
        path: path.resolve(trace),
        categories: [
          '__metadata',
          'toplevel',
          'devtools.timeline',
          'disabled-by-default-devtools.timeline',
          'v8.execute',
          'disabled-by-default-v8.cpu_profiler',
          'blink.user_timing',
        ],
      });
    await page.goto(
      `http://127.0.0.1:${server.address().port}/src/index.html?${new URLSearchParams(query)}`,
    );
    const result = await Promise.race([
      page
        .waitForFunction(() => window.__escapeResult!, null, {
          timeout,
          polling: 100,
        })
        .then(
          h => h.jsonValue(),
          (e: Error) => {
            throw e.name === 'TimeoutError'
              ? new Error(
                  `chrome: the page did not report in ${timeout / 1000} s: its program is stuck, or slower than that (chrome.ts --timeout=S waits longer, 0 for good)`,
                )
              : e;
          },
        ),
      failed,
    ]);
    if (trace) await browser.stopTracing();
    return {...result, version: browser.version()};
  } finally {
    await browser.close();
    server.close();
  }
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const opt = (n: string, d?: string) =>
    args.find(a => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
  const flag: (n: string) => boolean = n => args.includes(`--${n}`);
  const name = args.find(a => !a.startsWith('--'));
  if (!name) {
    console.error(
      'usage: node src/chrome.ts <program> [--threads=1,2,4,8] [--trace=file.json] [--headed] [--timeout=600]',
    );
    process.exit(1);
  }
  const query: Record<string, string> = {
    program: pageProgram(name),
    threads: opt('threads', '1,2,4,8')!,
  };
  if (opt('pool')) query.pool = opt('pool')!;
  if (flag('check')) query.check = '';
  const trace = opt('trace');
  const result = await runInChrome({
    query,
    trace,
    headed: flag('headed'),
    timeout: Number(opt('timeout', '600')) * 1000,
  }).catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
  process.stdout.write(result.output);
  if (trace) console.error(`trace: ${path.resolve(trace)}`);
  if (!result.ok) console.error(result.error);
  if (flag('stats') && result.counters)
    console.error(JSON.stringify(result.counters));
  console.error(`chrome ${result.version}`);
  process.exitCode = result.ok ? 0 : 1;
}
