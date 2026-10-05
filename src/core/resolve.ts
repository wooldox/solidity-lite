// Name resolution: which declaration a name at a given offset refers to.
// It works from names and scopes, without type checking, so it can be fooled by
// overloads it cannot tell apart; it then returns every candidate.

import {
  baseTypeName,
  enclosing,
  isCallable,
  isContractLike,
  paramsOf,
  returnsOf,
  typeNameText,
  type Decl,
  type SourceFile,
} from "./model";
import {
  callArgs,
  callArgCountAfter,
  chainEndingAt,
  CharKind,
  codeView,
  isIdentChar,
  qualifierBefore,
  skipSpaceForward,
  wordAt,
  type ChainStep,
} from "./text";
import type { Workspace } from "./workspace";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

type Sym = { decl: Decl } | { namespace: SourceFile };

export interface TypeRef {
  decl?: Decl;
  elementary?: string;
  element?: TypeRef;
  mappingValue?: TypeRef;
}

type Value =
  | { kind: "type"; decl: Decl }
  | { kind: "namespace"; file: SourceFile }
  | { kind: "value"; type: TypeRef }
  | { kind: "callable"; decls: Decl[] }
  | { kind: "super"; contract: Decl };

export type Lookup =
  /** `attached`: reached through `using … for`, so the receiver fills the first parameter. */
  | { kind: "decls"; decls: Decl[]; word: { start: number; end: number }; attached?: boolean }
  | { kind: "import"; path: string; start: number; end: number };

const FUNCTION_SCOPES = ["function", "constructor", "receive", "fallback", "modifier"] as const;
/** Elementary types that can be called as conversions: `address(x)`, `uint256(y)`. */
const ELEMENTARY = /^(address|payable|bool|string|bytes\d*|u?int\d*)$/;

export class Resolver {
  /**
   * @param builtinsPath A declaration file for Solidity's globals (builtins/globals.sol). Names not found
   *   anywhere else resolve there; its `$`-prefixed libraries hold the members of built-in types.
   */
  constructor(
    private readonly ws: Workspace,
    readonly builtinsPath?: string,
  ) {}

  /** What the identifier (or import path) at `offset` refers to. */
  lookup(file: SourceFile, offset: number, { allOverloads = false } = {}): Lookup | undefined {
    for (const imp of file.imports) {
      if (imp.pathStart <= offset && offset <= imp.pathEnd) {
        const target = this.ws.resolveImport(file.path, imp.path);
        return target ? { kind: "import", path: target, start: imp.pathStart, end: imp.pathEnd } : undefined;
      }
    }
    const { kinds, text } = codeView(file);
    if (kinds[offset] !== CharKind.Code && kinds[offset - 1] !== CharKind.Code) return undefined;
    const word = wordAt(text, offset);
    if (!word) return undefined;
    const span = { start: word.start, end: word.end };

    const own = file.all.find((d) => d.nameStart === word.start && d.name === word.name);
    if (own) return { kind: "decls", decls: [own], word: span };

    const steps = qualifierBefore(text, word.start);
    let decls: Decl[];
    let receiver: TypeRef | undefined;
    if (steps) {
      const base = this.evalChain(steps, file, word.start);
      if (!base) return undefined;
      const found = this.members(base, word.name, file, word.start);
      decls = found.decls;
      if (found.attached && base.kind === "value") receiver = base.type;
    } else if (word.name === "this" || word.name === "super") {
      const contract = enclosing(file, word.start, ["contract", "interface", "library"]);
      decls = !contract ? [] : word.name === "this" ? [contract] : this.bases(contract).reverse();
    } else {
      decls = this.resolveName(word.name, file, word.start);
    }
    decls = allOverloads ? dedupeOverrides(decls) : this.pickOverloads(decls, file, word.end, receiver);
    return decls.length ? { kind: "decls", decls, word: span, attached: receiver !== undefined } : undefined;
  }

