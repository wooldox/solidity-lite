// Rename: every reference, every override in the same family, and `@param` lines.

import { isContractLike, paramsOf, typeNameText, type Decl } from "./model";
import { findReferences, sameDecl } from "./references";
import type { Resolver } from "./resolve";
import type { Workspace } from "./workspace";

export interface TextEdit {
  path: string;
  start: number;
  end: number;
  text: string;
}

const KEYWORDS = new Set(
  (
    "abstract address after alias anonymous apply as assembly auto bool break byte bytes calldata case catch constant " +
    "constructor continue contract copyof default define delete do else emit enum error event external fallback false final " +
    "fixed for function global hex if immutable implements import in indexed inline interface internal is let library macro " +
    "mapping match memory modifier mutable new null of override partial payable pragma private promise public pure receive " +
    "reference relocatable return returns revert sealed sizeof static storage string struct super supports switch this " +
    "throw transient true try type typedef typeof ufixed uint unchecked unicode using var view virtual while"
  ).split(" "),
);

const OVERRIDABLE = new Set(["function", "modifier", "stateVariable"]);

/** Why `target` cannot be renamed, if it cannot. */
export function renameBlocker(resolver: Resolver, target: Decl, editable: (path: string) => boolean): string | undefined {
  if (target.file.path === resolver.builtinsPath) return "Built-ins cannot be renamed.";
  if (!target.name || ["constructor", "receive", "fallback"].includes(target.kind)) return "This cannot be renamed.";
  if (!editable(target.file.path)) return `${target.name} is declared in a dependency.`;
  return undefined;
}

export function validName(name: string): string | undefined {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return `'${name}' is not a valid identifier.`;
  if (KEYWORDS.has(name) || /^(u?int|bytes)\d+$/.test(name)) return `'${name}' is a reserved word.`;
  return undefined;
}

/**
 * Edits renaming `target` to `newName` in `candidates`. Overrides of the same function in base and
 * derived contracts are renamed together, since renaming one alone would break compilation.
 */
export function renameEdits(
  ws: Workspace,
  resolver: Resolver,
  target: Decl,
  newName: string,
  candidates: string[],
  editable: (path: string) => boolean,
): TextEdit[] | { error: string } {
  const invalid = validName(newName);
  if (invalid) return { error: invalid };
  const family = overrideFamily(ws, resolver, target, candidates);
  const locked = family.find((d) => !editable(d.file.path));
  if (locked) return { error: `${target.name} overrides ${locked.parent?.name}.${locked.name}, declared in a dependency.` };

  const edits = new Map<string, TextEdit>();
  const add = (path: string, start: number, end: number) => edits.set(`${path}:${start}`, { path, start, end, text: newName });
  for (const decl of family) {
    for (const ref of findReferences(ws, resolver, decl, candidates)) add(ref.file.path, ref.start, ref.end);
  }
  for (const edit of paramDocEdits(target, newName)) edits.set(`${edit.path}:${edit.start}`, edit);
  return [...edits.values()];
}

/** `target` plus every function it overrides or is overridden by, transitively, among `candidates`. */
function overrideFamily(ws: Workspace, resolver: Resolver, target: Decl, candidates: string[]): Decl[] {
  if (!OVERRIDABLE.has(target.kind) || !target.parent || !isContractLike(target.parent)) return [target];
  const signature = (d: Decl) => paramsOf(d).map((p) => typeNameText(p.typeName)).join(",");
  const sig = signature(target);
  const pool: Decl[] = [];
  for (const p of new Set([target.file.path, ...candidates])) {
    if (!ws.contains(p, target.name)) continue;
    for (const d of ws.get(p)?.all ?? []) {
      if (d.name === target.name && OVERRIDABLE.has(d.kind) && d.parent && isContractLike(d.parent) && signature(d) === sig) pool.push(d);
    }
  }
  // Bases of the family's contracts may live outside the candidates (a dependency).
  const family = [target];
  for (let i = 0; i < family.length; i++) {
    const contract = family[i].parent!;
    for (const base of ancestors(resolver, contract)) {
      for (const m of base.children) {
        if (m.name === target.name && OVERRIDABLE.has(m.kind) && signature(m) === sig && !family.some((f) => sameDecl(f, m))) family.push(m);
      }
    }
    for (const d of pool) {
      if (!family.some((f) => sameDecl(f, d)) && ancestors(resolver, d.parent!).some((a) => sameDecl(a, contract))) family.push(d);
    }
  }
  return family;
}

function ancestors(resolver: Resolver, contract: Decl, seen = new Set<string>()): Decl[] {
  const out: Decl[] = [];
  for (const base of resolver.bases(contract)) {
    const key = `${base.file.path}:${base.nameStart}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(base, ...ancestors(resolver, base, seen));
  }
  return out;
}

/** `@param oldName` (and named `@return oldName`) in the owner's doc comment. */
function paramDocEdits(target: Decl, newName: string): TextEdit[] {
  const owner = target.parent;
  if (!owner || !["parameter", "returnParameter", "field"].includes(target.kind)) return [];
  const text = owner.file.text;
  const docStart = commentBlockStart(text, owner.start);
  const tag = target.kind === "returnParameter" ? "return" : "param";
  const edits: TextEdit[] = [];
  const re = new RegExp(`@${tag}\\s+(${target.name.replace(/\$/g, "\\$")})\\b`, "g");
  for (const m of text.slice(docStart, owner.start).matchAll(re)) {
    const start = docStart + m.index + m[0].length - m[1].length;
    edits.push({ path: owner.file.path, start, end: start + m[1].length, text: newName });
  }
  return edits;
}

/** Start of the run of comment lines directly above `offset`. */
function commentBlockStart(text: string, offset: number): number {
  let start = offset;
  while (start > 0 && text[start - 1] !== "\n") start--;
  for (;;) {
    if (start === 0) return 0;
    let prev = start - 1;
    while (prev > 0 && text[prev - 1] !== "\n") prev--;
    const line = text.slice(prev, start).trim();
    if (!/^(\/\/\/|\/\*\*|\*)/.test(line)) return start;
    start = prev;
  }
}
