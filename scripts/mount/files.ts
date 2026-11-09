// The literal files the design system needs, as text. They carry no decisions — plan.ts decides
// which get written and composes the two JSON files, which depend on mono.json. Kept apart so
// plan.ts stays readable as a compiler rather than a file bundle.

export const STORYBOOK_MAIN = `import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";

// The design system's Storybook: packages/ui, shared by every frontend in apps/.
const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../packages/ui/src/**/*.mdx", "../packages/ui/src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-docs", "@storybook/addon-a11y", "@storybook/addon-vitest"],
  core: { disableTelemetry: true },
  viteFinal: async (vite) => {
    vite.plugins = [...(vite.plugins ?? []), tailwindcss()];
    return vite;
  },
};
export default config;
`;

export const STORYBOOK_PREVIEW = `import type { Decorator, Preview } from "@storybook/react-vite";
import { useEffect } from "react";
import "../packages/ui/src/tokens.css";
import "./storybook.css";

// Light / dark from the toolbar, applied the way the apps do it: a class on <html>.
const withTheme: Decorator = (Story, context) => {
  const theme = context.globals.theme === "dark" ? "dark" : "light";
  useEffect(() => {
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.classList.add(theme);
  }, [theme]);
  const fill = context.parameters.fill === true;
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-background p-8 text-foreground">
      <div className={fill ? "w-full max-w-6xl" : "flex w-full max-w-6xl justify-center"}>
        <Story />
      </div>
    </div>
  );
};

const preview: Preview = {
  decorators: [withTheme],
  tags: ["autodocs"],
  globalTypes: {
    theme: {
      description: "Colour theme",
      toolbar: {
        title: "Theme", icon: "mirror", dynamicTitle: true,
        items: [{ value: "light", title: "Light" }, { value: "dark", title: "Dark" }],
      },
    },
  },
  initialGlobals: { theme: "light" },
  parameters: {
    layout: "fullscreen",
    controls: { expanded: true },
    // Reports without failing. Switch to "error" once the palette is settled.
    a11y: { test: "todo" },
    docs: { codePanel: true, source: { type: "dynamic", excludeDecorators: true } },
  },
};
export default preview;
`;

export const STORYBOOK_CSS = `@import "tailwindcss";
@import "tw-animate-css";
@import "../packages/ui/src/theme.css";

@source "../packages/ui/src";
`;

export const STORYBOOK_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["."]
}
`;

export const VITEST_CONFIG = `import path from "node:path";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// Storybook interaction tests (bun run test:storybook): every story renders in real Chromium.
// Kept apart from \`bun test\`, which runs the workspaces' own suites.
export default defineConfig({
  // Pre-bundle what Vite would otherwise discover mid-run on a cold start: it reloads the page
  // under the tests and whole files fail with "failed to find the current suite".
  optimizeDeps: { include: ["react/jsx-dev-runtime"] },
  test: {
    projects: [
      {
        extends: true,
        plugins: [storybookTest({ configDir: path.join(import.meta.dirname, ".storybook") })],
        test: {
          name: "storybook",
          browser: {
            enabled: true,
            headless: true,
            // CI installs Playwright's Chromium. Locally, CHROMIUM_PATH can point at an existing one.
            provider: playwright({
              launchOptions: process.env.CHROMIUM_PATH
                ? { executablePath: process.env.CHROMIUM_PATH }
                : {},
            }),
            instances: [{ browser: "chromium" }],
          },
          viewport: { width: 1280, height: 800 },
        },
      },
    ],
  },
});
`;

export const BUTTON_STORIES = `import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "../components/button";

const meta = {
  title: "Primitives/Button",
  component: Button,
  parameters: { usage: \`import { Button } from "@app/ui/components/button";\` },
} satisfies Meta<typeof Button>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "Button" } };
export const Secondary: Story = { args: { children: "Secondary", variant: "secondary" } };
export const Destructive: Story = { args: { children: "Delete", variant: "destructive" } };
export const Outline: Story = { args: { children: "Outline", variant: "outline" } };
export const Ghost: Story = { args: { children: "Ghost", variant: "ghost" } };
export const Small: Story = { args: { children: "Small", size: "sm" } };
export const Large: Story = { args: { children: "Large", size: "lg" } };
export const Disabled: Story = { args: { children: "Disabled", disabled: true } };
`;

export const TOKENS_STORIES = `import type { Meta, StoryObj } from "@storybook/react-vite";

const SURFACES = [
  ["background", "foreground"], ["card", "card-foreground"],
  ["popover", "popover-foreground"], ["primary", "primary-foreground"],
  ["secondary", "secondary-foreground"], ["muted", "muted-foreground"],
  ["accent", "accent-foreground"], ["destructive", "destructive-foreground"],
] as const;

function Swatches() {
  return (
    <div className="grid w-full grid-cols-2 gap-3 md:grid-cols-4">
      {SURFACES.map(([bg, fg]) => (
        <div key={bg} className={\`rounded-lg border border-border bg-\${bg} p-4 text-\${fg}\`}>
          <div className="text-sm font-medium">{bg}</div>
          <div className="text-xs opacity-70">{fg}</div>
        </div>
      ))}
    </div>
  );
}

function TypeScale() {
  return (
    <div className="space-y-2 text-foreground">
      <p className="text-4xl font-semibold">Display 4xl</p>
      <p className="text-2xl font-semibold">Heading 2xl</p>
      <p className="text-base">Body base — the size most interface text sits at.</p>
      <p className="text-sm text-muted-foreground">Muted sm — captions and help text.</p>
      <p className="font-mono text-sm">Mono sm — code and identifiers.</p>
    </div>
  );
}

const meta = { title: "Tokens", parameters: { fill: true } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Surfaces: Story = { render: () => <Swatches /> };
export const Typography: Story = { render: () => <TypeScale /> };
`;

export const PRINCIPLES_MDX = `import { Meta } from "@storybook/addon-docs/blocks";

<Meta title="Principles" />

# Principles

The rules this design system holds itself to. Replace this page with your own — it is the first
thing anyone opening Storybook reads.

- **One source.** A component lives in \`packages/ui\` and nowhere else. If it exists twice, the
  copies will diverge; they always do.
- **Tokens, not values.** Components reference \`bg-background\` and \`text-foreground\`, never a hex
  code, so a theme change reaches everything.
- **Both themes, always.** Every story is checked in light and dark from the toolbar before it is
  called done.
`;

// types: ["react"], NOT belltax's ["bun"] — this package is browser code.
export const UI_TSCONFIG = `{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "types": ["react"]
  },
  "include": ["src"]
}
`;
