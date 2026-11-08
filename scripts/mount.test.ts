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
