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
  depMoves: Record<string, string>;
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
  // Design-system effects. Task 7 adds their appliers.
  | { kind: "extractComponents"; sources: string[]; to: string; policy: "portal-wins" }
  | { kind: "moveFile"; from: string; to: string }
  | { kind: "splitCss"; source: string; theme: string; tokens: string; themeHolds: string[]; tokensHolds: string[] }
  | { kind: "importRewrite"; dir: string; from: string; to: string };

// `demos` is category C: content the templates ship on purpose, which the mount leaves alone
// and the preview must say out loud. Paths are relative to the monorepo root, not the template.
export type MountPlan = { ops: Op[]; warnings: string[]; tree: string[]; demos: Demo[] };

export class MountError extends Error {}
