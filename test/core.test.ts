import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import { hoverMarkdown } from "../src/core/hover";
import { parseFile, type Decl } from "../src/core/model";
import { docCommentBefore, parseNatSpec } from "../src/core/natspec";
import { outline } from "../src/core/outline";
import { findReferences } from "../src/core/references";
import { Resolver } from "../src/core/resolve";
import { qualifierBefore } from "../src/core/text";
import { Workspace } from "../src/core/workspace";

const root = path.join(__dirname, "..", "test", "fixtures", "project");
const FARM = path.join(root, "src", "Farm.sol");
const MESSAGES = path.join(root, "src", "Messages.sol");

const BUILTINS = path.join(__dirname, "..", "builtins", "globals.sol");
const ws = new Workspace();
const resolver = new Resolver(ws, BUILTINS);

/** Line of the first `snippet` (after `after`) in globals.sol, so tests survive edits to that file. */
function gl(snippet: string, after = ""): number {
  const text = readFileSync(BUILTINS, "utf8");
  const i = text.indexOf(snippet, after ? text.indexOf(after) : 0);
  assert.notEqual(i, -1, snippet);
  return text.slice(0, i).split("\n").length;
}

/** Offset of `word` inside the first occurrence of `snippet` in the file. */
function at(file: string, snippet: string, word: string): number {
  const text = ws.get(file)!.text;
  const s = text.indexOf(snippet);
  assert.notEqual(s, -1, `snippet not found: ${snippet}`);
  const w = snippet.indexOf(word);
  assert.notEqual(w, -1, `word not in snippet: ${word}`);
  return s + w + 1;
}

function lookup(file: string, snippet: string, word: string): Decl[] {
  const result = resolver.lookup(ws.get(file)!, at(file, snippet, word));
  assert.ok(result?.kind === "decls", `no declaration at ${word} in ${snippet}`);
  return result.decls;
}

function where(d: Decl): string {
  const line = d.file.text.slice(0, d.nameStart).split("\n").length;
  return `${path.basename(d.file.path)}:${line} ${d.kind} ${d.parent ? `${d.parent.name}.` : ""}${d.name}`;
}

test("parses declarations with name ranges", () => {
  const file = ws.get(MESSAGES)!;
  const lib = file.decls[0];
  assert.equal(lib.kind, "library");
  assert.equal(file.text.slice(lib.nameStart, lib.nameEnd), "Messages");
  const hashes = lib.children.filter((c) => c.name === "hash");
  assert.equal(hashes.length, 2);
  for (const h of hashes) assert.equal(file.text.slice(h.nameStart, h.nameEnd), "hash");
});

test("keeps offsets right after astral characters", () => {
  const file = ws.get(FARM)!;
  const farm = file.decls.find((d) => d.name === "Farm")!;
  assert.equal(file.text.slice(farm.nameStart, farm.nameEnd), "Farm");
});

test("reparses with the edited line blanked", () => {
  const text = "contract A {\n  function f(uint a) public {\n    a.\n  }\n}\n";
  assert.ok(parseFile("x.sol", text, text.indexOf("a.") + 2));
  assert.equal(parseFile("x.sol", text), undefined);
});

test("qualifier chains", () => {
  const text = "x = plots[msg.sender][0].price.add(";
  assert.deepEqual(qualifierBefore(text, text.indexOf("add")), [
    { kind: "name", name: "plots" },
    { kind: "index" },
    { kind: "index" },
    { kind: "name", name: "price" },
  ]);
  assert.equal(qualifierBefore("foo", 0), undefined);
});

test("NatSpec from /// and /** */", () => {
  const file = ws.get(path.join(root, "lib/solady/src/auth/Ownable.sol"))!;
  const fn = file.all.find((d) => d.name === "transferOwnership")!;
  const spec = parseNatSpec(docCommentBefore(file.text, fn.start)!);
  assert.equal(spec.dev, "Allows the owner to transfer the ownership to `newOwner`.");
  assert.equal(spec.params.get("newOwner"), "The new owner.");
});

test("resolves imports through remappings", () => {
  assert.equal(ws.resolveImport(FARM, "solady/auth/Ownable.sol"), path.join(root, "lib/solady/src/auth/Ownable.sol"));
  assert.equal(ws.resolveImport(FARM, "@other/Units.sol"), path.join(root, "lib/other/contracts/Units.sol"));
  assert.equal(ws.resolveImport(FARM, "./Messages.sol"), MESSAGES);
  assert.equal(ws.resolveImport(FARM, "missing/X.sol"), undefined);
});

