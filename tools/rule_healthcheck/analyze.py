"""只读体检：字段、规则标识粒度、条件解析和拆分列一致性。"""

from __future__ import annotations

import re
from collections import Counter, defaultdict
from dataclasses import dataclass, field

import pandas as pd

from condition_parser import (
    OPERATOR_VOCAB,
    clean_excel_text,
    normalize_parens,
    parse_condition,
    skeleton,
    squash,
)

ALIASES: dict[str, list[str]] = {
    "seq": ["序号"],
    "rule_id": ["规则标识"],
    "rule_name": ["规则名称"],
    "status": ["规则状态"],
    "rule_type": ["规则类型"],
    "product": ["策略产品"],
    "scene": ["策略场景"],
    "company": ["公司"],
    "app": ["应用"],
    "channel": ["渠道/事件"],
    "risk_label": ["风险标签"],
    "label_l4": ["关联四级标签"],
    "label_status": ["标签状态"],
    "risk_type": ["风险类型"],
    "action": ["处置建议"],
    "score": ["得分"],
    "blacklist": ["是否拉黑"],
    "blacklist_field": ["拉黑字段"],
    "condition": ["规则条件"],
    "created_at": ["创建时间"],
    "description": ["规则描述"],
    "remark": ["备注"],
    "source": ["来源"],
    "feature": ["模型特征名称"],
    "operator": ["比较运算值"],
    "threshold": ["阈值名单", "阈值"],
}

REQUIRED_ROLES = ("rule_id", "condition")
SEMANTIC_ROLES = (
    "rule_name",
    "status",
    "risk_label",
    "risk_type",
    "action",
    "score",
    "label_status",
    "label_l4",
    "blacklist",
    "blacklist_field",
)
SCOPE_ROLES = ("rule_type", "scene", "company", "app", "channel", "source", "product")
VERSION_ROLES = ("description", "remark", "created_at")
HIDDEN_PREVIEW_ROLES = {
    "rule_name",
    "risk_label",
    "label_l4",
    "description",
    "remark",
    "blacklist_field",
    "condition",
    "feature",
    "threshold",
}
DISTRIBUTION_ROLES = (
    "status",
    "rule_type",
    "product",
    "scene",
    "company",
    "app",
    "channel",
    "label_status",
    "risk_type",
    "action",
    "blacklist",
    "source",
    "score",
)

ISSUE_LABELS = {
    "empty_condition": "条件为空",
    "unparsed": "无法解析条件",
    "partial_multi_op": "顶层运算符不唯一",
    "partial_incomplete": "条件结构不完整",
    "operator_not_in_vocab": "比较运算值不在已知运算符词表",
    "column_shift": "疑似列错位（运算符、阈值、无表头列）",
    "feature_mismatch": "模型特征名称与条件不一致",
    "operator_mismatch": "比较运算值与条件不一致",
    "threshold_mismatch": "阈值或名单与条件不一致",
    "threshold_missing_in_column": "条件中有阈值但阈值列为空",
    "operator_inside_feature": "特征文本中仍含比较运算符",
    "overflow_column": "无表头列有值",
    "exact_duplicate": "完全重复行",
}


class HealthcheckError(Exception):
    pass


@dataclass
class ResolvedColumns:
    mapping: dict[str, str]
    missing_roles: list[str]
    overflow_cols: list[str]
    original_columns: list[str]


@dataclass
class Analysis:
    cover: list[tuple[str, str]]
    fields: pd.DataFrame
    distributions: pd.DataFrame
    rule_detail: pd.DataFrame
    structure: pd.DataFrame
    differences: pd.DataFrame
    parse_stats: pd.DataFrame
    samples: pd.DataFrame
    anomalies: pd.DataFrame
    review: pd.DataFrame
    impacts: pd.DataFrame
    log_lines: list[str] = field(default_factory=list)


def canon_header(name: object) -> str:
    text = "" if name is None else str(name).strip()
    return text.replace("\\", "").replace("/", "")


def cell_to_text(value: object) -> str:
    if value is None:
        return ""
    try:
        if pd.isna(value):
            return ""
    except TypeError:
        pass
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, pd.Timestamp):
        return value.strftime("%Y-%m-%d %H:%M:%S")
    text = str(value).strip()
    if text.lower() in {"nan", "none", "nat"}:
        return ""
    return text


