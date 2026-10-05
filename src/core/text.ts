// Text helpers that need no AST: where comments and strings are, line/column maths,
// and the identifier and member chain under the cursor.

import type { SourceFile } from "./model";

export const enum CharKind {
  Code = 0,
  Comment = 1,
  String = 2,
}

/** Marks every character as code, comment or string. */
export function charKinds(text: string): Uint8Array {
  const kinds = new Uint8Array(text.length);
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      const end = lineEnd(text, i);
      kinds.fill(CharKind.Comment, i, end);
      i = end;
    } else if (c === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close === -1 ? text.length : close + 2;
      kinds.fill(CharKind.Comment, i, end);
      i = end;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      const end = Math.min(j + 1, text.length);
      kinds.fill(CharKind.String, i, end);
      i = end;
    } else {
      i++;
    }
  }
  return kinds;
}

/** `text` with comments and string contents turned into spaces (quotes kept), offsets unchanged. */
export function codeOnly(text: string, kinds: Uint8Array): string {
  const chars = text.split("");
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === "\n") continue;
    const inString = kinds[i] === CharKind.String && kinds[i - 1] === CharKind.String && kinds[i + 1] === CharKind.String;
    if (kinds[i] === CharKind.Comment || inString) chars[i] = " ";
  }
  return chars.join("");
}

function lineEnd(text: string, from: number): number {
  const nl = text.indexOf("\n", from);
  return nl === -1 ? text.length : nl;
}

export class LineIndex {
  private readonly starts: number[] = [0];

  constructor(text: string) {
    for (let i = 0; i < text.length; i++) if (text[i] === "\n") this.starts.push(i + 1);
  }

  offset(line: number, character: number): number {
    return (this.starts[line] ?? this.starts[this.starts.length - 1]) + character;
  }

  position(offset: number): { line: number; character: number } {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo, character: offset - this.starts[lo] };
  }
}

const IDENT = /[A-Za-z0-9_$]/;

export function isIdentChar(c: string | undefined): boolean {
  return c !== undefined && IDENT.test(c);
}

/** The identifier touching `offset`, if any. */
export function wordAt(text: string, offset: number): { name: string; start: number; end: number } | undefined {
  let start = offset;
  while (start > 0 && isIdentChar(text[start - 1])) start--;
  let end = offset;
  while (end < text.length && isIdentChar(text[end])) end++;
  if (start === end || /[0-9]/.test(text[start])) return undefined;
  return { name: text.slice(start, end), start, end };
}

/** One step of an expression like `m.seedIds[i].length` or `foo(x).bar`. */
export type ChainStep = { kind: "name"; name: string } | { kind: "index" } | { kind: "call"; argCount: number };

/**
 * The expression in front of the `.` that precedes `wordStart`, as steps from left to right.
 * `m.seedIds[i].len|` gives name m, name seedIds, index. Undefined when there is no `.`.
 */
export function qualifierBefore(text: string, wordStart: number): ChainStep[] | undefined {
  const dot = skipSpaceBack(text, wordStart - 1);
  if (text[dot] !== ".") return undefined;
  return chainEndingAt(text, skipSpaceBack(text, dot - 1))?.steps;
}

/** Parses backwards a chain of names, `.`, `[...]` and `(...)` whose last character is at `last`. */
export function chainEndingAt(text: string, last: number): { steps: ChainStep[]; start: number } | undefined {
  const steps: ChainStep[] = [];
  let i = last;
  let start = last + 1;
  while (i >= 0) {
    const c = text[i];
    if (c === "]" || c === ")") {
      const open = matchingOpen(text, i, c === "]" ? "[" : "(", c);
      if (open < 0) return undefined;
      steps.push(c === "]" ? { kind: "index" } : { kind: "call", argCount: countArgs(text, open) });
      start = open;
      i = skipSpaceBack(text, open - 1);
      continue;
    }
    if (isIdentChar(c)) {
      let s = i;
      while (s > 0 && isIdentChar(text[s - 1])) s--;
      steps.push({ kind: "name", name: text.slice(s, i + 1) });
      start = s;
      i = skipSpaceBack(text, s - 1);
      if (text[i] === ".") {
        i = skipSpaceBack(text, i - 1);
        continue;
      }
    }
    break;
  }
  steps.reverse();
  return steps[0]?.kind === "name" ? { steps, start } : undefined;
}

/** Argument count of a call whose `(` follows `wordEnd`, or undefined when the word is not called. */
export function callArgCountAfter(text: string, wordEnd: number): number | undefined {
  const i = skipSpaceForward(text, wordEnd);
  return text[i] === "(" ? countArgs(text, i) : undefined;
}

/** Top-level comma count + 1 inside the parens opening at `open`; 0 for `()`. */
export function countArgs(text: string, open: number): number {
  let depth = 0;
  let commas = 0;
  let sawContent = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) break;
    } else if (depth === 1) {
      if (c === ",") commas++;
      else if (!/\s/.test(c)) sawContent = true;
    }
  }
  return sawContent ? commas + 1 : 0;
}

/** Raw text of each top-level argument in the call whose `(` is at `open`. */
export function callArgs(text: string, open: number): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        args.push(text.slice(start, i));
        break;
      }
    } else if (c === "," && depth === 1) {
      args.push(text.slice(start, i));
      start = i + 1;
    }
  }
  const trimmed = args.map((a) => a.trim());
  return trimmed.length === 1 && trimmed[0] === "" ? [] : trimmed;
}

function matchingOpen(text: string, close: number, open: string, closeChar: string): number {
  let depth = 0;
  for (let i = close; i >= 0; i--) {
    if (text[i] === closeChar) depth++;
    else if (text[i] === open && --depth === 0) return i;
  }
  return -1;
}

function skipSpaceBack(text: string, i: number): number {
  while (i >= 0 && /\s/.test(text[i])) i--;
  return i;
}

export function skipSpaceForward(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

/** Copy of `text` with the given (zero-based) lines replaced by spaces, so offsets stay put. */
export function blankLines(text: string, lines: Set<number>): string {
  return text
    .split("\n")
    .map((l, i) => (lines.has(i) ? " ".repeat(l.length) : l))
    .join("\n");
}

/** Collapses runs of whitespace and tidies the space just inside brackets. */
export function squash(source: string): string {
  return source
    .replace(/\s+/g, " ")
    .replace(/([([]) /g, "$1")
    .replace(/ ([)\]])/g, "$1")
    .replace(/ ,/g, ",")
    .trim();
}

const codeViews = new WeakMap<SourceFile, { kinds: Uint8Array; text: string }>();

/** Character kinds and comment-free text of a file, computed once per parse. */
export function codeView(file: SourceFile): { kinds: Uint8Array; text: string } {
  let view = codeViews.get(file);
  if (!view) {
    const kinds = charKinds(file.text);
    view = { kinds, text: codeOnly(file.text, kinds) };
    codeViews.set(file, view);
  }
  return view;
}

