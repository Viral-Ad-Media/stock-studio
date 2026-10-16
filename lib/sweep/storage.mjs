import { mkdir, open, readFile, rename, unlink, appendFile } from "node:fs/promises";
import { join } from "node:path";
export async function readJSON(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
export async function atomicJSON(path, value) {
  const temp = path + "." + process.pid + ".tmp";
  await import("node:fs/promises").then(fs => fs.writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 }));
  await rename(temp, path);
}
export async function appendJSONL(path, value) {
  await appendFile(path, JSON.stringify(value) + "\n", { mode: 0o600 });
}
export async function readJSONL(path) {
  try {
    const text = await readFile(path, "utf8");
    return text.split("\n").filter(Boolean).map((line, i) => {
      try { return JSON.parse(line); } catch { throw new Error("CORRUPT_JSONL_LINE:" + (i + 1)); }
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
// One runner host and a persistent shared directory. Never steal a stale lock
// automatically: verify the owning process is stopped before operator removal.
export async function withLock(directory, fn) {
  await mkdir(directory, { recursive: true });
  const path = join(directory, "scanner.lock");
  let lock;
  try { lock = await open(path, "wx", 0o600); }
  catch (error) { if (error.code === "EEXIST") return { status: "SKIPPED_OVERLAP" }; throw error; }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    return await fn();
  } finally {
    await lock.close();
    await unlink(path);
  }
}