def resolve_columns(columns: list[object]) -> ResolvedColumns:
    original = [str(column) for column in columns]
    by_canon: dict[str, str] = {}
    for column in original:
        by_canon.setdefault(canon_header(column), column)
    mapping: dict[str, str] = {}
    missing: list[str] = []
    for role, aliases in ALIASES.items():
        found = ""
        for alias in aliases:
            if alias in original:
                found = alias
                break
            canon = canon_header(alias)
            if canon in by_canon:
                found = by_canon[canon]
                break
        if found:
            mapping[role] = found
        else:
            missing.append(role)
    absent = [role for role in REQUIRED_ROLES if role not in mapping]
    if absent:
        raise HealthcheckError(
            "缺少必要字段 "
            + "、".join(absent)
            + "。实际字段："
            + "、".join(original)
        )
    overflow = [column for column in original if column.startswith("Unnamed")]
    return ResolvedColumns(mapping, missing, overflow, original)


def _roles(resolved: ResolvedColumns, roles: tuple[str, ...]) -> list[str]:
    return [resolved.mapping[role] for role in roles if role in resolved.mapping]


def _infer_type(values: list[str]) -> str:
    present = [value for value in values if value]
    if not present:
        return "空列"
    numeric = sum(bool(re.fullmatch(r"-?\d+(?:\.\d+)?", value)) for value in present)
    temporal = sum(
        bool(re.fullmatch(r"\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}:\d{2})?", value))
        for value in present
    )
    if numeric / len(present) >= 0.9:
        return "数值"
    if temporal / len(present) >= 0.9:
        return "日期时间"
    unique = len(set(present))
    if unique <= 30:
        return "低基数分类"
    if max(len(value) for value in present) >= 40:
        return "长文本"
    return "文本"


def _preview(role: str, values: list[str]) -> str:
    unique = sorted({value if value else "<空>" for value in values})
    if role in HIDDEN_PREVIEW_ROLES:
        return f"{len(unique)} 个不同文本，内容已隐藏"
    if len(unique) > 8 or any(len(value) > 40 for value in unique):
        return f"{len(unique)} 个不同取值，内容已隐藏"
    return " | ".join(unique)


def _join_rows(rows: list[int], limit: int = 500) -> str:
    text = ",".join(str(row) for row in rows)
    if len(text) <= limit:
        return text
    return text[:limit] + f"...(共{len(rows)}行)"


def _ratio(part: int, total: int) -> str:
    if total <= 0:
        return "0%"
    return f"{part / total:.2%}"


def _fingerprint(text: str) -> str:
    import hashlib

    return hashlib.sha256(squash(text).encode("utf-8")).hexdigest()[:12]


def prepare_frame(raw: pd.DataFrame) -> pd.DataFrame:
    frame = pd.DataFrame({str(column): raw[column].map(cell_to_text) for column in raw.columns})
    frame.insert(0, "_excel_row", range(2, len(frame) + 2))
    return frame


def _issue_codes(parsed, feature: str, operator: str, threshold: str, overflow: str) -> list[str]:
    codes: list[str] = []
    if parsed.expr_type == "空条件":
        codes.append("empty_condition")
        return codes
    if parsed.level == "无法解析":
        codes.append("unparsed")
        return codes
    if parsed.top_level_ops > 1:
        codes.append("partial_multi_op")
    elif parsed.level == "部分解析":
        codes.append("partial_incomplete")
    if parsed.feature or parsed.operator or parsed.threshold:
        if squash(normalize_parens(feature)) != squash(parsed.feature):
            codes.append("feature_mismatch")
        if operator != parsed.operator:
            codes.append("operator_mismatch")
        if threshold == "" and parsed.threshold != "":
            codes.append("threshold_missing_in_column")
        elif threshold != "" and squash(normalize_parens(threshold)) != squash(parsed.threshold):
            codes.append("threshold_mismatch")
    if operator and operator not in OPERATOR_VOCAB:
        codes.append("operator_not_in_vocab")
    if (
        operator
        and operator not in OPERATOR_VOCAB
        and threshold in OPERATOR_VOCAB
        and overflow != ""
    ):
        codes.append("column_shift")
    if parsed.operator_inside_feature:
        codes.append("operator_inside_feature")
    if overflow != "":
        codes.append("overflow_column")
    return codes


