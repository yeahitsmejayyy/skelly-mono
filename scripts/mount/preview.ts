// What the user reads before saying yes.
import type { Answers, MountPlan } from "./types";

export function preview(p: MountPlan, answers: Answers): string {
  const out: string[] = ["", ...p.tree, ""];
  const scripts = p.ops.filter(
    (o) => o.kind === "jsonSet" && o.file === "package.json" && o.path[0] === "scripts",
  );
  out.push("Root scripts:");
  for (const s of scripts) {
    if (s.kind !== "jsonSet") continue;
    out.push(`  bun run ${s.path[1]}  →  ${String(s.value)}`);
  }
  const clones = p.ops.filter((o) => o.kind === "clone").length;
  out.push("", `${clones} repositories will be cloned, ${p.ops.length} operations in all.`);
  out.push(answers.designSystem
    ? "Shared design system: YES — the frontends' primitives move into packages/ui."
    : "Shared design system: no — each frontend keeps its own primitives.");
  if (p.warnings.length) out.push("", "Warnings:", ...p.warnings.map((w) => `  ! ${w}`));
  out.push("", "Nothing has been written. Re-run without --dry-run to apply.");
  return out.join("\n");
}
