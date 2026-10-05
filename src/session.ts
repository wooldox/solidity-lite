// State shared by the providers: the parsed-file cache, the resolver and range conversions.

import * as path from "node:path";
import * as vscode from "vscode";
import type { SourceFile } from "./core/model";
import { Resolver } from "./core/resolve";
import { LineIndex } from "./core/text";
import { Workspace } from "./core/workspace";

export const SELECTOR: vscode.DocumentSelector = { language: "solidity" };

/** Folders whose Solidity files project-wide features skip: dependencies and build output. */
const PROJECT_EXCLUDE = "**/{node_modules,lib,out,cache,artifacts,.git}/**";
const DEPENDENCY_DIR = /(^|[\\/])(node_modules|lib)[\\/]/;

export class Session {
  readonly ws = new Workspace((filePath) => {
    const doc = vscode.workspace.textDocuments.find((d) => d.uri.fsPath === filePath);
    return doc && { text: doc.getText(), version: doc.version };
  });
  readonly resolver: Resolver;

  constructor(context: vscode.ExtensionContext) {
    this.resolver = new Resolver(this.ws, context.asAbsolutePath(path.join("builtins", "globals.sol")));
  }

  /** The parsed document; `offset` is where the user is editing, used to recover from half-typed code. */
  fileOf(document: vscode.TextDocument, offset?: number): SourceFile | undefined {
    return this.ws.get(document.uri.fsPath, offset);
  }

  /** The declarations under the cursor, if any. */
  lookupAt(document: vscode.TextDocument, position: vscode.Position, options?: { allOverloads?: boolean }) {
    const offset = document.offsetAt(position);
    const file = this.fileOf(document, offset);
    const found = file && this.resolver.lookup(file, offset, options);
    return file && found ? { file, offset, found } : undefined;
  }

  /** Solidity files of the project (not dependencies), plus open ones. */
  async projectFiles(token?: vscode.CancellationToken): Promise<string[]> {
    const found = await vscode.workspace.findFiles("**/*.sol", PROJECT_EXCLUDE, undefined, token);
    const open = vscode.workspace.textDocuments.filter((d) => d.languageId === "solidity" && d.uri.scheme === "file").map((d) => d.uri);
    return [...new Set([...found, ...open].map((u) => u.fsPath))];
  }

  /** Whether rename may edit the file: inside the workspace and not a dependency or built-in. */
  editable(filePath: string): boolean {
    if (filePath === this.resolver.builtinsPath) return false;
    const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(filePath));
    if (!folder) return vscode.workspace.textDocuments.some((d) => d.uri.fsPath === filePath);
    return !DEPENDENCY_DIR.test(path.relative(folder.uri.fsPath, filePath));
  }
}

export function range(document: vscode.TextDocument, start: number, end: number): vscode.Range {
  return new vscode.Range(document.positionAt(start), document.positionAt(end));
}

const lineIndexes = new WeakMap<SourceFile, LineIndex>();

function lineIndex(file: SourceFile): LineIndex {
  let index = lineIndexes.get(file);
  if (!index) lineIndexes.set(file, (index = new LineIndex(file.text)));
  return index;
}

/** Offset of a position in a file that may not be open. */
export function fileOffset(file: SourceFile, position: vscode.Position): number {
  return lineIndex(file).offset(position.line, position.character);
}

/** Range in a file that may not be open, using the text it was parsed from. */
export function fileRange(file: SourceFile, start: number, end: number): vscode.Range {
  const index = lineIndex(file);
  const a = index.position(start);
  const b = index.position(end);
  return new vscode.Range(a.line, a.character, b.line, b.character);
}

export function location(file: SourceFile, start: number, end: number): vscode.Location {
  return new vscode.Location(vscode.Uri.file(file.path), fileRange(file, start, end));
}
