// Pure. No fs, no network, no clock, no randomness — that is what makes --dry-run honest and the
// tests free. Anything that must read a file is an Op for apply.ts to resolve.
import type { Answers, Container, Instance, Manifest, MountPlan, Op } from "./types";
import { MountError } from "./types";

const SAFE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

export function substitute(s: string, vars: { slug: string; dir: string }): string {
  return s.replaceAll("{{slug}}", vars.slug).replaceAll("{{dir}}", vars.dir);
}

// Category B and D files the shell itself carries. Purged on every mount.
const SHELL_PURGE = ["README.md", "SECURITY.md", "image.png", "LICENSE", "apps/.gitkeep"];

export function plan(answers: Answers, manifest: Manifest): MountPlan {
  const ops: Op[] = [];
  const warnings: string[] = [];
  const byId = new Map(manifest.containers.map((c) => [c.id, c]));

  if (!SAFE.test(answers.slug)) throw new MountError(`unsafe slug: ${answers.slug}`);
  if (answers.instances.length === 0) throw new MountError("no containers chosen");

  const seenDirs = new Set<string>();
  const counts = new Map<string, number>();
  for (const inst of answers.instances) {
    const c = byId.get(inst.id);
    if (!c) throw new MountError(`unknown container: ${inst.id}`);
    if (!SAFE.test(inst.dir)) throw new MountError(`unsafe directory name: ${inst.dir}`);
    if (seenDirs.has(inst.dir)) throw new MountError(`duplicate directory: apps/${inst.dir}`);
    seenDirs.add(inst.dir);
    const n = (counts.get(inst.id) ?? 0) + 1;
    counts.set(inst.id, n);
    if (n > 1 && !c.multiple) throw new MountError(`${inst.id} cannot mount more than once`);
  }
  const backends = answers.instances.filter((i) => byId.get(i.id)!.role === "backend");
  if (backends.length > 1) throw new MountError("only one backend container per monorepo");

  // 1. The shell sheds its own identity.
  for (const p of SHELL_PURGE) ops.push({ kind: "purge", path: p });
  ops.push({ kind: "jsonSet", file: "package.json", path: ["name"], value: answers.slug });

  // 2. Each instance: clone, purge, rename, rewrite, scripts.
  const frontends: Instance[] = [];
  for (const inst of answers.instances) {
    const c = byId.get(inst.id)!;
    const vars = { slug: answers.slug, dir: inst.dir };
    const root = `apps/${inst.dir}`;
    ops.push({ kind: "clone", repo: c.repo, dest: root });
    for (const p of c.purge) ops.push({ kind: "purge", path: `${root}/${p}` });
    for (const r of c.rename) {
      ops.push({
        kind: "replace",
        file: `${root}/${r.file}`,
        from: substitute(r.from, vars),
        to: substitute(r.to, vars),
        required: true,
      });
    }
    for (const w of c.rewrite) {
      ops.push({ kind: "write", file: `${root}/${w.file}`, content: substitute(w.content, vars) });
    }
    for (const name of c.appScriptsDrop) {
      ops.push({ kind: "jsonUnset", file: `${root}/package.json`, path: ["scripts", name] });
    }
    for (const [name, body] of Object.entries(c.rootScripts)) {
      ops.push({
        kind: "jsonSet",
        file: "package.json",
        path: ["scripts", substitute(name, vars)],
        value: substitute(body, vars),
      });
    }
    if (c.role === "frontend") frontends.push(inst);
  }

  // 3. build chains every frontend; the contract sync learns its source and targets.
  if (frontends.length > 0) {
    ops.push({
      kind: "jsonSet",
      file: "package.json",
      path: ["scripts", "build"],
      value: frontends.map((f) => `bun --filter @app/${f.dir} build`).join(" && "),
    });
  }
  const backend = backends[0];
  if (backend) {
    ops.push({
      kind: "replace",
      file: "scripts/sync-types.ts",
      from: 'const BACKEND = "apps/server";',
      to: `const BACKEND = "apps/${backend.dir}";`,
      required: true,
    });
  }
  const targets = answers.instances.filter((i) => byId.get(i.id)!.contractTarget).map((i) => i.dir);
  ops.push({
    kind: "replace",
    file: "scripts/sync-types.ts",
    from: "const CONTRACT_TARGETS: string[] = [];",
    to: `const CONTRACT_TARGETS: string[] = [${targets.map((t) => `"${t}"`).join(", ")}];`,
    required: true,
  });
  if (backend && targets.length === 0) {
    warnings.push("A backend is mounted but no frontend consumes its contract.");
  }
  if (!backend && targets.length > 0) {
    warnings.push("A portal is mounted with no backend. Its System Health widget will show Failed.");
  }

  // 4. The design system. Ops only; Task 7 gives them appliers.
  if (answers.designSystem) {
    if (frontends.length === 0) {
      throw new MountError("the design system needs at least one frontend container");
    }
    ops.push(...designSystemOps(answers, frontends, manifest));
  }

  return { ops, warnings, tree: treeOf(answers, byId) };
}

