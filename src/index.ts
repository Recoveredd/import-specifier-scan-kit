export type ImportSpecifierKind =
  | "static-import"
  | "side-effect-import"
  | "export-from"
  | "dynamic-import"
  | "require";

export type ImportSpecifierQuote = "\"" | "'" | "`";

export interface ImportSpecifierMatch {
  readonly kind: ImportSpecifierKind;
  readonly specifier: string;
  readonly quote: ImportSpecifierQuote;
  readonly start: number;
  readonly end: number;
  readonly specifierStart: number;
  readonly specifierEnd: number;
  readonly raw: string;
}

export type ImportSpecifierIssueCode =
  | "input-too-large"
  | "unterminated-string"
  | "template-expression-skipped"
  | "nonliteral-dynamic-import"
  | "nonliteral-require";

export interface ImportSpecifierIssue {
  readonly code: ImportSpecifierIssueCode;
  readonly message: string;
  readonly start: number;
  readonly end: number;
}

export interface ScanImportSpecifiersOptions {
  readonly includeRequires?: boolean;
  readonly includeDynamicImports?: boolean;
  readonly includeExports?: boolean;
  readonly maxLength?: number;
}

export interface ScanImportSpecifiersResult {
  readonly specifiers: readonly ImportSpecifierMatch[];
  readonly issues: readonly ImportSpecifierIssue[];
}

interface ScanState {
  readonly source: string;
  readonly options: Required<ScanImportSpecifiersOptions>;
  readonly specifiers: ImportSpecifierMatch[];
  readonly issues: ImportSpecifierIssue[];
}

const DEFAULT_OPTIONS: Required<ScanImportSpecifiersOptions> = {
  includeRequires: true,
  includeDynamicImports: true,
  includeExports: true,
  maxLength: 500_000
};

const IDENTIFIER = /[A-Za-z0-9_$]/;

export function scanImportSpecifiers(
  source: string,
  options: ScanImportSpecifiersOptions = {}
): ScanImportSpecifiersResult {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  const state: ScanState = {
    source,
    options: resolved,
    specifiers: [],
    issues: []
  };

  if (source.length > resolved.maxLength) {
    state.issues.push({
      code: "input-too-large",
      message: `Input length ${source.length} exceeds maxLength ${resolved.maxLength}.`,
      start: resolved.maxLength,
      end: source.length
    });
    return { specifiers: [], issues: state.issues };
  }

  let index = 0;
  while (index < source.length) {
    const char = source[index];

    if (char === "\"" || char === "'" || char === "`") {
      index = skipString(state, index, char);
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      index = skipLineComment(source, index + 2);
      continue;
    }

    if (char === "/" && source[index + 1] === "*") {
      index = skipBlockComment(source, index + 2);
      continue;
    }

    if (startsWord(source, index, "import")) {
      index = scanImport(state, index);
      continue;
    }

    if (state.options.includeExports && startsWord(source, index, "export")) {
      index = scanExportFrom(state, index);
      continue;
    }

    if (state.options.includeRequires && startsWord(source, index, "require")) {
      index = scanRequire(state, index);
      continue;
    }

    index += 1;
  }

  return { specifiers: state.specifiers, issues: state.issues };
}

export function listImportSpecifiers(
  source: string,
  options: ScanImportSpecifiersOptions = {}
): string[] {
  return scanImportSpecifiers(source, options).specifiers.map((match) => match.specifier);
}

export function hasImportSpecifier(
  source: string,
  specifier: string,
  options: ScanImportSpecifiersOptions = {}
): boolean {
  return scanImportSpecifiers(source, options).specifiers.some((match) => match.specifier === specifier);
}

function scanImport(state: ScanState, start: number): number {
  const source = state.source;
  let index = skipWhitespace(source, start + "import".length);

  if (source[index] === "(") {
    return state.options.includeDynamicImports ? scanDynamicImport(state, start, index) : start + 1;
  }

  const literal = readStringLiteral(state, index);
  if (literal) {
    addMatch(state, "side-effect-import", start, literal);
    return literal.end;
  }

  const fromIndex = findKeywordBeforeStatementEnd(source, index, "from");
  if (fromIndex === -1) {
    return start + "import".length;
  }

  const afterFrom = skipWhitespace(source, fromIndex + "from".length);
  const fromLiteral = readStringLiteral(state, afterFrom);
  if (fromLiteral) {
    addMatch(state, "static-import", start, fromLiteral);
    return fromLiteral.end;
  }

  return fromIndex + "from".length;
}

function scanExportFrom(state: ScanState, start: number): number {
  const source = state.source;
  const fromIndex = findKeywordBeforeStatementEnd(source, start + "export".length, "from");
  if (fromIndex === -1) {
    return start + "export".length;
  }

  const literalStart = skipWhitespace(source, fromIndex + "from".length);
  const literal = readStringLiteral(state, literalStart);
  if (literal) {
    addMatch(state, "export-from", start, literal);
    return literal.end;
  }

  return fromIndex + "from".length;
}

