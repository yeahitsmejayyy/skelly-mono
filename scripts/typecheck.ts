#!/usr/bin/env bun
/**
 * Typecheck every workspace.
 *
 * `bun --filter <glob> typecheck` exits 1 when no workspace matches the glob, which is the
 * state a freshly cloned shell is in: `apps/` holds only `.gitkeep` and `packages/` does not
 * exist. An empty workspace is not a failure, so this guard reports it and exits 0.
 *
 * It does NOT swallow anything else. If one or more workspaces exist, it delegates to
 * `bun --filter` and propagates that exit code unchanged.
 */
import { Glob, spawn } from "bun";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

const ROOT = dirname(import.meta.dir);

const members: string[] = [];
for (const dir of ["apps", "packages"]) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) continue;
  for await (const hit of new Glob("*/package.json").scan({ cwd: abs })) {
    members.push(join(dir, dirname(hit)));
  }
}

if (members.length === 0) {
  console.log("typecheck: no workspaces mounted yet — nothing to check.");
  console.log("Run `bun run mount` to compose the Skelly templates into apps/.");
  process.exit(0);
}

const proc = spawn({
  cmd: ["bun", "--filter", "./apps/*", "--filter", "./packages/*", "typecheck"],
  cwd: ROOT,
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(await proc.exited);
