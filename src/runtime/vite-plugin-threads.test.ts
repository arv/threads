// The Vite plugin on small projects, built with the tsgo fork: a tsconfig as
// create-vite writes it, a thread module the fork never sees, a .tsx one,
// Vite's own queries, and what a changed file compiles again. The fork is
// TSGO_FORK's (a clone of arv/threads-checker with tsgo built in it, by default
// ~/src/arv/threads-checker), as for compare.ts; without it the tests skip
import fs from 'node:fs';
import {homedir, tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {build, createServer, type InlineConfig, type Plugin} from 'vite-plus';
import {afterAll, beforeEach, describe, expect, it} from 'vite-plus/test';
import threads, {type Options} from './vite-plugin-threads.ts';

const TSGO = path.join(
  process.env.TSGO_FORK ?? path.join(homedir(), 'src/arv/threads-checker'),
  'built/local/tsgo',
);
const missing = fs.existsSync(TSGO)
  ? null
  : `no tsgo fork at ${TSGO} (TSGO_FORK names a clone of arv/threads-checker with tsgo built in it)`;
const RUNTIME = path.dirname(fileURLToPath(import.meta.url));

// a project of these files, in a directory of its own
const roots: string[] = [];
afterAll(() => {
  for (const root of roots) fs.rmSync(root, {recursive: true, force: true});
});
function project(files: Record<string, string>) {
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(tmpdir(), 'threads-vite-')),
  );
  roots.push(root);
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), {recursive: true});
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

// the tsconfig create-vite writes (vanilla-ts), which emits nothing, with the
// runtime's types
const tsconfig = (options: object = {}) =>
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      lib: ['ES2022', 'DOM'],
      skipLibCheck: true,
      moduleResolution: 'bundler',
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      moduleDetection: 'force',
      noEmit: true,
      strict: true,
      paths: Object.fromEntries(
        ['', '/heap', '/browser'].map(sub => [
          `@arv/threads${sub}`,
          [path.join(RUNTIME, `${sub.slice(1) || 'threads'}.d.ts`)],
        ]),
      ),
      ...options,
    },
    include: ['src'],
  });
// a page that runs main, from a module of its own, on a thread
const INDEX =
  '<!doctype html><script type="module" src="/src/main.ts"></script>\n';
const page = (app: string) =>
  `import '@arv/threads/heap';\nimport {run} from '@arv/threads/browser';\nimport {main} from '${app}';\n\nconsole.log(await run(main, 21));\n`;
const APP = `import {log} from '@arv/threads';\n\nexport function main(n: number): number {\n  log('main', n);\n  return n * 2;\n}\n`;

// Vite's config for a project: the plugin, and the runtime from its sources
const config = (
  root: string,
  options: Omit<Options, 'tsgo'> = {},
  alias: {find: RegExp; replacement: string}[] = [],
): InlineConfig => ({
  root,
  configFile: false,
  logLevel: 'silent',
  cacheDir: path.join(root, '.vite'),
  plugins: [threads({tsgo: TSGO, ...options})],
  resolve: {
    alias: [
      {find: /^@arv\/threads$/, replacement: path.join(RUNTIME, 'threads.ts')},
      {
        find: /^@arv\/threads\/(heap|browser)$/,
        replacement: path.join(RUNTIME, '$1.ts'),
      },
      ...alias,
    ],
  },
  build: {target: 'es2022', minify: false},
});
// the project built: its bundles' JavaScript, the page's and the workers'
async function bundle(...args: Parameters<typeof config>) {
  const root = args[0];
  await build(config(...args));
  const assets = path.join(root, 'dist/assets');
  return fs
    .readdirSync(assets)
    .map(name => fs.readFileSync(path.join(assets, name), 'utf8'))
    .join('\n');
}
// a dev server for a project, which the fork compiles as it starts, with no
// port, websocket or watcher of its own
const serve = (root: string) =>
  createServer({
    ...config(root),
    server: {middlewareMode: true, ws: false, watch: null},
  });
