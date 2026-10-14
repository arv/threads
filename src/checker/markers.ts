// The plain TypeScript API of threads (ownmarkers.go): the module the runtime
// specifier names (threads.d.ts) exports markers that stock TypeScript accepts,
// and the checker gives them their meaning:
//
//   Sending<T>                 a value whose ownership moves (a parameter, a
//                              rest parameter, a result)
//   Shared<T>                  a shared value (deeply readonly)
//   consume(x)                 ends x's lifetime
//   a type assignable to Cell  a cell: shared and region-less
//   const S = struct({ a: f64, next: ref<T>() }), const S = struct<I>({ ... })
//                              a shared struct: its fields in the order of the
//                              object literal, `f64` a number field and
//                              `ref<T>()` a reference field.
//
// A marker is recognized by its declaration: an export of the runtime module,
// by name.

import {CellKind} from './context.ts';
import type {FieldKind, Own, StructInfo} from './context.ts';
import {IndexKind, ObjectFlags, SymbolFlags, TypeFlags} from './host.ts';
import type {TsSymbol, Type} from './host.ts';
import {getCellType, getFieldKind, isFieldType} from './layout.ts';
import {Messages} from './messages.ts';
import {
  forEachChild,
  isPropertyNameLiteral,
  isThisParameter,
  K,
  skipParentheses,
  walkUpParenthesizedExpressions,
} from './syntax.ts';
import type {Node} from './syntax.ts';

// The name of the runtime export a symbol is (or is an alias of), or "" if it
// is none.
export function getRuntimeExportName(
  c: Own,
  symbol: TsSymbol | undefined,
): string {
  if (!symbol) return '';
  let name = c.runtimeExportNames.get(symbol);
  if (name !== undefined) return name;
  let target: TsSymbol | undefined = symbol;
  if (symbol.flags & SymbolFlags.Alias) target = c.host.resolveAlias(symbol);
  name =
    target && target.declarations.some(d => c.isRuntimePath(d.path))
      ? target.name
      : '';
  c.runtimeExportNames.set(symbol, name);
  return name;
}

// The marker a type node refers to: "Sending" or "Shared" for `Sending<T>` and
// `Shared<T>` , or "".
export function getTypeMarker(c: Own, t: Node | undefined): string {
  if (!t || t.kind !== K.TypeReference || t.typeArguments?.length !== 1)
    return '';
  const name = getRuntimeExportName(c, c.host.symbolAt(t.typeName));
  return name === 'Sending' || name === 'Shared' ? name : '';
}

// The marker function a call calls: "consume", "struct", "ref", or "". By the
// declaration the call resolves to, whatever the callee looks like: `consume as
// take`, a const that holds it, `threads["consume"]`, an asserted alias, are
// consume too. (The signature is fetched once per call and cached; a
// declaration is looked up for the runtime's own only.) An `import()` is no
// call of a declaration.
export function getCallMarker(c: Own, call: Node | undefined): string {
  if (!call || call.kind !== K.CallExpression) return '';
  if (call.expression.kind === K.ImportKeyword) return '';
  const handle = c.host.signatureOf(call).declaration;
  if (
    !handle ||
    handle.kind !== K.FunctionDeclaration ||
    !c.isRuntimePath(handle.path)
  )
    return '';
  const declared = c.host.declarationOf(handle)?.name?.text;
  return declared === 'consume' || declared === 'struct' || declared === 'ref'
    ? declared
    : '';
}

// The operations of the runtime's `atomic` , which are those of `Atomics` by
// the same names.
const atomicOperations = new Set([
  'load',
  'store',
  'add',
  'sub',
  'and',
  'or',
  'xor',
  'exchange',
  'compareExchange',
  'wait',
  'notify',
]);

