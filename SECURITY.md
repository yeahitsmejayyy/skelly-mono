# Security Policy

skelly-mono is a **monorepo shell plus a mount script**. There is no service and no runtime.
The security surface is what `scripts/mount.ts` does to your filesystem when you run it, and
what the templates it clones bring with them.

---

## Supported Versions

Only `main` is supported. There are no releases, tags, or backports.

---

## What `bun run mount` Does

1. **Clones templates over HTTPS** from `github.com/yeahitsmejayyy/skelly-{backend,portal,site}`,
   shallowly, into `apps/` inside this repository.
2. **Deletes each clone's `.git`**, so the result is your repository with no Skelly history and
   no remote pointing at us.
3. **Rewrites a fixed list of strings** in a fixed list of files, and **deletes a fixed list of
   paths**. Both lists live in `mono.json`, as data. Nothing is inferred or improvised.
4. Optionally **moves shared components into `packages/ui`** and writes a Storybook rig.

It writes only inside this repository. It reads no credentials and sends nothing anywhere.

**`--dry-run` prints the complete plan and exits without touching anything.** Run it first.
The planner is pure — no filesystem, no network, no clock — so the plan you read is the plan
that executes, not a summary of one.

Every path the applier writes passes through a containment check that rejects anything
resolving outside the repository root. A `mono.json` or a slug that tries to escape fails
loudly rather than writing outside the tree.

---

## What To Check Before You Trust It

* `mono.json` — every string replacement and every deletion, in one file you can read.
* `scripts/mount/apply.ts` — the only file that touches the disk or the network.
* `bun run mount ... --dry-run` — the actual plan, before you let it run.
* The templates themselves, which are what ends up in your project. Each has its own
  `SECURITY.md`.

If the mount proposes something that does not match `mono.json`, stop and tell us — that is a
bug or a compromise, and both matter.

---

## Known Sharp Edges

* **The templates are skeletons, not hardened services.** `skelly-portal` ships a login screen
  with no session behind it; `skelly-backend` runs open CORS to a localhost origin. Both are
  documented in their own repositories. Do not deploy either as-is.
* **Cloning executes nothing, but `bun install` does.** Dependencies come from each template's
  committed lockfile, which the mount then discards in favour of one root lockfile. Read it if
  that matters to you.
* **The mount is not idempotent.** Running it twice into a populated `apps/` is not supported;
  it stops rather than merging.

---

## Reporting

Open a [security advisory](https://github.com/yeahitsmejayyy/skelly-mono/security/advisories/new)
or an issue. This is a personal project, so expect a human response rather than a fast one.
