import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const hostDirectory = resolve(process.cwd(), "host");
const forbiddenImport = /\b(?:from|import)\s*(?:\(\s*)?["'`](?:@\/|(?:\.\.\/)+)servers\/finance-mcp\/(?:tools|services|repositories)(?:\/|["'`])/;

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

describe("Host module boundary", () => {
  it("does not import Finance MCP internals directly", () => {
    const violations = sourceFiles(hostDirectory).flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return forbiddenImport.test(source) ? [file] : [];
    });

    expect(violations).toEqual([]);
  });
});