// Whether a call is an atomic operation (getOwnAtomicCall): undefined if it is
// not one, true if it acts on an i32 field of a shared struct named by a string
// literal or on an element of a SharedArray<i32>, and false if it acts on
// anything else, which is an error.
export function isAtomicCallValid(c: Own, call: Node): boolean | undefined {
  const callee = skipParentheses(call.expression);
  if (
    callee.kind !== K.PropertyAccessExpression ||
    !atomicOperations.has(callee.name.text) ||
    getRuntimeExportName(c, c.host.symbolAt(callee.expression)) !== 'atomic'
  )
    return undefined;
  if (call.arguments.length < 2) return false;
  const cell = getCellType(c, c.host.typeOf(call.arguments[0]));
  if (cell.kind === CellKind.ArrayOfI32) return true;
  if (cell.kind !== CellKind.Struct) return false;
  const key = skipParentheses(call.arguments[1]);
  if (
    key.kind !== K.StringLiteral &&
    key.kind !== K.NoSubstitutionTemplateLiteral
  )
    return false;
  return cell.kinds[cell.fields.indexOf(key.text)] === 'i';
}

// The runtime's calls that block their thread, by declaring class and name, and
// what an async function calls instead ("" for none).
const blockingCalls = new Map([
  ['Channel.send', 'sendAsync'],
  ['Channel.recv', 'recvAsync'],
  ['ChannelCell.send', 'sendAsync'],
  ['ChannelCell.recv', 'recvAsync'],
  ['Thread.join', 'joinAsync'],
  ['Lock.hold', 'holdAsync'],
  ['Condition.wait', 'waitAsync'],
  ['select', 'selectAsync'],
  ['scope', ''],
]);

// A call of the runtime's that blocks its thread (getOwnBlockingCall): its
// name, and what an async function calls instead ("" for none).
export function getBlockingCall(
  c: Own,
  call: Node,
): {name: string; instead: string} | undefined {
  if (isAtomicCallValid(c, call) !== undefined) {
    const op = skipParentheses(call.expression).name.text as string;
    return op === 'wait' ? {name: `atomic.${op}`, instead: ''} : undefined;
  }
  const handle = c.host.signatureOf(call).declaration;
  if (!handle || !c.isRuntimePath(handle.path)) return undefined;
  const decl = c.host.declarationOf(handle);
  if (!decl || decl.name?.kind !== K.Identifier) return undefined;
  let key = decl.name.text as string;
  const owner = decl.parent as Node | undefined;
  if (
    (decl.kind === K.MethodDeclaration || decl.kind === K.MethodSignature) &&
    owner?.name
  )
    key = `${owner.name.text}.${key}`;
  const instead = blockingCalls.get(key);
  return instead === undefined ? undefined : {name: decl.name.text, instead};
}

// Reports whether an expression is `consume(x)`.
export function isConsumeCall(c: Own, expr: Node): boolean {
  return (
    expr.kind === K.CallExpression &&
    expr.arguments.length === 1 &&
    getCallMarker(c, expr) === 'consume'
  );
}

// The runtime's interface or class of a given name, if it exports one.
function getRuntimeType(c: Own, name: string): Type | undefined {
  if (c.runtimeTypes.has(name)) return c.runtimeTypes.get(name);
  let result: Type | undefined;
  for (const file of c.runtimeFiles) {
    const fileSymbol = c.host.checker.getSymbolOfSourceFile(file.fileName);
    const symbol = fileSymbol?.getExports().get(name as any);
    if (symbol && symbol.flags & (SymbolFlags.Interface | SymbolFlags.Class)) {
      result = c.host.declaredTypeOfSymbol(symbol);
      break;
    }
  }
  c.runtimeTypes.set(name, result);
  return result;
}

