// Go to Symbol in Workspace (Cmd/Ctrl+T): contracts and their members across files.

import { isContractLike, type Decl } from "./model";
import type { Workspace } from "./workspace";

const MEMBER_KINDS = new Set(["function", "modifier", "event", "error", "struct", "enum", "stateVariable", "constant", "userType"]);
const MAX_RESULTS = 500;

export function workspaceSymbols(ws: Workspace, paths: string[], query: string, shouldStop = () => false): Decl[] {
  const out: Decl[] = [];
  for (const p of paths) {
    if (shouldStop() || out.length >= MAX_RESULTS) break;
    const file = ws.get(p);
    if (!file) continue;
    for (const d of file.decls) {
      if (d.name && fuzzy(query, d.name)) out.push(d);
      if (isContractLike(d)) for (const m of d.children) if (m.name && MEMBER_KINDS.has(m.kind) && fuzzy(query, m.name)) out.push(m);
    }
  }
  return out.slice(0, MAX_RESULTS);
}

/** Every query character appears in `name`, in order, ignoring case. */
export function fuzzy(query: string, name: string): boolean {
  const q = query.toLowerCase();
  const n = name.toLowerCase();
  let i = 0;
  for (const c of n) if (c === q[i]) i++;
  return i === q.length;
}
