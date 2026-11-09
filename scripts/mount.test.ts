import { expect, test } from "bun:test";
import { $, Glob } from "bun";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { apply, safeJoin, splitTopLevel } from "./mount/apply";
import { plan } from "./mount/plan";
import { preview } from "./mount/preview";
import { MountError } from "./mount/types";
import manifest from "../mono.json";
import type { Manifest, Op } from "./mount/types";

// mono.json widens to `role: string` and a per-container union, so tsc rejects a direct cast.
// The shape is asserted at runtime by the manifest drift guard, not here.
const M = manifest as unknown as Manifest;
const answers = (over: Partial<Parameters<typeof plan>[0]> = {}) => ({
  slug: "acme", designSystem: false,
  instances: [{ id: "server", dir: "server" }],
  ...over,
});

test("rejects an unknown container id", () => {
  expect(() => plan(answers({ instances: [{ id: "nope", dir: "nope" }] }), M)).toThrow(MountError);
});

test("rejects a second backend", () => {
  expect(() =>
    plan(answers({ instances: [{ id: "server", dir: "server" }, { id: "server", dir: "server2" }] }), M),
  ).toThrow(MountError);
});

test("rejects two instances in the same directory", () => {
  expect(() =>
    plan(answers({ instances: [{ id: "portal", dir: "app" }, { id: "site", dir: "app" }] }), M),
  ).toThrow(MountError);
});

test("rejects a directory name that is not a safe slug", () => {
  expect(() => plan(answers({ instances: [{ id: "portal", dir: "../escape" }] }), M)).toThrow(MountError);
});

test("carries every mounted container's demo content, rooted at the monorepo", () => {
  const p = plan(
    answers({ instances: [{ id: "server", dir: "server" }, { id: "site", dir: "www" }] }),
    M,
  );
  const paths = p.demos.map((d) => d.path);
  expect(paths).toEqual([
    "apps/server/src/db/schema.sql",
    "apps/www/src/seo/seo-defaults.tsx",
    "apps/www/src/routes/home.tsx",
  ]);
  for (const d of p.demos) expect(d.note.length).toBeGreaterThan(20);
});

test("a container with no demo content contributes nothing", () => {
  const p = plan(answers({ instances: [{ id: "portal", dir: "portal" }] }), M);
  expect(p.demos).toEqual([]);
});

test("the preview names every demo path and its note", () => {
  const a = answers({ instances: [{ id: "site", dir: "site" }] });
  const text = preview(plan(a, M), a);
  for (const d of plan(a, M).demos) {
    expect(text).toContain(d.path);
    expect(text).toContain(d.note);
  }
});

// ── The four-instance hard path: a backend, two portals and a site, with the design system ──

const FOUR = {
  slug: "belltax",
  designSystem: true,
  instances: [
    { id: "server", dir: "server" },
    { id: "portal", dir: "portal" },
    { id: "portal", dir: "admin" },
    { id: "site", dir: "site" },
  ],
};

test("mounts the backend at apps/server, never apps/backend", () => {
  const p = plan(FOUR, M);
  const clones = p.ops.filter((o) => o.kind === "clone");
  expect(clones.map((c) => c.kind === "clone" && c.dest)).toEqual([
    "apps/server", "apps/portal", "apps/admin", "apps/site",
  ]);
  expect(JSON.stringify(p.ops)).not.toContain("apps/backend");
});

test("the second portal instance is scoped to its own directory", () => {
  const p = plan(FOUR, M);
  const names = p.ops.filter(
    (o) => o.kind === "replace" && o.file === "apps/admin/package.json",
  );
  expect(names).toHaveLength(1);
  expect(names[0]!.kind === "replace" && names[0]!.to).toBe("@app/admin");
});

test("the contract targets are the frontends that consume it", () => {
  const p = plan(FOUR, M);
  const sync = p.ops.find(
    (o) => o.kind === "replace" && o.from === "const CONTRACT_TARGETS: string[] = [];",
  );
  expect(sync!.kind === "replace" && sync!.to).toBe(
    'const CONTRACT_TARGETS: string[] = ["portal", "admin"];',
  );
});

