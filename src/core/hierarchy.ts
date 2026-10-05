// Call hierarchy (who calls this, what does it call) and type hierarchy (bases, derived contracts).

import { enclosing, isContractLike, type Decl, type DeclKind } from "./model";
import { findReferences, sameDecl } from "./references";
import type { Resolver } from "./resolve";
import { codeView, skipSpaceForward } from "./text";
import type { Workspace } from "./workspace";

const CALLABLE: DeclKind[] = ["function", "modifier", "constructor", "receive", "fallback"];

export interface CallGroup {
  decl: Decl;
  /** [start, end) of each call site, in the caller's file for incoming calls, in `from`'s file for outgoing. */
  ranges: [number, number][];
}

export function isCallableDecl(d: Decl): boolean {
  return CALLABLE.includes(d.kind);
}

/** Functions and modifiers whose bodies or headers call `target`. */
export function incomingCalls(ws: Workspace, resolver: Resolver, target: Decl, candidates: string[], shouldStop?: () => boolean): CallGroup[] {
  const groups = new Map<string, CallGroup>();
  for (const ref of findReferences(ws, resolver, target, candidates, { shouldStop })) {
    if (ref.isDeclaration || !isCallSite(ref.file.text, ref.end, target)) continue;
    const caller = enclosing(ref.file, ref.start, CALLABLE);
    if (!caller) continue;
    const key = `${caller.file.path}:${caller.nameStart}`;
    const group = groups.get(key) ?? { decl: caller, ranges: [] };
    group.ranges.push([ref.start, ref.end]);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** Functions and modifiers that `from` calls, grouped by callee. */
export function outgoingCalls(resolver: Resolver, from: Decl): CallGroup[] {
  const { kinds, text } = codeView(from.file);
  const groups = new Map<string, CallGroup>();
  const body = from.node.body?.range?.[0] ?? from.nameEnd;
  for (const m of text.slice(from.nameEnd, from.end).matchAll(/[A-Za-z_$][\w$]*/g)) {
    const start = from.nameEnd + m.index;
    if (kinds[start] !== 0 || /[\w$]/.test(text[start - 1] ?? "")) continue;
    const end = start + m[0].length;
    // Modifiers are invoked without parentheses in the header.
    const called = text[skipSpaceForward(text, end)] === "(";
    if (!called && start >= body) continue;
    const found = resolver.lookup(from.file, start);
    if (found?.kind !== "decls") continue;
    for (const d of found.decls) {
      if (!isCallableDecl(d) || (!called && d.kind !== "modifier") || sameDecl(d, from)) continue;
      const key = `${d.file.path}:${d.nameStart}`;
      const group = groups.get(key) ?? { decl: d, ranges: [] };
      group.ranges.push([start, end]);
      groups.set(key, group);
    }
  }
  return [...groups.values()];
}

function isCallSite(text: string, end: number, target: Decl): boolean {
  return target.kind === "modifier" || text[skipSpaceForward(text, end)] === "(";
}

/** Contracts `contract` inherits from directly. */
export function supertypes(resolver: Resolver, contract: Decl): Decl[] {
  return resolver.bases(contract);
}

/** Contracts that list `contract` among their direct bases, in `candidates`. */
export function subtypes(ws: Workspace, resolver: Resolver, contract: Decl, candidates: string[]): Decl[] {
  const out: Decl[] = [];
  for (const p of new Set([contract.file.path, ...candidates])) {
    if (!ws.contains(p, contract.name)) continue;
    const file = ws.get(p);
    for (const d of file?.decls ?? []) {
      if (isContractLike(d) && resolver.bases(d).some((b) => sameDecl(b, contract))) out.push(d);
    }
  }
  return out;
}
