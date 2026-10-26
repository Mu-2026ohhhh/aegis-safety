import { isPrototypeState } from "@/lib/platform/state-guard";
import type { PrototypeState } from "@/lib/platform/types";
import { readJsonFile, updateJsonFile } from "@/lib/server/json-file";

const fileName = "prototype-state.json";

export type StateEnvelope = {
  savedAt: string;
  state: PrototypeState;
};

export async function readPrototypeState(): Promise<StateEnvelope | null> {
  const value = await readJsonFile<unknown>(fileName, null);
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<StateEnvelope>;
  if (typeof record.savedAt !== "string" || !isPrototypeState(record.state)) return null;
  return { savedAt: record.savedAt, state: record.state };
}

export async function writePrototypeState(savedAt: string, state: PrototypeState): Promise<void> {
  await updateJsonFile(fileName, null, () => ({ savedAt, state }));
}
