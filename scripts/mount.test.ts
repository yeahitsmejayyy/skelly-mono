import { expect, test } from "bun:test";
import { plan } from "./mount/plan";
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
