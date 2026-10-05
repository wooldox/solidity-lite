// Turns a parsed file into a tree of declarations with exact name ranges.

import { parse } from "@solidity-parser/parser";
import { blankLines } from "./text";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

export type DeclKind =
  | "contract"
  | "interface"
  | "library"
  | "function"
  | "constructor"
  | "receive"
  | "fallback"
  | "modifier"
  | "event"
  | "error"
  | "struct"
  | "enum"
  | "enumValue"
  | "stateVariable"
  | "constant"
  | "field"
  | "parameter"
  | "returnParameter"
  | "localVariable"
  | "userType";

export interface Decl {
  kind: DeclKind;
  name: string;
  file: SourceFile;
  /** Whole declaration, end exclusive. */
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
  parent?: Decl;
  children: Decl[];
  node: Node;
  /** Type of a variable, field or parameter (an AST TypeName). */
  typeName?: Node;
}

export interface ImportInfo {
  path: string;
  pathStart: number;
  pathEnd: number;
  /** `import {A as B} from "x"` → [["A", "B"]]; null for whole-file imports. */
  symbols: [string, string | null][] | null;
  /** `import "x" as X` / `import * as X from "x"`. */
  unitAlias: string | null;
}

export interface UsingInfo {
  file: SourceFile;
  /** Library name or path, for `using L for T`. */
  library?: string;
  /** Free or library functions, for `using {f, L.g} for T`. */
  functions: string[];
  /** Type name the functions attach to, or "*". */
  forType: string;
  /** Contract holding the directive; undefined at file level. */
  contract?: Decl;
  isGlobal: boolean;
}

export interface SourceFile {
  path: string;
  text: string;
  /** Top-level declarations. */
  decls: Decl[];
  /** Every declaration, in source order. */
  all: Decl[];
  imports: ImportInfo[];
  usings: UsingInfo[];
  /** Spans of `assembly { ... }` blocks, end exclusive. */
  assembly: [number, number][];
}

const PARSE_OPTIONS = { range: true, tolerant: true } as const;

const MAX_RECOVERY_ROUNDS = 4;

/**
 * Parses `text`. Half-typed code often does not parse, so on failure the lines with syntax errors
 * (and the line at `editOffset`, where the user is typing) are blanked and parsing retried.
 * Blanking keeps every offset, so the declarations found still point into the real text.
 */
export function parseFile(path: string, text: string, editOffset?: number): SourceFile | undefined {
  if (editOffset === undefined) {
    try {
      return buildFile(path, text, parse(text, PARSE_OPTIONS));
    } catch {
      return undefined;
    }
  }
  const blanked = new Set<number>();
  let attempt = text;
  for (let round = 0; round < MAX_RECOVERY_ROUNDS; round++) {
    try {
      return buildFile(path, text, parse(attempt, PARSE_OPTIONS));
    } catch (err) {
      const lines = new Set<number>();
      for (const e of (err as { errors?: ParseErrorInfo[] }).errors ?? []) for (const l of errorLines(text, e)) lines.add(l);
      if (round === 0) lines.add(lineOf(text, editOffset));
      const fresh = [...lines].filter((l) => !blanked.has(l));
      if (!fresh.length) return undefined;
      for (const l of fresh) blanked.add(l);
      attempt = blankLines(text, blanked);
    }
  }
  return undefined;
}

interface ParseErrorInfo {
  message: string;
  line: number;
  column: number;
}

/**
 * Lines to blank for one syntax error: its own line, plus, for "no viable alternative at input 'a.b.}'",
 * the lines that input started on (a half-typed expression the parser ran on into the next lines).
 */
function errorLines(text: string, e: ParseErrorInfo): number[] {
  const errorLine = e.line - 1;
  const input = /^no viable alternative at input '(.*)'$/s.exec(e.message)?.[1];
  const first = input && /^[\w$]+/.exec(input)?.[0];
  if (!first) return [errorLine];
  const lines = text.split("\n");
  for (let l = errorLine; l >= 0 && l >= errorLine - 20; l--) {
    if (new RegExp(`(^|[^\\w$])${first.replace(/\$/g, "\\$")}([^\\w$]|$)`).test(lines[l])) {
      // Keep the error line itself when it only closes a block.
      const last = /^\s*[}\]);]/.test(lines[errorLine]) && l < errorLine ? errorLine - 1 : errorLine;
      return Array.from({ length: last - l + 1 }, (_, i) => l + i);
    }
  }
  return [errorLine];
}

