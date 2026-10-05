// ABI selectors: `transfer(address,uint256)` → 0xa9059cbb, and event topics.

import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { isContractLike, paramsOf, type Decl } from "./model";
import type { Resolver } from "./resolve";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Node = any;

export interface SelectorInfo {
  /** Canonical signature, e.g. `transfer(address,uint256)`. */
  signature: string;
  /** `0x` + 8 hex digits for functions and errors, 64 for event topics. */
  hash: string;
  kind: "selector" | "topic0";
}

/** The selector of an external/public function, public getter or error, or an event's topic0. */
export function selectorOf(resolver: Resolver, d: Decl): SelectorInfo | undefined {
  const contract = d.parent;
  let types: (string | undefined)[];
  switch (d.kind) {
    case "function": {
      if (!contract || !isContractLike(contract) || contract.kind === "library") return undefined;
      const visibility = d.node.visibility;
      if (contract.kind !== "interface" && visibility !== "external" && visibility !== "public") return undefined;
      types = paramsOf(d).map((p) => canonical(resolver, p.typeName, p));
      break;
    }
    case "stateVariable":
      if (d.node.variables?.[0]?.visibility !== "public") return undefined;
      types = getterKeys(resolver, d.typeName, d);
      break;
    case "error":
      types = paramsOf(d).map((p) => canonical(resolver, p.typeName, p));
      break;
    case "event":
      if (d.node.isAnonymous) return undefined;
      types = paramsOf(d).map((p) => canonical(resolver, p.typeName, p));
      break;
    default:
      return undefined;
  }
  if (types.some((t) => t === undefined)) return undefined;
  const signature = `${d.name}(${types.join(",")})`;
  const hex = bytesToHex(keccak_256(utf8ToBytes(signature)));
  return d.kind === "event"
    ? { signature, hash: `0x${hex}`, kind: "topic0" }
    : { signature, hash: `0x${hex.slice(0, 8)}`, kind: "selector" };
}

/** Parameters of a public state variable's getter: one per mapping key or array index. */
function getterKeys(resolver: Resolver, t: Node, where: Decl): (string | undefined)[] {
  const keys: (string | undefined)[] = [];
  for (let cur = t; cur; ) {
    if (cur.type === "Mapping") {
      keys.push(canonical(resolver, cur.keyType, where));
      cur = cur.valueType;
    } else if (cur.type === "ArrayTypeName") {
      keys.push("uint256");
      cur = cur.baseTypeName;
    } else break;
  }
  return keys;
}

/** ABI type of a TypeName: structs become tuples, contracts addresses, enums uint8. */
function canonical(resolver: Resolver, t: Node, where: Decl, depth = 0): string | undefined {
  if (!t || depth > 16) return undefined;
  switch (t.type) {
    case "ElementaryTypeName":
      return { uint: "uint256", int: "int256", byte: "bytes1", fixed: "fixed128x18", ufixed: "ufixed128x18" }[t.name as string] ?? t.name;
    case "ArrayTypeName": {
      const base = canonical(resolver, t.baseTypeName, where, depth + 1);
      if (!base) return undefined;
      if (!t.length) return `${base}[]`;
      return t.length.type === "NumberLiteral" ? `${base}[${t.length.number}]` : undefined;
    }
    case "FunctionTypeName":
      return "function";
    case "UserDefinedTypeName": {
      const d = resolver.typeRef(t, where).decl;
      if (!d) return undefined;
      if (isContractLike(d)) return "address";
      if (d.kind === "enum") return "uint8";
      if (d.kind === "userType") return canonical(resolver, d.typeName, d, depth + 1);
      if (d.kind === "struct") {
        const fields = d.children.map((f) => canonical(resolver, f.typeName, f, depth + 1));
        return fields.some((f) => f === undefined) ? undefined : `(${fields.join(",")})`;
      }
      return undefined;
    }
    default:
      return undefined;
  }
}