  /**
   * What autocomplete can offer at `offset`: the members of the expression before a `.`,
   * otherwise every name in scope (innermost first). Undefined inside comments and strings.
   */
  completions(file: SourceFile, offset: number): { entries: { name: string; decl: Decl }[]; namespaces: string[]; afterDot: boolean } | undefined {
    const { kinds, text } = codeView(file);
    if (offset > 0 && kinds[offset - 1] !== CharKind.Code) return undefined;
    let start = offset;
    while (start > 0 && isIdentChar(text[start - 1])) start--;
    const steps = qualifierBefore(text, start);
    if (steps) {
      const base = this.evalChain(steps, file, start);
      const decls = base ? this.allMembersOf(base, file, start) : [];
      return { entries: decls.map((decl) => ({ name: decl.name, decl })), namespaces: [], afterDot: true };
    }
    return { ...this.namesInScope(file, start), afterDot: false };
  }

  private namesInScope(file: SourceFile, offset: number): { entries: { name: string; decl: Decl }[]; namespaces: string[] } {
    const decls: Decl[] = [];
    const entries: { name: string; decl: Decl }[] = [];
    for (let fn = enclosing(file, offset, [...FUNCTION_SCOPES]); fn && isFunctionScope(fn); fn = fn.parent) {
      decls.push(...fn.children.filter((c) => c.name && (c.start <= offset || c.kind === "parameter" || c.kind === "returnParameter")));
    }
    if (inAssembly(file, offset)) decls.push(...(this.builtins("$yul")[0]?.children ?? []));
    const contract = enclosing(file, offset, ["contract", "interface", "library"]);
    if (contract) decls.push(...this.allMembers(contract).filter(isNamedMember));
    entries.push(...decls.map((decl) => ({ name: decl.name, decl })));
    // File scope uses the visible name, which differs for `import {A as B}`.
    const namespaces: string[] = [];
    for (const [name, syms] of this.exported(file)) {
      for (const sym of syms) {
        if ("decl" in sym) entries.push({ name, decl: sym.decl });
        else namespaces.push(name);
      }
    }
    for (const decl of this.builtinsFile()?.decls ?? []) if (!decl.name.startsWith("$")) entries.push({ name: decl.name, decl });
    return { entries, namespaces };
  }

  /** Every member of a value, type or namespace, for autocomplete after a `.`. */
  private allMembersOf(value: Value, file: SourceFile, offset: number): Decl[] {
    switch (value.kind) {
      case "namespace":
        return [...this.exported(value.file).values()].flat().flatMap((s) => ("decl" in s ? [s.decl] : []));
      case "super":
        return this.bases(value.contract).flatMap((b) => this.allMembers(b).filter(isNamedMember));
      case "type": {
        const d = value.decl;
        if (isContractLike(d)) return this.allMembers(d).filter(isNamedMember);
        if (d.kind === "enum") return d.children;
        if (d.kind === "userType") return this.builtins("$userType")[0]?.children ?? [];
        return [];
      }
      case "callable": {
        const kind = value.decls[0].kind;
        return this.builtins(kind === "error" ? "$error" : kind === "event" ? "$event" : "$function")[0]?.children ?? [];
      }
      case "value": {
        const out: Decl[] = [];
        if (inAssembly(file, offset)) out.push(...(this.builtins("$assemblyAccess")[0]?.children ?? []));
        const d = value.type.decl;
        if (d?.kind === "struct") out.push(...d.children);
        else if (d && isContractLike(d)) out.push(...this.allMembers(d).filter((m) => m.kind === "function" || m.kind === "stateVariable"));
        const container = builtinContainer(value.type);
        if (container) out.push(...(this.builtins(container)[0]?.children ?? []));
        out.push(...this.attached(value.type, undefined, file, offset));
        return out;
      }
    }
  }

  // ---- scopes ----------------------------------------------------------------------------

  /** Declarations `name` can mean at `offset`: locals, then contract members, then file scope. */
  resolveName(name: string, file: SourceFile, offset: number): Decl[] {
    return this.resolveSyms(name, file, offset).flatMap((s) => ("decl" in s ? [s.decl] : []));
  }

