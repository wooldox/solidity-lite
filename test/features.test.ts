import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import { syntaxErrors } from "../src/core/diagnostics";
import { incomingCalls, outgoingCalls, subtypes, supertypes } from "../src/core/hierarchy";
import { hoverMarkdown } from "../src/core/hover";
import { parseFile, type Decl } from "../src/core/model";
import { natSpecTemplate } from "../src/core/natspec";
import { renameEdits, validName } from "../src/core/rename";
import { Resolver } from "../src/core/resolve";
import { selectorOf } from "../src/core/selectors";
import { signatureHelp } from "../src/core/signatureHelp";
import { fuzzy, workspaceSymbols } from "../src/core/symbols";
import { Workspace } from "../src/core/workspace";

const root = path.join(__dirname, "..", "test", "fixtures", "project");
const FARM = path.join(root, "src", "Farm.sol");
const MESSAGES = path.join(root, "src", "Messages.sol");
const OWNABLE = path.join(root, "lib/solady/src/auth/Ownable.sol");
const PROJECT = [FARM, MESSAGES];

const ws = new Workspace();
const resolver = new Resolver(ws, path.join(__dirname, "..", "builtins", "globals.sol"));

const decl = (file: string, name: string, kind?: string): Decl => {
  const d = ws.get(file)!.all.find((x) => x.name === name && (!kind || x.kind === kind));
  assert.ok(d, `${name} not found`);
  return d;
};
const offsetOf = (text: string, snippet: string, word = snippet) => text.indexOf(snippet) + snippet.indexOf(word);

test("selectors: functions, getters, errors, events", () => {
  const sel = (file: string, name: string, kind?: string) => selectorOf(resolver, decl(file, name, kind));
  assert.deepEqual(sel(FARM, "owner", "function"), { signature: "owner()", hash: "0x8da5cb5b", kind: "selector" });
  assert.equal(sel(FARM, "plant")?.signature, "plant((address,uint256[],uint256),(address,uint256[]))");
  assert.equal(sel(FARM, "plots")?.signature, "plots(address,uint256)");
  assert.equal(sel(FARM, "Expired")?.signature, "Expired(uint256)");
  assert.deepEqual(sel(OWNABLE, "Unauthorized"), { signature: "Unauthorized()", hash: "0x82b42900", kind: "selector" });
  assert.equal(sel(FARM, "Planted")?.kind, "topic0");
  assert.equal(sel(FARM, "Planted")?.hash.length, 66);
  assert.equal(sel(MESSAGES, "hash"), undefined, "internal library functions have no selector");
  assert.equal(sel(FARM, "_signer"), undefined, "private state variables have no getter");

  const text = "interface IERC20 { function transfer(address to, uint256 amount) external returns (bool); event Transfer(address indexed from, address indexed to, uint256 value); }";
  const file = parseFile("/virtual/IERC20.sol", text)!;
  const of = (name: string) => selectorOf(resolver, file.all.find((d) => d.name === name)!);
  assert.equal(of("transfer")?.hash, "0xa9059cbb");
  assert.equal(of("Transfer")?.hash, "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef");
});

test("selectors appear in hovers", () => {
  assert.match(hoverMarkdown(resolver, [decl(FARM, "owner", "function")], FARM), /\nselector `0x8da5cb5b` · `owner\(\)`\n/);
});

test("signature help: overloads, active parameter, @param docs", () => {
  const file = ws.get(FARM)!;
  const help = signatureHelp(resolver, file, offsetOf(file.text, "M.hash(intent)", "intent"))!;
  assert.deepEqual(
    help.signatures.map((s) => s.label),
    ["hash(Intent memory m) returns (bytes32)", "hash(Permit memory p) returns (bytes32)"],
  );
  assert.equal(help.activeParameter, 0);
  const first = help.signatures[0];
  assert.equal(first.label.slice(...first.parameters[0].range), "Intent memory m");
  assert.equal(first.parameters[0].doc, "The intent.");
  assert.match(first.doc ?? "", /Struct hash of an intent\./);

  const second = signatureHelp(resolver, file, offsetOf(file.text, "emit Planted(intent.player, digest", "digest"))!;
  assert.equal(second.activeParameter, 1);
  assert.equal(second.signatures[0].label, "Planted(address indexed player, bytes32 digest)");
});

