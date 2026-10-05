// Writing code: autocomplete, the `///` NatSpec template, parameter hints and rename.

import * as vscode from "vscode";
import { hoverMarkdown, hoverSignature } from "./core/hover";
import { paramsOf, typeNameText, type Decl, type DeclKind } from "./core/model";
import { natSpecTemplate } from "./core/natspec";
import { renameBlocker, renameEdits } from "./core/rename";
import { signatureHelp } from "./core/signatureHelp";
import { fileRange, range, SELECTOR, type Session } from "./session";

const COMPLETION_KINDS: Record<DeclKind, vscode.CompletionItemKind> = {
  contract: vscode.CompletionItemKind.Class,
  interface: vscode.CompletionItemKind.Interface,
  library: vscode.CompletionItemKind.Module,
  function: vscode.CompletionItemKind.Function,
  constructor: vscode.CompletionItemKind.Constructor,
  receive: vscode.CompletionItemKind.Function,
  fallback: vscode.CompletionItemKind.Function,
  modifier: vscode.CompletionItemKind.Function,
  event: vscode.CompletionItemKind.Event,
  error: vscode.CompletionItemKind.Struct,
  struct: vscode.CompletionItemKind.Struct,
  enum: vscode.CompletionItemKind.Enum,
  enumValue: vscode.CompletionItemKind.EnumMember,
  stateVariable: vscode.CompletionItemKind.Field,
  constant: vscode.CompletionItemKind.Constant,
  field: vscode.CompletionItemKind.Field,
  parameter: vscode.CompletionItemKind.Variable,
  returnParameter: vscode.CompletionItemKind.Variable,
  localVariable: vscode.CompletionItemKind.Variable,
  userType: vscode.CompletionItemKind.TypeParameter,
};

const KEYWORDS = (
  "abstract address assembly bool break bytes bytes32 calldata catch constant constructor continue contract delete do " +
  "else emit enum error event external fallback false for function if immutable import indexed interface internal is " +
  "library mapping memory modifier new override payable pragma private public pure receive return returns revert " +
  "storage string struct transient true try type uint256 int256 unchecked using view virtual while"
).split(" ");

const MAX_DETAIL = 90;

export function registerEditing(session: Session): vscode.Disposable[] {
  const { ws, resolver } = session;
  const declOfItem = new WeakMap<vscode.CompletionItem, Decl>();

  return [
    vscode.languages.registerCompletionItemProvider(
      SELECTOR,
      {
        provideCompletionItems(document, position) {
          const offset = document.offsetAt(position);
          const file = session.fileOf(document, offset);
          const result = file && resolver.completions(file, offset);
          if (!result) return undefined;

          // One item per name; the innermost declaration wins, overloads are counted.
          const byName = new Map<string, Decl[]>();
          for (const { name, decl: d } of result.entries) {
            if (!name) continue;
            const list = byName.get(name) ?? [];
            if (!list.length || list[0].kind === d.kind) list.push(d);
            byName.set(name, list);
          }
          const items: vscode.CompletionItem[] = [];
          let order = 0;
          for (const [name, decls] of byName) {
            const d = decls[0];
            const item = new vscode.CompletionItem(name, COMPLETION_KINDS[d.kind]);
            // Overrides repeat a signature; only different parameter lists count as overloads.
            const signatures = new Set(decls.map((x) => paramsOf(x).map((p) => typeNameText(p.typeName)).join(","))).size;
            const overloads = signatures > 1 ? ` (+${signatures - 1} overload${signatures > 2 ? "s" : ""})` : "";
            item.detail = shorten(d.kind === "struct" ? `struct ${d.name}` : hoverSignature(resolver, d)) + overloads;
            item.sortText = String(order++).padStart(5, "0");
            declOfItem.set(item, d);
            items.push(item);
          }
          for (const ns of result.namespaces) items.push(new vscode.CompletionItem(ns, vscode.CompletionItemKind.Module));
          if (!result.afterDot) {
            for (const kw of KEYWORDS) {
              if (byName.has(kw)) continue;
              const item = new vscode.CompletionItem(kw, vscode.CompletionItemKind.Keyword);
              item.sortText = `z${kw}`;
              items.push(item);
            }
          }
          return items;
        },
        resolveCompletionItem(item) {
          const d = declOfItem.get(item);
          if (d) item.documentation = new vscode.MarkdownString(hoverMarkdown(resolver, [d], ""));
          return item;
        },
      },
      ".",
    ),

    vscode.languages.registerCompletionItemProvider(
      SELECTOR,
      {
        provideCompletionItems(document, position) {
          const line = document.lineAt(position.line);
          const before = line.text.slice(0, position.character);
          if (!/^\s*\/\/\/$/.test(before) || line.text.slice(position.character).trim()) return undefined;
          const file = session.fileOf(document);
          const indent = /^\s*/.exec(line.text)![0];
          const snippet = file && natSpecTemplate(file, document.offsetAt(line.range.end), indent);
          if (!snippet) return undefined;
          const item = new vscode.CompletionItem("/// NatSpec", vscode.CompletionItemKind.Snippet);
          item.insertText = new vscode.SnippetString(snippet);
          item.range = new vscode.Range(position.translate(0, -3), position);
          item.filterText = "///";
          item.detail = "Document the declaration below";
          item.preselect = true;
          return [item];
        },
      },
      "/",
    ),

    vscode.languages.registerSignatureHelpProvider(
      SELECTOR,
      {
        provideSignatureHelp(document, position) {
          const offset = document.offsetAt(position);
          const file = session.fileOf(document, offset);
          const help = file && signatureHelp(resolver, file, offset);
          if (!help) return undefined;
          const result = new vscode.SignatureHelp();
          result.signatures = help.signatures.map((s) => {
            const info = new vscode.SignatureInformation(s.label, s.doc ? new vscode.MarkdownString(s.doc) : undefined);
            info.parameters = s.parameters.map((p) => new vscode.ParameterInformation(p.range, p.doc ? new vscode.MarkdownString(p.doc) : undefined));
            return info;
          });
          result.activeSignature = help.activeSignature;
          result.activeParameter = help.activeParameter;
          return result;
        },
      },
      { triggerCharacters: ["(", ","], retriggerCharacters: [","] },
    ),

    vscode.languages.registerRenameProvider(SELECTOR, {
      prepareRename(document, position) {
        const at = session.lookupAt(document, position);
        if (at?.found.kind !== "decls") throw new Error("You cannot rename this element.");
        const blocker = renameBlocker(resolver, at.found.decls[0], (p) => session.editable(p));
        if (blocker) throw new Error(blocker);
        return { range: range(document, at.found.word.start, at.found.word.end), placeholder: at.found.decls[0].name };
      },
      async provideRenameEdits(document, position, newName, token) {
        const at = session.lookupAt(document, position);
        if (at?.found.kind !== "decls") return undefined;
        const candidates = await session.projectFiles(token);
        const edits = renameEdits(ws, resolver, at.found.decls[0], newName, candidates, (p) => session.editable(p));
        if ("error" in edits) throw new Error(edits.error);
        const workspaceEdit = new vscode.WorkspaceEdit();
        for (const e of edits) {
          const file = ws.get(e.path);
          if (file) workspaceEdit.replace(vscode.Uri.file(e.path), fileRange(file, e.start, e.end), e.text);
        }
        return workspaceEdit;
      },
    }),
  ];
}

function shorten(text: string): string {
  const line = text.replace(/\s+/g, " ");
  return line.length > MAX_DETAIL ? `${line.slice(0, MAX_DETAIL - 1)}…` : line;
}
