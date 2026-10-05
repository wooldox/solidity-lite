// Syntax errors from the parser alone: no compiler, so typos and brackets, not types.

import { parse, ParserError } from "@solidity-parser/parser";

export interface SyntaxError {
  /** Zero-based. */
  line: number;
  column: number;
  length: number;
  message: string;
}

const MAX_ERRORS = 20;

export function syntaxErrors(text: string): SyntaxError[] {
  try {
    parse(text);
    return [];
  } catch (err) {
    if (!(err instanceof ParserError)) return [];
    const lines = text.split("\n");
    return err.errors.slice(0, MAX_ERRORS).map((e: { message: string; line: number; column: number }) => {
      const line = Math.max(0, e.line - 1);
      const rest = (lines[line] ?? "").slice(e.column);
      const token = /^[\w$]+|^\S/.exec(rest)?.[0] ?? "";
      return { line, column: e.column, length: Math.max(token.length, 1), message: friendly(e.message) };
    });
  }
}

/** ANTLR's messages list every token it would accept; keep them short when that list is long. */
export function friendly(message: string): string {
  const m = /^(mismatched|extraneous) input '(.*)' expecting (.*)$/s.exec(message);
  if (m) {
    const found = m[2] === "<EOF>" ? "end of file" : `'${m[2]}'`;
    const options = m[3].startsWith("{") ? m[3].slice(1, -1).split(", ") : [m[3]];
    const expected = options.length <= 4 ? `, expected ${options.join(" or ")}` : "";
    return `Unexpected ${found}${expected}`;
  }
  const missing = /^missing (.*) at '(.*)'$/s.exec(message);
  if (missing) return `Missing ${missing[1]} before '${missing[2]}'`;
  const noViable = /^no viable alternative at input '(.*)'$/s.exec(message);
  if (noViable) return `Syntax error near '${noViable[1].split(/\s+/).slice(-3).join(" ")}'`;
  return message.charAt(0).toUpperCase() + message.slice(1);
}