test("signature help: using-for skips the receiver, built-ins, Yul", () => {
  const file = ws.get(FARM)!;
  const attached = signatureHelp(resolver, file, offsetOf(file.text, "intent.hash()", "()") + 1)!;
  assert.equal(attached.signatures[0].label, "hash() returns (bytes32)");

  const text = "contract C { function f(bytes memory b) public { keccak256(b); assembly { mstore(0, 1) } } }";
  const c = parseFile("/virtual/C.sol", text)!;
  assert.equal(signatureHelp(resolver, c, offsetOf(text, "keccak256(b", "b"))!.signatures[0].label, "keccak256(bytes memory data) returns (bytes32)");
  const yul = signatureHelp(resolver, c, offsetOf(text, "mstore(0, 1", "1"))!;
  assert.equal(yul.signatures[0].label, "mstore(p, v)");
  assert.equal(yul.activeParameter, 1);
  assert.equal(signatureHelp(resolver, c, offsetOf(text, "public {")), undefined);
});

test("completion: members after a dot", () => {
  const names = (typed: string) => {
    const text = [
      'import {Messages as M} from "./Messages.sol";',
      "contract C {",
      "  using M for M.Intent;",
      "  function f(M.Intent memory intent, address a) public {",
      `    ${typed}`,
      "  }",
      "}",
    ].join("\n");
    const offset = text.indexOf(typed) + typed.length;
    const file = parseFile(path.join(root, "src", "C.sol"), text, offset)!;
    return resolver
      .completions(file, offset)!
      .entries.map((e) => e.name)
      .sort();
  };
  assert.deepEqual(names("intent."), ["deadline", "hash", "player", "seedIds"]);
  assert.deepEqual(names("intent.pl"), ["deadline", "hash", "player", "seedIds"]);
  assert.deepEqual(names("a.").filter((n) => n === "balance" || n === "call"), ["balance", "call"]);
  assert.deepEqual(names("M."), ["INTENT_TYPEHASH", "Intent", "Permit", "_hashIds", "hash", "hash"]);
});

test("completion: names in scope, innermost first, with built-ins", () => {
  const file = ws.get(FARM)!;
  const result = resolver.completions(file, offsetOf(file.text, "        seed;"))!;
  const names = result.entries.map((e) => e.name);
  assert.equal(result.afterDot, false);
  assert.ok(names.indexOf("seed") < names.indexOf("plots"), "locals before members");
  assert.ok(names.indexOf("plots") < names.indexOf("Price"), "members before imports");
  for (const n of ["intent", "transferOwnership", "M", "ONE_DAY", "keccak256", "msg"]) {
    assert.ok(names.includes(n) || result.namespaces.includes(n), n);
  }
  assert.ok(result.namespaces.includes("Units"));
  assert.ok(!names.includes("$yul") && !names.includes("mload"), "no Yul outside assembly");
  assert.equal(resolver.completions(file, offsetOf(file.text, "/// @notice The farm.") + 8), undefined, "nothing in comments");
});

test("syntax errors with positions, even when the parser crashes", () => {
  assert.deepEqual(syntaxErrors("contract A { function f() public {} }"), []);
  const errors = syntaxErrors("contract A {\n  function f( {\n  }\n}");
  assert.ok(errors.length >= 1);
  assert.deepEqual([errors[0].line, errors[0].column], [1, 14]);
  assert.match(errors[0].message, /^Unexpected '\{'/);
  assert.ok(errors[0].message.length < 60, errors[0].message);
});

test("workspace symbols", () => {
  const names = (q: string) => workspaceSymbols(ws, PROJECT, q).map((d) => `${d.parent ? `${d.parent.name}.` : ""}${d.name}`);
  assert.deepEqual(names("plant"), ["Farm.Planted", "Farm.plant"]);
  assert.ok(names("ITH").includes("Messages.INTENT_TYPEHASH"));
  assert.ok(fuzzy("tow", "transferOwnership") && !fuzzy("xyz", "transferOwnership"));
});