function designSystemOps(answers: Answers, frontends: Instance[], m: Manifest): Op[] {
  const ds = m.designSystem;
  const ops: Op[] = [];
  // portal-wins: the portal's copy of a divergent component is the one kept.
  const ordered = [...frontends].sort((a, b) => Number(b.id === "portal") - Number(a.id === "portal"));

  ops.push({
    kind: "extractComponents",
    sources: ordered.map((f) => `apps/${f.dir}/${ds.extract.from}`),
    to: ds.extract.to,
    policy: ds.conflictPolicy,
  });
  for (const f of ds.extract.files) {
    ops.push({ kind: "moveFile", from: `apps/${ordered[0]!.dir}/${f.from}`, to: f.to });
  }
  ops.push({
    kind: "splitCss",
    source: `apps/${ordered[0]!.dir}/${ds.cssSplit.source}`,
    theme: ds.cssSplit.theme,
    tokens: ds.cssSplit.tokens,
    themeHolds: ds.cssSplit.themeHolds,
    tokensHolds: ds.cssSplit.tokensHolds,
  });

  for (const f of frontends) {
    const root = `apps/${f.dir}`;
    for (const r of ds.importRewrites) {
      ops.push({ kind: "importRewrite", dir: `${root}/src`, from: r.from, to: r.to });
    }
    // Tailwind v4 scans only this app's tree. Without @source the extracted components are unstyled.
    ops.push({
      kind: "write",
      file: `${root}/${ds.cssSplit.source}`,
      content:
        '@import "tailwindcss";\n@import "tw-animate-css";\n' +
        `@import "${ds.pkg}/theme.css";\n@import "${ds.pkg}/tokens.css";\n\n` +
        "/* Tailwind v4 scans only this app's tree. Without this every extracted component is unstyled. */\n" +
        '@source "../../../packages/ui/src";\n',
    });
    for (const dep of Object.keys(ds.depMoves)) {
      ops.push({ kind: "jsonUnset", file: `${root}/package.json`, path: ["dependencies", dep] });
    }
    ops.push({
      kind: "jsonSet",
      file: `${root}/package.json`,
      path: ["dependencies", ds.pkg],
      value: "workspace:*",
    });
    ops.push({ kind: "purge", path: `${root}/${ds.extract.from}` });
  }

  for (const [name, body] of Object.entries(ds.rootScripts)) {
    ops.push({ kind: "jsonSet", file: "package.json", path: ["scripts", name], value: body });
  }
  for (const [dep, version] of Object.entries(ds.devDeps)) {
    ops.push({ kind: "jsonSet", file: "package.json", path: ["devDependencies", dep], value: version });
  }
  return ops;
}

function treeOf(answers: Answers, byId: Map<string, Container>): string[] {
  const lines = [`${answers.slug}/`, "├─ apps/"];
  for (const i of answers.instances) {
    lines.push(`│  ├─ ${i.dir}/   @app/${i.dir}   ${byId.get(i.id)!.summary}`);
  }
  if (answers.designSystem) {
    lines.push("├─ packages/", "│  └─ ui/      @app/ui   shared components, tokens, utils");
    lines.push("├─ .storybook/");
  }
  lines.push("├─ mono.json", "├─ tsconfig.base.json", "└─ package.json");
  return lines;
}
