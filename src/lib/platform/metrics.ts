export type OutcomeKind = "correct" | "falsePositive" | "falseNegative" | "reviewGap" | "error" | "unlabeled";

export type MetricDefinition = {
  id: string;
  name: string;
  formula: string;
};

export type OutcomeCounts = {
  total: number;
  correct: number;
  falsePositive: number;
  falseNegative: number;
  expectedPass: number;
  expectedReject: number;
  expectedReview: number;
  actualPass: number;
  actualReject: number;
  actualReview: number;
  error: number;
  unlabeled: number;
  reviewGap: number;
};

export const defaultMetrics: MetricDefinition[] = [
  { id: "accuracy", name: "", formula: "correct / total" },
  { id: "falsePositiveRate", name: "", formula: "falsePositive / expectedPass" },
  { id: "falseNegativeRate", name: "", formula: "falseNegative / expectedReject" },
];

export function classifyOutcome(expected: string, decision: string, status: string): OutcomeKind {
  if (status === "error" || (expected && !decision)) return "error";
  if (!expected) return "unlabeled";
  if (expected === "allow" && decision === "block") return "falsePositive";
  if (expected === "block" && decision === "allow") return "falseNegative";
  if (expected === decision) return "correct";
  return "reviewGap";
}

export function countOutcomes(rows: Array<{ expected: string; decision: string; status: string }>): OutcomeCounts {
  const counts: OutcomeCounts = {
    total: 0,
    correct: 0,
    falsePositive: 0,
    falseNegative: 0,
    expectedPass: 0,
    expectedReject: 0,
    expectedReview: 0,
    actualPass: 0,
    actualReject: 0,
    actualReview: 0,
    error: 0,
    unlabeled: 0,
    reviewGap: 0,
  };
  for (const row of rows) {
    const kind = classifyOutcome(row.expected, row.decision, row.status);
    if (kind === "error") {
      counts.error += 1;
      continue;
    }
    if (kind === "unlabeled") {
      counts.unlabeled += 1;
      continue;
    }
    counts.total += 1;
    if (row.expected === "allow") counts.expectedPass += 1;
    if (row.expected === "block") counts.expectedReject += 1;
    if (row.expected === "review") counts.expectedReview += 1;
    if (row.decision === "allow") counts.actualPass += 1;
    if (row.decision === "block") counts.actualReject += 1;
    if (row.decision === "review") counts.actualReview += 1;
    if (kind === "correct") counts.correct += 1;
    if (kind === "falsePositive") counts.falsePositive += 1;
    if (kind === "falseNegative") counts.falseNegative += 1;
    if (kind === "reviewGap") counts.reviewGap += 1;
  }
  return counts;
}

export function evaluateFormula(formula: string, counts: OutcomeCounts): number | null {
  const source = formula.replace(/\s+/g, "");
  if (!source) return null;
  let index = 0;
  const known = counts as unknown as Record<string, number>;

  function peek() {
    return source[index];
  }

  function parseExpression(): number | null {
    let left = parseTerm();
    if (left == null) return null;
    while (peek() === "+" || peek() === "-") {
      const operator = source[index];
      index += 1;
      const right = parseTerm();
      if (right == null) return null;
      left = operator === "+" ? left + right : left - right;
    }
    return left;
  }

  function parseTerm(): number | null {
    let left = parseFactor();
    if (left == null) return null;
    while (peek() === "*" || peek() === "/") {
      const operator = source[index];
      index += 1;
      const right = parseFactor();
      if (right == null) return null;
      if (operator === "/" && right === 0) return Number.NaN;
      left = operator === "*" ? left * right : left / right;
    }
    return left;
  }

  function parseFactor(): number | null {
    if (peek() === "(") {
      index += 1;
      const value = parseExpression();
      if (peek() !== ")") return null;
      index += 1;
      return value;
    }
    if (peek() === "-") {
      index += 1;
      const value = parseFactor();
      return value == null ? null : -value;
    }
    if (peek() >= "0" && peek() <= "9") {
      const start = index;
      while ((peek() >= "0" && peek() <= "9") || peek() === ".") index += 1;
      const numeric = Number(source.slice(start, index));
      return Number.isFinite(numeric) ? numeric : null;
    }
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(index));
    if (!match || !(match[0] in known)) return null;
    index += match[0].length;
    return known[match[0]];
  }

  const value = parseExpression();
  if (value == null || index !== source.length) return null;
  return value;
}

export function mergeMetrics(current: MetricDefinition[] | undefined): MetricDefinition[] {
  const list = (current ?? []).filter((item) => item?.id && typeof item.formula === "string");
  if (!list.length) return defaultMetrics;
  const ids = new Set(list.map((item) => item.id));
  return [...list.map((item) => ({ id: item.id, name: item.name ?? "", formula: item.formula })), ...defaultMetrics.filter((item) => !ids.has(item.id))];
}
