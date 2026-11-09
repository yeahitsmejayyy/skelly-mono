// What the user reads before saying yes.
import type { Answers, MountPlan } from "./types";

export function preview(p: MountPlan, answers: Answers): string {
  const out: string[] = ["", ...p.tree, ""];
  const scripts = p.ops.filter(
    (o) => o.kind === "jsonSet" && o.file === "package.json" && o.path[0] === "scripts",
  );
  out.push("Root scripts:");
  // Padded to the widest name, like the tree, so the arrows form a column.
  const names = scripts.map((s) => (s.kind === "jsonSet" ? String(s.path[1]) : ""));
  const nameW = Math.max(0, ...names.map((n) => n.length));
  scripts.forEach((s, n) => {
    if (s.kind !== "jsonSet") return;
    out.push(`  bun run ${names[n]!.padEnd(nameW)}  →  ${String(s.value)}`);
  });
  const clones = p.ops.filter((o) => o.kind === "clone").length;
  out.push("", `${clones} repositories will be cloned, ${p.ops.length} operations in all.`);
  out.push(answers.designSystem
    ? "Shared design system: YES — the frontends' primitives move into packages/ui."
    : "Shared design system: no — each frontend keeps its own primitives.");

  // Category C. The mount leaves these alone deliberately, which is exactly why the preview has
  // to say so: this is the difference between knowing your landing page still advertises Skelly
  // and finding out after you ship.
  if (p.demos.length) {
    out.push("", "Demo content you will inherit, untouched:");
    for (const d of p.demos) out.push(`  ${d.path}`, `      ${d.note}`);
  }

  if (p.warnings.length) out.push("", "Warnings:", ...p.warnings.map((w) => `  ! ${w}`));
  out.push("", "Nothing has been written. Re-run without --dry-run to apply.");
  return out.join("\n");
}
