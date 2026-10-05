// Reading code: hover, Go to Definition, references, highlights, Outline, workspace symbols and hierarchies.

import * as vscode from "vscode";
import { incomingCalls, isCallableDecl, outgoingCalls, subtypes, supertypes, type CallGroup } from "./core/hierarchy";
import { hoverMarkdown } from "./core/hover";
import { isContractLike, type Decl, type DeclKind } from "./core/model";
import { outline, type OutlineItem } from "./core/outline";
import { findReferences } from "./core/references";
import { workspaceSymbols } from "./core/symbols";
import { fileOffset, fileRange, location, range, SELECTOR, type Session } from "./session";

export const SYMBOL_KINDS: Record<DeclKind, vscode.SymbolKind> = {
  contract: vscode.SymbolKind.Class,
  interface: vscode.SymbolKind.Interface,
  library: vscode.SymbolKind.Module,
  function: vscode.SymbolKind.Method,
  constructor: vscode.SymbolKind.Constructor,
  receive: vscode.SymbolKind.Method,
  fallback: vscode.SymbolKind.Method,
  modifier: vscode.SymbolKind.Method,
  event: vscode.SymbolKind.Event,
  error: vscode.SymbolKind.Object,
  struct: vscode.SymbolKind.Struct,
  enum: vscode.SymbolKind.Enum,
  enumValue: vscode.SymbolKind.EnumMember,
  stateVariable: vscode.SymbolKind.Field,
  constant: vscode.SymbolKind.Constant,
  field: vscode.SymbolKind.Field,
  parameter: vscode.SymbolKind.Variable,
  returnParameter: vscode.SymbolKind.Variable,
  localVariable: vscode.SymbolKind.Variable,
  userType: vscode.SymbolKind.TypeParameter,
};