test("the site is not a contract target", () => {
  const p = plan(FOUR, M);
  const sync = p.ops.find((o) => o.kind === "replace" && o.from.includes("CONTRACT_TARGETS"));
  expect(sync!.kind === "replace" && sync!.to).not.toContain("site");
});

test("build chains every frontend and no backend", () => {
  const p = plan(FOUR, M);
  const build = p.ops.find(
    (o) => o.kind === "jsonSet" && o.path[0] === "scripts" && o.path[1] === "build",
  );
  expect(build!.kind === "jsonSet" && build!.value).toBe(
    "bun --filter @app/portal build && bun --filter @app/admin build && bun --filter @app/site build",
  );
});

test("the slug reaches the db filename but never a package name", () => {
  const p = plan(FOUR, M);
  const db = p.ops.find((o) => o.kind === "replace" && o.from === "skelly.db");
  expect(db!.kind === "replace" && db!.to).toBe("belltax.db");
  const pkgNames = p.ops.filter((o) => o.kind === "replace" && o.to.startsWith("@"));
  for (const op of pkgNames) expect(op.kind === "replace" && op.to).not.toContain("belltax");
});

test("every app's own bun.lock is purged", () => {
  const p = plan(FOUR, M);
  const locks = p.ops.filter((o) => o.kind === "purge" && o.path.endsWith("bun.lock"));
  expect(locks).toHaveLength(4);
});

test("the portal's own sync-types script is purged and its script dropped", () => {
  const p = plan(FOUR, M);
  expect(p.ops).toContainEqual({ kind: "purge", path: "apps/portal/scripts/sync-types.ts" });
  expect(p.ops).toContainEqual({
    kind: "jsonUnset", file: "apps/portal/package.json", path: ["scripts", "sync:types"],
  });
});

test("the app keeps dev, build and typecheck", () => {
  const p = plan(FOUR, M);
  const dropped = p.ops.filter((o) => o.kind === "jsonUnset" && o.path[0] === "scripts");
  for (const op of dropped) expect(op.kind === "jsonUnset" && op.path[1]).toBe("sync:types");
});

test("the shell sheds its own identity files", () => {
  const p = plan(FOUR, M);
  for (const f of ["README.md", "SECURITY.md", "image.png", "LICENSE"]) {
    expect(p.ops).toContainEqual({ kind: "purge", path: f });
  }
});

// ── The design system ──

const OFF = { ...FOUR, designSystem: false };

test("design system off emits nothing about packages/ui", () => {
  const p = plan(OFF, M);
  expect(JSON.stringify(p.ops)).not.toContain("packages/ui");
  expect(JSON.stringify(p.ops)).not.toContain("@app/ui");
  expect(p.ops.some((o) => o.kind === "extractComponents")).toBe(false);
});

test("portal-wins: the portal is the first extraction source", () => {
  const p = plan(FOUR, M);
  const ex = p.ops.find((o) => o.kind === "extractComponents");
  expect(ex!.kind === "extractComponents" && ex!.sources[0]).toBe("apps/portal/src/components/ui");
});

test("every frontend gets the Tailwind @source line", () => {
  const p = plan(FOUR, M);
  const css = p.ops.filter((o) => o.kind === "write" && o.file.endsWith("src/index.css"));
  expect(css).toHaveLength(3);
  for (const op of css) {
    expect(op.kind === "write" && op.content).toContain('@source "../../../packages/ui/src";');
  }
});

test("the moved deps leave every frontend and @app/ui is added", () => {
  const p = plan(FOUR, M);
  for (const dir of ["portal", "admin", "site"]) {
    expect(p.ops).toContainEqual({
      kind: "jsonUnset", file: `apps/${dir}/package.json`, path: ["dependencies", "lucide-react"],
    });
    expect(p.ops).toContainEqual({
      kind: "jsonSet", file: `apps/${dir}/package.json`,
      path: ["dependencies", "@app/ui"], value: "workspace:*",
    });
  }
});

test("the design system is refused with no frontend", () => {
  expect(() =>
    plan({ slug: "acme", designSystem: true, instances: [{ id: "server", dir: "server" }] }, M),
  ).toThrow(MountError);
});