function scanDynamicImport(state: ScanState, start: number, parenIndex: number): number {
  const literalStart = skipWhitespace(state.source, parenIndex + 1);
  const literal = readStringLiteral(state, literalStart);
  if (literal) {
    addMatch(state, "dynamic-import", start, literal);
    return literal.end;
  }

  const issueEnd = Math.min(state.source.length, parenIndex + 24);
  state.issues.push({
    code: "nonliteral-dynamic-import",
    message: "Dynamic import argument is not a string literal.",
    start,
    end: issueEnd
  });
  return parenIndex + 1;
}

function scanRequire(state: ScanState, start: number): number {
  const source = state.source;
  let index = skipWhitespace(source, start + "require".length);
  if (source[index] !== "(") {
    return start + "require".length;
  }

  index = skipWhitespace(source, index + 1);
  const literal = readStringLiteral(state, index);
  if (literal) {
    addMatch(state, "require", start, literal);
    return literal.end;
  }

  state.issues.push({
    code: "nonliteral-require",
    message: "Require argument is not a string literal.",
    start,
    end: Math.min(source.length, index + 24)
  });
  return index + 1;
}

interface LiteralRead {
  readonly value: string;
  readonly quote: ImportSpecifierQuote;
  readonly start: number;
  readonly end: number;
  readonly valueStart: number;
  readonly valueEnd: number;
}

function readStringLiteral(state: ScanState, start: number): LiteralRead | undefined {
  const quote = state.source[start];
  if (quote !== "\"" && quote !== "'" && quote !== "`") {
    return undefined;
  }

  let value = "";
  let index = start + 1;
  while (index < state.source.length) {
    const char = state.source[index];

    if (char === "\\") {
      const next = state.source[index + 1];
      if (next === undefined) {
        break;
      }
      value += next;
      index += 2;
      continue;
    }

    if (quote === "`" && char === "$" && state.source[index + 1] === "{") {
      state.issues.push({
        code: "template-expression-skipped",
        message: "Template literals with expressions are skipped.",
        start,
        end: index + 2
      });
      return undefined;
    }

    if (char === quote) {
      return {
        value,
        quote,
        start,
        end: index + 1,
        valueStart: start + 1,
        valueEnd: index
      };
    }

    value += char;
    index += 1;
  }

  state.issues.push({
    code: "unterminated-string",
    message: "String literal is not terminated.",
    start,
    end: state.source.length
  });
  return undefined;
}

function addMatch(
  state: ScanState,
  kind: ImportSpecifierKind,
  statementStart: number,
  literal: LiteralRead
): void {
  state.specifiers.push({
    kind,
    specifier: literal.value,
    quote: literal.quote,
    start: statementStart,
    end: literal.end,
    specifierStart: literal.valueStart,
    specifierEnd: literal.valueEnd,
    raw: state.source.slice(statementStart, literal.end)
  });
}

function findKeywordBeforeStatementEnd(source: string, start: number, keyword: string): number {
  let index = start;
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;

  while (index < source.length) {
    const char = source[index];

    if (char === ";" && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      return -1;
    }

    if (char === "\"" || char === "'" || char === "`") {
      index = skipString({ source, options: DEFAULT_OPTIONS, specifiers: [], issues: [] }, index, char);
      continue;
    }

    if (char === "/" && source[index + 1] === "/") {
      return -1;
    }

    if (char === "/" && source[index + 1] === "*") {
      index = skipBlockComment(source, index + 2);
      continue;
    }

    if (char === "{") {
      braceDepth += 1;
      index += 1;
      continue;
    }

    if (char === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      index += 1;
      continue;
    }

    if (char === "[") {
      bracketDepth += 1;
      index += 1;
      continue;
    }

    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      index += 1;
      continue;
    }

    if (char === "(") {
      parenDepth += 1;
      index += 1;
      continue;
    }

    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      index += 1;
      continue;
    }

    if (braceDepth === 0 && bracketDepth === 0 && parenDepth === 0 && startsWord(source, index, keyword)) {
      return index;
    }

    index += 1;
  }

  return -1;
}

function skipString(state: ScanState, start: number, quote: ImportSpecifierQuote): number {
  const source = state.source;
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") {
      index += 2;
      continue;
    }
    if (char === quote) {
      return index + 1;
    }
    index += 1;
  }
  return source.length;
}

function skipLineComment(source: string, start: number): number {
  const newline = source.indexOf("\n", start);
  return newline === -1 ? source.length : newline + 1;
}

function skipBlockComment(source: string, start: number): number {
  const end = source.indexOf("*/", start);
  return end === -1 ? source.length : end + 2;
}

function skipWhitespace(source: string, start: number): number {
  let index = start;
  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }
  return index;
}

function startsWord(source: string, start: number, word: string): boolean {
  if (!source.startsWith(word, start)) {
    return false;
  }

  const before = source[start - 1];
  const after = source[start + word.length];
  return !isIdentifier(before) && !isIdentifier(after);
}

function isIdentifier(char: string | undefined): boolean {
  return char !== undefined && IDENTIFIER.test(char);
}