def build_analysis(
    frame: pd.DataFrame,
    resolved: ResolvedColumns,
    *,
    data_kind: str,
    source_name: str,
    sheet_name: str,
    sha256: str,
    file_size: int,
) -> Analysis:
    columns = resolved.mapping
    condition_col = columns["condition"]
    rule_col = columns["rule_id"]
    feature_col = columns.get("feature", "")
    operator_col = columns.get("operator", "")
    threshold_col = columns.get("threshold", "")
    overflow_cols = resolved.overflow_cols
    original_cols = resolved.original_columns
    row_count = len(frame)

    parsed_rows: list[dict[str, object]] = []
    for as_dict in frame.to_dict("records"):
        condition = as_dict[condition_col]
        feature = as_dict[feature_col] if feature_col else ""
        operator = as_dict[operator_col] if operator_col else ""
        threshold = as_dict[threshold_col] if threshold_col else ""
        overflow = " ".join(as_dict[column] for column in overflow_cols if as_dict[column]).strip()
        parsed = parse_condition(str(condition))
        codes = _issue_codes(parsed, str(feature), str(operator), str(threshold), overflow)
        parsed_rows.append(
            {
                "_rule_id": as_dict[rule_col] or "(空规则标识)",
                "_level": parsed.level,
                "_expr": parsed.expr_type,
                "_reason": parsed.reason,
                "_skeleton": skeleton(str(condition)),
                "_ops": parsed.top_level_ops,
                "_inside": parsed.operator_inside_feature,
                "_codes": codes,
                "_fingerprint": _fingerprint(str(condition)),
            }
        )
    parsed_df = pd.DataFrame(parsed_rows)
    work = pd.concat([frame.reset_index(drop=True), parsed_df], axis=1)

    duplicate_mask = work.duplicated(subset=original_cols, keep=False)
    updated_codes: list[list[str]] = []
    for codes, is_duplicate in zip(work["_codes"], duplicate_mask):
        current = list(codes)
        if is_duplicate:
            current.append("exact_duplicate")
        updated_codes.append(current)
    work["_codes"] = updated_codes
    seq_col = columns.get("seq", "")
    duplicate_without_seq = 0
    if seq_col:
        subset = [column for column in original_cols if column != seq_col]
        duplicate_without_seq = int(work.duplicated(subset=subset, keep=False).sum())

    fields = _field_overview(work, resolved)
    distributions = _distributions(work, resolved)
    rule_detail = _rule_detail(work, resolved)
    structure = _structure(work, resolved, duplicate_mask, duplicate_without_seq)
    differences = _differences(work, resolved)
    parse_stats = _parse_stats(work, row_count)
    samples = _samples(work)
    anomalies = _anomalies(work)
    stats = _summary_numbers(work, resolved, duplicate_mask, duplicate_without_seq, differences, structure)
    review = _review(stats)
    impacts = _impacts(stats)
    cover = _cover(stats, data_kind, source_name, sheet_name, sha256, file_size, resolved, row_count)
    log_lines = _log_lines(stats)
    return Analysis(
        cover=cover,
        fields=fields,
        distributions=distributions,
        rule_detail=rule_detail,
        structure=structure,
        differences=differences,
        parse_stats=parse_stats,
        samples=samples,
        anomalies=anomalies,
        review=review,
        impacts=impacts,
        log_lines=log_lines,
    )


def _field_overview(work: pd.DataFrame, resolved: ResolvedColumns) -> pd.DataFrame:
    rows = []
    total = len(work)
    for index, column in enumerate(resolved.original_columns, start=1):
        values = work[column].tolist()
        empty = sum(value == "" for value in values)
        present = [value for value in values if value]
        note = ""
        if column.startswith("Unnamed"):
            note = "无表头列。非空值先视为溢出，体检不把它并回阈值列。"
        rows.append(
            {
                "列序号": index,
                "字段名": column,
                "非空行数": total - empty,
                "空值行数": empty,
                "空值率": _ratio(empty, total),
                "唯一值数": len(set(present)),
                "推断类型": _infer_type(values),
                "最大字符长度": max((len(value) for value in present), default=0),
                "备注": note,
            }
        )
    return pd.DataFrame(rows)


def _distributions(work: pd.DataFrame, resolved: ResolvedColumns) -> pd.DataFrame:
    rows = []
    for role in DISTRIBUTION_ROLES:
        column = resolved.mapping.get(role)
        if not column:
            continue
        counts = Counter(value if value else "<空>" for value in work[column])
        if len(counts) > 40 and role != "score":
            rows.append(
                {
                    "字段名": column,
                    "取值": f"(唯一值 {len(counts)} 个，超过展示上限)",
                    "行数": len(work),
                    "占比": "100%",
                }
            )
            continue
        for value, count in counts.most_common():
            if role == "operator" or (len(value) > 40):
                continue
            rows.append(
                {
                    "字段名": column,
                    "取值": value,
                    "行数": count,
                    "占比": _ratio(count, len(work)),
                }
            )
    operator_col = resolved.mapping.get("operator")
    if operator_col:
        non_vocab = [value for value in work[operator_col] if value and value not in OPERATOR_VOCAB]
        vocab_counts = Counter(value for value in work[operator_col] if value in OPERATOR_VOCAB)
        for value, count in vocab_counts.most_common():
            rows.append(
                {
                    "字段名": operator_col,
                    "取值": value,
                    "行数": count,
                    "占比": _ratio(count, len(work)),
                }
            )
        if non_vocab:
            rows.append(
                {
                    "字段名": operator_col,
                    "取值": f"<非运算符词表，{len(set(non_vocab))} 种，内容已隐藏>",
                    "行数": len(non_vocab),
                    "占比": _ratio(len(non_vocab), len(work)),
                }
            )
    return pd.DataFrame(rows)


