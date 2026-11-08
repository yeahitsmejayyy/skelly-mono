# Working in this monorepo

One bun workspace. `apps/*` are the deployable containers, `packages/*` is shared code.

## Commands, always from the root

- `bun install` — one lockfile, one `node_modules`. Never install inside an app.
- `bun run dev` — the backend. Each frontend has its own `bun run dev:<name>`.
- `bun run typecheck` — every workspace. This is the gate; run it before saying anything works.
- `bun run build` — builds every frontend. Each app's `build` runs `tsc -b` first, so a type
  error fails the build. That is intended. Do not skip the typecheck to get a green build.

## The tRPC contract is a snapshot, not an import

`apps/server` owns the router. Each frontend holds a *committed copy* of its type at
`src/lib/app-router.d.ts`, so the frontends typecheck and build with no backend present and
without Bun types. After changing any procedure: `bun run sync:types`, then commit the copies.
Never import server source from a frontend.

## packages/ui, when it exists

The single source for shared components, tokens and `utils`. One edit reaches every app. If you
change a component, you are changing it everywhere — check the other apps' usages.

**Tailwind v4 only scans an app's own tree.** Every app's `src/index.css` therefore carries
`@source "../../../packages/ui/src";`. If an extracted component renders unstyled, that line is
missing.

## Ports

The backend is 3001. Vite defaults to 5173, so two frontends running at once means the second
silently moves to 5174 and the backend's CORS rejects it. Give each frontend an explicit port.
