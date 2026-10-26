import { createId } from "@/lib/platform/hash";
import type { Inquiry, InquiryInput } from "@/lib/inquiries";
import { readJsonFile, updateJsonFile } from "@/lib/server/json-file";

const fileName = "inquiries.json";

function asList(value: unknown): Inquiry[] {
  return Array.isArray(value) ? (value as Inquiry[]) : [];
}

export async function listInquiries(): Promise<Inquiry[]> {
  return asList(await readJsonFile<unknown>(fileName, []));
}

export async function addInquiry(input: InquiryInput): Promise<Inquiry> {
  const record: Inquiry = {
    ...input,
    id: createId("inq"),
    createdAt: new Date().toISOString(),
  };
  await updateJsonFile<Inquiry[]>(fileName, [], (current) => [record, ...asList(current)].slice(0, 2000));
  return record;
}