// Reports whether a type is a cell of the plain API: assignable to the
// runtime's `Cell` (Lock, Condition, Channel, SharedArray, SharedMap,
// SharedSet, a struct's values), or a struct type or a field marker (immutable,
// `IntegerField` included). Its values are shared, with no region. A Thread and
// a Scope are not cells: they stay on the thread that made them.
export function isCellBranded(c: Own, t: Type | undefined): boolean {
  if (
    !t ||
    t.flags & (TypeFlags.AnyOrUnknown | TypeFlags.Never | TypeFlags.Primitive)
  )
    return false;
  let result = c.cellBranded.get(t);
  if (result !== undefined) return result;
  result = false;
  if (t.flags & TypeFlags.Object) {
    const target = c.host.typeTarget(t);
    const symbol = target && c.host.typeSymbol(target);
    if (
      symbol &&
      (symbol.name === 'StructType' ||
        symbol.name === 'Field' ||
        symbol.name === 'IntegerField') &&
      getRuntimeExportName(c, symbol) !== ''
    ) {
      result = true;
    }
  }
  if (!result) {
    const cell = getRuntimeType(c, 'Cell');
    result =
      !!cell &&
      !!(t.flags & (TypeFlags.Object | TypeFlags.Intersection)) &&
      c.host.checker.isTypeAssignableTo(t, cell);
  }
  c.cellBranded.set(t, result);
  return result;
}

// What the thread that made a Thread or a Scope does with it (StaysHere).
const staysWith: Record<string, string> = {
  Thread: 'joins it',
  Scope: 'spawns on it in its body',
};

// "Thread" or "Scope" if t is the runtime's, else "".
function threadOrScope(c: Own, t: Type): string {
  if (!(t.flags & TypeFlags.Object)) return '';
  const symbol = c.host.typeSymbol(t);
  return symbol &&
    Object.hasOwn(staysWith, symbol.name) &&
    getRuntimeExportName(c, symbol) === symbol.name
    ? symbol.name
    : '';
}

// A Thread or a Scope of the runtime's in a value of type t, where a message or
// a share reaches at run time: t itself, a member of a union, an element of an
// array or a tuple, or a property of an object type (a plain object, at run
// time). Not in a cell, which goes by reference, nor in a function or an object
// of the default library's (a Map, a Promise), which are not sent as plain
// objects are; its mapped types (Record, Readonly) are plain objects.
function findStaysHere(c: Own, t: Type, seen: Set<Type>): Type | undefined {
  if (
    seen.has(t) ||
    t.flags & (TypeFlags.AnyOrUnknown | TypeFlags.Never | TypeFlags.Primitive)
  )
    return undefined;
  seen.add(t);
  const host = c.host;
  const inAny = (ts: readonly Type[]) => {
    for (const m of ts) {
      const found = findStaysHere(c, m, seen);
      if (found) return found;
    }
    return undefined;
  };
  if (t.flags & TypeFlags.Union) return inAny(host.memberTypes(t));
  if (!(t.flags & (TypeFlags.Object | TypeFlags.Intersection)))
    return undefined;
  if (threadOrScope(c, t)) return t;
  if (isCellBranded(c, t)) return undefined;
  if (host.checker.isArrayType(t as any) || host.checker.isTupleType(t as any))
    return inAny(host.typeArguments(t));
  const handle = host.typeSymbol(t)?.declarations[0];
  if (
    handle &&
    host.isDefaultLibraryPath(handle.path) &&
    !((t as any).objectFlags & ObjectFlags.Mapped)
  )
    return undefined;
  if (host.callSignatures(t).length > 0) return undefined;
  const apparent = host.checker.getApparentType(t as any) as any;
  return inAny([
    ...host.checker
      .getPropertiesOfType(apparent)
      .map(p => host.typeOfSymbol(p)),
    ...[IndexKind.String, IndexKind.Number]
      .map(k => host.checker.getIndexTypeOfType(apparent, k) as Type)
      .filter(Boolean),
  ]);
}

