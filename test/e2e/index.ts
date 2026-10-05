// Runs inside an editor's extension host (see scripts/e2e.sh) and writes what the providers return.

import { writeFileSync } from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

export async function run(): Promise<void> {
  const out = process.env.E2E_OUT!;
  const root = path.resolve(__dirname, "..", "..", "test", "fixtures", "project");
  const results: Record<string, unknown> = {};
  try {
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === "solidity-lite")!;
    await ext.activate();
    const farm = await vscode.workspace.openTextDocument(path.join(root, "src", "Farm.sol"));
    await vscode.window.showTextDocument(farm);
    results.languageId = farm.languageId;

    const pos = (snippet: string, word: string) => farm.positionAt(farm.getText().indexOf(snippet) + snippet.indexOf(word) + 1);
    const where = (uri: vscode.Uri, r: vscode.Range) => `${path.basename(uri.fsPath)}:${r.start.line + 1}:${r.start.character + 1}`;

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", farm.uri, pos("digest = M.hash(intent)", "hash"));
    results.hover = hovers.flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value))).join("\n");

    const defs = async (snippet: string, word: string) => {
      const links = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>("vscode.executeDefinitionProvider", farm.uri, pos(snippet, word));
      return links.map((l) => ("targetUri" in l ? where(l.targetUri, l.targetSelectionRange ?? l.targetRange) : where(l.uri, l.range)));
    };
    results.defHash = await defs("intent.hash()", "hash");
    results.defOwnable = await defs("contract Farm is Ownable", "Ownable");
    results.defImport = await defs('"solady/auth/Ownable.sol"', "auth");

    const messages = await vscode.workspace.openTextDocument(path.join(root, "src", "Messages.sol"));
    const mpos = (snippet: string, word: string) => messages.positionAt(messages.getText().indexOf(snippet) + snippet.indexOf(word) + 1);
    const refs = await vscode.commands.executeCommand<vscode.Location[]>("vscode.executeReferenceProvider", messages.uri, mpos("struct Intent", "Intent"));
    results.referencesIntent = refs.map((l) => where(l.uri, l.range));
    const highlights = await vscode.commands.executeCommand<vscode.DocumentHighlight[]>("vscode.executeDocumentHighlights", farm.uri, pos("uint256 seed =", "seed"));
    results.highlightsSeed = highlights.map((h) => `${h.range.start.line + 1}:${h.range.start.character + 1} ${vscode.DocumentHighlightKind[h.kind ?? 0]}`);
    const builtin = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", messages.uri, mpos("return keccak256(abi.encodePacked", "keccak256"));
    results.hoverKeccak = builtin.flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value))).join("\n");
    const toBuiltin = await vscode.commands.executeCommand<vscode.LocationLink[]>("vscode.executeDefinitionProvider", messages.uri, mpos("abi.encode(INTENT", "encode"));
    results.defEncode = toBuiltin.map((l) => where(l.targetUri, l.targetSelectionRange ?? l.targetRange));

    // ---- the eight lightweight features ----
    const ownerHover = await vscode.commands.executeCommand<vscode.Hover[]>("vscode.executeHoverProvider", farm.uri, pos("function owner()", "owner"));
    results.selectorInHover = /selector `0x8da5cb5b`/.test(ownerHover.flatMap((h) => h.contents.map((c) => (typeof c === "string" ? c : c.value))).join());

    const scratch = await vscode.workspace.openTextDocument({
      language: "solidity",
      content: [
        "contract S {",
        "    struct P { address who; uint256 amount; }",
        "    ///",
        "    function pay(P memory p, uint256 tip) external returns (bool ok) {",
        "        uint256 x = p.;",
        "        pay(p, ",
        "    }",
        "}",
      ].join("\n"),
    });
    const sPos = (snippet: string, after = snippet) => scratch.positionAt(scratch.getText().indexOf(snippet) + after.length);
    const completions = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider", scratch.uri, sPos("        uint256 x = p."), ".");
    results.completionAfterDot = completions.items.map((i) => (typeof i.label === "string" ? i.label : i.label.label)).sort();
    const template = await vscode.commands.executeCommand<vscode.CompletionList>("vscode.executeCompletionItemProvider", scratch.uri, sPos("    ///"), "/");
    const snippet = template.items.find((i) => i.kind === vscode.CompletionItemKind.Snippet)?.insertText;
    results.natspecTemplate = snippet instanceof vscode.SnippetString ? snippet.value : snippet;
    const sig = await vscode.commands.executeCommand<vscode.SignatureHelp>("vscode.executeSignatureHelpProvider", scratch.uri, sPos("        pay(p, "), ",");
    results.signatureHelp = sig && `${sig.signatures[sig.activeSignature].label} [param ${sig.activeParameter}]`;
    await new Promise((r) => setTimeout(r, 900));
    results.syntaxErrors = vscode.languages.getDiagnostics(scratch.uri).map((d) => `${d.range.start.line + 1}:${d.range.start.character + 1} ${d.message}`);

    const rename = await vscode.commands.executeCommand<vscode.WorkspaceEdit>("vscode.executeDocumentRenameProvider", farm.uri, pos("intent.deadline +", "intent"), "signed");
    results.renameEdits = rename.entries().map(([uri, edits]) => `${path.basename(uri.fsPath)} ×${edits.length}`);
    try {
      await vscode.commands.executeCommand("vscode.prepareRename", farm.uri, pos("block.timestamp", "timestamp"));
      results.renameBuiltin = "allowed";
    } catch (err) {
      results.renameBuiltin = String((err as Error).message ?? err);
    }

    const wsSymbols = await vscode.commands.executeCommand<vscode.SymbolInformation[]>("vscode.executeWorkspaceSymbolProvider", "plant");
    results.workspaceSymbols = wsSymbols.map((s) => `${s.containerName}.${s.name}`).sort();

    const [callItem] = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>("vscode.prepareCallHierarchy", farm.uri, pos("function plant(", "plant"));
    const outgoing = await vscode.commands.executeCommand<vscode.CallHierarchyOutgoingCall[]>("vscode.provideOutgoingCalls", callItem);
    results.outgoingCalls = outgoing.map((c) => c.to.name).sort();
    const [hashItem] = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>("vscode.prepareCallHierarchy", messages.uri, mpos("function hash(Intent", "hash"));
    const incoming = await vscode.commands.executeCommand<vscode.CallHierarchyIncomingCall[]>("vscode.provideIncomingCalls", hashItem);
    results.incomingCalls = incoming.map((c) => `${c.from.name} ×${c.fromRanges.length}`);

    const [typeItem] = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>("vscode.prepareTypeHierarchy", farm.uri, pos("contract Farm is", "Farm"));
    const supers = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>("vscode.provideSupertypes", typeItem);
    results.supertypes = supers.map((t) => t.name);

    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>("vscode.executeDocumentSymbolProvider", farm.uri);
    results.outline = symbols.map((s) => `${s.name}: ${s.children.map((c) => c.name + (c.detail ? ` ${c.detail}` : "")).join(" | ")}`);

    const messy = await vscode.workspace.openTextDocument({ language: "solidity", content: "contract A{function f( ) public{uint x=1;}}" });
    const edits = await vscode.commands.executeCommand<vscode.TextEdit[]>("vscode.executeFormatDocumentProvider", messy.uri, { tabSize: 4, insertSpaces: true });
    results.format = edits?.map((e) => e.newText);
  } catch (err) {
    results.error = String(err instanceof Error ? err.stack : err);
  }
  writeFileSync(out, JSON.stringify(results, null, 2));
}