// main registered, by its module's key
const registered = (key: string) =>
  new RegExp(
    String.raw`register\w*\("${key.replace(/\./g, '\\.')}", \{ main \}\)`,
  );

describe('the Vite plugin', () => {
  beforeEach(context => {
    if (missing) context.skip(missing);
  });

  it('compiles a project whose tsconfig emits nothing, type errors and all', async () => {
    const root = project({
      'index.html': INDEX,
      'tsconfig.json': tsconfig(),
      'src/main.ts': page('./app.ts'),
      'src/app.ts': APP,
      'src/wrong.ts': `export const n: number = 'one';\n`,
    });
    expect(await bundle(root)).toMatch(registered('src/app.ts'));
  });

  it('adds options that raise no error of their own', async () => {
    // which would stop the emit with noEmitOnError
    const root = project({
      'index.html': INDEX,
      'tsconfig.json': tsconfig({noEmitOnError: true}),
      'src/main.ts': page('./app.ts'),
      'src/app.ts': APP,
    });
    expect(await bundle(root)).toMatch(registered('src/app.ts'));
  });

  it('reports the errors that stopped an incremental emit', async () => {
    // noEmitOnError: the fork writes its build info, and no JavaScript
    const root = project({
      'index.html': INDEX,
      'tsconfig.json': tsconfig({incremental: true, noEmitOnError: true}),
      'src/main.ts': page('./app.ts'),
      'src/app.ts': APP,
      'src/wrong.ts': `export const n: number = 'one';\n`,
    });
    await expect(bundle(root)).rejects.toThrow(
      /tsgo emitted nothing for .*tsconfig\.json:\n.*wrong\.ts\(1,14\): error TS2322/,
    );
  });

  it('says to name the app’s tsconfig where tsconfig.json only references others', async () => {
    const root = project({
      'index.html': INDEX,
      'tsconfig.json': JSON.stringify({
        files: [],
        references: [{path: './tsconfig.app.json'}],
      }),
      'tsconfig.app.json': tsconfig(),
      'src/main.ts': page('./app.ts'),
      'src/app.ts': APP,
    });
    await expect(bundle(root)).rejects.toThrow(
      /tsgo emitted nothing for .*tsconfig\.json, and reported no error: a solution-style tsconfig .* Name the app's \(tsconfig\.app\.json, say\) with the plugin's tsconfig option/,
    );
    expect(await bundle(root, {tsconfig: 'tsconfig.app.json'})).toMatch(
      registered('src/app.ts'),
    );
  });

  it('compiles everything each time where the build is incremental', async () => {
    // the build info kept apart from what the fork emits, which goes as
    // each compile starts
    const root = project({
      'index.html': INDEX,
      'tsconfig.json': tsconfig({
        incremental: true,
        tsBuildInfoFile: './node_modules/.tmp/tsconfig.tsbuildinfo',
      }),
      'src/main.ts': page('./app.ts'),
      'src/app.ts': APP,
    });
    for (const _ of [1, 2]) {
      const server = await serve(root);
      try {
        expect(
          (await server.environments.client.transformRequest('/src/app.ts'))
            ?.code,
        ).toMatch(registered('src/app.ts'));
      } finally {
        await server.close();
      }
    }
  });

  it('refuses a thread module the fork did not compile', async () => {
    // lib/ is outside the tsconfig's include, reached through an alias; the
    // import of the runtime has a comment in it
    const root = project({
      'index.html': INDEX,
      'tsconfig.json': tsconfig(),
      'src/main.ts': page('~lib/app.ts'),
      'lib/app.ts': APP.replace('from ', 'from /* the runtime */ '),
    });
    await expect(
      bundle(root, {}, [{find: /^~lib\//, replacement: `${root}/lib/`}]),
    ).rejects.toThrow(
      "threads: lib/app.ts was not compiled by tsgo -p tsconfig.json: add it to the tsconfig's include or files (or mirror the alias in paths)",
    );
  });

  it('lets a module the fork did not compile be, where it does not import the runtime', async () => {
    // an import in a comment, or in a string, is none
    const root = project({
      'index.html': INDEX,
      'tsconfig.json': tsconfig(),
      'src/main.ts': `import '~lib/note.ts';\n${page('./app.ts')}`,
      'src/app.ts': APP,
      'lib/note.ts': `// import {log} from '@arv/threads';\nexport const note: string = "import '@arv/threads'";\n`,
    });
    expect(
      await bundle(root, {}, [{find: /^~lib\//, replacement: `${root}/lib/`}]),
    ).toMatch(registered('src/app.ts'));
  });

  for (const jsx of ['react-jsx', 'preserve'])
    it(`compiles a .tsx thread module (jsx: ${jsx})`, async () => {
      const root = project({
        'index.html': INDEX,
        'tsconfig.json': tsconfig({jsx}),
        'src/main.ts': page('./app.tsx'),
        'src/app.tsx': APP,
      });
      expect(await bundle(root)).toMatch(registered('src/app.tsx'));
    });

  it('tells a .tsx thread module from a .ts of its name', async () => {
    // both compiled, to app.js and app.jsx (jsx: preserve)
    const OTHER = `import {log} from '@arv/threads';\n\nexport function other() {\n  log('other');\n}\n`;
    const both = project({
      'index.html': INDEX,
      'tsconfig.json': tsconfig({jsx: 'preserve'}),
      'src/main.ts': page('./app.tsx'),
      'src/app.tsx': APP,
      'src/app.ts': OTHER,
    });
    expect(await bundle(both)).toMatch(registered('src/app.tsx'));
    // the .ts left out, the .tsx compiled to app.js (jsx: react-jsx)
    const one = project({
      'index.html': INDEX,
      'tsconfig.json': JSON.stringify({
        ...JSON.parse(tsconfig({jsx: 'react-jsx'})),
        include: undefined,
        files: ['src/main.ts', 'src/app.tsx'],
      }),
      'src/main.ts': page('./app.tsx'),
      'src/app.tsx': APP,
      'src/app.ts': OTHER,
    });
    const js = await bundle(one);
    expect(js).toMatch(registered('src/app.tsx'));
    expect(js).not.toContain('"src/app.ts"');
  });

  it('leaves ?raw, ?url and ?worker to Vite', async () => {
    const root = project({
      'index.html': INDEX,
      'tsconfig.json': tsconfig(),
      'src/main.ts': `import text from './w.ts?raw';\nimport url from './w.ts?url';\nimport W from './w.ts?worker';\n\nconsole.log(text, url, new W());\n`,
      'src/w.ts': `const n: number = 1;\npostMessage(n);\n`,
    });
    const js = await bundle(root);
    expect(js).toContain('"const n: number = 1;');
    expect(js).toContain('new Worker(');
  });

  it('compiles again for a change only to a source the fork compiled or Vite loaded', async () => {
    const root = project({
      'index.html': INDEX,
      'tsconfig.json': tsconfig(),
      'src/main.ts': page('./app.ts'),
      'src/app.ts': APP,
      'scripts/tool.ts': `export const tool: number = 1;\n`,
    });
    const server = await serve(root);
    try {
      const client = server.environments.client;
      expect((await client.transformRequest('/src/app.ts'))?.code).toMatch(
        registered('src/app.ts'),
      );
      const plugin = server.config.plugins.find(p => p.name === 'threads')!;
      const hotUpdate = plugin.hotUpdate as Extract<
        Plugin['hotUpdate'],
        Function
      >;
      // whether the fork compiled again, which clears what it emitted
      const marker = path.join(root, '.vite/threads/page/marker');
      const compiles = async (type: 'create' | 'update', file: string) => {
        fs.writeFileSync(marker, '');
        await hotUpdate.call({environment: client} as any, {
          type,
          file: path.join(root, file),
          timestamp: Date.now(),
          modules: [],
          read: () => '',
          server,
        });
        return !fs.existsSync(marker);
      };
      expect(await compiles('update', 'scripts/tool.ts')).toBe(false);
      expect(await compiles('update', 'src/app.ts')).toBe(true);
      expect(await compiles('create', 'scripts/new.ts')).toBe(true);
    } finally {
      await server.close();
    }
  });
});