function lineOf(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) if (text[i] === "\n") line++;
  return line;
}

function buildFile(path: string, text: string, ast: Node): SourceFile {
  const file: SourceFile = { path, text, decls: [], all: [], imports: [], usings: [], assembly: [] };

  const make = (kind: DeclKind, name: string, node: Node, parent: Decl | undefined, nameAt?: Node): Decl => {
    const [start, endIncl] = node.range;
    const nameRange = nameAt?.range
      ? { s: nameAt.range[0], e: nameAt.range[1] + 1 }
      : findName(text, name, start, endIncl + 1, kind);
    const decl: Decl = {
      kind,
      name,
      file,
      start,
      end: endIncl + 1,
      nameStart: nameRange.s,
      nameEnd: nameRange.e,
      parent,
      children: [],
      node,
    };
    file.all.push(decl);
    if (parent) parent.children.push(decl);
    else file.decls.push(decl);
    return decl;
  };

  const variable = (kind: DeclKind, v: Node, parent: Decl | undefined, container: Node = v) => {
    if (!v || !v.name) return;
    const d = make(kind, v.name, container, parent, v.identifier);
    d.typeName = v.typeName;
    return d;
  };

  // Unnamed parameters are kept (with an empty name) so arity and return types stay right.
  const params = (list: Node[] | null | undefined, kind: DeclKind, parent: Decl) => {
    for (const p of list ?? []) {
      if (p.name) variable(kind, p, parent);
      else make(kind, "", p, parent, { range: [p.range[0], p.range[0] - 1] }).typeName = p.typeName;
    }
  };

  const struct = (node: Node, parent: Decl | undefined) => {
    const d = make("struct", node.name, node, parent);
    for (const m of node.members ?? []) variable("field", m, d);
  };

  const enumDef = (node: Node, parent: Decl | undefined) => {
    const d = make("enum", node.name, node, parent);
    for (const m of node.members ?? []) make("enumValue", m.name, m, d);
  };

  const callable = (node: Node, parent: Decl | undefined) => {
    let kind: DeclKind = "function";
    let name: string = node.name ?? "";
    if (node.isConstructor) [kind, name] = ["constructor", "constructor"];
    else if (node.isReceiveEther) [kind, name] = ["receive", "receive"];
    else if (node.isFallback) [kind, name] = ["fallback", "fallback"];
    const d = make(kind, name, node, parent);
    params(node.parameters, "parameter", d);
    params(node.returnParameters, "returnParameter", d);
    if (node.body) locals(node.body, d);
  };

  const locals = (body: Node, fn: Decl) => {
    walk(body, (n) => {
      if (n.type === "VariableDeclarationStatement") {
        for (const v of n.variables ?? []) variable("localVariable", v, fn);
      } else if (n.type === "TryStatement") {
        for (const v of n.returnParameters ?? []) variable("localVariable", v, fn);
      } else if (n.type === "CatchClause") {
        for (const v of n.parameters ?? []) variable("localVariable", v, fn);
      } else if (n.type === "InlineAssemblyStatement") {
        file.assembly.push([n.range[0], n.range[1] + 1]);
      } else if (n.type === "AssemblyLocalDefinition") {
        for (const id of n.names ?? []) make("localVariable", id.name, n, fn, id);
      } else if (n.type === "AssemblyFunctionDefinition") {
        // A Yul function is its own scope: its parameters, returns and locals belong to it.
        const yulFn = make("function", n.name, n, fn);
        for (const id of n.arguments ?? []) make("parameter", id.name, id, yulFn, id);
        for (const id of n.returnArguments ?? []) make("returnParameter", id.name, id, yulFn, id);
        locals(n.body, yulFn);
        return false;
      }
    });
  };

  const using = (node: Node, contract: Decl | undefined) => {
    const forType = node.typeName ? typeNameText(node.typeName) : "*";
    file.usings.push({
      file,
      library: node.libraryName ?? undefined,
      functions: node.functions ?? [],
      forType,
      contract,
      isGlobal: !!node.isGlobal,
    });
  };

  const member = (node: Node, parent: Decl | undefined) => {
    switch (node.type) {
      case "FunctionDefinition":
        return callable(node, parent);
      case "ModifierDefinition": {
        const d = make("modifier", node.name, node, parent);
        params(node.parameters, "parameter", d);
        if (node.body) locals(node.body, d);
        return;
      }
      case "StructDefinition":
        return struct(node, parent);
      case "EnumDefinition":
        return enumDef(node, parent);
      case "EventDefinition": {
        const d = make("event", node.name, node, parent);
        params(node.parameters, "parameter", d);
        return;
      }
      case "CustomErrorDefinition": {
        const d = make("error", node.name, node, parent);
        params(node.parameters, "parameter", d);
        return;
      }
      case "StateVariableDeclaration":
        for (const v of node.variables ?? []) {
          variable(v.isDeclaredConst ? "constant" : "stateVariable", v, parent, node);
        }
        return;
      case "FileLevelConstant": {
        const d = make("constant", node.name, node, parent, node.identifier);
        d.typeName = node.typeName;
        return;
      }
      case "TypeDefinition": {
        const d = make("userType", node.name, node, parent);
        d.typeName = node.definition;
        return;
      }
      case "UsingForDeclaration":
        return using(node, parent);
    }
  };

  for (const node of ast.children ?? []) {
    if (node.type === "ImportDirective") {
      const lit = node.pathLiteral;
      file.imports.push({
        path: node.path,
        pathStart: lit ? lit.range[0] + 1 : node.range[0],
        pathEnd: lit ? lit.range[1] : node.range[1],
        symbols: node.symbolAliases ?? null,
        unitAlias: node.unitAlias ?? null,
      });
    } else if (node.type === "ContractDefinition") {
      const kind: DeclKind = node.kind === "interface" ? "interface" : node.kind === "library" ? "library" : "contract";
      const d = make(kind, node.name, node, undefined);
      for (const sub of node.subNodes ?? []) member(sub, d);
    } else {
      member(node, undefined);
    }
  }
  file.all.sort((a, b) => a.start - b.start);
  return file;
}

