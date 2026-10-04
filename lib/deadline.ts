import { setTimeout as delay } from "node:timers/promises";

export function assertTimeLeft(deadline?: number): void {
  if (deadline != null && (!Number.isFinite(deadline) || deadline <= Date.now())) {
    throw new Error("Worker deadline reached");
  }
}

export function deadlineSignal(deadline: number | undefined, capMs: number): AbortSignal {
  assertTimeLeft(deadline);
  return AbortSignal.timeout(Math.max(1, Math.floor(Math.min(capMs, deadline == null ? capMs : deadline - Date.now()))));
}

export async function waitWithinBudget(ms: number, deadline?: number): Promise<void> {
  assertTimeLeft(deadline);
  await delay(ms, undefined, deadline == null ? undefined : { signal: deadlineSignal(deadline, ms + 1_000) });
  assertTimeLeft(deadline);
}