def _rule_detail(work: pd.DataFrame, resolved: ResolvedColumns) -> pd.DataFrame:
    rows = []
    semantic_cols = _roles(resolved, SEMANTIC_ROLES)
    scope_cols = _roles(resolved, SCOPE_ROLES)
    version_cols = _roles(resolved, VERSION_ROLES)
    feature_col = resolved.mapping.get("feature", "")
    operator_col = resolved.mapping.get("operator", "")
    seq_col = resolved.mapping.get("seq", "")
    for rule_id, group in work.groupby("_rule_id", sort=False):
        semantic = [column for column in semantic_cols if group[column].nunique() > 1]
        scope = [column for column in scope_cols if group[column].nunique() > 1]
        version = [column for column in version_cols if group[column].nunique() > 1]
        rows.append(
            {
                "规则标识": clean_excel_text(str(rule_id))[:200],
                "行数": len(group),
                "不同条件数": group["_fingerprint"].nunique(),
                "不同特征数": group[feature_col].nunique() if feature_col else "",
                "不同运算符数": group[operator_col].nunique() if operator_col else "",
                "不同序号数": group[seq_col].nunique() if seq_col else "",
                "多行原因": _reason(group, scope_cols),
                "语义冲突字段": "、".join(semantic),
                "版本差异字段": "、".join(version),
                "范围差异字段": "、".join(scope),
                "起始行号": int(group["_excel_row"].min()),
                "结束行号": int(group["_excel_row"].max()),
                "行号列表": _join_rows(group["_excel_row"].astype(int).tolist()),
            }
        )
    detail = pd.DataFrame(rows)
    if detail.empty:
        return detail
    return detail.sort_values(["行数", "规则标识"], ascending=[False, True])


def _reason(group: pd.DataFrame, scope_cols: list[str]) -> str:
    if len(group) == 1:
        return "单行规则"
    multi_condition = group["_fingerprint"].nunique() > 1
    scope_varies = any(group[column].nunique() > 1 for column in scope_cols)
    if multi_condition and scope_varies:
        return "原子条件拆分与投放范围展开同时存在"
    if multi_condition:
        return "同一标识对应多条不同原子条件"
    if scope_varies:
        return "同一原子条件按投放范围展开"
    return "其他多行（条件与范围字段未变）"


