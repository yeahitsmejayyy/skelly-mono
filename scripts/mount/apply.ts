// The only file that writes to disk or hits the network. Every path goes through safeJoin, so a
// manifest cannot reach outside the project root even if someone edits it badly.
import { $ } from "bun";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Op } from "./types";
import { MountError } from "./types";

export type ApplyReport = { applied: number; notFound: string[] };

export function safeJoin(root: string, p: string): string {
  const base = resolve(root);
  const abs = resolve(base, p);
  const rel = relative(base, abs);
  // "" means the path IS the root — a purge of "." would take the project with it.
  if (rel === "" || rel.startsWith("..")) throw new MountError(`path escapes root: ${p}`);
  return abs;
}

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
}

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let node = obj;
  for (const key of path.slice(0, -1)) {
    if (typeof node[key] !== "object" || node[key] === null) node[key] = {};
    node = node[key] as Record<string, unknown>;
  }
  node[path[path.length - 1]!] = value;
}

function unsetPath(obj: Record<string, unknown>, path: string[]): void {
  let node: Record<string, unknown> | undefined = obj;
  for (const key of path.slice(0, -1)) {
    node = node?.[key] as Record<string, unknown> | undefined;
    if (!node) return;
  }
  delete node[path[path.length - 1]!];
}

export async function apply(ops: Op[], root: string): Promise<ApplyReport> {
  const notFound: string[] = [];
  let applied = 0;

  for (const op of ops) {
    switch (op.kind) {
      case "clone": {
        const dest = safeJoin(root, op.dest);
        mkdirSync(dirname(dest), { recursive: true });
        await $`git clone --depth 1 ${op.repo} ${dest}`.quiet();
        rmSync(resolve(dest, ".git"), { recursive: true, force: true });
        break;
      }
      case "purge": {
        rmSync(safeJoin(root, op.path), { recursive: true, force: true });
        break;
      }
      case "replace": {
        const file = safeJoin(root, op.file);
        // A missing target is drift between the templates and mono.json: recorded, not fatal.
        // It is NOT counted as applied — the report has to be true or it is worth nothing.
        if (!existsSync(file)) { notFound.push(`${op.file} (missing file)`); continue; }
        const before = readFileSync(file, "utf8");
        if (!before.includes(op.from)) { notFound.push(`${op.file}: ${op.from}`); continue; }
        writeFileSync(file, before.replaceAll(op.from, op.to));
        break;
      }
      case "write": {
        const file = safeJoin(root, op.file);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, op.content);
        break;
      }
      case "jsonSet": {
        const file = safeJoin(root, op.file);
        if (!existsSync(file)) { notFound.push(`${op.file} (missing file)`); continue; }
        const json = readJson(file);
        setPath(json, op.path, op.value);
        writeJson(file, json);
        break;
      }
      case "jsonUnset": {
        const file = safeJoin(root, op.file);
        if (!existsSync(file)) { notFound.push(`${op.file} (missing file)`); continue; }
        const json = readJson(file);
        unsetPath(json, op.path);
        writeJson(file, json);
        break;
      }
      default:
        // Task 7 adds extractComponents, moveFile, splitCss and importRewrite.
        throw new MountError(`no applier for op: ${(op as { kind: string }).kind}`);
    }
    applied += 1;
  }
  return { applied, notFound };
}
