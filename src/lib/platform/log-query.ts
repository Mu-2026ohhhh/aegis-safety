export type QueryTable = Record<string, string>;

export type QueryOutcome =
  | { ok: true; columns: string[]; rows: string[][] }
  | { ok: false; error: "syntax" | "table" | "column" };

const forbidden = /\b(insert|update|delete|drop|alter|create|attach|pragma|grant|truncate|into)\b/i;

function likeToRegExp(pattern: string) {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${escaped}$`, "i");
}

export function runSelect(sql: string, tables: Record<string, QueryTable[]>): QueryOutcome {
  const compact = sql.trim().replace(/\s+/g, " ").replace(/;$/, "");
  if (!compact || compact.includes(";") || forbidden.test(compact) || !/^select\s/i.test(compact)) {
    return { ok: false, error: "syntax" };
  }
  const match = compact.match(
    /^select\s+(\*|[a-z_][\w]*(?:\s*,\s*[a-z_][\w]*)*)\s+from\s+([a-z_][\w]*)(?:\s+where\s+(.+?))?(?:\s+limit\s+(\d+))?$/i
  );
  if (!match) return { ok: false, error: "syntax" };
  const [, columnText, tableName, whereText, limitText] = match;
  const source = tables[tableName.toLowerCase()];
  if (!source) return { ok: false, error: "table" };
  const known = new Set(source[0] ? Object.keys(source[0]) : []);
  const columns = columnText.trim() === "*" ? [...known] : columnText.split(",").map((item) => item.trim().toLowerCase());
  if (columns.some((column) => known.size > 0 && !known.has(column))) return { ok: false, error: "column" };

  let rows = source;
  if (whereText) {
    const parts = whereText.split(/\s+and\s+/i);
    const checks: Array<(row: QueryTable) => boolean> = [];
    for (const part of parts) {
      const like = part.match(/^([a-z_][\w]*)\s+like\s+'([^']*)'$/i);
      const eq = part.match(/^([a-z_][\w]*)\s*=\s+'([^']*)'$/i);
      const num = part.match(/^([a-z_][\w]*)\s*=\s+(-?\d+)$/i);
      const clause = like ?? eq ?? num;
      if (!clause) return { ok: false, error: "syntax" };
      const column = clause[1].toLowerCase();
      if (known.size > 0 && !known.has(column)) return { ok: false, error: "column" };
      const expected = clause[2];
      if (like) {
        const pattern = likeToRegExp(expected);
        checks.push((row) => pattern.test(row[column] ?? ""));
      } else {
        checks.push((row) => (row[column] ?? "") === expected);
      }
    }
    rows = rows.filter((row) => checks.every((check) => check(row)));
  }
  const limit = limitText ? Math.min(Number(limitText), 500) : 500;
  const sliced = rows.slice(0, limit);
  return {
    ok: true,
    columns,
    rows: sliced.map((row) => columns.map((column) => row[column] ?? "")),
  };
}