test("a portal with no backend warns rather than throwing", () => {
  const p = plan({ slug: "acme", designSystem: false, instances: [{ id: "portal", dir: "portal" }] }, M);
  expect(p.warnings.join(" ")).toContain("no backend");
});

test("the preview names every container and says nothing was written", () => {
  const text = preview(plan(FOUR, M), FOUR);
  for (const d of ["server", "portal", "admin", "site"]) expect(text).toContain(d);
  expect(text).toContain("Nothing has been written");
  expect(text).toContain("packages/ui");
});

// portal-wins must survive a declaration order that contradicts it. FOUR lists the portal first,
// so it cannot tell a real sort from no sort at all — this does.
const SITE_FIRST = {
  slug: "belltax",
  designSystem: true,
  instances: [
    { id: "site", dir: "site" },
    { id: "server", dir: "server" },
    { id: "portal", dir: "portal" },
  ],
};

test("portal-wins holds when the site is declared first", () => {
  const p = plan(SITE_FIRST, M);
  const ex = p.ops.find((o) => o.kind === "extractComponents");
  expect(ex!.kind === "extractComponents" && ex!.sources).toEqual([
    "apps/portal/src/components/ui",
    "apps/site/src/components/ui",
  ]);
});

test("the shared single-copy files come from the portal, not whichever is declared first", () => {
  const p = plan(SITE_FIRST, M);
  const move = p.ops.find((o) => o.kind === "moveFile");
  expect(move!.kind === "moveFile" && move!.from).toBe("apps/portal/src/lib/utils.ts");
  const css = p.ops.find((o) => o.kind === "splitCss");
  expect(css!.kind === "splitCss" && css!.source).toBe("apps/portal/src/index.css");
});

test("with no portal mounted the site is the extraction source", () => {
  const p = plan({ slug: "acme", designSystem: true, instances: [{ id: "site", dir: "site" }] }, M);
  const ex = p.ops.find((o) => o.kind === "extractComponents");
  expect(ex!.kind === "extractComponents" && ex!.sources).toEqual(["apps/site/src/components/ui"]);
  const move = p.ops.find((o) => o.kind === "moveFile");
  expect(move!.kind === "moveFile" && move!.from).toBe("apps/site/src/lib/utils.ts");
});

// ── Determinism: the dry run is a diffable artefact ──
// Clockwork gates its scaffold station on diffing `--dry-run` output, so byte stability is a
// contract, not a nicety. The planner being pure is what makes this hold; these tests are what
// stop a later change from quietly breaking it.

test("the same answers render byte-identical preview text, every time", () => {
  const renders = new Set<string>();
  for (let i = 0; i < 50; i++) renders.add(preview(plan(FOUR, M), FOUR));
  expect(renders.size).toBe(1);
});

test("the plan itself is structurally identical across calls", () => {
  expect(plan(FOUR, M)).toEqual(plan(FOUR, M));
});

test("instance declaration order is the only thing that reorders the ops", () => {
  const a = plan(SITE_FIRST, M);
  const b = plan({ ...SITE_FIRST, instances: [...SITE_FIRST.instances] }, M);
  expect(JSON.stringify(a.ops)).toBe(JSON.stringify(b.ops));
});

test("the preview embeds no absolute path, so it is diffable across machines", () => {
  const text = preview(plan(FOUR, M), FOUR);
  expect(text).not.toContain("/Users/");
  expect(text).not.toContain("/private/");
  expect(text).not.toContain(process.cwd());
  // every path in the preview is repo-relative
  for (const line of text.split("\n")) expect(line.trimStart().startsWith("/")).toBe(false);
});

// --- Task 6: the applier -----------------------------------------------------------------

test("safeJoin refuses to escape the project root", () => {
  expect(() => safeJoin("/tmp/proj", "../etc/passwd")).toThrow(MountError);
  expect(() => safeJoin("/tmp/proj", "apps/../../x")).toThrow(MountError);
  expect(() => safeJoin("/tmp/proj", "/etc/passwd")).toThrow(MountError);
  expect(() => safeJoin("/tmp/proj", ".")).toThrow(MountError);
  expect(safeJoin("/tmp/proj", "apps/server/package.json")).toBe("/tmp/proj/apps/server/package.json");
});

