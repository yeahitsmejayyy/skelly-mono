import { expect, test } from "bun:test";
import { plan } from "./mount/plan";
import { preview } from "./mount/preview";
import { MountError } from "./mount/types";
import manifest from "../mono.json";
import type { Manifest } from "./mount/types";

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