  private resolveSyms(name: string, file: SourceFile, offset: number): Sym[] {
    // Innermost function first: a Yul function inside assembly, then the Solidity function around it.
    for (let fn = offset < 0 ? undefined : enclosing(file, offset, [...FUNCTION_SCOPES]); fn && isFunctionScope(fn); fn = fn.parent) {
      const locals = fn.children.filter((c) => c.name === name);
      if (locals.length) {
        const before = locals.filter((c) => c.start <= offset);
        return (before.length ? before.slice(-1) : locals).map((decl) => ({ decl }));
      }
    }
    if (inAssembly(file, offset)) {
      const yul = this.builtinMembers("$yul", name);
      if (yul.length) return yul.map((decl) => ({ decl }));
    }
    const contract = offset < 0 ? undefined : enclosing(file, offset, ["contract", "interface", "library"]);
    if (contract) {
      const members = this.membersNamed(contract, name);
      if (members.length) return members.map((decl) => ({ decl }));
    }
    return this.exported(file).get(name) ?? (name.startsWith("$") ? [] : this.builtins(name).map((decl) => ({ decl })));
  }

  /** The parsed built-ins file. */
  private builtinsFile(): SourceFile | undefined {
    const file = this.builtinsPath ? this.ws.get(this.builtinsPath) : undefined;
    if (file && !cleanedBuiltins.has(file)) {
      // Names the parser rejects are written with a trailing `_` (`ether_`, `return_`).
      for (const d of file.all) if (d.name.endsWith("_")) d.name = d.name.slice(0, -1);
      cleanedBuiltins.add(file);
    }
    return file;
  }

  /** Top-level declarations named `name` in the built-ins file. */
  private builtins(name: string): Decl[] {
    return this.builtinsFile()?.decls.filter((d) => d.name === name) ?? [];
  }

  /** Members called `name` of a `$` container in the built-ins file. */
  private builtinMembers(container: string, name: string): Decl[] {
    return this.builtins(container)[0]?.children.filter((c) => c.name === name) ?? [];
  }

  private builtinType(name: string): Value | undefined {
    const decl = this.builtins(name)[0];
    return decl && { kind: "type", decl };
  }

  /** Every name a file makes visible: its own top-level declarations plus what it imports. */
  exported(file: SourceFile, seen = new Set<string>()): Map<string, Sym[]> {
    const out = new Map<string, Sym[]>();
    const add = (name: string, syms: Sym[]) => {
      if (!syms.length) return;
      const list = out.get(name) ?? [];
      for (const s of syms) if (!list.some((x) => sameSym(x, s))) list.push(s);
      out.set(name, list);
    };
    for (const d of file.decls) add(d.name, [{ decl: d }]);
    if (seen.has(file.path)) return out;
    seen.add(file.path);

    for (const imp of file.imports) {
      const targetPath = this.ws.resolveImport(file.path, imp.path);
      const target = targetPath ? this.ws.get(targetPath) : undefined;
      if (!target) continue;
      if (imp.unitAlias) {
        add(imp.unitAlias, [{ namespace: target }]);
      } else if (imp.symbols) {
        const theirs = this.exported(target, seen);
        for (const [name, alias] of imp.symbols) add(alias ?? name, theirs.get(name) ?? []);
      } else {
        for (const [name, syms] of this.exported(target, seen)) add(name, syms);
      }
    }
    return out;
  }

  /** Declarations named `namePath` at file level (no locals or contract members). */
  resolveTopLevel(namePath: string, file: SourceFile): Decl[] {
    return this.resolvePath(namePath, file, -1);
  }

  /** Base contracts named in `contract X is A, B`, resolved in X's file. */
  bases(contract: Decl): Decl[] {
    const out: Decl[] = [];
    for (const spec of contract.node.baseContracts ?? []) {
      const found = this.resolveTopLevel(spec.baseName.namePath, contract.file).filter(isContractLike);
      if (found[0]) out.push(found[0]);
    }
    return out;
  }

  /** Members of a contract and everything it inherits, most derived first. */
  allMembers(contract: Decl, seen = new Set<Decl>()): Decl[] {
    if (seen.has(contract)) return [];
    seen.add(contract);
    const out = [...contract.children];
    // Later bases are "more derived" in Solidity's linearization.
    for (const base of this.bases(contract).reverse()) out.push(...this.allMembers(base, seen));
    return out;
  }

  private membersNamed(contract: Decl, name: string): Decl[] {
    return this.allMembers(contract).filter((m) => m.name === name);
  }