// Every op the planner can emit must have an applier, or the mount dies partway through a
// directory it has already half-written. Task 7 emptied this list; it is kept so the next op kind
// added without an applier has to be excused in writing rather than discovered during a mount.
const DEFERRED = new Set<Op["kind"]>([]);

test("no op kind the planner emits is missing an applier", async () => {
  const source = await Bun.file(new URL("./mount/apply.ts", import.meta.url)).text();
  const emitted = new Set(plan(FOUR, M).ops.map((o) => o.kind));
  const unhandled = [...emitted].filter((k) => !source.includes(`case "${k}":`)).sort();
  expect(unhandled).toEqual([...DEFERRED].sort());
});

test("every op kind in the union is reachable from some plan, so none is dead code", () => {
  const emitted = new Set([...plan(FOUR, M).ops, ...plan(OFF, M).ops].map((o) => o.kind));
  for (const k of [
    "clone", "purge", "replace", "write", "jsonSet", "jsonUnset",
    "extractComponents", "moveFile", "splitCss", "importRewrite",
  ] satisfies Op["kind"][]) expect(emitted.has(k)).toBe(true);
});

// --- Task 6: the CLI ---------------------------------------------------------------------
// The preview test above covers the rendered block. This covers the whole CLI, because the
// flag parsing is where an absolute path leaks back in: --root is a path, and the obvious
// implementation echoes it.

const cliDryRun = async (answers: unknown) => {
  const file = join(tmpdir(), `mount-answers-${Bun.randomUUIDv7()}.json`);
  await Bun.write(file, JSON.stringify(answers));
  const root = dirname(import.meta.dir);
  const proc = Bun.spawn({
    cmd: ["bun", join(root, "scripts/mount.ts"), "--answers", file, "--dry-run", "--root", root],
    stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(),
  ]);
  return { exit: await proc.exited, stdout, stderr };
};

test("the CLI's dry run prints no absolute path, even though --root is one", async () => {
  const { exit, stdout } = await cliDryRun(FOUR);
  expect(exit).toBe(0);
  expect(stdout).toContain("Nothing has been written.");
  expect(stdout).not.toContain("/Users/");
  expect(stdout).not.toContain("/private/");
  expect(stdout).not.toContain(tmpdir());
  for (const line of stdout.split("\n")) expect(line.trimStart().startsWith("/")).toBe(false);
});

test("the CLI's dry run touches nothing on disk", async () => {
  const root = dirname(import.meta.dir);
  const before = (await $`git status --porcelain`.cwd(root).text()).trim();
  const mtimes = (await Array.fromAsync(new Glob("scripts/**/*.ts").scan({ cwd: root })))
    .sort().map((f) => `${f}:${statSync(join(root, f)).mtimeMs}`);
  await cliDryRun(FOUR);
  const after = (await $`git status --porcelain`.cwd(root).text()).trim();
  expect(after).toBe(before);
  expect((await Array.fromAsync(new Glob("scripts/**/*.ts").scan({ cwd: root })))
    .sort().map((f) => `${f}:${statSync(join(root, f)).mtimeMs}`)).toEqual(mtimes);
});

test("a bad slug fails at the CLI with a message, not a stack trace", async () => {
  const { exit, stdout, stderr } = await cliDryRun({ ...FOUR, slug: "Not A Slug" });
  expect(exit).toBe(1);
  expect(stderr).toContain("✖");
  expect(stderr).not.toContain("at ");
  expect(stdout).not.toContain("Nothing has been written.");
});

// --- Task 7: the design system -----------------------------------------------------------

test("the design system writes its package, its rig and its seed stories", () => {
  const written = plan(FOUR, M).ops.flatMap((o) => (o.kind === "write" ? [o.file] : []));
  for (const f of [
    "packages/ui/package.json", "packages/ui/tsconfig.json",
    ".storybook/main.ts", ".storybook/preview.tsx", ".storybook/storybook.css",
    ".storybook/tsconfig.json", "vitest.config.ts",
    "packages/ui/src/stories/button.stories.tsx",
    "packages/ui/src/stories/tokens.stories.tsx",
    "packages/ui/src/principles.mdx",
  ]) expect(written).toContain(f);
});

