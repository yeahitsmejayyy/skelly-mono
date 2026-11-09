#!/usr/bin/env bun
// bun run mount --answers answers.json [--dry-run] [--root .]
//
// mono.json is the spec. This turns it into a list of operations and either prints them or
// performs them. --dry-run is the preview the user says yes to, so its output is deliberately
// free of absolute paths: it has to be diffable between machines and between runs.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { apply } from "./mount/apply";
import { plan } from "./mount/plan";
import { preview } from "./mount/preview";
import type { Answers, Manifest } from "./mount/types";
import { MountError } from "./mount/types";

const args = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const dryRun = args.includes("--dry-run");
const root = resolve(flag("root") ?? ".");
const answersPath = flag("answers");

const die = (msg: string, code = 1): never => {
  console.error(`✖ ${msg}`);
  process.exit(code);
};

if (!answersPath) {
  console.error("usage: bun run mount --answers <file.json> [--dry-run] [--root <dir>]");
  process.exit(2);
}

// Read both inputs before anything else, so a typo in a filename fails before any work.
const readSpec = <T,>(file: string, what: string): T => {
  if (!existsSync(file)) return die(`${what} not found: ${file}`);
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (err) {
    return die(`${what} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
};

const answers = readSpec<Answers>(resolve(answersPath), "answers file");
const manifest = readSpec<Manifest>(resolve(root, "mono.json"), "mono.json");

const compiled = (() => {
  try {
    return plan(answers, manifest);
  } catch (err) {
    return die(err instanceof MountError ? err.message : String(err));
  }
})();

if (dryRun) {
  console.log(preview(compiled, answers));
  process.exit(0);
}

// Refuse to mount over an existing mount. The mount is not idempotent: a second run would
// clone into directories that already hold someone's work.
const apps = resolve(root, "apps");
if (existsSync(apps) && readdirSync(apps).some((e) => e !== ".gitkeep")) {
  die("apps/ is not empty. Mount into a fresh clone of the shell.");
}

const report = await apply(compiled.ops, root);
console.log(`✔ ${report.applied} operations applied`);

if (report.notFound.length) {
  console.log("\n⚠ the manifest did not match the templates here:");
  for (const n of report.notFound) console.log(`  - ${n}`);
  console.log("  The templates have drifted from mono.json. Report this; do not fix it silently.");
}
if (report.conflicts.length) {
  console.log("\n⚠ divergent duplicates — the portal's copy was kept:");
  for (const c of report.conflicts) console.log(`  - ${c.file}: kept ${c.kept}, dropped ${c.dropped}`);
  console.log("  Diff them before trusting the result. The dropped app may lose behaviour.");
}
for (const w of compiled.warnings) console.log(`! ${w}`);