// Reports a Thread or a Scope that a call or `new` of the runtime's would send
// to another thread or share, which the runtime refuses: an argument to a
// `Sending` parameter, which a thread, a goroutine, a channel or a map takes,
// or share() freezes (partition's but for, which splits an array on its
// thread), and a thread's result, which moves to the thread that joins it.
export function checkStaysHere(c: Own, call: Node): void {
  const host = c.host;
  const handle = host.signatureOf(call).declaration;
  if (!handle || !c.isRuntimePath(handle.path)) return;
  const decl = host.declarationOf(handle);
  if (
    !decl ||
    (decl.kind === K.FunctionDeclaration && decl.name?.text === 'partition')
  )
    return;
  const report = (node: Node, t: Type) => {
    const found = findStaysHere(c, t, new Set());
    if (found)
      c.error(
        node,
        Messages.StaysHere,
        host.typeToString(found),
        staysWith[threadOrScope(c, found)]!,
      );
  };
  const params = ((decl.parameters ?? []) as Node[]).filter(
    p => !isThisParameter(p),
  );
  const args = (call.arguments ?? []) as Node[];
  args.forEach((arg, i) => {
    const param =
      i < params.length
        ? params[i]
        : params[params.length - 1]?.dotDotDotToken
          ? params[params.length - 1]
          : undefined;
    if (!param || !isSendingParameterType(c, param.type)) return;
    const expr = arg.kind === K.SpreadElement ? (arg.expression as Node) : arg;
    report(expr, host.typeOf(expr));
  });
  // spawn's: the thread's result, as the Thread<R> it returns has it
  const thread = host.typeOf(call);
  if (args.length > 0 && threadOrScope(c, thread) === 'Thread') {
    const result = host.typeArguments(thread)[0];
    if (result) report(args[0]!, result);
  }
}

// `Sending<T>` , or a union of it with null or undefined (a SharedMap's
// entries), as the runtime's declarations write a parameter that moves.
function isSendingParameterType(c: Own, t: Node | undefined): boolean {
  if (t?.kind === K.UnionType)
    return (t.types as Node[]).some(m => getTypeMarker(c, m) === 'Sending');
  return getTypeMarker(c, t) === 'Sending';
}

// The `struct(...)` calls of the program's source files, by the type of their
// structs' values (StructType<T>'s T).
export function getStructRegistry(c: Own): Map<Type, Node> {
  if (c.structs) return c.structs;
  const structs = new Map<Type, Node>();
  c.structs = structs;
  for (const file of c.files) {
    const visit = (node: Node): boolean => {
      if (
        node.kind === K.CallExpression &&
        getCallMarker(c, node) === 'struct'
      ) {
        const t = getStructTypeOfCall(c, node);
        if (t) structs.set(t, node);
      }
      return forEachChild(node, visit);
    };
    forEachChild(file as Node, visit);
  }
  return structs;
}

// The type of the values of the struct a `struct(...)` call declares: T in
// StructType<T>.
function getStructTypeOfCall(c: Own, call: Node): Type | undefined {
  const t = c.host.typeOf(call);
  if (
    !t ||
    !(t.flags & TypeFlags.Object) ||
    !((t as any).objectFlags & ObjectFlags.Reference)
  )
    return undefined;
  return c.host.typeArguments(t)[0];
}