test("the design system writes none of those files when it is off", () => {
  const written = plan(OFF, M).ops.flatMap((o) => (o.kind === "write" ? [o.file] : []));
  for (const f of written) {
    expect(f.startsWith("packages/")).toBe(false);
    expect(f.startsWith(".storybook/")).toBe(false);
  }
  expect(written).not.toContain("vitest.config.ts");
});

// packages/ui's dependencies and the deps unset from each frontend both come from depMoves, so
// the two cannot drift apart. This asserts the wiring, not the list.
test("every dep moved off a frontend arrives in packages/ui", () => {
  const p = plan(FOUR, M);
  const pkg = p.ops.find((o) => o.kind === "write" && o.file === "packages/ui/package.json");
  expect(pkg?.kind).toBe("write");
  const deps = JSON.parse((pkg as { content: string }).content).dependencies as Record<string, string>;
  const unset = p.ops.flatMap((o) =>
    o.kind === "jsonUnset" && o.path[0] === "dependencies" ? [o.path[1]!] : [],
  );
  expect(unset.length).toBeGreaterThan(0);
  for (const d of new Set(unset)) expect(Object.keys(deps)).toContain(d);
});

test("a seed story named in mono.json with no body is a MountError, not a silent skip", () => {
  const broken = { ...M, designSystem: { ...M.designSystem, seedStories: ["nope.stories.tsx"] } };
  expect(() => plan(FOUR, broken)).toThrow(MountError);
});

// A published skelly-mono has no sibling template checkout, so this skips rather than fails when
// none is present. It is a development-time guard, not a release gate. Both frontend templates are
// checked, because splitCss reads whichever frontend is declared first — with no portal, the site.
// The local checkout of the portal template is in a directory still called skelly-admin.
const SIBLINGS = ["skelly-admin", "skelly-portal", "skelly-site"]
  .map((d) => resolve(dirname(import.meta.dir), "..", d, "src/index.css"))
  .filter((f) => existsSync(f));

test.skipIf(SIBLINGS.length === 0)(
  "splitTopLevel routes every block of the templates' index.css to theme or tokens",
  async () => {
    const { themeHolds, tokensHolds } = M.designSystem.cssSplit;
    for (const file of SIBLINGS) {
      const blocks = splitTopLevel(await Bun.file(file).text());
      const claims = (holds: string[], b: string) => holds.some((h) => b.startsWith(h));
      for (const h of [...themeHolds, ...tokensHolds]) {
        expect(blocks.some((b) => b.startsWith(h))).toBe(true);
      }
      // A block claimed by neither would vanish from both outputs. @import is expected to go: the
      // per-app index.css is rewritten with its own imports.
      const unclaimed = blocks.filter(
        (b) => !claims(themeHolds, b) && !claims(tokensHolds, b) && !b.startsWith("@import"),
      );
      expect({ file, unclaimed }).toEqual({ file, unclaimed: [] });
    }
  },
);

// --- Task 7: the appliers, executed for real ----------------------------------------------
// Everything above this point tests the planner, which never touches disk. These run apply()
// against a throwaway tree, because portal-wins and the drift report are only true if the code
// that moves bytes behaves the way the plan says it does.

const sandbox = () => {
  const root = join(tmpdir(), `mount-apply-${Bun.randomUUIDv7()}`);
  mkdirSync(root, { recursive: true });
  return root;
};

