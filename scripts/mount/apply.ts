// The only file that writes to disk or hits the network. Every path goes through safeJoin, so a
// manifest cannot reach outside the project root even if someone edits it badly.
import { $ } from "bun";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import type { Op } from "./types";
import { MountError } from "./types";

// conflicts are not failures: two frontends shipped the same component and it has drifted. The
// design doc requires the dropped copy be named out loud rather than quietly overwritten.
export type ApplyReport = {
  applied: number;
  notFound: string[];
  conflicts: { file: string; kept: string; dropped: string }[];
};

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
  const conflicts: ApplyReport["conflicts"] = [];
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
      case "extractComponents": {
        const to = safeJoin(root, op.to);
        mkdirSync(to, { recursive: true });
        const wanted = new Set(op.components);
        const seen = new Set<string>();
        for (const source of op.sources) {
          const from = safeJoin(root, source);
          if (!existsSync(from)) { notFound.push(`${source} (missing dir)`); continue; }
          for (const name of readdirSync(from)) {
            // A component the manifest does not name is drift, not a bonus: mono.json claims to
            // list the whole surface of the design system, so an extra file falsifies the claim.
            if (!wanted.has(name)) { notFound.push(`${source}/${name} (not in extract.components)`); continue; }
            seen.add(name);
            const src = resolve(from, name);
            const dest = resolve(to, name);
            if (!existsSync(dest)) { writeFileSync(dest, readFileSync(src)); continue; }
            if (readFileSync(dest, "utf8") !== readFileSync(src, "utf8")) {
              conflicts.push({ file: name, kept: op.sources[0]!, dropped: source });
            }
          }
        }
        for (const name of op.components) {
          if (!seen.has(name)) notFound.push(`${op.to}/${name} (named in extract.components, found in no source)`);
        }
        break;
      }
      case "moveFile": {
        const from = safeJoin(root, op.from);
        const to = safeJoin(root, op.to);
        if (!existsSync(from)) { notFound.push(`${op.from} (missing file)`); continue; }
        mkdirSync(dirname(to), { recursive: true });
        renameSync(from, to);
        break;
      }
      case "splitCss": {
        const source = safeJoin(root, op.source);
        if (!existsSync(source)) { notFound.push(`${op.source} (missing file)`); continue; }
        const blocks = splitTopLevel(readFileSync(source, "utf8"));
        const claims = (holds: string[], b: string) => holds.some((h) => b.trimStart().startsWith(h));
        const take = (holds: string[]) => blocks.filter((b) => claims(holds, b)).join("\n\n");
        const theme = safeJoin(root, op.theme);
        const tokens = safeJoin(root, op.tokens);
        mkdirSync(dirname(theme), { recursive: true });
        mkdirSync(dirname(tokens), { recursive: true });
        writeFileSync(theme, `${take(op.themeHolds)}\n`);
        writeFileSync(tokens, `${take(op.tokensHolds)}\n`);
        // A block routed nowhere would vanish from both files. @import lines are expected to go:
        // the per-app index.css is rewritten with its own imports.
        for (const b of blocks) {
          if (claims(op.themeHolds, b) || claims(op.tokensHolds, b)) continue;
          if (!b.trim() || b.trimStart().startsWith("@import")) continue;
          notFound.push(`${op.source}: unclaimed CSS block "${b.trim().slice(0, 40)}…"`);
        }
        break;
      }
      case "importRewrite": {
        const dir = safeJoin(root, op.dir);
        if (!existsSync(dir)) { notFound.push(`${op.dir} (missing dir)`); continue; }
        for (const file of walk(dir, [".ts", ".tsx"])) {
          const before = readFileSync(file, "utf8");
          if (!before.includes(op.from)) continue;
          writeFileSync(file, before.replaceAll(op.from, op.to));
        }
        break;
      }
      default:
        // Unreachable while Op is exhaustively handled; a new op kind lands here loudly.
        throw new MountError(`no applier for op: ${(op as { kind: string }).kind}`);
    }
    applied += 1;
  }
  return { applied, notFound, conflicts };
}

// Splits a CSS file into top-level blocks: an at-rule or selector plus its balanced braces, or a
// standalone statement. Brace-counting is enough here — these files carry no strings with braces.
export function splitTopLevel(css: string): string[] {
  const blocks: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) { blocks.push(css.slice(start, i + 1)); start = i + 1; }
    }
    if (ch === ";" && depth === 0) { blocks.push(css.slice(start, i + 1)); start = i + 1; }
  }
  if (css.slice(start).trim()) blocks.push(css.slice(start));
  return blocks.map((b) => b.trim()).filter(Boolean);
}

function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((e) => entry.name.endsWith(e))) out.push(p);
  }
  return out;
}
