#!/usr/bin/env bun
/**
 * Typecheck the root's own scripts, then every mounted workspace.
 *
 * Two halves, because they fail for different reasons:
 *
 * 1. `tsc -p tsconfig.json` covers `scripts/` — the mount compiler and the contract sync. This
 *    is root code, not a workspace, so `bun --filter` never sees it.
 * 2. `bun --filter <glob> typecheck` covers the mounted apps and packages. It exits 1 when no
 *    workspace matches the glob, which is the state a freshly cloned shell is in: `apps/` holds
 *    only `.gitkeep` and `packages/` does not exist. An empty workspace is not a failure, so
 *    this guard reports it and exits 0.
 *
 * It does NOT swallow anything else. A real tsc error, or a failing workspace, propagates.
 */
import { Glob, spawn } from "bun";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = dirname(import.meta.dir);

async function run(cmd: string[]): Promise<number> {
  const proc = spawn({ cmd, cwd: ROOT, stdout: "inherit", stderr: "inherit" });
  return await proc.exited;
}

// 1. The root's own scripts.
const rootExit = await run(["bunx", "tsc", "-p", "tsconfig.json"]);
if (rootExit !== 0) process.exit(rootExit);
console.log("typecheck: scripts/ clean.");

// 2. The workspaces, if any are mounted.
const members: string[] = [];
for (const dir of ["apps", "packages"]) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for await (const hit of new Glob("*/package.json").scan({ cwd: abs })) {
    members.push(join(dir, dirname(hit)));
  }
}

if (members.length === 0) {
  console.log("typecheck: no workspaces mounted yet — nothing more to check.");
  console.log("Run `bun run mount` to compose the Skelly templates into apps/.");
  process.exit(0);
}

process.exit(await run(["bun", "--filter", "./apps/*", "--filter", "./packages/*", "typecheck"]));
