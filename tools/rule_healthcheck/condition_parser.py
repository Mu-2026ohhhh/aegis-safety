"""规则条件的结构识别。只做解析和问题标记，不改写原始条件。"""

from __future__ import annotations

import re
from dataclasses import dataclass

# 长词优先，避免 eq 吃掉 neq、contain 吃掉 notContain、= 吃掉 >=。
OPERATORS: tuple[str, ...] = (
    "notContain",
    "subsetp",
    "contain",
    "neq",
    "eq",
    ">=",
    "<=",
    "!=",
    "==",
    ">",
    "<",
    "=",
)
WORD_OPERATORS = {"notContain", "subsetp", "contain", "neq", "eq"}
OPERATOR_VOCAB = set(OPERATORS)

_ILLEGAL_EXCEL = re.compile(r"[\000-\010\013\014\016-\037]")


@dataclass(frozen=True)
class ParseResult:
    level: str
    expr_type: str
    feature: str
    operator: str
    threshold: str
    reason: str
    operator_inside_feature: bool
    top_level_ops: int


def normalize_parens(text: str) -> str:
    return text.replace("（", "(").replace("）", ")")


def squash(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _is_boundary(ch: str) -> bool:
    return not (ch.isalnum() or ch == "_")


def find_operators(text: str, *, respect_depth: bool) -> list[tuple[int, str]]:
    found: list[tuple[int, str]] = []
    i = 0
    depth = 0
    length = len(text)
    while i < length:
        ch = text[i]
        if ch == "(":
            depth += 1
            i += 1
            continue
        if ch == ")":
            depth = max(0, depth - 1)
            i += 1
            continue
        if respect_depth and depth != 0:
            i += 1
            continue
        matched = ""
        for op in OPERATORS:
            if not text.startswith(op, i):
                continue
            if op in WORD_OPERATORS:
                before = text[i - 1] if i else " "
                after_i = i + len(op)
                after = text[after_i] if after_i < length else " "
                if not _is_boundary(before) or not _is_boundary(after):
                    continue
            matched = op
            break
        if matched:
            found.append((i, matched))
            i += len(matched)
            continue
        i += 1
    return found


def _balanced(text: str) -> bool:
    depth = 0
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def _strip_wrapping(text: str) -> tuple[str, bool]:
    if len(text) < 2 or text[0] != "(" or text[-1] != ")":
        return text, False
    depth = 0
    for i, ch in enumerate(text):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return text, False
            if depth == 0 and i != len(text) - 1:
                return text, False
    if depth != 0:
        return text, False
    return text[1:-1].strip(), True


def _base_type(operator: str, threshold: str) -> str:
    if operator in {">", ">=", "<", "<="}:
        return "数值比较"
    if operator in {"=", "==", "eq", "neq", "!="}:
        if re.fullmatch(r"-?\d+(?:\.\d+)?", threshold):
            return "数值等值"
        return "文本等值"
    if operator in {"contain", "notContain"}:
        return "包含判断"
    if operator == "subsetp":
        return "集合关系"
    return "其他"


def parse_condition(condition: str) -> ParseResult:
    raw = "" if condition is None else str(condition)
    text = squash(normalize_parens(raw))
    if not text:
        return ParseResult("无法解析", "空条件", "", "", "", "空条件", False, 0)

    inner, wrapped = _strip_wrapping(text)
    has_paren = "(" in text or ")" in text
    if has_paren and not wrapped:
        ops = find_operators(inner if wrapped else text, respect_depth=True)
        return _from_ops(
            text if not wrapped else inner,
            ops,
            level_if_single="部分解析",
            reason="括号未整体包裹或括号不平衡",
            force_partial=True,
        )

    if not _balanced(inner):
        ops = find_operators(inner, respect_depth=True)
        return _from_ops(inner, ops, level_if_single="部分解析", reason="括号不平衡", force_partial=True)

    ops = find_operators(inner, respect_depth=True)
    return _from_ops(inner, ops, level_if_single="能够解析", reason="", force_partial=False)


def _from_ops(
    inner: str,
    ops: list[tuple[int, str]],
    *,
    level_if_single: str,
    reason: str,
    force_partial: bool,
) -> ParseResult:
    if not ops:
        return ParseResult("无法解析", "未识别运算符", "", "", "", reason or "未找到已知运算符", False, 0)

    index, operator = ops[-1]
    feature = inner[:index].strip()
    threshold = inner[index + len(operator) :].strip()
    inside = bool(feature) and bool(find_operators(feature, respect_depth=False))
    base = _base_type(operator, threshold)
    if len(ops) > 1:
        level = "部分解析"
        expr = f"{base}（顶层运算符不唯一）"
        why = reason or f"顶层运算符 {len(ops)} 个，不能唯一切分"
    elif not feature or not threshold:
        level = "部分解析"
        expr = f"{base}（结构不完整）"
        why = reason or "运算符一侧为空"
    elif force_partial:
        level = "部分解析"
        expr = f"{base}（结构不完整）"
        why = reason or "结构不完整"
    else:
        level = level_if_single
        expr = base
        why = ""
    return ParseResult(level, expr, feature, operator, threshold, why, inside, len(ops))


def _mask_chunk(chunk: str) -> str:
    chunk = re.sub(r"[\u4e00-\u9fff]+", "文", chunk)

    def _token(match: re.Match[str]) -> str:
        token = match.group(0)
        if re.fullmatch(r"\d+(?:\.\d+)?", token):
            return "n"
        return "id"

    chunk = re.sub(r"[A-Za-z0-9_.]+", _token, chunk)
    chunk = re.sub(r"[^\x20-\x7e文]+", "文", chunk)
    return chunk


def skeleton(condition: str) -> str:
    """结构骨架。中文、标识符和数字都替换掉，只保留运算符和括号。"""
    text = squash(normalize_parens("" if condition is None else str(condition)))
    text = text.translate(str.maketrans({"：": ":", "，": ",", "、": "/"}))
    pattern = re.compile("|".join(re.escape(op) for op in OPERATORS))
    parts: list[str] = []
    cursor = 0
    for match in pattern.finditer(text):
        parts.append(_mask_chunk(text[cursor : match.start()]))
        parts.append(match.group(0))
        cursor = match.end()
    parts.append(_mask_chunk(text[cursor:]))
    return squash("".join(parts))[:180]


def clean_excel_text(value: str) -> str:
    return _ILLEGAL_EXCEL.sub("", value)
