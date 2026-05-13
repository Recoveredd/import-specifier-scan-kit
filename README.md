# import-specifier-scan-kit

Scan JavaScript source text for literal module specifiers from `import`, `export ... from`, dynamic `import()`, and `require()` calls.

It is intentionally small: no AST, no runtime dependencies, no Node-only APIs, and no attempt to evaluate JavaScript. Use it when you need a quick browser-friendly dependency hint with spans and diagnostics.

## Install

```bash
npm install import-specifier-scan-kit
```

## Usage

```ts
import { scanImportSpecifiers } from "import-specifier-scan-kit";

const result = scanImportSpecifiers(`
  import read from "read-pkg";
  import "./setup.css";
  export { helper } from "@acme/tools";
  const view = await import("./view.js");
  const legacy = require("legacy-package");
`);

console.log(result.specifiers);
// [
//   { kind: "static-import", specifier: "read-pkg", ... },
//   { kind: "side-effect-import", specifier: "./setup.css", ... },
//   { kind: "export-from", specifier: "@acme/tools", ... },
//   { kind: "dynamic-import", specifier: "./view.js", ... },
//   { kind: "require", specifier: "legacy-package", ... }
// ]
```

Each match includes:

- `kind`: the syntax family that produced the match.
- `specifier`: the unquoted module specifier.
- `start` and `end`: source offsets for the scanned statement fragment.
- `specifierStart` and `specifierEnd`: source offsets for the literal value.
- `raw`: the matched source fragment.

## Helpers

```ts
import {
  getPackageNameFromSpecifier,
  hasImportSpecifier,
  listImportSpecifiers,
  listPackageSpecifiers,
  scanImportSpecifiers
} from "import-specifier-scan-kit";

listImportSpecifiers(`import x from "x";`);
// ["x"]

hasImportSpecifier(`const x = require("pkg");`, "pkg");
// true

listPackageSpecifiers(`
  import React from "react";
  import jsx from "react/jsx-runtime";
  import local from "./local.js";
  import scoped from "@scope/pkg/subpath";
  import fs from "node:fs";
`);
// ["react", "@scope/pkg"]

getPackageNameFromSpecifier("@scope/pkg/subpath");
// "@scope/pkg"

scanImportSpecifiers(source, {
  includeRequires: false,
  includeDynamicImports: true,
  includeExports: true,
  maxLength: 200_000
});
```

## Diagnostics

The scanner does not throw for expected source-shape problems. It returns issues such as:

- `input-too-large`
- `unterminated-string`
- `template-expression-skipped`
- `nonliteral-dynamic-import`
- `nonliteral-require`

## Browser compatibility

The core uses only strings, arrays, objects, regular expressions, and numbers. It does not require `fs`, `path`, `Buffer`, `process`, native modules, or network access.

Multi-line import declarations, side-effect imports, `export ... from`, literal dynamic `import()`, and literal `require()` calls are supported. Non-literal calls are reported as diagnostics.

`listPackageSpecifiers()` is intended for dependency previews and package audits. It returns unique bare package names, strips subpaths such as `react/jsx-runtime` to `react`, keeps scoped packages such as `@scope/pkg/subpath` as `@scope/pkg`, and skips relative paths plus Node builtins by default. Pass `includeNodeBuiltins: true` if you also want `node:fs` or `fs`.

## Limits

This package is not a JavaScript parser. It is best for lint hints, previews, search tools, editor helpers, browser demos, and quick dependency summaries. For bundlers, transpilers, or code that must understand every JavaScript syntax edge case, use a parser or lexer such as `es-module-lexer`, Babel, Acorn, or SWC.

## CLI

No CLI is included. The scanner is browser-friendly by design and works best as
a small function inside dependency previews, editors, docs tools, and internal
automation scripts.

## License

MPL-2.0
