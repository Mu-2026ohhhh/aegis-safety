"""分析数据层。复用体检解析器，不修正原始条件和拆分列。"""

from __future__ import annotations

import hashlib
import sys
from pathlib import Path

import pandas as pd

HEALTHCHECK_DIR = Path(__file__).resolve().parents[1] / "rule_healthcheck"
if str(HEALTHCHECK_DIR) not in sys.path:
    sys.path.insert(0, str(HEALTHCHECK_DIR))

from analyze import HealthcheckError, _issue_codes, resolve_columns  # noqa: E402
from condition_parser import parse_condition, skeleton, squash, normalize_parens  # noqa: E402

UNCONFIGURED = "未配置"
BUSINESS_ROLES = (
    "rule_name",
    "status",
    "rule_type",
    "product",
    "scene",
    "company",
    "app",
    "channel",
    "risk_label",
    "label_l4",
    "label_status",
    "risk_type",
    "action",
    "score",
    "blacklist",
    "blacklist_field",
    "source",
    "description",
    "remark",
)
ROLE_LABELS = {
    "seq": "序号",
    "rule_id": "规则标识",
    "rule_name": "规则名称",
    "status": "规则状态",
    "rule_type": "规则类型",
    "product": "策略产品",
    "scene": "策略场景",
    "company": "公司",
    "app": "应用",
    "channel": "渠道/事件",
    "risk_label": "风险标签",
    "label_l4": "关联四级标签",
    "label_status": "标签状态",
    "risk_type": "风险类型",
    "action": "处置建议",
    "score": "得分",
    "blacklist": "是否拉黑",
    "blacklist_field": "拉黑字段",
    "condition": "规则条件",
    "created_at": "创建时间",
    "description": "规则描述",
    "remark": "备注",
    "source": "来源",
    "feature": "模型特征名称",
    "operator": "比较运算值",
    "threshold": "阈值名单",
}
SCOPE_ROLES = ("company", "app", "channel", "scene", "source", "rule_type")
DECISION_ROLES = ("action", "score", "label_status")
UNRELIABLE_CODES = {
    "empty_condition",
    "unparsed",
    "partial_multi_op",
    "partial_incomplete",
    "column_shift",
    "feature_mismatch",
    "operator_mismatch",
    "threshold_mismatch",
    "threshold_missing_in_column",
    "operator_not_in_vocab",
    "overflow_column",
}


def normalize_business(value: str) -> tuple[str, str]:
    """空业务值记为未配置。原文里的“未配置”仍算业务原值。"""
    if value == "":
        return UNCONFIGURED, "空值记为未配置"
    return value, "原始业务值"


def fingerprint(text: str, size: int = 16) -> str:
    return hashlib.sha256(squash(text).encode("utf-8")).hexdigest()[:size]


def _field(row: dict[str, str], mapping: dict[str, str], role: str) -> str:
    column = mapping.get(role, "")
    if not column:
        return ""
    return row.get(column, "")


def build_layer(frame: pd.DataFrame, resolved) -> pd.DataFrame:
    mapping = resolved.mapping
    overflow_cols = resolved.overflow_cols
    records: list[dict[str, object]] = []
    for row in frame.to_dict("records"):
        condition = _field(row, mapping, "condition")
        feature_col = _field(row, mapping, "feature")
        operator_col = _field(row, mapping, "operator")
        threshold_col = _field(row, mapping, "threshold")
        overflow = " ".join(row.get(column, "") for column in overflow_cols if row.get(column, "")).strip()
        parsed = parse_condition(condition)
        codes = _issue_codes(parsed, feature_col, operator_col, threshold_col, overflow)
        usable = parsed.level == "能够解析" and not any(code in UNRELIABLE_CODES for code in codes)
        cond_norm = squash(normalize_parens(condition))
        rule_raw = _field(row, mapping, "rule_id")
        seq_raw = _field(row, mapping, "seq")
        excel_row = int(row["_excel_row"])
        if seq_raw:
            parent_id = f"序号:{seq_raw}"
            parent_note = "序号作为父行组编号，不是全表主键"
        else:
            parent_id = f"无序号:行{excel_row}"
            parent_note = "序号为空，父行组退回到该行，这是技术缺口，不是业务未配置"
        item: dict[str, object] = {
            "原始Excel行号": excel_row,
            "父行组": parent_id,
            "父行说明": parent_note,
            "规则标识": rule_raw if rule_raw else "（规则标识为空）",
            "规则标识为空": "是" if not rule_raw else "否",
            "条件规范化": cond_norm,
            "条件指纹": fingerprint(cond_norm),
            "条件骨架": skeleton(condition),
            "解析级别": parsed.level,
            "表达式类型": parsed.expr_type,
            "解析特征": parsed.feature,
            "解析运算符": parsed.operator,
            "解析阈值": parsed.threshold,
            "解析可用": "是" if usable else "否",
            "质量代码": ",".join(codes),
            "特征内含运算符": "是" if "operator_inside_feature" in codes else "否",
            "已自动修正": "否",
        }
        scope_parts: list[str] = []
        for role in BUSINESS_ROLES:
            label = ROLE_LABELS[role]
            raw = _field(row, mapping, role) if role in mapping else ""
            norm, origin = normalize_business(raw) if role in mapping else ("", "字段不存在")
            item[f"{label}_原始值"] = raw
            item[f"{label}_规范值"] = norm
            item[f"{label}_规范来源"] = origin
            if role in SCOPE_ROLES:
                scope_parts.append(f"{label}={norm}")
        item["投放范围键"] = " | ".join(scope_parts)
        if usable and parsed.operator in {"contain", "notContain", "subsetp"}:
            item["名单指纹"] = fingerprint(parsed.threshold)
            item["名单长度"] = len(parsed.threshold)
        elif usable and parsed.operator:
            item["名单指纹"] = ""
            item["名单长度"] = ""
        else:
            item["名单指纹"] = ""
            item["名单长度"] = ""
        item["阈值指纹"] = fingerprint(parsed.threshold) if usable else ""
        records.append(item)
    return pd.DataFrame.from_records(records)


def require_layer_columns(raw: pd.DataFrame):
    if raw.empty:
        raise HealthcheckError("所选工作表没有数据行，无法做策略诊断。")
    try:
        return resolve_columns(list(raw.columns))
    except HealthcheckError as exc:
        text = str(exc).replace("rule_id", "规则标识").replace("condition", "规则条件")
        raise HealthcheckError("无法建立分析层。" + text) from exc