/** Locates a declaration's name inside its source, skipping the keyword that introduces it. */
function findName(text: string, name: string, start: number, end: number, kind: DeclKind): { s: number; e: number } {
  if (kind === "constructor" || kind === "receive" || kind === "fallback") {
    return { s: start, e: start + name.length };
  }
  const re = new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\b`, "g");
  re.lastIndex = start;
  const m = re.exec(text.slice(0, end));
  if (!m) return { s: start, e: start };
  return { s: m.index, e: m.index + name.length };
}

/** Visits every node; returning false from `visit` skips that node's children. */
function walk(node: Node, visit: (n: Node) => boolean | void) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (typeof node.type === "string" && visit(node) === false) return;
  for (const key of Object.keys(node)) {
    if (key === "range" || key === "loc") continue;
    const value = node[key];
    if (value && typeof value === "object") walk(value, visit);
  }
}

/** Short text for a TypeName node: `uint256`, `PlantIntent`, `uint256[]`, `mapping(address => uint256)`. */
export function typeNameText(t: Node): string {
  if (!t) return "";
  switch (t.type) {
    case "ElementaryTypeName":
      return t.name;
    case "UserDefinedTypeName":
      return t.namePath;
    case "ArrayTypeName":
      return `${typeNameText(t.baseTypeName)}[]`;
    case "Mapping":
      return `mapping(${typeNameText(t.keyType)} => ${typeNameText(t.valueType)})`;
    case "FunctionTypeName":
      return "function";
    default:
      return "";
  }
}

/** Last segment of a dotted type path, which is how overloads and `using` match types. */
export function baseTypeName(t: Node): string {
  const text = typeNameText(t);
  return text.slice(text.lastIndexOf(".") + 1);
}

export function isContractLike(d: Decl): boolean {
  return d.kind === "contract" || d.kind === "interface" || d.kind === "library";
}

export function isCallable(d: Decl): boolean {
  return d.kind === "function" || d.kind === "modifier" || d.kind === "event" || d.kind === "error";
}

export function paramsOf(d: Decl): Decl[] {
  return d.children.filter((c) => c.kind === "parameter");
}

export function returnsOf(d: Decl): Decl[] {
  return d.children.filter((c) => c.kind === "returnParameter");
}

/** Innermost declaration whose span holds `offset`. */
export function enclosing(file: SourceFile, offset: number, kinds?: DeclKind[]): Decl | undefined {
  let best: Decl | undefined;
  for (const d of file.all) {
    if (d.start <= offset && offset < d.end && (!kinds || kinds.includes(d.kind))) {
      if (!best || d.end - d.start <= best.end - best.start) best = d;
    }
  }
  return best;
}