  /** `A.B.C` resolved one segment at a time from `offset` (negative: file scope only). */
  private resolvePath(namePath: string, file: SourceFile, offset: number): Decl[] {
    const [first, ...rest] = namePath.split(".");
    let syms = this.resolveSyms(first, file, offset);
    for (const seg of rest) {
      const next: Sym[] = [];
      for (const s of syms) {
        if ("namespace" in s) next.push(...(this.exported(s.namespace).get(seg) ?? []));
        else if (isContractLike(s.decl)) next.push(...this.membersNamed(s.decl, seg).map((decl) => ({ decl })));
        else if (s.decl.kind === "enum") next.push(...s.decl.children.filter((c) => c.name === seg).map((decl) => ({ decl })));
      }
      syms = next;
    }
    return syms.flatMap((s) => ("decl" in s ? [s.decl] : []));
  }

  // ---- expressions -----------------------------------------------------------------------

  private evalChain(steps: ChainStep[], file: SourceFile, offset: number): Value | undefined {
    const [first, ...rest] = steps;
    if (first.kind !== "name") return undefined;
    let value: Value | undefined;
    const calledNext = rest[0]?.kind === "call";
    if (first.name === "type" && calledNext) {
      rest.shift();
      value = this.builtinType("$type");
    } else if (ELEMENTARY.test(first.name) && calledNext) {
      rest.shift();
      value = { kind: "value", type: { elementary: first.name === "payable" ? "address" : first.name } };
    } else if (first.name === "bytes" || first.name === "string") {
      value = this.builtinType(`$${first.name}`);
    } else if (first.name === "this") {
      const c = enclosing(file, offset, ["contract", "interface", "library"]);
      value = c && { kind: "value", type: { decl: c } };
    } else if (first.name === "super") {
      const c = enclosing(file, offset, ["contract"]);
      value = c && { kind: "super", contract: c };
    } else {
      const syms = this.resolveSyms(first.name, file, offset);
      const ns = syms.find((s): s is { namespace: SourceFile } => "namespace" in s);
      if (ns) value = { kind: "namespace", file: ns.namespace };
      else value = this.valueOf(syms.flatMap((s) => ("decl" in s ? [s.decl] : [])));
    }

    for (const step of rest) {
      if (!value) return undefined;
      if (step.kind === "index") {
        value = value.kind === "value" ? indexed(value.type) : undefined;
      } else if (step.kind === "call") {
        value = this.called(value, step.argCount);
      } else {
        value = this.valueOf(this.memberOf(value, step.name, file, offset));
      }
    }
    return value;
  }

  private valueOf(decls: Decl[]): Value | undefined {
    const d = decls[0];
    if (!d) return undefined;
    switch (d.kind) {
      case "contract":
      case "interface":
      case "library":
      case "struct":
      case "enum":
      case "userType":
        return { kind: "type", decl: d };
      case "function":
      case "modifier":
      case "event":
      case "error":
        return { kind: "callable", decls };
      case "enumValue":
        return { kind: "value", type: { decl: d.parent } };
      default:
        return d.typeName ? { kind: "value", type: this.typeRef(d.typeName, d) } : undefined;
    }
  }

  private called(value: Value, argCount: number): Value | undefined {
    if (value.kind === "type") return { kind: "value", type: { decl: value.decl } }; // cast or struct literal
    if (value.kind !== "callable") return undefined;
    const fns = value.decls.filter((d) => d.kind === "function");
    const fn = fns.find((d) => paramsOf(d).length === argCount) ?? fns[0];
    const ret = fn && returnsOf(fn)[0];
    return ret?.typeName ? { kind: "value", type: this.typeRef(ret.typeName, ret) } : undefined;
  }

  /** Resolves a TypeName node in the scope of the declaration that wrote it. */
  typeRef(t: Node, where: Decl): TypeRef {
    switch (t?.type) {
      case "ElementaryTypeName":
        return { elementary: t.name };
      case "UserDefinedTypeName":
        return { decl: this.resolvePath(t.namePath, where.file, where.start)[0] };
      case "ArrayTypeName":
        return { element: this.typeRef(t.baseTypeName, where) };
      case "Mapping":
        return { mappingValue: this.typeRef(t.valueType, where) };
      default:
        return {};
    }
  }