def _structure(
    work: pd.DataFrame,
    resolved: ResolvedColumns,
    duplicate_mask: pd.Series,
    duplicate_without_seq: int,
) -> pd.DataFrame:
    rows: list[dict[str, object]] = []
    reason_counts = work.groupby("_rule_id", sort=False).size()
    scope_cols = _roles(resolved, SCOPE_ROLES)
    reason_counter: Counter[str] = Counter()
    reason_rows: Counter[str] = Counter()
    for _, group in work.groupby("_rule_id", sort=False):
        reason = _reason(group, scope_cols)
        reason_counter[reason] += 1
        reason_rows[reason] += len(group)
    for reason, count in reason_counter.most_common():
        rows.append(
            {
                "统计项": f"多行原因·{reason}",
                "数值": count,
                "说明": f"涉及数据行 {reason_rows[reason]}",
            }
        )
    rows.append({"统计项": "规则标识数", "数值": work["_rule_id"].nunique(), "说明": "空标识会计成同一组"})
    rows.append({"统计项": "完全重复行数", "数值": int(duplicate_mask.sum()), "说明": "同一行内容出现多次时，这些行都计入"})
    rows.append(
        {
            "统计项": "除序号外完全重复行数",
            "数值": duplicate_without_seq,
            "说明": "用于区分序号不同但其余单元格相同的展开",
        }
    )
    multiplicity = reason_counts
    buckets = [(1, 1, "1行"), (2, 2, "2行"), (3, 5, "3-5行"), (6, 10, "6-10行"), (11, 20, "11-20行"), (21, 10**9, "21行及以上")]
    for low, high, label in buckets:
        ids = multiplicity[(multiplicity >= low) & (multiplicity <= high)]
        rows.append(
            {
                "统计项": f"每个规则标识行数·{label}",
                "数值": int(ids.size),
                "说明": f"这些标识合计 {int(ids.sum()) if len(ids) else 0} 行",
            }
        )
    cond_per_id = work.groupby("_rule_id", sort=False)["_fingerprint"].nunique()
    cond_buckets = [(1, 1, "1种"), (2, 2, "2种"), (3, 5, "3-5种"), (6, 10, "6-10种"), (11, 10**9, "11种及以上")]
    for low, high, label in cond_buckets:
        ids = cond_per_id[(cond_per_id >= low) & (cond_per_id <= high)]
        rows.append(
            {
                "统计项": f"每个规则标识的不同条件数·{label}",
                "数值": int(ids.size),
                "说明": "按条件文本指纹计数，不输出条件原文",
            }
        )
    seq_col = resolved.mapping.get("seq", "")
    if seq_col:
        seq_sizes = work.groupby(seq_col, sort=False).size()
        repeated = seq_sizes[seq_sizes > 1]
        rows.append({"统计项": "序号唯一值数", "数值": int(seq_sizes.size), "说明": "序号不是全表唯一行号"})
        rows.append({"统计项": "序号重复组数", "数值": int(repeated.size), "说明": "同一序号对应多行"})
        same_rule = 0
        cond_changes = 0
        company_stable = 0
        company_col = resolved.mapping.get("company", "")
        rule_stable_scope = 0
        scope_cols = [resolved.mapping[role] for role in ("company", "app", "channel", "source", "scene") if role in resolved.mapping]
        for seq_value, group in work.groupby(seq_col, sort=False):
            if len(group) == 1:
                continue
            if group["_rule_id"].nunique() == 1:
                same_rule += 1
            if group["_fingerprint"].nunique() > 1:
                cond_changes += 1
            if company_col and group[company_col].nunique() == 1:
                company_stable += 1
            if scope_cols and all(group[column].nunique() == 1 for column in scope_cols):
                rule_stable_scope += 1
        repeated_n = int(repeated.size)
        rows.append(
            {
                "统计项": "序号重复组中规则标识始终相同",
                "数值": same_rule,
                "说明": _ratio(same_rule, repeated_n) + " 的重复序号组",
            }
        )
        rows.append(
            {
                "统计项": "序号重复组中条件多于一种",
                "数值": cond_changes,
                "说明": _ratio(cond_changes, repeated_n) + " 的重复序号组",
            }
        )
        rows.append(
            {
                "统计项": "序号重复组中公司始终相同",
                "数值": company_stable,
                "说明": _ratio(company_stable, repeated_n) + " 的重复序号组",
            }
        )
        rows.append(
            {
                "统计项": "序号重复组中公司应用渠道来源场景都不变",
                "数值": rule_stable_scope,
                "说明": "若这项很高，序号更像按 && 拆开前的父行号",
            }
        )
    return pd.DataFrame(rows)


def _differences(work: pd.DataFrame, resolved: ResolvedColumns) -> pd.DataFrame:
    rows = []
    tracked: list[tuple[str, str, str]] = []
    for category, roles in (("语义冲突", SEMANTIC_ROLES), ("版本差异", VERSION_ROLES), ("范围展开", SCOPE_ROLES)):
        for role in roles:
            column = resolved.mapping.get(role)
            if column:
                tracked.append((category, role, column))
    for rule_id, group in work.groupby("_rule_id", sort=False):
        if len(group) == 1:
            continue
        for category, role, column in tracked:
            if group[column].nunique() <= 1:
                continue
            values = group[column].tolist()
            rows.append(
                {
                    "规则标识": clean_excel_text(str(rule_id))[:200],
                    "差异类别": category,
                    "字段名": column,
                    "不同取值数": int(group[column].nunique()),
                    "取值预览": _preview(role, values),
                    "行数": len(group),
                    "行号列表": _join_rows(group["_excel_row"].astype(int).tolist()),
                }
            )
    if not rows:
        return pd.DataFrame(columns=["规则标识", "差异类别", "字段名", "不同取值数", "取值预览", "行数", "行号列表"])
    return pd.DataFrame(rows).sort_values(["差异类别", "字段名", "行数"], ascending=[True, True, False])


