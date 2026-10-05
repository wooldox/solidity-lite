// Loads and caches parsed files, and resolves import paths the way forge does.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import * as path from "node:path";
import { parseFile, type SourceFile } from "./model";

/** Text of a file open in the editor, which wins over what is on disk. */
export type Overlay = (filePath: string) => { text: string; version: number } | undefined;

interface Cached {
  key: string;
  file: SourceFile;
}

interface Remapping {
  context: string;
  prefix: string;
  target: string;
}

const CONFIG_FILES = ["foundry.toml", "remappings.txt"];

export class Workspace {
  private readonly files = new Map<string, Cached>();
  private readonly remappings = new Map<string, { key: string; list: Remapping[] }>();

  constructor(private readonly overlay: Overlay = () => undefined) {}

  /**
   * Parsed file, or undefined when it does not exist or never parsed. For an open file that
   * does not parse right now, the last good parse is returned (its offsets may lag a little).
   */
  get(filePath: string, editOffset?: number): SourceFile | undefined {
    const open = this.overlay(filePath);
    let key: string;
    let text: string | undefined;
    if (open) {
      key = `v${open.version}`;
      text = open.text;
    } else {
      try {
        const stat = statSync(filePath);
        key = `m${stat.mtimeMs}:${stat.size}`;
      } catch {
        return undefined;
      }
    }
    const cached = this.files.get(filePath);
    if (cached?.key === key) return cached.file;

    text ??= readFileSync(filePath, "utf8");
    const file = parseFile(filePath, text, editOffset);
    if (!file) return cached?.file;
    this.files.set(filePath, { key, file });
    return file;
  }

  /** Whether the file's current text contains `needle`, without parsing it. */
  contains(filePath: string, needle: string): boolean {
    const open = this.overlay(filePath);
    if (open) return open.text.includes(needle);
    const cached = this.files.get(filePath);
    if (cached) return cached.file.text.includes(needle);
    try {
      return readFileSync(filePath, "utf8").includes(needle);
    } catch {
      return false;
    }
  }

  /** Absolute path of `importPath` as imported from `fromFile`, if that file exists. */
  resolveImport(fromFile: string, importPath: string): string | undefined {
    if (importPath.startsWith("./") || importPath.startsWith("../")) {
      return existing(path.resolve(path.dirname(fromFile), importPath));
    }
    const root = projectRoot(fromFile);
    const relFrom = path.relative(root, fromFile);
    let best: Remapping | undefined;
    for (const r of this.remappingsFor(root)) {
      if (!importPath.startsWith(r.prefix)) continue;
      if (r.context && !relFrom.startsWith(r.context)) continue;
      if (!best || r.prefix.length > best.prefix.length || (r.prefix.length === best.prefix.length && r.context.length > best.context.length)) {
        best = r;
      }
    }
    if (best) {
      const hit = existing(path.resolve(root, best.target + importPath.slice(best.prefix.length)));
      if (hit) return hit;
    }
    const direct = existing(path.resolve(root, importPath));
    if (direct) return direct;
    for (let dir = root; ; dir = path.dirname(dir)) {
      const hit = existing(path.join(dir, "node_modules", importPath));
      if (hit) return hit;
      if (path.dirname(dir) === dir) return undefined;
    }
  }

  private remappingsFor(root: string): Remapping[] {
    const key = CONFIG_FILES.map((f) => {
      try {
        return statSync(path.join(root, f)).mtimeMs;
      } catch {
        return 0;
      }
    }).join(":");
    const cached = this.remappings.get(root);
    if (cached?.key === key) return cached.list;
    const list = loadRemappings(root);
    this.remappings.set(root, { key, list });
    return list;
  }
}

function existing(p: string): string | undefined {
  try {
    return statSync(p).isFile() ? p : undefined;
  } catch {
    return undefined;
  }
}

/** Nearest folder with a foundry.toml or remappings.txt, else the file's own folder. */
export function projectRoot(filePath: string): string {
  const start = path.dirname(filePath);
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (CONFIG_FILES.some((f) => existsSync(path.join(dir, f)))) return dir;
    if (path.dirname(dir) === dir) return start;
  }
}

/** foundry.toml and remappings.txt entries, then forge's automatic `lib/<name>/` ones. */
function loadRemappings(root: string): Remapping[] {
  const lines: string[] = [];
  try {
    const toml = readFileSync(path.join(root, "foundry.toml"), "utf8");
    const block = /^\s*remappings\s*=\s*\[([\s\S]*?)\]/m.exec(toml);
    if (block) for (const m of block[1].matchAll(/["']([^"']+)["']/g)) lines.push(m[1]);
  } catch {
    // no foundry.toml
  }
  try {
    lines.push(...readFileSync(path.join(root, "remappings.txt"), "utf8").split("\n"));
  } catch {
    // no remappings.txt
  }
  const list: Remapping[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    const eq = line.indexOf("=");
    if (!line || line.startsWith("#") || eq === -1) continue;
    let prefix = line.slice(0, eq);
    let context = "";
    const colon = prefix.indexOf(":");
    if (colon !== -1) [context, prefix] = [prefix.slice(0, colon), prefix.slice(colon + 1)];
    list.push({ context, prefix, target: line.slice(eq + 1) });
  }
  // node_modules needs no entries: resolveImport falls back to it.
  let libs: string[] = [];
  try {
    libs = readdirSync(path.join(root, "lib"));
  } catch {
    // no lib/
  }
  for (const name of libs) {
    const base = `lib/${name}/`;
    const sub = ["src", "contracts"].find((s) => existsSync(path.join(root, base, s)));
    list.push({ context: "", prefix: `${name}/`, target: sub ? `${base}${sub}/` : base });
  }
  return list;
}