export function registerNavigation(session: Session): vscode.Disposable[] {
  const { ws, resolver } = session;

  /** The declaration a hierarchy item stands for, found again from its position. */
  const declOfItem = (item: { uri: vscode.Uri; selectionRange: vscode.Range }): Decl | undefined => {
    const file = ws.get(item.uri.fsPath);
    if (!file) return undefined;
    const found = resolver.lookup(file, fileOffset(file, item.selectionRange.start));
    return found?.kind === "decls" ? found.decls[0] : undefined;
  };

  return [
    vscode.languages.registerHoverProvider(SELECTOR, {
      provideHover(document, position) {
        const at = session.lookupAt(document, position);
        if (at?.found.kind !== "decls") return undefined;
        const markdown = new vscode.MarkdownString(hoverMarkdown(resolver, at.found.decls, at.file.path));
        return new vscode.Hover(markdown, range(document, at.found.word.start, at.found.word.end));
      },
    }),

    vscode.languages.registerDefinitionProvider(SELECTOR, {
      provideDefinition(document, position) {
        const found = session.lookupAt(document, position)?.found;
        if (!found) return undefined;
        if (found.kind === "import") {
          const start = new vscode.Position(0, 0);
          return [{ originSelectionRange: range(document, found.start, found.end), targetUri: vscode.Uri.file(found.path), targetRange: new vscode.Range(start, start) }];
        }
        return found.decls.map(
          (d): vscode.LocationLink => ({
            originSelectionRange: range(document, found.word.start, found.word.end),
            targetUri: vscode.Uri.file(d.file.path),
            targetRange: fileRange(d.file, d.start, d.end),
            targetSelectionRange: fileRange(d.file, d.nameStart, d.nameEnd),
          }),
        );
      },
    }),

    vscode.languages.registerReferenceProvider(SELECTOR, {
      async provideReferences(document, position, context, token) {
        const at = session.lookupAt(document, position);
        if (at?.found.kind !== "decls") return undefined;
        const candidates = await session.projectFiles(token);
        return at.found.decls
          .flatMap((target) => findReferences(ws, resolver, target, candidates, { shouldStop: () => token.isCancellationRequested }))
          .filter((r) => context.includeDeclaration || !r.isDeclaration)
          .map((r) => location(r.file, r.start, r.end));
      },
    }),

    vscode.languages.registerDocumentHighlightProvider(SELECTOR, {
      provideDocumentHighlights(document, position) {
        const at = session.lookupAt(document, position);
        if (at?.found.kind !== "decls") return undefined;
        const kind = (isDecl: boolean) => (isDecl ? vscode.DocumentHighlightKind.Write : vscode.DocumentHighlightKind.Read);
        return at.found.decls
          .flatMap((target) => findReferences(ws, resolver, target, [at.file.path], { onlyCandidates: true }))
          .map((r) => new vscode.DocumentHighlight(range(document, r.start, r.end), kind(r.isDeclaration)));
      },
    }),

    vscode.languages.registerDocumentSymbolProvider(SELECTOR, {
      provideDocumentSymbols(document) {
        const file = session.fileOf(document);
        return file ? outline(file).map(documentSymbol) : [];
      },
    }),

    vscode.languages.registerWorkspaceSymbolProvider({
      async provideWorkspaceSymbols(query, token) {
        if (!query) return [];
        const paths = await session.projectFiles(token);
        return workspaceSymbols(ws, paths, query, () => token.isCancellationRequested).map(
          (d) => new vscode.SymbolInformation(d.name, SYMBOL_KINDS[d.kind], d.parent?.name ?? "", location(d.file, d.nameStart, d.nameEnd)),
        );
      },
    }),

    vscode.languages.registerCallHierarchyProvider(SELECTOR, {
      prepareCallHierarchy(document, position) {
        const at = session.lookupAt(document, position);
        if (at?.found.kind !== "decls") return undefined;
        const fns = at.found.decls.filter(isCallableDecl);
        return fns.length ? fns.map(hierarchyItem) : undefined;
      },
      async provideCallHierarchyIncomingCalls(item, token) {
        const target = declOfItem(item);
        if (!target) return [];
        const candidates = await session.projectFiles(token);
        return incomingCalls(ws, resolver, target, candidates, () => token.isCancellationRequested).map(
          (g: CallGroup) => new vscode.CallHierarchyIncomingCall(hierarchyItem(g.decl), g.ranges.map(([s, e]) => fileRange(g.decl.file, s, e))),
        );
      },
      provideCallHierarchyOutgoingCalls(item) {
        const from = declOfItem(item);
        if (!from) return [];
        return outgoingCalls(resolver, from).map(
          (g: CallGroup) => new vscode.CallHierarchyOutgoingCall(hierarchyItem(g.decl), g.ranges.map(([s, e]) => fileRange(from.file, s, e))),
        );
      },
    }),

    vscode.languages.registerTypeHierarchyProvider(SELECTOR, {
      prepareTypeHierarchy(document, position) {
        const at = session.lookupAt(document, position);
        if (at?.found.kind !== "decls") return undefined;
        const contracts = at.found.decls.filter(isContractLike);
        return contracts.length ? contracts.map(typeItem) : undefined;
      },
      provideTypeHierarchySupertypes(item) {
        const contract = declOfItem(item);
        return contract ? supertypes(resolver, contract).map(typeItem) : [];
      },
      async provideTypeHierarchySubtypes(item, token) {
        const contract = declOfItem(item);
        if (!contract) return [];
        return subtypes(ws, resolver, contract, await session.projectFiles(token)).map(typeItem);
      },
    }),
  ];
}

function documentSymbol(item: OutlineItem): vscode.DocumentSymbol {
  const d = item.decl;
  const full = fileRange(d.file, d.start, d.end);
  const name = fileRange(d.file, d.nameStart, d.nameEnd);
  const s = new vscode.DocumentSymbol(d.name, item.detail, SYMBOL_KINDS[d.kind], full, full.contains(name) ? name : full);
  s.children = item.children.map(documentSymbol);
  return s;
}

function itemRanges(d: Decl): [vscode.Range, vscode.Range] {
  const full = fileRange(d.file, d.start, d.end);
  const name = fileRange(d.file, d.nameStart, d.nameEnd);
  return [full, full.contains(name) ? name : full];
}

function hierarchyItem(d: Decl): vscode.CallHierarchyItem {
  return new vscode.CallHierarchyItem(SYMBOL_KINDS[d.kind], d.name, d.parent?.name ?? "", vscode.Uri.file(d.file.path), ...itemRanges(d));
}

function typeItem(d: Decl): vscode.TypeHierarchyItem {
  return new vscode.TypeHierarchyItem(SYMBOL_KINDS[d.kind], d.name, d.kind, vscode.Uri.file(d.file.path), ...itemRanges(d));
}