def _parse_stats(work: pd.DataFrame, row_count: int) -> pd.DataFrame:
    rows = []
    for level, count in work["_level"].value_counts().items():
        rows.append(
            {
                "类别": "解析级别",
                "项目": level,
                "行数": int(count),
                "规则标识数": int(work.loc[work["_level"] == level, "_rule_id"].nunique()),
                "占数据行比例": _ratio(int(count), row_count),
                "说明": "",
            }
        )
    for expr, count in work["_expr"].value_counts().items():
        rows.append(
            {
                "类别": "表达式类型",
                "项目": expr,
                "行数": int(count),
                "规则标识数": int(work.loc[work["_expr"] == expr, "_rule_id"].nunique()),
                "占数据行比例": _ratio(int(count), row_count),
                "说明": "类型按最右侧顶层运算符估计；运算符不唯一时已在名称中标明",
            }
        )
    code_rows: Counter[str] = Counter()
    code_ids: dict[str, set[str]] = defaultdict(set)
    for rule_id, codes in zip(work["_rule_id"], work["_codes"]):
        for code in codes:
            code_rows[code] += 1
            code_ids[code].add(rule_id)
    for code, count in code_rows.most_common():
        rows.append(
            {
                "类别": "问题代码",
                "项目": code,
                "行数": int(count),
                "规则标识数": len(code_ids[code]),
                "占数据行比例": _ratio(int(count), row_count),
                "说明": ISSUE_LABELS.get(code, code),
            }
        )
    consistent = int(work["_codes"].map(lambda codes: not any(code != "operator_inside_feature" for code in codes)).sum())
    rows.append(
        {
            "类别": "字段一致性",
            "项目": "解析结果与拆分字段一致，或仅提示特征内含运算符",
            "行数": consistent,
            "规则标识数": "",
            "占数据行比例": _ratio(consistent, row_count),
            "说明": "特征名内部含运算符会单独提示，但不算拆分失败",
        }
    )
    return pd.DataFrame(rows)


def _samples(work: pd.DataFrame) -> pd.DataFrame:
    picked: list[pd.DataFrame] = []
    full = work[work["_level"] == "能够解析"]
    full_ok = full[full["_codes"].map(lambda codes: "feature_mismatch" not in codes and "threshold_mismatch" not in codes and "operator_mismatch" not in codes)]
    full_bad = full[full["_codes"].map(lambda codes: any(code in codes for code in ("feature_mismatch", "threshold_mismatch", "operator_mismatch", "column_shift")))]
    ok_part = full_ok.head(3)
    bad_part = full_bad.head(2)
    full_parts = [part for part in (ok_part, bad_part) if len(part)]
    if full_parts:
        picked.append(pd.concat(full_parts, ignore_index=True))
    partial = work[work["_level"] == "部分解析"].head(5)
    failed = work[work["_level"] == "无法解析"].head(5)
    if len(partial):
        picked.append(partial)
    if len(failed):
        picked.append(failed)
    if not picked:
        sample = pd.DataFrame(columns=["_level", "_expr", "_codes", "_skeleton", "_reason", "_excel_row", "_rule_id"])
    else:
        sample = pd.concat(picked, ignore_index=True)
    rows = []
    for item in sample.to_dict("records"):
        rows.append(
            {
                "解析级别": item["_level"],
                "表达式类型": item["_expr"],
                "与拆分字段关系": "、".join(ISSUE_LABELS.get(code, code) for code in item["_codes"]) or "一致",
                "条件骨架": item["_skeleton"],
                "解析说明": item["_reason"],
                "原始Excel行号": int(item["_excel_row"]),
                "规则标识": clean_excel_text(str(item["_rule_id"]))[:200],
            }
        )
    present = {row["解析级别"] for row in rows}
    for level in ("能够解析", "部分解析", "无法解析"):
        if level not in present:
            rows.append(
                {
                    "解析级别": level,
                    "表达式类型": "",
                    "与拆分字段关系": "",
                    "条件骨架": "",
                    "解析说明": "本次数据中没有这一级",
                    "原始Excel行号": "",
                    "规则标识": "",
                }
            )
    return pd.DataFrame(rows)


