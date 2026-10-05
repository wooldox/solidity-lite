// Red squiggles for syntax errors while typing, from the parser alone (no compiler).

import * as vscode from "vscode";
import { syntaxErrors } from "./core/diagnostics";

const DELAY_MS = 400;

export function registerSyntaxErrors(): vscode.Disposable[] {
  const collection = vscode.languages.createDiagnosticCollection("solidity-lite");
  const timers = new Map<string, NodeJS.Timeout>();
  const enabled = () => vscode.workspace.getConfiguration("solidityLite").get<boolean>("syntaxErrors", true);

  const check = (doc: vscode.TextDocument) => {
    if (doc.languageId !== "solidity") return;
    if (!enabled()) return collection.delete(doc.uri);
    collection.set(
      doc.uri,
      syntaxErrors(doc.getText()).map((e) => {
        const start = new vscode.Position(e.line, e.column);
        const d = new vscode.Diagnostic(new vscode.Range(start, start.translate(0, e.length)), e.message, vscode.DiagnosticSeverity.Error);
        d.source = "solidity";
        return d;
      }),
    );
  };
  const schedule = (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => (timers.delete(key), check(doc)), DELAY_MS));
  };
  const recheckAll = () => vscode.workspace.textDocuments.forEach(check);

  recheckAll();
  return [
    collection,
    vscode.workspace.onDidOpenTextDocument(check),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      clearTimeout(timers.get(doc.uri.toString()));
      collection.delete(doc.uri);
    }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("solidityLite.syntaxErrors") && recheckAll()),
    { dispose: () => timers.forEach(clearTimeout) },
  ];
}
