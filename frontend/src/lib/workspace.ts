/** Backend stores ``User.workspace`` as lowercase enum: ``ds`` | ``nota``. */
export function isNotaWorkspace(workspace: string | undefined | null): boolean {
  return String(workspace ?? "").trim().toLowerCase() === "nota";
}
