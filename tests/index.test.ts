import { describe, expect, it } from "vitest";
import {
  getPackageNameFromSpecifier,
  hasImportSpecifier,
  isBarePackageSpecifier,
  listImportSpecifiers,
  listPackageSpecifiers,
  scanImportSpecifiers
} from "../src/index.js";

describe("scanImportSpecifiers", () => {
  it("extracts static, side-effect, export, dynamic, and require specifiers", () => {
    const source = `
      import defaultExport from "alpha";
      import { named } from './beta.js';
      import "side-effect.css";
      export { thing } from "@scope/pkg";
      const lazy = import("lazy-module");
      const cjs = require('legacy');
    `;

    const result = scanImportSpecifiers(source);

    expect(result.issues).toEqual([]);
    expect(result.specifiers.map((match) => [match.kind, match.specifier])).toEqual([
      ["static-import", "alpha"],
      ["static-import", "./beta.js"],
      ["side-effect-import", "side-effect.css"],
      ["export-from", "@scope/pkg"],
      ["dynamic-import", "lazy-module"],
      ["require", "legacy"]
    ]);
    expect(result.specifiers[0]?.specifierStart).toBe(source.indexOf("alpha"));
  });

  it("ignores comments and ordinary strings", () => {
    const source = `
      // import fake from "commented";
      const text = "require('not-real')";
      /* export * from "also-commented"; */
      import ok from "real";
    `;

    expect(listImportSpecifiers(source)).toEqual(["real"]);
  });

  it("can disable require, dynamic import, and export scanning", () => {
    const result = scanImportSpecifiers(
      `export { x } from "x"; import("y"); require("z"); import a from "a";`,
      {
        includeExports: false,
        includeDynamicImports: false,
        includeRequires: false
      }
    );

    expect(result.specifiers.map((match) => match.specifier)).toEqual(["a"]);
  });

  it("supports multiline imports and import attributes", () => {
    const source = `
      import {
        readFile,
        writeFile
      } from "node:fs/promises";

      import data from "./data.json" with { type: "json" };
    `;

    expect(listImportSpecifiers(source)).toEqual(["node:fs/promises", "./data.json"]);
  });

  it("reports nonliteral dynamic import and require arguments", () => {
    const result = scanImportSpecifiers(`
      import(name);
      require(packageName);
    `);

    expect(result.specifiers).toEqual([]);
    expect(result.issues.map((issue) => issue.code)).toEqual([
      "nonliteral-dynamic-import",
      "nonliteral-require"
    ]);
  });

  it("handles escaped characters and scoped package names", () => {
    const result = scanImportSpecifiers(`import value from "@scope/pkg\\\"name";`);

    expect(result.specifiers[0]?.specifier).toBe('@scope/pkg"name');
    expect(result.specifiers[0]?.quote).toBe("\"");
  });

  it("returns an issue instead of scanning oversized input", () => {
    const result = scanImportSpecifiers("import x from 'x';", { maxLength: 5 });

    expect(result.specifiers).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: "input-too-large",
        message: "Input length 18 exceeds maxLength 5.",
        start: 5,
        end: 18
      }
    ]);
  });

  it("returns a diagnostic for non-string input", () => {
    const result = scanImportSpecifiers(null);

    expect(result.specifiers).toEqual([]);
    expect(result.issues).toEqual([
      {
        code: "not-a-string",
        message: "Source input must be a string.",
        start: 0,
        end: 0
      }
    ]);
    expect(listImportSpecifiers(null)).toEqual([]);
    expect(hasImportSpecifier(null, "react")).toBe(false);
  });

  it("falls back to the default max length for invalid runtime options", () => {
    const result = scanImportSpecifiers("import x from 'x';", { maxLength: Number.NaN });

    expect(result.issues).toEqual([
      {
        code: "invalid-options",
        message: "maxLength must be an integer greater than or equal to 0.",
        start: 0,
        end: 0
      }
    ]);
    expect(result.specifiers.map((match) => match.specifier)).toEqual(["x"]);
  });

  it("exposes a direct presence helper", () => {
    expect(hasImportSpecifier(`import x from "x";`, "x")).toBe(true);
    expect(hasImportSpecifier(`import x from "x";`, "missing")).toBe(false);
  });

  it("extracts unique package names from bare specifiers", () => {
    const source = `
      import React from "react";
      import jsx from "react/jsx-runtime";
      import local from "./local.js";
      import scoped from "@scope/pkg/subpath";
      import fs from "node:fs";
      const legacy = require("legacy-package/utils");
    `;

    expect(listPackageSpecifiers(source)).toEqual([
      "react",
      "@scope/pkg",
      "legacy-package"
    ]);
    expect(listPackageSpecifiers(source, { includeNodeBuiltins: true })).toEqual([
      "react",
      "@scope/pkg",
      "node:fs",
      "legacy-package"
    ]);
  });

  it("exposes helpers for package-name normalization", () => {
    expect(getPackageNameFromSpecifier("react/jsx-runtime")).toBe("react");
    expect(getPackageNameFromSpecifier("@scope/pkg/subpath")).toBe("@scope/pkg");
    expect(getPackageNameFromSpecifier("./local")).toBeUndefined();
    expect(isBarePackageSpecifier("package")).toBe(true);
    expect(isBarePackageSpecifier("#internal")).toBe(false);
  });
});
