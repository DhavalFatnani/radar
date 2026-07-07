/** The run's funded-since window: the form's override if valid, else the sourcing-plan default. */
export function resolveFundedSinceDays(planDefault: number, configOverride: unknown): number {
  return typeof configOverride === "number" && Number.isFinite(configOverride) && configOverride > 0
    ? configOverride
    : planDefault;
}
