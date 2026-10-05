// NatSpec: the `///` or `/** */` comment right above a declaration, split into tags.

import type { SourceFile } from "./model";

export interface NatSpec {
  title?: string;
  author?: string;
  notice?: string;
  dev?: string;
  params: Map<string, string>;
  returns: string[];
  inheritdoc?: string;
  custom: { tag: string; text: string }[];
}

/** The doc comment that ends just before `offset` (only whitespace in between), without its markers. */
export function docCommentBefore(text: string, offset: number): string | undefined {
  let lineStart = offset;
  while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
  if (text.slice(lineStart, offset).trim() !== "") return undefined;

  const lines: string[] = [];
  let end = lineStart - 1; // the "\n" closing the previous line
  // Trailing `/** ... */` block.
  const before = text.slice(0, Math.max(end, 0)).trimEnd();
  if (before.endsWith("*/")) {
    const open = before.lastIndexOf("/*", before.length - 3);
    if (open !== -1 && before[open + 2] === "*") {
      const body = before.slice(open + 3, before.length - 2);
      return body
        .split("\n")
        .map((l) => l.replace(/^\s*\*(?!\/) ?/, ""))
        .join("\n")
        .trim();
    }
    return undefined;
  }
  // Run of `///` lines.
  while (end > 0) {
    let start = end;
    while (start > 0 && text[start - 1] !== "\n") start--;
    const line = text.slice(start, end).trim();
    if (!line.startsWith("///")) break;
    lines.unshift(line.slice(3));
    end = start - 1;
  }
  return lines.length ? lines.join("\n") : undefined;
}

export function parseNatSpec(comment: string): NatSpec {
  const spec: NatSpec = { params: new Map(), returns: [], custom: [] };
  let tag = "notice";
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    buffer = [];
    if (!text && tag !== "notice") return;
    if (tag === "param") {
      const m = /^(\S+)\s*([\s\S]*)$/.exec(text);
      if (m) spec.params.set(m[1], m[2]);
    } else if (tag === "return") spec.returns.push(text);
    else if (tag === "inheritdoc") spec.inheritdoc = text.split(/\s/)[0];
    else if (tag === "title" || tag === "author" || tag === "dev") spec[tag] = join(spec[tag], text);
    else if (tag === "notice") spec.notice = join(spec.notice, text);
    else spec.custom.push({ tag, text });
  };

  for (const raw of comment.split("\n")) {
    const line = raw.trim();
    const m = /^@([\w:-]+)\s?(.*)$/.exec(line);
    if (m) {
      flush();
      tag = m[1];
      buffer.push(m[2]);
    } else {
      buffer.push(line);
    }
  }
  flush();
  return spec;
}

function join(a: string | undefined, b: string): string | undefined {
  if (!b) return a;
  return a ? `${a}\n\n${b}` : b;
}

export function isEmpty(spec: NatSpec): boolean {
  return (
    !spec.title &&
    !spec.author &&
    !spec.notice &&
    !spec.dev &&
    spec.params.size === 0 &&
    spec.returns.length === 0 &&
    spec.custom.length === 0
  );
}

/** Markdown for a hover, in the style of TypeScript's JSDoc hovers. */
export function natSpecMarkdown(spec: NatSpec, opts: { params?: boolean } = {}): string {
  const parts: string[] = [];
  if (spec.title) parts.push(`**${spec.title}**`);
  if (spec.notice) parts.push(spec.notice);
  if (spec.dev) parts.push(spec.dev);
  const tags: string[] = [];
  if (opts.params !== false) {
    for (const [name, text] of spec.params) tags.push(`*@param* \`${name}\`${text ? ` — ${text}` : ""}`);
  }
  for (const text of spec.returns) tags.push(`*@return*${text ? ` — ${text}` : ""}`);
  for (const { tag, text } of spec.custom) tags.push(`*@${tag}*${text ? ` — ${text}` : ""}`);
  if (spec.author) tags.push(`*@author* — ${spec.author}`);
  if (tags.length) parts.push(tags.join("  \n"));
  return parts.join("\n\n");
}

/**
 * A snippet documenting the declaration that starts right after `lineEnd` (the end of the line
 * where `///` was typed), in VS Code snippet syntax. Continuation lines get `indent`.
 * Uses `@dev` when the file already prefers it over `@notice`.
 */
export function natSpecTemplate(file: SourceFile, lineEnd: number, indent: string): string | undefined {
  const next = file.all.find(
    (d) => d.start >= lineEnd && file.text.slice(lineEnd, d.start).trim() === "" && !["localVariable", "parameter", "returnParameter"].includes(d.kind),
  );
  if (!next) return undefined;
  const tag = (file.text.match(/@dev\b/g)?.length ?? 0) > (file.text.match(/@notice\b/g)?.length ?? 0) ? "@dev" : "@notice";
  const esc = (name: string) => name.replace(/[$}\\]/g, "\\$&");
  let n = 1;
  const lines: string[] = [];
  if (next.kind === "contract" || next.kind === "interface" || next.kind === "library") {
    lines.push(`/// @title \${${n++}:${esc(next.name)}}`);
  }
  lines.push(`/// ${tag} \${${n++}}`);
  if (["function", "modifier", "event", "error", "constructor"].includes(next.kind)) {
    for (const c of next.children) {
      if (c.kind === "parameter" && c.name) lines.push(`/// @param ${esc(c.name)} \${${n++}}`);
    }
    for (const c of next.children) {
      if (c.kind === "returnParameter") lines.push(c.name ? `/// @return ${esc(c.name)} \${${n++}}` : `/// @return \${${n++}}`);
    }
  }
  return lines.join(`\n${indent}`);
}
