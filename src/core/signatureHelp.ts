// Parameter hints while typing a call: which function, which overloads, which argument.

import { specOf } from "./hover";
import { isContractLike, paramsOf, returnsOf, type Decl, type SourceFile } from "./model";
import { natSpecMarkdown } from "./natspec";
import type { Resolver } from "./resolve";
import { chainEndingAt, codeView, squash } from "./text";

export interface SignatureInfo {
  label: string;
  /** [start, end) of each parameter inside `label`. */
  parameters: { range: [number, number]; doc?: string }[];
  doc?: string;
}

export interface SignatureHelpResult {
  signatures: SignatureInfo[];
  activeSignature: number;
  activeParameter: number;
}

/** Signatures for the call whose argument list holds `offset`. */
export function signatureHelp(resolver: Resolver, file: SourceFile, offset: number): SignatureHelpResult | undefined {
  const { text } = codeView(file);
  const call = enclosingCall(text, offset);
  if (!call) return undefined;
  const callee = chainEndingAt(text, call.calleeEnd - 1);
  const last = callee?.steps[callee.steps.length - 1];
  if (!last || last.kind !== "name") return undefined;

  const found = resolver.lookup(file, call.calleeEnd, { allOverloads: true });
  if (found?.kind !== "decls") return undefined;
  const skipFirst = found.attached === true;
  const isNew = /\bnew\s+$/.test(text.slice(Math.max(0, callee!.start - 8), callee!.start));

  const signatures: SignatureInfo[] = [];
  for (const d of found.decls) {
    const target = isNew && isContractLike(d) ? d.children.find((c) => c.kind === "constructor") : d;
    const params = target ? paramsFor(target) : isNew ? [] : undefined;
    if (!params) continue;
    signatures.push(build(resolver, target ?? d, last.name, skipFirst ? params.slice(1) : params));
  }
  if (!signatures.length) return undefined;
  const fits = signatures.findIndex((s) => s.parameters.length > call.argIndex);
  return { signatures, activeSignature: Math.max(fits, 0), activeParameter: call.argIndex };
}

function paramsFor(d: Decl): Decl[] | undefined {
  switch (d.kind) {
    case "function":
    case "constructor":
    case "modifier":
    case "event":
    case "error":
      return paramsOf(d);
    case "struct":
      return d.children;
    default:
      return undefined;
  }
}

function build(resolver: Resolver, d: Decl, name: string, params: Decl[]): SignatureInfo {
  const builtin = d.file.path === resolver.builtinsPath;
  const yul = d.parent?.name === "$yul";
  const paramText = (p: Decl) => (yul || !p.name ? p.name || squash(p.file.text.slice(p.start, p.end)) : clean(squash(p.file.text.slice(p.start, p.end)), builtin));

  let label = `${name}(`;
  const parameters: SignatureInfo["parameters"] = [];
  const spec = specOf(resolver, d);
  params.forEach((p, i) => {
    if (i) label += ", ";
    const t = paramText(p);
    parameters.push({ range: [label.length, label.length + t.length], doc: paramDoc(resolver, d, p) });
    label += t;
  });
  label += ")";
  const returns = returnsOf(d);
  if (returns.length) {
    label += yul
      ? ` -> ${returns.map((r) => r.name).join(", ")}`
      : ` returns (${returns.map((r) => clean(squash(r.file.text.slice(r.start, r.end)), builtin)).join(", ")})`;
  }
  const doc = spec ? natSpecMarkdown(spec, { params: false }) : undefined;
  return { label, parameters, doc: doc || undefined };
}

function paramDoc(resolver: Resolver, owner: Decl, p: Decl): string | undefined {
  if (owner.kind === "struct") {
    const own = specOf(resolver, p);
    return (own && natSpecMarkdown(own)) || specOf(resolver, owner)?.params.get(p.name);
  }
  return specOf(resolver, owner)?.params.get(p.name);
}

/** Drops the `_` markers globals.sol uses for names the parser rejects. */
function clean(text: string, builtin: boolean): string {
  return builtin ? text.replace(/\b(\w+)_\b/g, "$1") : text;
}

/** The innermost unclosed `(` before `offset` that belongs to a call, and the argument the cursor is in. */
function enclosingCall(text: string, offset: number): { calleeEnd: number; argIndex: number } | undefined {
  let depth = 0;
  let commas = 0;
  for (let i = offset - 1; i >= 0; i--) {
    const c = text[i];
    if (c === ")" || c === "]" || c === "}") depth++;
    else if (c === "[") depth--;
    else if (c === "{") {
      if (depth > 0) depth--;
      // `f({a: 1, b: 2})`: named arguments, all in the first slot.
      else if (/\(\s*$/.test(text.slice(Math.max(0, i - 16), i))) commas = 0;
      else return undefined;
    } else if (c === "(") {
      if (depth === 0) {
        let end = i;
        while (end > 0 && /\s/.test(text[end - 1])) end--;
        if (!/[\w$]/.test(text[end - 1] ?? "")) return undefined;
        return { calleeEnd: end, argIndex: commas };
      }
      depth--;
    } else if (c === "," && depth === 0) commas++;
    else if (c === ";" && depth === 0) return undefined;
  }
  return undefined;
}
