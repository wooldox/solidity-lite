// Hover text for a declaration: its signature as Solidity, then its NatSpec.

import * as path from "node:path";
import { isContractLike, paramsOf, returnsOf, type Decl } from "./model";
import { docCommentBefore, isEmpty, natSpecMarkdown, parseNatSpec, type NatSpec } from "./natspec";
import { findInheritedDoc, type Resolver } from "./resolve";
import { selectorOf } from "./selectors";
import { squash } from "./text";

const MAX_INITIALIZER = 40;

/** How hovers describe the `$` containers of builtins/globals.sol. */
const CONTAINER_LABELS: Record<string, string> = {
  $address: "member of address",
  $array: "member of arrays and bytes",
  $bytes: "bytes.concat",
  $string: "string.concat",
  $type: "member of type(X)",
  $function: "member of a function",
  $error: "member of an error",
  $event: "member of an event",
  $userType: "member of a user-defined value type",
  $fixedBytes: "member of bytes1 to bytes32",
  $assemblyAccess: "assembly · member of a variable",
  $yul: "assembly",
};

export function hoverMarkdown(resolver: Resolver, decls: Decl[], fromFile: string): string {
  return decls
    .slice(0, 3)
    .map((d) => {
      const code = ["```solidity", ...contextLine(resolver, d, fromFile), hoverSignature(resolver, d), "```"].join("\n");
      const selector = selectorOf(resolver, d);
      const parts = [code];
      if (selector) parts.push(`${selector.kind} \`${selector.hash}\` · \`${selector.signature}\``);
      const docs = documentation(resolver, d);
      if (docs) parts.push(docs);
      return parts.join("\n\n");
    })
    .join("\n\n---\n\n");
}

function contextLine(resolver: Resolver, d: Decl, fromFile: string): string[] {
  const owner = d.parent;
  if (d.file.path === resolver.builtinsPath) {
    const container = owner ? (CONTAINER_LABELS[owner.name] ?? `${owner.name}.${d.name}`) : "";
    return [`// built-in${container ? ` · ${container}` : ""}`];
  }
  const where = d.file.path !== fromFile ? path.basename(d.file.path) : undefined;
  let label: string | undefined;
  switch (d.kind) {
    case "parameter":
      label = `parameter of ${owner?.name}`;
      break;
    case "returnParameter":
      label = `return value of ${owner?.name}`;
      break;
    case "localVariable":
      label = `local variable in ${owner?.name}`;
      break;
    case "field":
      label = `field of ${owner?.name}`;
      break;
    case "enumValue":
      label = `${owner?.name} member`;
      break;
    default:
      if (owner) label = `in ${owner.name}`;
  }
  const parts = [label, where].filter(Boolean);
  return parts.length ? [`// ${parts.join(" · ")}`] : [];
}

/** The declaration as hovers and signature help show it (built-ins without their `_` markers, Yul as `f(a) -> b`). */
export function hoverSignature(resolver: Resolver, d: Decl): string {
  if (d.file.path !== resolver.builtinsPath) return signature(d);
  if (d.parent?.name === "$yul") {
    const names = (list: Decl[]) => list.map((p) => p.name).join(", ");
    const returns = returnsOf(d);
    return `${d.name}(${names(paramsOf(d))})${returns.length ? ` -> ${names(returns)}` : ""}`;
  }
  // Names the parser rejects are written with a trailing `_` in globals.sol.
  return signature(d).replace(/\b(\w+)_\b/g, "$1");
}

/** The declaration as written, without its body, on one line (structs and enums keep their shape). */
export function signature(d: Decl): string {
  const text = d.file.text;
  const source = text.slice(d.start, d.end);
  switch (d.kind) {
    case "function":
    case "constructor":
    case "receive":
    case "fallback":
    case "modifier": {
      const bodyStart = d.node.body?.range?.[0];
      return stripSemicolon(squash(text.slice(d.start, bodyStart ?? d.end)));
    }
    case "contract":
    case "interface":
    case "library": {
      const brace = text.indexOf("{", d.nameEnd);
      return squash(text.slice(d.start, brace === -1 ? d.end : brace));
    }
    case "struct":
      return [`struct ${d.name} {`, ...d.children.map((f) => `    ${squash(text.slice(f.start, f.end))};`), "}"].join("\n");
    case "enum":
      return `enum ${d.name} { ${d.children.map((c) => c.name).join(", ")} }`;
    case "enumValue":
      return `${d.parent?.name}.${d.name}`;
    case "localVariable":
      return d.node.type === "AssemblyLocalDefinition" ? `let ${d.name}` : stripSemicolon(squash(source));
    case "stateVariable":
    case "constant": {
      const full = stripSemicolon(squash(source));
      const eq = full.indexOf(" = ");
      return eq !== -1 && full.length - eq - 3 > MAX_INITIALIZER ? full.slice(0, eq) : full;
    }
    default:
      return stripSemicolon(squash(source));
  }
}

function stripSemicolon(s: string): string {
  return s.replace(/\s*;$/, "");
}

function documentation(resolver: Resolver, d: Decl): string {
  switch (d.kind) {
    case "parameter":
    case "returnParameter": {
      const owner = d.parent;
      if (!owner) return "";
      const spec = specOf(resolver, owner);
      if (!spec) return "";
      if (d.kind === "parameter") return spec.params.get(d.name) ?? "";
      const index = returnsOf(owner).indexOf(d);
      const named = spec.returns.find((r) => r.split(/\s/)[0] === d.name);
      return named ? named.slice(d.name.length).trim() : (spec.returns[index] ?? "");
    }
    case "field": {
      const own = specOf(resolver, d);
      if (own) return natSpecMarkdown(own);
      const parent = d.parent && specOf(resolver, d.parent);
      return parent?.params.get(d.name) ?? "";
    }
    default: {
      const spec = specOf(resolver, d);
      return spec ? natSpecMarkdown(spec) : "";
    }
  }
}

/** NatSpec above `d`, following `@inheritdoc` and borrowing from the overridden function when empty. */
export function specOf(resolver: Resolver, d: Decl, depth = 0): NatSpec | undefined {
  const raw = docCommentBefore(d.file.text, d.start);
  const spec = raw ? parseNatSpec(raw) : undefined;
  if (depth > 5) return spec;
  if (spec?.inheritdoc) {
    const base = findInheritedDoc(resolver, d, spec.inheritdoc);
    const inherited = base && specOf(resolver, base, depth + 1);
    if (inherited) return { ...inherited, inheritdoc: undefined };
  }
  if ((!spec || isEmpty(spec)) && d.parent && isContractLike(d.parent) && (d.kind === "function" || d.kind === "modifier")) {
    const base = findInheritedDoc(resolver, d);
    if (base) return specOf(resolver, base, depth + 1);
  }
  return spec && !isEmpty(spec) ? spec : undefined;
}
