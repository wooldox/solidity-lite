// The declarations shown in the Outline view and breadcrumbs.

import { paramsOf, returnsOf, typeNameText, type Decl, type DeclKind, type SourceFile } from "./model";

export interface OutlineItem {
  decl: Decl;
  detail: string;
  children: OutlineItem[];
}

const HIDDEN: DeclKind[] = ["parameter", "returnParameter", "localVariable"];

export function outline(file: SourceFile): OutlineItem[] {
  return file.decls.map(item);
}

function item(d: Decl): OutlineItem {
  return {
    decl: d,
    detail: detail(d),
    children: d.children.filter((c) => !HIDDEN.includes(c.kind)).map(item),
  };
}

function detail(d: Decl): string {
  switch (d.kind) {
    case "function":
    case "constructor":
    case "modifier":
    case "event":
    case "error": {
      const params = `(${paramsOf(d).map((p) => typeNameText(p.typeName)).join(", ")})`;
      const returns = returnsOf(d).map((p) => typeNameText(p.typeName));
      return returns.length ? `${params} → ${returns.join(", ")}` : params;
    }
    case "stateVariable":
    case "constant":
    case "field":
      return typeNameText(d.typeName);
    case "userType":
      return `is ${typeNameText(d.typeName)}`;
    default:
      return "";
  }
}