test("call hierarchy", () => {
  const hash = ws.get(MESSAGES)!.all.find((d) => d.name === "hash")!;
  const incoming = incomingCalls(ws, resolver, hash, PROJECT);
  assert.deepEqual(
    incoming.map((g) => `${g.decl.name} ×${g.ranges.length}`),
    ["plant ×2"],
  );
  const outgoing = outgoingCalls(resolver, decl(FARM, "plant"))
    .map((g) => `${g.decl.parent?.name ?? ""}.${g.decl.name}`)
    .sort();
  assert.deepEqual(outgoing, ["$userType.wrap", ".add", "Farm.owner", "Messages.hash", "Messages.hash", "Ownable.onlyOwner", "Ownable.transferOwnership"]);
});

test("type hierarchy", () => {
  const ownable = decl(OWNABLE, "Ownable");
  assert.deepEqual(subtypes(ws, resolver, ownable, PROJECT).map((d) => d.name), ["Farm"]);
  assert.deepEqual(supertypes(resolver, decl(FARM, "Farm")).map((d) => d.name), ["Ownable"]);
});

test("rename: references, aliases untouched, @param lines", () => {
  const intent = decl(FARM, "intent", "parameter");
  const edits = renameEdits(ws, resolver, intent, "signed", PROJECT, () => true);
  assert.ok(Array.isArray(edits));
  const text = ws.get(FARM)!.text;
  const renamed = applyEdits(text, edits.filter((e) => e.path === FARM));
  assert.match(renamed, /@param signed The signed intent\./);
  assert.match(renamed, /M\.Intent calldata signed,/);
  assert.match(renamed, /M\.hash\(signed\)/);
  assert.match(renamed, /bytes32 again = signed\.hash\(\);/);
  assert.doesNotMatch(renamed, /M\.hash\(intent\)/);

  const struct = renameEdits(ws, resolver, decl(MESSAGES, "Intent", "struct"), "PlantIntent", PROJECT, () => true);
  assert.ok(Array.isArray(struct));
  assert.deepEqual(struct.map((e) => `${path.basename(e.path)}:${ws.get(e.path)!.text.slice(0, e.start).split("\n").length}`).sort(), [
    "Farm.sol:11",
    "Farm.sol:38",
    "Messages.sol:26",
    "Messages.sol:8",
  ]);
});

test("rename: overrides move together, dependencies and bad names are refused", () => {
  const farmOwner = decl(FARM, "owner", "function");
  const blocked = renameEdits(ws, resolver, farmOwner, "boss", PROJECT, (p) => !p.includes("/lib/"));
  assert.deepEqual(blocked, { error: "owner overrides Ownable.owner, declared in a dependency." });

  const all = renameEdits(ws, resolver, farmOwner, "boss", PROJECT, () => true);
  assert.ok(Array.isArray(all));
  assert.ok(all.some((e) => e.path === OWNABLE), "base declaration renamed too");
  assert.ok(all.some((e) => e.path === FARM && ws.get(FARM)!.text.slice(e.start - 6, e.start) === "super."));

  assert.equal(validName("mapping"), "'mapping' is a reserved word.");
  assert.equal(validName("2x"), "'2x' is not a valid identifier.");
  assert.equal(validName("ok_name$"), undefined);
});

test("/// template documents the declaration below", () => {
  const file = ws.get(FARM)!;
  const constructorLine = file.text.indexOf("    constructor(");
  assert.equal(
    natSpecTemplate(file, constructorLine - 1, "    "),
    ["/// @dev ${1}", "    /// @param signer_ ${2}"].join("\n"),
  );
  assert.equal(natSpecTemplate(file, file.text.indexOf("    uint256 seed = ") - 1, "        "), undefined, "statements are not declarations");

  const text = "contract X {\n    ///\n    function f(uint256 a, address) external returns (bool ok, uint256) {}\n}";
  const x = parseFile("/virtual/X.sol", text)!;
  assert.equal(
    natSpecTemplate(x, text.indexOf("///") + 3, "    "),
    ["/// @notice ${1}", "    /// @param a ${2}", "    /// @return ok ${3}", "    /// @return ${4}"].join("\n"),
  );
  const lib = parseFile("/virtual/L.sol", "///\nlibrary L {}")!;
  assert.equal(natSpecTemplate(lib, 3, ""), "/// @title ${1:L}\n/// @notice ${2}");
});

function applyEdits(text: string, edits: { start: number; end: number; text: string }[]): string {
  for (const e of [...edits].sort((a, b) => b.start - a.start)) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}
