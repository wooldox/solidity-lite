# Changelog

## 0.4.0

First public release.

- Syntax highlighting, including NatSpec tags, constants, variables and Solidity code blocks in Markdown.
- Hover with signatures, NatSpec and ABI selectors; Go to Definition; Find All References; highlights.
- Built-ins (`msg`, `abi`, `keccak256`, units, members of built-in types, Yul) documented in `builtins/globals.sol`.
- Autocomplete, parameter hints, rename (with overrides and `@param` lines) and a `///` NatSpec template.
- Outline, Go to Symbol in Workspace, call hierarchy and type hierarchy.
- Syntax errors while typing, from the parser alone.
- Format Document through `forge fmt`.
