// Bundles the extension (or, with --test, the tests) with esbuild.
// Patches @solidity-parser/parser so a crash while building the AST of broken code still
// reports the syntax errors it collected (with positions), instead of a bare TypeError.
import { build, context } from "esbuild";
import { readFile } from "node:fs/promises";

const PARSER_ENTRY = /@solidity-parser[\\/]parser[\\/]dist[\\/]index\.cjs\.js$/;
const ORIGINAL = "  astBuilder.visit(sourceUnit);\n";
const PATCHED =
  "  try { astBuilder.visit(sourceUnit); } catch (e) {\n" +
  "    if (listener.hasErrors()) throw new ParserError({ errors: listener.getErrors() });\n" +
  "    throw e;\n" +
  "  }\n";

const keepParserErrors = {
  name: "keep-parser-errors",
  setup(b) {
    b.onLoad({ filter: PARSER_ENTRY }, async (args) => {
      const source = await readFile(args.path, "utf8");
      if (!source.includes(ORIGINAL)) throw new Error("@solidity-parser/parser changed: update scripts/build.mjs");
      return { contents: source.replace(ORIGINAL, PATCHED), loader: "js" };
    });
  },
};

const args = process.argv.slice(2);
const test = args.includes("--test");
const options = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node18",
  plugins: [keepParserErrors],
  logLevel: "warning",
  ...(test
    ? { entryPoints: ["test/*.test.ts"], outdir: "out-test" }
    : {
        entryPoints: ["src/extension.ts"],
        outfile: "out/extension.js",
        external: ["vscode"],
        sourcemap: true,
        minify: args.includes("--minify"),
      }),
};

if (args.includes("--watch")) await (await context(options)).watch();
else await build(options);