def _anomalies(work: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for item in work.to_dict("records"):
        for code in item["_codes"]:
            rows.append(
                {
                    "原始Excel行号": int(item["_excel_row"]),
                    "规则标识": clean_excel_text(str(item["_rule_id"]))[:200],
                    "问题代码": code,
                    "问题说明": ISSUE_LABELS.get(code, code),
                    "解析级别": item["_level"],
                    "表达式类型": item["_expr"],
                    "条件骨架": item["_skeleton"],
                    "顶层运算符个数": int(item["_ops"]),
                }
            )
    if not rows:
        return pd.DataFrame(
            columns=["原始Excel行号", "规则标识", "问题代码", "问题说明", "解析级别", "表达式类型", "条件骨架", "顶层运算符个数"]
        )
    anomalies = pd.DataFrame(rows)
    return anomalies.sort_values(["原始Excel行号", "问题代码"])


def _summary_numbers(
    work: pd.DataFrame,
    resolved: ResolvedColumns,
    duplicate_mask: pd.Series,
    duplicate_without_seq: int,
    differences: pd.DataFrame,
    structure: pd.DataFrame,
) -> dict[str, object]:
    code_counts = Counter(code for codes in work["_codes"] for code in codes)
    semantic_ids = 0
    version_ids = 0
    scope_ids = 0
    if len(differences):
        semantic_ids = differences.loc[differences["差异类别"] == "语义冲突", "规则标识"].nunique()
        version_ids = differences.loc[differences["差异类别"] == "版本差异", "规则标识"].nunique()
        scope_ids = differences.loc[differences["差异类别"] == "范围展开", "规则标识"].nunique()
    structure_map = {row["统计项"]: row["数值"] for _, row in structure.iterrows()}
    return {
        "rows": len(work),
        "columns": len(resolved.original_columns),
        "rule_ids": int(work["_rule_id"].nunique()),
        "unique_conditions": int(work["_fingerprint"].nunique()),
        "id_condition_pairs": int(work.groupby(["_rule_id", "_fingerprint"]).ngroups),
        "duplicate_rows": int(duplicate_mask.sum()),
        "duplicate_without_seq": duplicate_without_seq,
        "parse_full": int((work["_level"] == "能够解析").sum()),
        "parse_partial": int((work["_level"] == "部分解析").sum()),
        "parse_fail": int((work["_level"] == "无法解析").sum()),
        "shift_rows": code_counts["column_shift"],
        "overflow_rows": code_counts["overflow_column"],
        "inside_rows": code_counts["operator_inside_feature"],
        "mismatch_rows": int(
            work["_codes"].map(
                lambda codes: any(
                    code in codes
                    for code in (
                        "feature_mismatch",
                        "operator_mismatch",
                        "threshold_mismatch",
                        "threshold_missing_in_column",
                        "column_shift",
                    )
                )
            ).sum()
        ),
        "semantic_ids": int(semantic_ids),
        "version_ids": int(version_ids),
        "scope_ids": int(scope_ids),
        "reason_condition_only": structure_map.get("多行原因·同一标识对应多条不同原子条件", 0),
        "reason_scope_only": structure_map.get("多行原因·同一原子条件按投放范围展开", 0),
        "reason_both": structure_map.get("多行原因·原子条件拆分与投放范围展开同时存在", 0),
        "reason_single": structure_map.get("多行原因·单行规则", 0),
        "reason_other": structure_map.get("多行原因·其他多行（条件与范围字段未变）", 0),
        "seq_repeated_groups": structure_map.get("序号重复组数", 0),
        "seq_scope_stable": structure_map.get("序号重复组中公司应用渠道来源场景都不变", 0),
        "seq_cond_changes": structure_map.get("序号重复组中条件多于一种", 0),
        "missing_roles": [role for role in resolved.missing_roles if role not in REQUIRED_ROLES],
        "code_counts": code_counts,
    }


def _cover(
    stats: dict[str, object],
    data_kind: str,
    source_name: str,
    sheet_name: str,
    sha256: str,
    file_size: int,
    resolved: ResolvedColumns,
    row_count: int,
) -> list[tuple[str, str]]:
    kind = "合成测试" if data_kind == "synthetic" else "真实数据"
    mapped = "；".join(f"{role}={name}" for role, name in resolved.mapping.items())
    missing = "、".join(stats["missing_roles"]) if stats["missing_roles"] else "无"
    return [
        ("数据性质", kind),
        ("源文件名", source_name),
        ("工作表", sheet_name),
        ("文件大小字节", str(file_size)),
        ("SHA256", sha256),
        ("数据行数", str(row_count)),
        ("字段数", str(stats["columns"])),
        ("规则标识数", str(stats["rule_ids"])),
        ("不同条件指纹数", str(stats["unique_conditions"])),
        ("规则标识加条件组合数", str(stats["id_condition_pairs"])),
        ("能够解析行数", str(stats["parse_full"])),
        ("部分解析行数", str(stats["parse_partial"])),
        ("无法解析行数", str(stats["parse_fail"])),
        ("拆分字段不一致行数", str(stats["mismatch_rows"])),
        ("疑似列错位行数", str(stats["shift_rows"])),
        ("语义冲突的规则标识数", str(stats["semantic_ids"])),
        ("版本差异的规则标识数", str(stats["version_ids"])),
        ("范围展开的规则标识数", str(stats["scope_ids"])),
        ("完全重复行数", str(stats["duplicate_rows"])),
        ("字段映射", mapped),
        ("未找到的可选字段", missing),
        ("处理原则", "只读源文件。报告只标记问题，不回写、不纠正、不覆盖原始表。"),
        ("脱敏", "条件、特征、阈值、描述和备注不写入报告原文，样例只保留运算符骨架。"),
    ]


def _review(stats: dict[str, object]) -> pd.DataFrame:
    items = [
        (
            "分析粒度",
            "同一规则标识多行，要先决定后续按标识、按序号父行，还是按原子条件计算。",
            "见 04_多行与父行。三种粒度的行数不一样，直接按行做相似度会把同一规则算重。",
        ),
        (
            "拆分字段是否可信",
            "规则条件、模型特征名称、比较运算值、阈值名单不一致时，先人工确认以哪一列为主。",
            f"不一致行数 {stats['mismatch_rows']}，疑似列错位 {stats['shift_rows']}。本阶段不自动纠正。",
        ),
        (
            "语义冲突",
            "同一规则标识的处置建议、得分、风险标签或标签状态如果不同，需要确认哪一条生效。",
            f"存在语义冲突的规则标识 {stats['semantic_ids']} 个。取值预览只保留短分类值。",
        ),
        (
            "空的场景和渠道",
            "策略场景、渠道等字段为空时，后续按场景切片会漏掉这些行。",
            "空值率见 01_字段概览，确认空值是“全场景”还是未填写。",
        ),
        (
            "特征名中的运算符",
            "特征文本里如果本身含有 >= 等符号，不能按第一个符号切分。",
            f"这类行有 {stats['inside_rows']} 行。解析使用括号深度和最右侧顶层运算符，仍建议人工抽查骨架。",
        ),
    ]
    return pd.DataFrame([{"确认项": title, "需要确认的问题": question, "证据位置": evidence} for title, question, evidence in items])


def _impacts(stats: dict[str, object]) -> pd.DataFrame:
    rows = int(stats["rows"])
    full_rate = _ratio(int(stats["parse_full"]), rows)
    items = [
        (
            "行、规则标识、原子条件不是同一粒度",
            f"数据行 {rows}，规则标识 {stats['rule_ids']}，条件指纹 {stats['unique_conditions']}，标识加条件 {stats['id_condition_pairs']}。",
            "按行计算相似度会把投放副本和拆开的原子条件重复计入。",
            "先做粒度模型：序号父行、规则标识、原子条件三层。",
        ),
        (
            "同一标识同时包含拆分和范围展开",
            f"只拆条件 {stats['reason_condition_only']} 个标识，只展开范围 {stats['reason_scope_only']} 个，两者都有 {stats['reason_both']} 个。",
            "不先拆开这两种多行，规则级诊断会把渠道差异和条件差异混在一起。",
            "做多行原因分类，并把它固定成后续模块的输入。",
        ),
        (
            "序号更接近拆分前父行",
            f"序号重复组 {stats['seq_repeated_groups']}，其中范围字段不变的组 {stats['seq_scope_stable']}，条件多于一种的组 {stats['seq_cond_changes']}。",
            "把序号当唯一主键会失败；把它丢掉又会失去 && 拆分前的原行关系。",
            "保留序号作为父行号，不要把它当成主键。",
        ),
        (
            "拆分列有一小部分不可直接用",
            f"字段不一致 {stats['mismatch_rows']} 行，疑似列错位 {stats['shift_rows']} 行，无表头溢出 {stats['overflow_rows']} 行。",
            "相似度若直接用模型特征名称和阈值列，错位行会把特征对错。",
            "以条件原文的解析结果为候选结构，错位只排队人工确认。",
        ),
        (
            "条件文本大部分能结构化",
            f"能够解析 {stats['parse_full']} 行（{full_rate}），部分解析 {stats['parse_partial']} 行，无法解析 {stats['parse_fail']} 行。",
            "主表达式类型已经可以统计。部分解析和无法解析的行不能进入自动相似度。",
            "下一阶段先做原子条件规范化，再做相似度。",
        ),
        (
            "同一标识的处置和得分可能冲突",
            f"语义冲突标识 {stats['semantic_ids']} 个，版本差异标识 {stats['version_ids']} 个。",
            "策略诊断如果随机取其中一行的处置建议，结论会随行序变化。",
            "做冲突确认清单，未确认前不要输出策略对错。",
        ),
    ]
    return pd.DataFrame(
        [{"影响点": title, "证据": evidence, "对后续分析的影响": impact, "更适合先做的模块": module} for title, evidence, impact, module in items]
    )


def _log_lines(stats: dict[str, object]) -> list[str]:
    return [
        f"数据行 {stats['rows']}，字段 {stats['columns']}，规则标识 {stats['rule_ids']}",
        f"条件指纹 {stats['unique_conditions']}，标识加条件 {stats['id_condition_pairs']}",
        f"解析：能够解析 {stats['parse_full']}，部分解析 {stats['parse_partial']}，无法解析 {stats['parse_fail']}",
        f"拆分字段不一致 {stats['mismatch_rows']}，疑似列错位 {stats['shift_rows']}",
        f"多行原因：单行 {stats['reason_single']}，只拆条件 {stats['reason_condition_only']}，只展开范围 {stats['reason_scope_only']}，两者都有 {stats['reason_both']}，其他 {stats['reason_other']}",
        f"语义冲突标识 {stats['semantic_ids']}，版本差异标识 {stats['version_ids']}，范围展开标识 {stats['scope_ids']}",
        f"完全重复行 {stats['duplicate_rows']}",
    ]