// The layout of the struct a `struct(...)` call declares: its fields in the
// order of the object literal, and their kinds by their types (see
// getFieldKind).
export function getStructOfCall(c: Own, call: Node): StructInfo | undefined {
  if (c.structCalls.has(call)) return c.structCalls.get(call);
  let info: StructInfo | undefined;
  const t = getStructTypeOfCall(c, call);
  if (
    t &&
    call.arguments.length >= 1 &&
    skipParentheses(call.arguments[0]).kind === K.ObjectLiteralExpression
  ) {
    info = {decl: call, name: 'Struct', fields: [], kinds: [], types: []};
    // before its fields: a field may refer to the struct itself
    c.structCalls.set(call, info);
    const parent = walkUpParenthesizedExpressions(call.parent as Node);
    if (
      parent &&
      parent.kind === K.VariableDeclaration &&
      parent.name.kind === K.Identifier
    )
      info.name = parent.name.text;
    for (const property of skipParentheses(call.arguments[0])
      .properties as Node[]) {
      const name = property.name as Node | undefined;
      if (
        !name ||
        !(
          property.kind === K.PropertyAssignment ||
          property.kind === K.ShorthandPropertyAssignment
        ) ||
        !isPropertyNameLiteral(name)
      ) {
        continue; // reported by checkStructCall
      }
      const field = name.text as string;
      const symbol = c.host.checker.getPropertyOfType(t, field);
      const type = symbol && c.host.typeOfSymbol(symbol);
      info.fields.push(field);
      info.types.push(type);
      // the kind its marker gives it, which the runtime lays out: the type's
      // field may be a number for an i32 marker
      info.kinds.push(
        markerKind(
          c,
          property.kind === K.PropertyAssignment ? property.initializer : name,
        ) ?? (type ? getFieldKind(c, type) : 'f'),
      );
    }
  }
  c.structCalls.set(call, info);
  return info;
}

// A struct's fields with their markers, for a message.
const markerNames: Record<FieldKind, string> = {
  'f': 'f64',
  'i': 'i32',
  'u': 'u8',
  'b': 'bool',
  's': 'str',
  'r': 'ref',
  'c': 'ref',
  '': '?',
};
const laidOut = (s: StructInfo) =>
  s.fields.map((f, k) => `${f}: ${markerNames[s.kinds[k]!]}`).join(', ');

// The kind of a field's marker (f64, i32, u8, bool, str, ref<T>()): of what
// its Field<T> holds, T.
function markerKind(c: Own, marker: Node): FieldKind | undefined {
  const host = c.host;
  const brand = host.checker
    .getPropertiesOfType(
      host.checker.getApparentType(host.typeOf(marker) as any) as any,
    )
    .find(p => p.name.startsWith('__@fieldBrand@'));
  return brand ? getFieldKind(c, host.typeOfSymbol(brand)) : undefined;
}

// Checks a `struct(...)` call: its fields are given in an object literal, by
// name, and each is a number, a boolean, a string or a reference (a shared
// struct or a SharedArray, possibly null).
export function checkStructCall(c: Own, call: Node): void {
  const t = getStructTypeOfCall(c, call);
  if (!t || call.arguments.length < 1) return;
  const literal = skipParentheses(call.arguments[0]);
  if (literal.kind !== K.ObjectLiteralExpression) {
    c.error(call.arguments[0], Messages.StructField);
    return;
  }
  for (const property of literal.properties as Node[]) {
    const name = property.name as Node | undefined;
    if (
      !name ||
      !(
        property.kind === K.PropertyAssignment ||
        property.kind === K.ShorthandPropertyAssignment
      ) ||
      !isPropertyNameLiteral(name) ||
      name.kind === K.NumericLiteral
    ) {
      c.error(property, Messages.StructField);
      continue;
    }
    const symbol = c.host.checker.getPropertyOfType(t, name.text);
    if (!symbol) continue;
    if (isFieldType(c, c.host.typeOfSymbol(symbol))) continue;
    c.error(property, Messages.StructField);
  }
  // another struct(...) for the same type: the registry keeps one, by which
  // every value of the type is read; one laid out otherwise is refused
  const registered = getStructRegistry(c).get(t);
  if (registered !== undefined && registered !== call) {
    const mine = getStructOfCall(c, call),
      theirs = getStructOfCall(c, registered);
    if (
      mine &&
      theirs &&
      (mine.fields.length !== theirs.fields.length ||
        mine.fields.some(
          (f, k) => f !== theirs.fields[k] || mine.kinds[k] !== theirs.kinds[k],
        ))
    )
      c.error(
        call,
        Messages.StructRedeclared,
        c.host.typeToString(t),
        `[${laidOut(mine)}] here, [${laidOut(theirs)}] at its other declaration`,
      );
  }
}
