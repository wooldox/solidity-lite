// Find References: every place a name resolves to the given declaration.

import { isContractLike, type Decl, type SourceFile } from "./model";
import type { Resolver } from "./resolve";
import type { Workspace } from "./workspace";

export interface Reference {
  file: SourceFile;
  start: number;
  end: number;
  isDeclaration: boolean;
}

const LOCAL_KINDS = new Set(["parameter", "returnParameter", "localVariable"]);

export interface ReferenceOptions {
  /** Search only `candidates`, not also the file declaring the target. */
  onlyCandidates?: boolean;
  /** Checked between files, to cancel. */
  shouldStop?: () => boolean;
}

/**
 * References to `target` in `candidates` (file paths). Each occurrence of the name is resolved
 * like a Go to Definition, so only files containing the name as text are parsed.
 */
export function findReferences(
  ws: Workspace,
  resolver: Resolver,
  target: Decl,
  candidates: string[],
  { onlyCandidates = false, shouldStop = () => false }: ReferenceOptions = {},
): Reference[] {
  let paths = onlyCandidates ? candidates : unique([target.file.path, ...candidates]);
  if (isFileLocal(target)) paths = paths.filter((p) => p === target.file.path);
  const word = new RegExp(`(?<![\\w$])${target.name.replace(/\$/g, "\\$")}(?![\\w$])`, "g");
  const out: Reference[] = [];
  for (const p of paths) {
    if (shouldStop()) break;
    if (p !== target.file.path && !ws.contains(p, target.name)) continue;
    const file = p === target.file.path ? target.file : ws.get(p);
    if (!file) continue;
    for (const m of file.text.matchAll(word)) {
      const start = m.index;
      const found = resolver.lookup(file, start);
      if (found?.kind !== "decls" || !found.decls.some((d) => sameDecl(d, target))) continue;
      out.push({ file, start, end: start + target.name.length, isDeclaration: file.path === target.file.path && start === target.nameStart });
    }
  }
  return out;
}

/** Same declaration, even when one side comes from a newer parse of the file. */
export function sameDecl(a: Decl, b: Decl): boolean {
  return a === b || (a.file.path === b.file.path && a.nameStart === b.nameStart && a.name === b.name);
}

/** Locals, parameters and private members can only be used in their own file. */
function isFileLocal(d: Decl): boolean {
  if (LOCAL_KINDS.has(d.kind)) return true;
  const visibility = d.node?.visibility ?? d.node?.variables?.[0]?.visibility;
  return visibility === "private" && !!d.parent && isContractLike(d.parent);
}

function unique(list: string[]): string[] {
  return [...new Set(list)];
}
