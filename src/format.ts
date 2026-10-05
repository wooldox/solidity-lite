// Format Document through `forge fmt`, run from the project folder so its [fmt] settings apply.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import * as path from "node:path";
import * as vscode from "vscode";

const FORMAT_TIMEOUT_MS = 10_000;

export function registerFormatter(log: vscode.OutputChannel): vscode.Disposable {
  return vscode.languages.registerDocumentFormattingEditProvider("solidity", {
    provideDocumentFormattingEdits: (document, _options, token) => formatDocument(log, document, token),
  });
}

async function formatDocument(
  log: vscode.OutputChannel,
  document: vscode.TextDocument,
  token: vscode.CancellationToken,
): Promise<vscode.TextEdit[]> {
  const source = document.getText();
  let formatted: string;
  try {
    formatted = await runForgeFmt(source, projectRoot(document), token);
  } catch (err) {
    if (token.isCancellationRequested) return [];
    const message = err instanceof Error ? err.message : String(err);
    log.appendLine(`[${new Date().toISOString()}] ${document.uri.fsPath}\n${message}\n`);
    vscode.window.setStatusBarMessage(`$(warning) forge fmt failed: ${firstLine(message)}`, 8000);
    return [];
  }
  if (formatted === source) return [];
  const all = new vscode.Range(document.positionAt(0), document.positionAt(source.length));
  return [vscode.TextEdit.replace(all, formatted)];
}

/** Nearest folder holding a foundry.toml, so forge picks up the project's [fmt] settings. */
function projectRoot(document: vscode.TextDocument): string {
  if (document.uri.scheme !== "file") {
    return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? homedir();
  }
  const start = path.dirname(document.uri.fsPath);
  for (let dir = start; ; dir = path.dirname(dir)) {
    if (existsSync(path.join(dir, "foundry.toml"))) return dir;
    if (path.dirname(dir) === dir) return start;
  }
}

function forgeCandidates(): string[] {
  const configured = vscode.workspace.getConfiguration("solidityLite").get<string>("forgePath") || "forge";
  // Cursor launched from the Dock may not see ~/.foundry/bin on its PATH.
  const fallback = path.join(homedir(), ".foundry", "bin", "forge");
  return configured === "forge" ? [configured, fallback] : [configured];
}

async function runForgeFmt(source: string, cwd: string, token: vscode.CancellationToken): Promise<string> {
  const candidates = forgeCandidates();
  for (const [i, bin] of candidates.entries()) {
    try {
      return await spawnFormatter(bin, source, cwd, token);
    } catch (err) {
      const notFound = (err as NodeJS.ErrnoException).code === "ENOENT";
      if (!notFound) throw err;
      if (i === candidates.length - 1) {
        throw new Error(`forge not found (tried ${candidates.join(", ")}). Set solidityLite.forgePath.`);
      }
    }
  }
  throw new Error("unreachable");
}

function spawnFormatter(bin: string, source: string, cwd: string, token: vscode.CancellationToken): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["fmt", "--raw", "-"], { cwd });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const kill = () => child.kill();
    const timer = setTimeout(kill, FORMAT_TIMEOUT_MS);
    const cancel = token.onCancellationRequested(kill);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      cancel.dispose();
      reject(err);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      cancel.dispose();
      if (code === 0) return resolve(Buffer.concat(stdout).toString("utf8"));
      const detail = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(detail || (signal ? `forge fmt was stopped (${signal})` : `forge fmt exited with code ${code}`)));
    });
    child.stdin.on("error", () => {}); // reported through "close" instead
    child.stdin.end(source, "utf8");
  });
}

function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim() && !l.startsWith("Error: solar run failed")) ?? text;
  return line.replace(/^error:\s*/i, "").trim().slice(0, 120);
}