test("import path jumps to the file", () => {
  const result = resolver.lookup(ws.get(FARM)!, at(FARM, '"solady/auth/Ownable.sol"', "auth"));
  assert.deepEqual(result && result.kind === "import" && result.path, path.join(root, "lib/solady/src/auth/Ownable.sol"));
});

const cases: [string, string, string, string[]][] = [
  // [snippet, word, description, expected locations]
  ["contract Farm is Ownable", "Ownable", "base contract from a lib", ["Ownable.sol:5 contract Ownable"]],
  ["external onlyOwner", "onlyOwner", "inherited modifier", ["Ownable.sol:21 modifier Ownable.onlyOwner"]],
  ["using M for M.Intent", "Intent", "struct through an aliased import", ["Messages.sol:8 struct Messages.Intent"]],
  ["digest = M.hash(intent)", "hash", "overload picked by argument type", ["Messages.sol:26 function Messages.hash"]],
  ["M.hash(permit)", "hash", "the other overload", ["Messages.sol:31 function Messages.hash"]],
  ["intent.hash()", "hash", "function attached with using-for", ["Messages.sol:26 function Messages.hash"]],
  ["intent.deadline +", "deadline", "struct field through a parameter", ["Messages.sol:11 field Intent.deadline"]],
  ["intent.deadline +", "intent", "parameter", ["Farm.sol:38 parameter plant.intent"]],
  ["plots[msg.sender][0].seed", "seed", "field through mapping and array", ["Farm.sol:19 field Plot.seed"]],
  [".price.add(", "add", "global using-for free function", ["Units.sol:7 function add"]],
  ["Units.Price.wrap", "Price", "type through a unit alias", ["Units.sol:5 userType Price"]],
  ["Phase.Open;", "Open", "enum member", ["Farm.sol:15 enumValue Phase.Open"]],
  ["emit Planted(", "Planted", "event", ["Farm.sol:24 event Farm.Planted"]],
  ["revert Expired(", "Expired", "error", ["Farm.sol:26 error Farm.Expired"]],
  ["+ ONE_DAY", "ONE_DAY", "file-level constant from an import", ["Units.sol:13 constant ONE_DAY"]],
  ["this.owner()", "owner", "this. picks the override", ["Farm.sol:55 function Farm.owner"]],
  ["super.owner()", "owner", "super. skips to the base", ["Ownable.sol:10 function Ownable.owner"]],
  ["transferOwnership(address(this))", "transferOwnership", "inherited function", ["Ownable.sol:18 function Ownable.transferOwnership"]],
  ["        seed;", "seed", "local variable", ["Farm.sol:43 localVariable plant.seed"]],
  ["_signer = signer_", "_signer", "state variable", ["Farm.sol:30 stateVariable Farm._signer"]],
  ["_signer = signer_", "signer_", "constructor parameter", ["Farm.sol:32 parameter constructor.signer_"]],
];

for (const [snippet, word, description, expected] of cases) {
  test(`definition: ${description}`, () => {
    assert.deepEqual(lookup(FARM, snippet, word).map(where), expected);
  });
}

test("nothing inside comments and strings", () => {
  const file = ws.get(FARM)!;
  assert.equal(resolver.lookup(file, at(FARM, "/// @notice The farm.", "farm")), undefined);
});

test("declaration names resolve to themselves", () => {
  assert.deepEqual(lookup(MESSAGES, "function _hashIds", "_hashIds").map(where), ["Messages.sol:35 function Messages._hashIds"]);
});

test("hover: function with NatSpec", () => {
  const md = hoverMarkdown(resolver, lookup(FARM, "digest = M.hash(intent)", "hash"), FARM);
  assert.equal(
    md,
    [
      "```solidity",
      "// in Messages · Messages.sol",
      "function hash(Intent memory m) internal pure returns (bytes32)",
      "```",
      "",
      "Struct hash of an intent.",
      "",
      "*@param* `m` — The intent.  \n*@return* — The EIP-712 struct hash.",
    ].join("\n"),
  );
});

test("hover: struct shows its fields", () => {
  const md = hoverMarkdown(resolver, lookup(FARM, "using M for M.Intent", "Intent"), FARM);
  assert.match(md, /struct Intent \{\n {4}address player;\n {4}uint256\[\] seedIds;\n {4}uint256 deadline;\n\}/);
  assert.match(md, /Plants one Seed per `seedIds` entry\./);
});

