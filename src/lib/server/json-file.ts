import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const dataDir = path.join(process.cwd(), "data");

let queue: Promise<void> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

export async function readJsonFile<T>(name: string, fallback: T): Promise<T> {
  return enqueue(async () => {
    try {
      const raw = await readFile(path.join(dataDir, name), "utf8");
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  });
}

export async function updateJsonFile<T>(name: string, fallback: T, update: (current: T) => T): Promise<T> {
  return enqueue(async () => {
    const target = path.join(dataDir, name);
    let current = fallback;
    try {
      current = JSON.parse(await readFile(target, "utf8")) as T;
    } catch {
      current = fallback;
    }
    const next = update(current);
    await mkdir(dataDir, { recursive: true });
    const temp = `${target}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(next), "utf8");
    await rename(temp, target);
    return next;
  });
}
