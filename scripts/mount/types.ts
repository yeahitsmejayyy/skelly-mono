// The compiler's vocabulary. mono.json is the spec; an Op is one instruction in the compiled
// output; apply.ts is the only thing that executes them.

export type Instance = { id: string; dir: string };
export type Answers = { slug: string; instances: Instance[]; designSystem: boolean };

export type Rename = { file: string; from: string; to: string };
export type Rewrite = { file: string; content: string };
export type Demo = { path: string; note: string };

export type Container = {
  id: string;
  summary: string;
  repo: string;
  defaultDir: string;
  role: "backend" | "frontend";
  multiple: boolean;
  pkg: string;
  run: string;
  rename: Rename[];
  rewrite: Rewrite[];
  purge: string[];
  appScriptsDrop: string[];
  // Scripts the template does not ship but the monorepo's root gate needs. The server and the
  // site have no `typecheck` of their own, so `bun run typecheck` would skip them in silence.
  appScriptsSet: Record<string, string>;
  rootScripts: Record<string, string>;
  demo: Demo[];
  contractSource?: boolean;
  contractTarget?: boolean;
};

export type DesignSystem = {
  pkg: string;
  dir: string;
  peerDeps: Record<string, string>;
  conflictPolicy: "portal-wins";
  exports: Record<string, string>;
  extract: {
    components: string[];
    from: string;
    to: string;
    files: { from: string; to: string }[];
  };
  cssSplit: {
    source: string; theme: string; tokens: string;
    themeHolds: string[]; tokensHolds: string[];
  };
  importRewrites: { from: string; to: string }[];
  // The extracted components' own imports. They move out of the app tree, so the apps' rewrites
  // never reach them and they need their own, relative to packages/ui/src.
  pkgImportRewrites: { from: string; to: string }[];
  depMoves: Record<string, string>;
  // Deps packages/ui needs that the frontends keep anyway, because their own code imports them
  // directly. lucide-react is the case: every nav item in every app names an icon.
  depKeep: string[];
  seedStories: string[];
  rootScripts: Record<string, string>;
  devDeps: Record<string, string>;
};

export type Manifest = { containers: Container[]; designSystem: DesignSystem };

export type Op =
  // Effects on the shell and the mounted apps.
  | { kind: "clone"; repo: string; dest: string }
  | { kind: "purge"; path: string }
  | { kind: "replace"; file: string; from: string; to: string; required: boolean }
  | { kind: "write"; file: string; content: string }
  | { kind: "jsonSet"; file: string; path: string[]; value: unknown }
  | { kind: "jsonUnset"; file: string; path: string[] }
  // Design-system effects, applied only when answers.designSystem is true.
  | { kind: "extractComponents"; components: string[]; sources: string[]; to: string; policy: "portal-wins" }
  | { kind: "moveFile"; from: string; to: string }
  | { kind: "splitCss"; source: string; theme: string; tokens: string; themeHolds: string[]; tokensHolds: string[] }
  | { kind: "importRewrite"; dir: string; from: string; to: string };

// `demos` is category C: content the templates ship on purpose, which the mount leaves alone
// and the preview must say out loud. Paths are relative to the monorepo root, not the template.
export type MountPlan = { ops: Op[]; warnings: string[]; tree: string[]; demos: Demo[] };

export class MountError extends Error {}
