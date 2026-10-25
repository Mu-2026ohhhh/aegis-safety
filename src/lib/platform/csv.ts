export function downloadCsv(filename: string, rows: string[][]) {
  const body = rows
    .map((row) =>
      row
        .map((cell) => `"${String(cell ?? "").replace(/"/g, '""')}"`)
        .join(",")
    )
    .join("\n");
  const blob = new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export const hitSeries = [
  { tenantId: "ten_demo", label: "example_politics", month: "2026-08", count: 86 },
  { tenantId: "ten_demo", label: "example_politics", month: "2026-09", count: 104 },
  { tenantId: "ten_demo", label: "example_politics", month: "2026-10", count: 97 },
  { tenantId: "ten_demo", label: "example_adult", month: "2026-08", count: 40 },
  { tenantId: "ten_demo", label: "example_adult", month: "2026-09", count: 55 },
  { tenantId: "ten_demo", label: "example_adult", month: "2026-10", count: 48 },
  { tenantId: "ten_retail", label: "example_politics", month: "2026-08", count: 12 },
  { tenantId: "ten_retail", label: "example_politics", month: "2026-09", count: 18 },
  { tenantId: "ten_retail", label: "example_politics", month: "2026-10", count: 15 },
  { tenantId: "ten_retail", label: "example_adult", month: "2026-08", count: 22 },
  { tenantId: "ten_retail", label: "example_adult", month: "2026-09", count: 31 },
  { tenantId: "ten_retail", label: "example_adult", month: "2026-10", count: 27 },
];