  private memberOf(value: Value, name: string, file: SourceFile, offset: number): Decl[] {
    return this.members(value, name, file, offset).decls;
  }

  /** Members called `name`; `attached` when they came from a `using` directive. */
  private members(value: Value, name: string, file: SourceFile, offset: number): { decls: Decl[]; attached?: boolean } {
    const list = (decls: Decl[]) => ({ decls });
    switch (value.kind) {
      case "namespace":
        return list((this.exported(value.file).get(name) ?? []).flatMap((s) => ("decl" in s ? [s.decl] : [])));
      case "super":
        return list(
          this.bases(value.contract)
            .reverse()
            .flatMap((b) => this.membersNamed(b, name)),
        );
      case "type":
        if (isContractLike(value.decl)) return list(this.membersNamed(value.decl, name));
        if (value.decl.kind === "enum") return list(value.decl.children.filter((c) => c.name === name));
        if (value.decl.kind === "userType") return list(this.builtinMembers("$userType", name));
        if (value.decl.kind === "error" || value.decl.kind === "event") return list(this.builtinMembers(`$${value.decl.kind}`, name));
        return list([]);
      case "callable": {
        const kind = value.decls[0].kind;
        const container = kind === "error" ? "$error" : kind === "event" ? "$event" : "$function";
        return list(this.builtinMembers(container, name));
      }
      case "value": {
        if (inAssembly(file, offset)) {
          const access = this.builtinMembers("$assemblyAccess", name);
          if (access.length) return list(access);
        }
        const own: Decl[] = [];
        const d = value.type.decl;
        if (d?.kind === "struct") own.push(...d.children.filter((c) => c.name === name));
        else if (d && isContractLike(d)) own.push(...this.membersNamed(d, name));
        if (own.length) return list(own);
        const container = builtinContainer(value.type);
        const builtin = container ? this.builtinMembers(container, name) : [];
        if (builtin.length) return list(builtin);
        return { decls: this.attached(value.type, name, file, offset), attached: true };
      }
      default:
        return list([]);
    }
  }

  /** Functions attached to a type with `using L for T` / `using {f} for T`; all of them when `name` is undefined. */
  private attached(type: TypeRef, name: string | undefined, file: SourceFile, offset: number): Decl[] {
    const typeName = typeRefText(type);
    if (!typeName) return [];
    const contract = enclosing(file, offset, ["contract", "interface", "library"]);
    const directives = [
      ...file.usings.filter((u) => !u.contract || u.contract === contract),
      ...(type.decl && type.decl.file !== file ? type.decl.file.usings.filter((u) => u.isGlobal) : []),
    ];
    const out: Decl[] = [];
    for (const u of directives) {
      if (u.forType !== "*" && u.forType.slice(u.forType.lastIndexOf(".") + 1) !== typeName) continue;
      const ctxFile = u.file;
      const ctxOffset = u.contract?.start ?? -1;
      if (u.library) {
        const lib = this.resolvePath(u.library, ctxFile, ctxOffset).find(isContractLike);
        if (lib) out.push(...lib.children.filter((c) => c.kind === "function" && (name === undefined || c.name === name)));
      }
      for (const f of u.functions) {
        if (name === undefined || f.slice(f.lastIndexOf(".") + 1) === name) out.push(...this.resolvePath(f, ctxFile, ctxOffset));
      }
    }
    // Only functions whose first parameter takes the receiver attach (unless none can be matched).
    const fits = out.filter((d) => baseTypeName(paramsOf(d)[0]?.typeName) === typeName);
    return fits.length ? fits : out;
  }

  // ---- overloads -------------------------------------------------------------------------

