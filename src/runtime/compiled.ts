// What the Vite plugin (vite-plugin-threads.ts) and the playground's page, which
// compiles with the fork in WebAssembly where there is no dev server, both do
// with a compiled program's text. Plain string work: it runs in node and in a
// browser.

// The runtime helpers the fork's emit imports, by the names the runtime exports
// them as. It imports each under a name of its own, the same with two leading
// underscores (`retain as __retain`), or with a number too where a module
// declares or uses that name itself (`retain as __retain_1`).
export const HELPERS = new Set([
  'F64',
  'I32',
  'U8',
  'box',
  'capture',
  'cellAddress',
  'countedRef',
  'moved',
  'newSharedArray',
  'newStruct',
  'outOfBounds',
  'quiescent',
  'register',
  'release',
  'retain',
  'sharedStruct',
  'store',
  'storeStr',
  'strAt',
  'unbox',
]);

// The local names of the helpers that compiled code imports from `runtime` :
// the specifiers of its first import of nothing but helpers.
export function helpersOf(
  code: string,
  runtime: string,
): Record<string, string> {
  for (const m of code.matchAll(/^import \{ ([^}]*) \} from "([^"]*)";$/gm)) {
    if (m[2] !== runtime) continue;
    const pairs = m[1].split(',').map(s => s.trim().split(/\s+as\s+/));
    if (pairs.every(([name]) => HELPERS.has(name)))
      return Object.fromEntries(
        pairs.map(([name, local]) => [name, local ?? name]),
      );
  }
  return {};
}

// A name like `name` that no identifier in `source` has, as TypeScript makes
// one: name, name_1, ...
export function uniqueName(source: string, name: string) {
  const used = new Set(source.match(/[A-Za-z_$][\w$]*/g));
  let unique = name;
  for (let n = 1; used.has(unique); n++) unique = `${name}_${n}`;
  return unique;
}

// Code that registers its functions (`__register(import.meta.url, { ... })`,
// its last statement, under whatever name it imported register as) with `key`
// in place of import.meta.url.
export function keyRegistration(code: string, runtime: string, key: string) {
  const register = helpersOf(code, runtime).register;
  if (!register) return code;
  const call = `${register}(import.meta.url, {`,
    at = code.lastIndexOf(call);
  if (at < 0) return code;
  return `${code.slice(0, at)}${register}(${JSON.stringify(key)}, {${code.slice(at + call.length)}`;
}

// The words and punctuation after which a / starts a regular expression
// rather than divides.
const BEFORE_REGEXP = new Set([
  '',
  ...'( , = : [ ! & | ? { ; ~ + - * % < > ^'.split(' '),
  'return',
  'typeof',
  'case',
  'do',
  'else',
  'in',
  'of',
  'new',
  'delete',
  'void',
  'throw',
  'instanceof',
  'yield',
  'await',
]);

const WORD = /[\w$]+/y;

// `source` with what is not at its top level blanked, a space for each
// character (a newline stays one): its comments, strings, template literals
// and regular expressions, and what is inside its braces, brackets and
// parentheses.
export function topLevel(source: string) {
  const n = source.length;
  let out = '',
    i = 0,
    // the last word or punctuation, at any depth
    last = '';
  // the brackets open, and the template literals' ${ open, innermost last
  const open: string[] = [];
  // the source up to j, kept where it is at the top level
  const take = (j: number, code = true) => {
    const text = source.slice(i, j);
    out += code && open.length === 0 ? text : text.replace(/[^\n]/g, ' ');
    i = j;
  };
  // a template literal's text from j: to its end, or into a ${
  const template = (j: number) => {
    while (j < n && source[j] !== '`' && !source.startsWith('${', j))
      j += source[j] === '\\' ? 2 : 1;
    if (source[j] === '`') {
      take(j + 1, false);
      last = '`';
    } else {
      take(Math.min(j + 2, n), false);
      open.push('${');
      last = '{';
    }
  };
  while (i < n) {
    const c = source[i];
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      take(end < 0 ? n : end, false);
    } else if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      take(end < 0 ? n : end + 2, false);
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && source[j] !== c && source[j] !== '\n')
        j += source[j] === '\\' ? 2 : 1;
      take(Math.min(j + 1, n), false);
      last = c;
    } else if (c === '`') template(i + 1);
    else if (c === '}' && open.at(-1) === '${') {
      open.pop();
      template(i + 1);
    } else if (c === '/' && BEFORE_REGEXP.has(last)) {
      // to its closing /, outside a character class, on its line; with no
      // such /, a division after all
      let j = i + 1,
        inClass = false;
      while (j < n && source[j] !== '\n' && (inClass || source[j] !== '/')) {
        if (source[j] === '[') inClass = true;
        else if (source[j] === ']') inClass = false;
        j += source[j] === '\\' ? 2 : 1;
      }
      if (source[j] === '/') {
        while (/[\w$]/.test(source[j + 1] ?? '')) j++;
        take(j + 1, false);
        last = '/re';
      } else {
        take(i + 1);
        last = '/';
      }
    } else if ('{(['.includes(c)) {
      take(i + 1);
      open.push(c);
      last = c;
    } else if ('})]'.includes(c)) {
      open.pop();
      take(i + 1);
      last = c;
    } else if (/[\w$]/.test(c)) {
      WORD.lastIndex = i;
      last = WORD.exec(source)![0];
      take(i + last.length);
    } else {
      if (!/\s/.test(c)) last = c;
      take(i + 1);
    }
  }
  return out;
}

// What a program with its types only erased needs at its end: the one line
// that registers its top-level functions, which is how a thread finds the one
// it runs (the fork's emit adds it itself); and how many lines that is. The
// fork registers every named function declared at the top level: exported, a
// default export, a generator however its * is spaced, indented or not.
export function registration(source: string, runtime: string) {
  const names = [
    ...topLevel(source).matchAll(
      /(?:^|[;}])\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function(?:\s*\*\s*|\s+)([A-Za-z_$][\w$]*)/gm,
    ),
  ].map(m => m[1]);
  const register = uniqueName(source, 'register'),
    specifier = register === 'register' ? register : `register as ${register}`;
  const tail = `\n// added: the runtime finds a thread's function by module and name\nimport { ${specifier} } from "${runtime}";\n${register}(import.meta.url, { ${names.join(', ')} });\n`;
  return {tail, added: tail.split('\n').length - 2};
}

export type Diagnostic = {
  line: number;
  col: number;
  code: string;
  message: string;
};

// `file(line,col): error TS1234: message` lines, with their indented
// continuations
export function diagnostics(text: string | undefined) {
  const out: Diagnostic[] = [];
  for (const line of String(text ?? '').split('\n')) {
    const m = /^[^()\n]*\((\d+),(\d+)\): error (TS\d+): (.*)$/.exec(line);
    if (m)
      out.push({
        line: Number(m[1]),
        col: Number(m[2]),
        code: m[3],
        message: m[4],
      });
    else if (out.length !== 0 && /^\s+\S/.test(line))
      out.at(-1)!.message += ` ${line.trim()}`;
  }
  return out;
}
