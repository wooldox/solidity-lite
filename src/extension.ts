import * as vscode from "vscode";
import { registerEditing } from "./editing";
import { registerFormatter } from "./format";
import { registerNavigation } from "./navigation";
import { Session } from "./session";
import { registerSyntaxErrors } from "./syntaxErrors";

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel("Solidity Lite");
  const session = new Session(context);
  context.subscriptions.push(
    log,
    registerFormatter(log),
    ...registerNavigation(session),
    ...registerEditing(session),
    ...registerSyntaxErrors(),
  );
}

export function deactivate() {}
