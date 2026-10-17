import { join } from "node:path";
import { scheduleSlot } from "./calendar.mjs";
import { atomicJSON, readJSON, withLock, appendJSONL } from "./storage.mjs";

export async function scheduledTick(directory, epoch, execute) {
  const slot = scheduleSlot(epoch);
  if (!slot) return { status: "IDLE" };
  return withLock(directory, async () => {
    const path = join(directory, "scheduler-state.json");
    let previous;
    try { previous = await readJSON(path); } catch (error) { if (error.code !== "ENOENT") throw error; }
    if (previous?.key === slot.key) return { status: "ALREADY_ATTEMPTED", key: slot.key };
    // Claim before spawning. A restart must not silently duplicate a pass or
    // daily scorecard. Failed claims remain visible for deliberate manual retry.
    const state = { key: slot.key, date: slot.date, mode: slot.mode, status: "RUNNING", startedAt: epoch };
    await atomicJSON(path, state);
    try {
      const result = await execute(slot);
      const final = { ...state, status: result.code === 0 ? "COMPLETED" : "FAILED", exitCode: result.code, output: result.output };
      await atomicJSON(path, final);
      await appendJSONL(join(directory, "scheduler-events.jsonl"), final);
      return final;
    } catch (error) {
      const final = { ...state, status: "FAILED", reason: error.message };
      await atomicJSON(path, final);
      await appendJSONL(join(directory, "scheduler-events.jsonl"), final);
      return final;
    }
  }, "scheduler.lock");
}