test("hover: parameter takes its @param line", () => {
  const md = hoverMarkdown(resolver, lookup(FARM, "intent.deadline +", "intent"), FARM);
  assert.match(md, /\/\/ parameter of plant\nM\.Intent calldata intent\n```\n\nThe signed intent\./);
});

test("hover: struct field takes the struct's @param line", () => {
  const permit = ws.get(MESSAGES)!.all.find((d) => d.name === "plantingIds")!;
  assert.match(hoverMarkdown(resolver, [permit], MESSAGES), /The plantings to fertilize\.$/);
});

test("hover: override without NatSpec borrows the base's", () => {
  const md = hoverMarkdown(resolver, lookup(FARM, "this.owner()", "owner"), FARM);
  assert.match(md, /Returns the owner of the contract\./);
});

test("hover: long constant initializers are cut", () => {
  const typehash = ws.get(MESSAGES)!.all.find((d) => d.name === "INTENT_TYPEHASH")!;
  assert.match(hoverMarkdown(resolver, [typehash], MESSAGES), /\nbytes32 internal constant INTENT_TYPEHASH\n/);
});

test("outline", () => {
  const items = outline(ws.get(FARM)!);
  const farm = items[0];
  assert.equal(farm.decl.name, "Farm");
  const names = farm.children.map((c) => `${c.decl.kind} ${c.decl.name} ${c.detail}`.trim());
  assert.deepEqual(names, [
    "enum Phase",
    "struct Plot",
    "event Planted (address, bytes32)",
    "error Expired (uint256)",
    "stateVariable plots mapping(address => Plot[])",
    "stateVariable phase Phase",
    "stateVariable _signer address",
    "constructor constructor (address)",
    "function plant (M.Intent, M.Permit) → bytes32",
    "function owner () → address",
  ]);
  assert.deepEqual(
    farm.children[1].children.map((c) => c.decl.name),
    ["seed", "price"],
  );
});

test("member chains do not reach into comments", () => {
  const text = "contract A {\n  uint x;\n  function f() public {\n    // done.\n    x;\n  }\n}\n";
  const file = parseFile("/virtual/A.sol", text)!;
  const result = resolver.lookup(file, text.indexOf("x;\n  }"));
  assert.ok(result?.kind === "decls");
  assert.equal(result.decls[0].kind, "stateVariable");
});

test("argument counts ignore commas in strings", () => {
  const text = 'contract A {\n  function g(string memory s) public {}\n  function g(string memory s, uint n) public {}\n  function f() public { g("a,b"); }\n}\n';
  const file = parseFile("/virtual/A.sol", text)!;
  const result = resolver.lookup(file, text.indexOf('g("a,b")'));
  assert.ok(result?.kind === "decls");
  assert.equal(result.decls.length, 1);
  assert.equal(result.decls[0].children.length, 1);
});

test("overloads picked by the type of a call argument", () => {
  const text = [
    "library L { struct A { uint x; } struct B { uint y; }",
    "  function h(A memory a) internal pure returns (uint) { return a.x; }",
    "  function h(B memory b) internal pure returns (uint) { return b.y; } }",
    "contract C { function mkB() internal pure returns (L.B memory b) {}",
    "  function f(L.B[] memory bs) public { L.h(mkB()); L.h(bs[0]); } }",
  ].join("\n");
  const file = parseFile("/virtual/C.sol", text)!;
  for (const call of ["L.h(mkB())", "L.h(bs[0])"]) {
    const result = resolver.lookup(file, text.indexOf(call) + 2);
    assert.ok(result?.kind === "decls");
    assert.deepEqual(result.decls.map((d) => d.children[0].name), ["b"], call);
  }
});

test("unnamed parameters count for overloads", () => {
  const text = "interface I { function f(uint256) external; function f(uint256, address) external; }\ncontract C { function g(I i) public { i.f(1, address(0)); } }";
  const file = parseFile("/virtual/I.sol", text)!;
  const result = resolver.lookup(file, text.indexOf("f(1,"));
  assert.ok(result?.kind === "decls");
  assert.equal(result.decls.length, 1);
  assert.equal(result.decls[0].children.length, 2);
});

test("built-in globals resolve to globals.sol", () => {
  assert.deepEqual(lookup(MESSAGES, "return keccak256(abi.encodePacked", "keccak256").map(where), [`globals.sol:${gl("function keccak256(bytes")} function keccak256`]);
  assert.deepEqual(lookup(MESSAGES, "abi.encode(INTENT_TYPEHASH", "abi").map(where), [`globals.sol:${gl("library abi")} library abi`]);
  assert.deepEqual(lookup(MESSAGES, "abi.encode(INTENT_TYPEHASH", "encode").map(where), [`globals.sol:${gl("function encode(")} function abi.encode`]);
  assert.deepEqual(lookup(FARM, "block.timestamp >", "timestamp").map(where), [`globals.sol:${gl("uint256 timestamp;")} stateVariable block.timestamp`]);
  assert.deepEqual(lookup(FARM, "plots[msg.sender]", "sender").map(where), [`globals.sol:${gl("address sender;")} stateVariable msg.sender`]);
});

test("members of built-in types", () => {
  const text = [
    "contract C {",
    "  uint256[] xs;",
    "  function f(address a) public returns (uint256) {",
    "    xs.push(a.balance);",
    "    bytes memory b = bytes.concat(bytes1(0x01));",
    "    return xs.length + address(this).balance + type(uint8).max + b.length;",
    "  }",
    "}",
  ].join("\n");
  const file = parseFile("/virtual/C.sol", text)!;
  const at = (snippet: string, word: string) => {
    const result = resolver.lookup(file, text.indexOf(snippet) + snippet.indexOf(word) + 1);
    return result?.kind === "decls" ? result.decls.map(where) : [];
  };
  assert.deepEqual(at("xs.push(", "push"), [`globals.sol:${gl("function push(/* T */")} function $array.push`]);
  assert.deepEqual(at("a.balance", "balance"), [`globals.sol:${gl("uint256 balance;")} stateVariable $address.balance`]);
  assert.deepEqual(at("bytes.concat", "concat"), [`globals.sol:${gl("function concat(/* ...args */) pure returns (bytes")} function $bytes.concat`]);
  assert.deepEqual(at("xs.length +", "length"), [`globals.sol:${gl("    uint256 length;")} stateVariable $array.length`]);
  assert.deepEqual(at("address(this).balance", "balance"), [`globals.sol:${gl("uint256 balance;")} stateVariable $address.balance`]);
  assert.deepEqual(at("type(uint8).max", "max"), [`globals.sol:${gl("uint256 max;")} stateVariable $type.max`]);
  assert.deepEqual(at("b.length", "length"), [`globals.sol:${gl("    uint256 length;")} stateVariable $array.length`]);
});

test("hover: built-ins", () => {
  const md = hoverMarkdown(resolver, lookup(MESSAGES, "abi.encode(INTENT_TYPEHASH", "encode"), MESSAGES);
  assert.match(md, /^```solidity\n\/\/ built-in · abi\.encode\nfunction encode\(\/\* \.\.\.args \*\/\) pure returns \(bytes memory\)\n```\n\nABI-encodes/);
});

test("own names shadow built-ins", () => {
  const text = "contract C { function keccak256(bytes memory) internal pure returns (bytes32) {} function f() public { keccak256(''); } }";
  const file = parseFile("/virtual/C.sol", text)!;
  const result = resolver.lookup(file, text.lastIndexOf("keccak256"));
  assert.ok(result?.kind === "decls");
  assert.equal(result.decls[0].file.path, "/virtual/C.sol");
});

const refs = (file: string, snippet: string, word: string, candidates = [FARM, MESSAGES]) =>
  findReferences(ws, resolver, lookup(file, snippet, word)[0], candidates).map(
    (r) => `${path.basename(r.file.path)}:${r.file.text.slice(0, r.start).split("\n").length}${r.isDeclaration ? " (declaration)" : ""}`,
  );

test("references: overloaded library function across files", () => {
  assert.deepEqual(refs(MESSAGES, "function hash(Intent", "hash"), ["Messages.sol:26 (declaration)", "Farm.sol:40", "Farm.sol:41"]);
});

test("references: struct used through an alias", () => {
  assert.deepEqual(refs(MESSAGES, "struct Intent", "Intent"), ["Messages.sol:8 (declaration)", "Messages.sol:26", "Farm.sol:11", "Farm.sol:38"]);
});

test("references: local variable stays in its function", () => {
  assert.deepEqual(refs(FARM, "uint256 seed =", "seed"), ["Farm.sol:43 (declaration)", "Farm.sol:49"]);
});

const BUILTIN_SAMPLE = [
  "type Price is uint128;",
  "contract C {",
  "  error Nope();",
  "  event Done(uint256 id);",
  "  uint256 stored;",
  "  function f(bytes32 h) external returns (uint256 r) {",
  "    Price p = Price.wrap(1);",
  "    uint256 u = Price.unwrap(p) + h.length + 1 days + 2 ether;",
  "    bytes4 a = this.f.selector;",
  "    bytes4 b = Nope.selector;",
  "    bytes32 c = Done.selector;",
  "    assembly {",
  "      function double(x) -> y { y := add(x, x) }",
  "      let ptr := mload(0x40)",
  "      mstore(ptr, keccak256(ptr, 32))",
  "      r := double(sload(stored.slot))",
  "      return(ptr, 32)",
  "    }",
  "    r = uint256(keccak256(abi.encode(u, a, b, c)));",
  "  }",
  "}",
].join("\n");

function sample(snippet: string, word: string, nth = 0): Decl[] {
  const file = parseFile("/virtual/B.sol", BUILTIN_SAMPLE)!;
  let i = -1;
  for (let k = 0; k <= nth; k++) i = BUILTIN_SAMPLE.indexOf(snippet, i + 1);
  assert.notEqual(i, -1, snippet);
  const result = resolver.lookup(file, i + snippet.indexOf(word) + 1);
  return result?.kind === "decls" ? result.decls : [];
}

test("more built-ins: wrap, selectors, fixed bytes, units", () => {
  const g = (d: Decl[]) => d.map(where);
  assert.deepEqual(g(sample("Price.wrap(1)", "wrap")), [`globals.sol:${gl("function wrap(")} function $userType.wrap`]);
  assert.deepEqual(g(sample("Price.unwrap(p)", "unwrap")), [`globals.sol:${gl("function unwrap(")} function $userType.unwrap`]);
  assert.deepEqual(g(sample("h.length", "length")), [`globals.sol:${gl("uint8 length;")} stateVariable $fixedBytes.length`]);
  assert.deepEqual(g(sample("1 days", "days")), [`globals.sol:${gl("days_ =")} constant days`]);
  assert.deepEqual(g(sample("2 ether", "ether")), [`globals.sol:${gl("ether_ =")} constant ether`]);
  assert.deepEqual(g(sample("this.f.selector", "selector")), [`globals.sol:${gl("bytes4 selector;")} stateVariable $function.selector`]);
  assert.deepEqual(g(sample("Nope.selector", "selector")), [`globals.sol:${gl("bytes4 selector;", "library $error")} stateVariable $error.selector`]);
  assert.deepEqual(g(sample("Done.selector", "selector")), [`globals.sol:${gl("bytes32 selector;")} stateVariable $event.selector`]);
});

test("this and super", () => {
  assert.deepEqual(sample("this.f.selector", "this").map(where), ["B.sol:2 contract C"]);
  assert.deepEqual(lookup(FARM, "super.owner()", "super").map(where), ["Ownable.sol:5 contract Ownable"]);
});

test("assembly: Yul built-ins, locals, functions and .slot", () => {
  const g = (d: Decl[]) => d.map(where);
  assert.deepEqual(g(sample("let ptr := mload", "mload")), [`globals.sol:${gl("function mload(")} function $yul.mload`]);
  assert.deepEqual(g(sample("keccak256(ptr, 32)", "keccak256")), [`globals.sol:${gl("function keccak256(uint256 p")} function $yul.keccak256`]);
  assert.deepEqual(g(sample("uint256(keccak256(abi", "keccak256")), [`globals.sol:${gl("function keccak256(bytes")} function keccak256`]);
  assert.deepEqual(g(sample("mstore(ptr,", "ptr")), ["B.sol:14 localVariable f.ptr"]);
  assert.deepEqual(g(sample("r := double(", "double")), ["B.sol:13 function f.double"]);
  assert.deepEqual(g(sample("add(x, x)", "x")), ["B.sol:13 parameter double.x"]);
  assert.deepEqual(g(sample("r := double", "r")), ["B.sol:6 returnParameter f.r"]);
  assert.deepEqual(g(sample("stored.slot", "slot")), [`globals.sol:${gl("uint256 slot;")} stateVariable $assemblyAccess.slot`]);
  assert.deepEqual(g(sample("stored.slot", "stored")), ["B.sol:5 stateVariable C.stored"]);
  assert.deepEqual(g(sample("return(ptr, 32)", "return")), [`globals.sol:${gl("function return_(")} function $yul.return`]);
});

test("hover: Yul built-in, assembly local and unit", () => {
  const md = (d: Decl[]) => hoverMarkdown(resolver, d, "/virtual/B.sol");
  assert.match(md(sample("let ptr := mload", "mload")), /^```solidity\n\/\/ built-in · assembly\nmload\(p\) -> v\n```\n\nLoads the word/);
  assert.match(md(sample("return(ptr, 32)", "return")), /\nreturn\(p, s\)\n/);
  assert.match(md(sample("mstore(ptr,", "ptr")), /\/\/ local variable in f\nlet ptr\n/);
  assert.match(md(sample("1 days", "days")), /\/\/ built-in\nuint256 constant days = 86400\n/);
});
