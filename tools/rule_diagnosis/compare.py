"""多维比较。双方都未配置时贡献为 0，不解释为空值互相匹配。"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from pathlib import Path

from layer import UNCONFIGURED

WEIGHT_PATH = Path(__file__).resolve().parent / "similarity_weights.json"


@dataclass
class RuleProfile:
    rule_id: str
    name: str
    risk_type: str
    risk_label: str
    features: set[str]
    operators: set[str]
    thresholds: set[str]
    feature_ops: set[tuple[str, str]]
    decision: dict[str, str]
    scope: dict[str, str]
    condition_fps: set[str]
    rows: list[int] = field(default_factory=list)
    unreliable_rows: int = 0


def load_weights() -> dict:
    return json.loads(WEIGHT_PATH.read_text(encoding="utf-8"))


def dimension_status(left: str, right: str) -> tuple[str, float]:
    if left == UNCONFIGURED and right == UNCONFIGURED:
        return "双方未配置", 0.0
    if left == UNCONFIGURED or right == UNCONFIGURED:
        return "一方未配置", 0.0
    if left == right:
        return "一致", 1.0
    return "不一致", 0.0


def name_similarity(left: str, right: str) -> tuple[str, float]:
    if left in {UNCONFIGURED, ""} or right in {UNCONFIGURED, ""}:
        return "名称有一侧未配置或不唯一，不计入", 0.0
    score = SequenceMatcher(None, left, right).ratio()
    return f"字符序列相似度 {score:.2f}", score


def _configured_value(values: set[str]) -> str:
    configured = {value for value in values if value != UNCONFIGURED}
    if not configured:
        return UNCONFIGURED
    if len(configured) == 1:
        return next(iter(configured))
    return "多值:" + "|".join(sorted(configured))


def _scope_detail(left: dict[str, str], right: dict[str, str], roles: tuple[str, ...]) -> tuple[str, float]:
    notes: list[str] = []
    compared = 0
    matched = 0.0
    for role in roles:
        status, point = dimension_status(left.get(role, UNCONFIGURED), right.get(role, UNCONFIGURED))
        notes.append(f"{role}:{status}")
        if status in {"双方未配置", "一方未配置"}:
            continue
        compared += 1
        matched += point
    if compared == 0:
        return "；".join(notes) + "；没有双方都已配置的维度", 0.0
    return "；".join(notes), matched / compared


def _set_score(left: set[str], right: set[str], label: str) -> tuple[str, float]:
    if not left or not right:
        return f"{label}没有可用解析，不计入", 0.0
    union = left | right
    inter = left & right
    if not union:
        return f"{label}没有可用解析，不计入", 0.0
    score = len(inter) / len(union)
    if score == 1:
        return "一致", 1.0
    if score == 0:
        return "不一致", 0.0
    return f"交集 {len(inter)} / 并集 {len(union)}", score


def compare_profiles(left: RuleProfile, right: RuleProfile, weights: dict) -> dict[str, object]:
    name_note, name_score = name_similarity(left.name, right.name)
    risk_type_note, risk_type_score = dimension_status(left.risk_type, right.risk_type)
    risk_label_note, risk_label_score = dimension_status(left.risk_label, right.risk_label)
    feature_note, feature_score = _set_score(left.features, right.features, "特征")
    operator_note, operator_score = _set_score(left.operators, right.operators, "运算符")
    threshold_note, threshold_score = _set_score(left.thresholds, right.thresholds, "阈值")
    decision_note, decision_score = _scope_detail(left.decision, right.decision, ("处置建议", "得分", "标签状态"))
    scope_note, scope_score = _scope_detail(
        left.scope, right.scope, ("公司", "应用", "渠道/事件", "策略场景", "来源", "规则类型")
    )
    parts = {
        "规则名称": (name_note, name_score, weights["dimensions"]["rule_name"]["weight"]),
        "风险类型": (risk_type_note, risk_type_score, weights["dimensions"]["risk_type"]["weight"]),
        "风险标签": (risk_label_note, risk_label_score, weights["dimensions"]["risk_label"]["weight"]),
        "模型特征": (feature_note, feature_score, weights["dimensions"]["feature"]["weight"]),
        "运算符": (operator_note, operator_score, weights["dimensions"]["operator"]["weight"]),
        "阈值或名单": (threshold_note, threshold_score, weights["dimensions"]["threshold"]["weight"]),
        "处置配置": (decision_note, decision_score, weights["dimensions"]["decision"]["weight"]),
        "投放范围": (scope_note, scope_score, weights["dimensions"]["scope"]["weight"]),
    }
    sort_key = 0.0
    same: list[str] = []
    different: list[str] = []
    skipped: list[str] = []
    for label, (note, score, weight) in parts.items():
        sort_key += float(weight) * float(score)
        unset_bits = [bit for bit in str(note).split("；") if "双方未配置" in bit or "不计入" in bit or "没有可用" in bit]
        if unset_bits:
            skipped.extend(f"{label}/{bit}" for bit in unset_bits)
        if "没有双方都已配置" in str(note) or "不计入" in str(note) or "没有可用" in str(note):
            continue
        if float(score) >= 0.999:
            same.append(label)
        elif float(score) <= 0:
            different.append(f"{label}（{note}）")
        else:
            different.append(f"{label}部分一致（{note}）")
    positive = sum(1 for note, score, _ in parts.values() if float(score) >= 0.999)
    name_hit = name_score >= float(weights["name_similarity_min"]) and risk_type_score == 1.0
    return {
        "名称相似度": round(name_score, 4),
        "名称说明": name_note,
        "风险类型比较": risk_type_note,
        "风险标签比较": risk_label_note,
        "特征比较": feature_note,
        "运算符比较": operator_note,
        "阈值比较": threshold_note,
        "处置比较": decision_note,
        "投放比较": scope_note,
        "一致维度": "、".join(same) if same else "无",
        "不同或未完全一致": "、".join(different) if different else "无",
        "未计入维度": "、".join(skipped) if skipped else "无",
        "排序参考": round(sort_key, 4),
        "正一致维度数": positive,
        "名称达标且风险类型一致": "是" if name_hit else "否",
    }


def candidate_pairs(profiles: dict[str, RuleProfile]) -> set[tuple[str, str]]:
    pairs: set[tuple[str, str]] = set()
    by_feature: dict[tuple[str, str], list[str]] = defaultdict(list)
    by_name: dict[tuple[str, str], list[str]] = defaultdict(list)
    for rule_id, profile in profiles.items():
        for feature, operator in profile.feature_ops:
            by_feature[(feature, operator)].append(rule_id)
        if profile.name not in {UNCONFIGURED, ""} and profile.risk_type != UNCONFIGURED:
            by_name[(profile.risk_type, profile.name[:4])].append(rule_id)
    for members in by_feature.values():
        _expand_feature_block(members, profiles, pairs)
    for members in by_name.values():
        uniq = sorted(set(members))
        if 2 <= len(uniq) <= 25:
            _add_all(uniq, pairs)
    return pairs


def _add_all(members: list[str], pairs: set[tuple[str, str]]) -> None:
    ordered = sorted(set(members))
    for index, left in enumerate(ordered):
        for right in ordered[index + 1 :]:
            pairs.add((left, right))


def _expand_feature_block(members: list[str], profiles: dict[str, RuleProfile], pairs: set[tuple[str, str]]) -> None:
    uniq = sorted(set(members))
    if len(uniq) < 2:
        return
    if len(uniq) <= 60:
        _add_all(uniq, pairs)
        return
    by_threshold: dict[str, list[str]] = defaultdict(list)
    by_prefix: dict[str, list[str]] = defaultdict(list)
    for rule_id in uniq:
        profile = profiles[rule_id]
        tokens = profile.thresholds or {""}
        for token in tokens:
            by_threshold[token].append(rule_id)
        by_prefix[profile.name[:4]].append(rule_id)
    for group in by_threshold.values():
        if 2 <= len(set(group)) <= 60:
            _add_all(list(set(group)), pairs)
    for group in by_prefix.values():
        if 2 <= len(set(group)) <= 15:
            _add_all(list(set(group)), pairs)