test("extractComponents keeps the first source's copy and names the dropped one", async () => {
  const root = sandbox();
  await Bun.write(join(root, "apps/portal/src/components/ui/button.tsx"), "PORTAL BUTTON\n");
  await Bun.write(join(root, "apps/portal/src/components/ui/card.tsx"), "SHARED CARD\n");
  await Bun.write(join(root, "apps/site/src/components/ui/button.tsx"), "SITE BUTTON\n");
  await Bun.write(join(root, "apps/site/src/components/ui/card.tsx"), "SHARED CARD\n");

  const report = await apply([{
    kind: "extractComponents",
    components: ["button.tsx", "card.tsx"],
    sources: ["apps/portal/src/components/ui", "apps/site/src/components/ui"],
    to: "packages/ui/src/components",
    policy: "portal-wins",
  }], root);

  // The portal is first, so its button survives and the site's is reported, not silently lost.
  expect(await Bun.file(join(root, "packages/ui/src/components/button.tsx")).text()).toBe("PORTAL BUTTON\n");
  expect(report.conflicts).toEqual([{
    file: "button.tsx",
    kept: "apps/portal/src/components/ui",
    dropped: "apps/site/src/components/ui",
  }]);
  // card.tsx is byte-identical in both, so it is not a conflict.
  expect(report.conflicts.map((c) => c.file)).not.toContain("card.tsx");
  expect(report.notFound).toEqual([]);
});

test("extractComponents reports a component the manifest does not name, and one it names in vain", async () => {
  const root = sandbox();
  await Bun.write(join(root, "apps/portal/src/components/ui/button.tsx"), "B\n");
  await Bun.write(join(root, "apps/portal/src/components/ui/surprise.tsx"), "NEW\n");

  const report = await apply([{
    kind: "extractComponents",
    components: ["button.tsx", "absent.tsx"],
    sources: ["apps/portal/src/components/ui"],
    to: "packages/ui/src/components",
    policy: "portal-wins",
  }], root);

  expect(existsSync(join(root, "packages/ui/src/components/surprise.tsx"))).toBe(false);
  expect(report.notFound.join("\n")).toContain("surprise.tsx (not in extract.components)");
  expect(report.notFound.join("\n")).toContain("absent.tsx (named in extract.components");
});

test("splitCss routes each block to one file and loses nothing", async () => {
  const root = sandbox();
  await Bun.write(join(root, "apps/portal/src/index.css"), [
    '@import "tailwindcss";',
    "@custom-variant dark (&:is(.dark *));",
    "@theme inline {\n  --color-background: var(--background);\n}",
    ":root {\n  --background: white;\n}",
    ".dark {\n  --background: black;\n}",
    "@layer base {\n  body {\n    @apply bg-background;\n  }\n}",
  ].join("\n\n") + "\n");

  const report = await apply([{
    kind: "splitCss",
    source: "apps/portal/src/index.css",
    theme: "packages/ui/src/theme.css",
    tokens: "packages/ui/src/tokens.css",
    themeHolds: ["@custom-variant dark", "@theme inline", "@layer base"],
    tokensHolds: [":root", ".dark"],
  }], root);

  const theme = await Bun.file(join(root, "packages/ui/src/theme.css")).text();
  const tokens = await Bun.file(join(root, "packages/ui/src/tokens.css")).text();
  expect(theme).toContain("@custom-variant dark");
  expect(theme).toContain("@theme inline");
  // @layer base uses @apply, so it has to land in the file Tailwind processes, never in tokens.css
  // — Storybook's preview.tsx imports tokens.css as plain CSS.
  expect(theme).toContain("@layer base");
  expect(tokens).toContain(":root");
  expect(tokens).toContain(".dark");
  expect(tokens).not.toContain("@apply");
  expect(report.notFound).toEqual([]);
});

test("splitCss reports a block that mono.json routes nowhere instead of dropping it", async () => {
  const root = sandbox();
  await Bun.write(join(root, "a.css"), ":root {\n  --x: 1;\n}\n\n@layer base {\n  body { color: red; }\n}\n");
  const report = await apply([{
    kind: "splitCss", source: "a.css",
    theme: "t.css", tokens: "k.css",
    themeHolds: [], tokensHolds: [":root"],
  }], root);
  expect(report.notFound.join("\n")).toContain("unclaimed CSS block");
  expect(report.notFound.join("\n")).toContain("@layer base");
});

test("an op whose path escapes the root aborts the mount rather than writing outside it", async () => {
  const root = sandbox();
  await expect(apply([{ kind: "purge", path: "../../etc/hosts" }], root)).rejects.toThrow(MountError);
});