  /**
   * Narrows overloaded candidates using the call's argument count and simple argument types.
   * `receiver` is set for functions reached through `using`, whose first parameter it fills.
   */
  private pickOverloads(decls: Decl[], file: SourceFile, wordEnd: number, receiver?: TypeRef): Decl[] {
    decls = dedupeOverrides(decls);
    if (decls.length < 2) return decls;
    const text = codeView(file).text;
    const argCount = callArgCountAfter(text, wordEnd);
    if (argCount === undefined) return decls;

    const viaUsing = (d: Decl) => receiver !== undefined && d.kind === "function";
    const arity = decls.filter((d) => !isCallable(d) || paramsOf(d).length === argCount + (viaUsing(d) ? 1 : 0));
    if (arity.length === 1 || arity.length === 0) return arity.length ? arity : decls;

    const args = callArgs(text, skipSpaceForward(text, wordEnd));
    const argTypes = args.map((a) => this.typeOfExpression(a, file, wordEnd));
    const scored = arity.map((d) => {
      const params = paramsOf(d);
      const offset = viaUsing(d) ? 1 : 0;
      let score = 0;
      if (offset && receiver && baseTypeName(params[0]?.typeName) === typeRefText(receiver)) score++;
      argTypes.forEach((t, i) => {
        if (t && baseTypeName(params[i + offset]?.typeName) === t) score++;
      });
      return { d, score };
    });
    const best = Math.max(...scored.map((s) => s.score));
    return scored.filter((s) => s.score === best).map((s) => s.d);
  }

  /** Type name of a simple expression like `x`, `m.player`, `ids[i]` or `_intent(v)`. */
  private typeOfExpression(expr: string, file: SourceFile, offset: number): string | undefined {
    const chain = chainEndingAt(expr, expr.length - 1);
    if (!chain || chain.start !== 0) return undefined;
    const value = this.evalChain(chain.steps, file, offset);
    return value?.kind === "value" ? typeRefText(value.type) : undefined;
  }
}

/** The built-ins library holding the members of an elementary or array type. */
function builtinContainer(t: TypeRef): string | undefined {
  if (t.element || t.elementary === "bytes") return "$array";
  if (t.elementary === "address") return "$address";
  if (t.elementary && /^bytes\d+$/.test(t.elementary)) return "$fixedBytes";
  return undefined;
}

const cleanedBuiltins = new WeakSet<SourceFile>();

/** Contract members worth offering by name (not constructors, receive or fallback). */
function isNamedMember(d: Decl): boolean {
  return !!d.name && d.kind !== "constructor" && d.kind !== "receive" && d.kind !== "fallback";
}

function isFunctionScope(d: Decl): boolean {
  return (FUNCTION_SCOPES as readonly string[]).includes(d.kind);
}

function inAssembly(file: SourceFile, offset: number): boolean {
  return file.assembly.some(([start, end]) => start <= offset && offset < end);
}

function indexed(t: TypeRef): Value | undefined {
  const inner = t.element ?? t.mappingValue;
  return inner ? { kind: "value", type: inner } : undefined;
}

function typeRefText(t: TypeRef): string {
  if (t.decl) return t.decl.name;
  if (t.elementary) return t.elementary;
  if (t.element) return `${typeRefText(t.element)}[]`;
  return "";
}

function sameSym(a: Sym, b: Sym): boolean {
  return "decl" in a && "decl" in b ? a.decl === b.decl : "namespace" in a && "namespace" in b && a.namespace === b.namespace;
}

/** Drops base-contract versions of a function an earlier (more derived) candidate overrides. */
function dedupeOverrides(decls: Decl[]): Decl[] {
  const seen = new Set<string>();
  const out: Decl[] = [];
  for (const d of decls) {
    const key = isCallable(d) || d.kind === "stateVariable" ? `${d.kind}:${d.name}(${paramsOf(d).map((p) => typeNameText(p.typeName)).join(",")})` : "";
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

/** The declaration `d` overrides (or the one `@inheritdoc Base` names), for borrowing its NatSpec. */
export function findInheritedDoc(resolver: Resolver, d: Decl, baseName?: string): Decl | undefined {
  const contract = d.parent;
  if (!contract || !isContractLike(contract)) return undefined;
  const bases = baseName ? resolver.resolveTopLevel(baseName, contract.file).filter(isContractLike) : resolver.bases(contract);
  const arity = paramsOf(d).length;
  for (const base of bases) {
    const match = resolver.allMembers(base).find((m) => m.name === d.name && m.kind === d.kind && paramsOf(m).length === arity);
    if (match) return match;
  }
  return undefined;
}
