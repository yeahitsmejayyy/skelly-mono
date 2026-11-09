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
 * 3. `bun --filter` runs the script where it exists and says nothing where it does not, so a
 *    workspace without a `typecheck` script is skipped in silence. CLAUDE.md calls this command
 *    the gate for every workspace, so a silent skip makes that a false claim: this guard names
 *    them and fails.
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
  console.log("Mount the templates into apps/ first — see README.md.");
  process.exit(0);
}

// 3. Every member must actually have the script, or the gate passes without looking at it.
const silent: string[] = [];
for (const m of members) {
  const pkg = (await Bun.file(join(ROOT, m, "package.json")).json()) as {
    scripts?: Record<string, string>;
  };
  if (!pkg.scripts?.typecheck) silent.push(m);
}
if (silent.length > 0) {
  console.error("typecheck: these workspaces have no `typecheck` script, so this gate cannot");
  console.error("check them. Add one to each package.json rather than ignoring this:");
  for (const m of silent) console.error(`  - ${m}`);
  process.exit(1);
}

process.exit(await run(["bun", "--filter", "./apps/*", "--filter", "./packages/*", "typecheck"]));
