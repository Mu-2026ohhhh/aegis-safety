"""策略资产画像、重复重叠和潜在处置冲突。差异只作候选，不判定线上冲突。"""

from __future__ import annotations

from collections import Counter, defaultdict

import pandas as pd

from compare import RuleProfile, _configured_value, candidate_pairs, compare_profiles, load_weights
from layer import UNCONFIGURED

SCOPE_FIELDS = ("公司", "应用", "渠道/事件", "策略场景", "来源", "规则类型")
DECISION_FIELDS = ("处置建议", "得分", "标签状态")
TOP_N = 30
SIMILAR_CAP = 2000


def _join(values, limit: int = 400) -> str:
    seen: list[str] = []
    for value in values:
        text = "" if value is None else str(value)
        if text not in seen:
            seen.append(text)
    merged = " | ".join(seen)
    if len(merged) <= limit:
        return merged
    return merged[:limit] + f"...(共{len(seen)}个)"


def _rows(series) -> str:
    numbers = sorted({int(value) for value in series})
    return _join(numbers, 500)


def _ratio(part: int, total: int) -> str:
    if total <= 0:
        return "0%"
    return f"{part / total:.2%}"


def _usable(layer: pd.DataFrame) -> pd.DataFrame:
    return layer[layer["解析可用"] == "是"]


def build_profiles(layer: pd.DataFrame) -> dict[str, RuleProfile]:
    profiles: dict[str, RuleProfile] = {}
    for rule_id, group in layer.groupby("规则标识", sort=False):
        if rule_id == "（规则标识为空）":
            continue
        reliable = group[group["解析可用"] == "是"]
        features = set(reliable["解析特征"]) - {""}
        operators = set(reliable["解析运算符"]) - {""}
        thresholds = set(reliable["阈值指纹"]) - {""}
        feature_ops = {
            (feature, operator)
            for feature, operator in zip(reliable["解析特征"], reliable["解析运算符"])
            if feature and operator
        }
        profiles[str(rule_id)] = RuleProfile(
            rule_id=str(rule_id),
            name=_configured_value(set(group["规则名称_规范值"])),
            risk_type=_configured_value(set(group["风险类型_规范值"])),
            risk_label=_configured_value(set(group["风险标签_规范值"])),
            features=features,
            operators=operators,
            thresholds=thresholds,
            feature_ops=feature_ops,
            decision={field: _configured_value(set(group[f"{field}_规范值"])) for field in DECISION_FIELDS},
            scope={field: _configured_value(set(group[f"{field}_规范值"])) for field in SCOPE_FIELDS},
            condition_fps=set(group["条件指纹"]),
            rows=[int(value) for value in group["原始Excel行号"]],
            unreliable_rows=int((group["解析可用"] == "否").sum()),
        )
    return profiles


def _distribution(layer: pd.DataFrame, column: str, dimension: str) -> pd.DataFrame:
    total = len(layer)
    grouped = (
        layer.groupby(column, dropna=False)
        .agg(行数=("原始Excel行号", "size"), 规则标识数=("规则标识", "nunique"), 父行组数=("父行组", "nunique"))
        .reset_index()
        .rename(columns={column: "取值"})
    )
    grouped["维度"] = dimension
    grouped["占原始行比例"] = grouped["行数"].map(lambda count: _ratio(int(count), total))
    grouped = grouped.sort_values("行数", ascending=False)
    grouped["名次"] = range(1, len(grouped) + 1)
    if len(grouped) > TOP_N:
        top = grouped.head(TOP_N).copy()
        top["层次"] = f"Top{TOP_N}"
        full = grouped.copy()
        full["层次"] = "完整明细"
        grouped = pd.concat([top, full], ignore_index=True)
    else:
        grouped["层次"] = "完整明细（基数未超过30）"
    return grouped[["层次", "维度", "名次", "取值", "行数", "规则标识数", "父行组数", "占原始行比例"]]


def _cross(layer: pd.DataFrame, left: str, right: str) -> pd.DataFrame:
    total = len(layer)
    grouped = (
        layer.groupby([left, right], dropna=False)
        .agg(行数=("原始Excel行号", "size"), 规则标识数=("规则标识", "nunique"))
        .reset_index()
    )
    grouped["交叉"] = left + " × " + right
    grouped["占原始行比例"] = grouped["行数"].map(lambda count: _ratio(int(count), total))
    grouped = grouped.sort_values("行数", ascending=False)
    return grouped.rename(columns={left: "维度甲", right: "维度乙"})[
        ["交叉", "维度甲", "维度乙", "行数", "规则标识数", "占原始行比例"]
    ]


def portrait(layer: pd.DataFrame) -> dict[str, pd.DataFrame]:
    total = len(layer)
    blank_rows = []
    for label in (
        "规则名称",
        "规则状态",
        "规则类型",
        "策略产品",
        "策略场景",
        "公司",
        "应用",
        "渠道/事件",
        "风险标签",
        "关联四级标签",
        "标签状态",
        "风险类型",
        "处置建议",
        "得分",
        "是否拉黑",
        "来源",
    ):
        origin = f"{label}_规范来源"
        if origin not in layer.columns:
            continue
        blanks = int((layer[origin] == "空值记为未配置").sum())
        literal = int(((layer[f"{label}_规范值"] == UNCONFIGURED) & (layer[origin] == "原始业务值")).sum())
        blank_rows.append(
            {
                "指标": f"{label}空值率",
                "数值": blanks,
                "说明": f"占原始行 {_ratio(blanks, total)}。空值规范为未配置 {blanks} 行；原文就写成未配置 {literal} 行。未配置不是全范围适用。",
            }
        )
    usable = _usable(layer)
    metrics = [
        {"指标": "原始行数", "数值": total, "说明": "粒度是 Excel 数据行，表头为第 1 行。"},
        {"指标": "规则标识数", "数值": int(layer["规则标识"].nunique()), "说明": "空规则标识单独成技术组，不叫未配置。"},
        {"指标": "父行组数", "数值": int(layer["父行组"].nunique()), "说明": "有序号时按序号分组；序号不是全表主键。"},
        {"指标": "原子条件数", "数值": int(layer["条件指纹"].nunique()), "说明": "按条件原文规范化后的指纹计数，不改写原文。"},
        {
            "指标": "规则与投放范围组合数",
            "数值": int(layer.groupby(["规则标识", "投放范围键"]).ngroups),
            "说明": "同一规则在不同公司、应用、渠道、场景、来源、规则类型上的配置分开计数。",
        },
        {"指标": "解析可用行数", "数值": int(len(usable)), "说明": "能够解析且拆分字段没有不一致、没有错位、没有部分解析。"},
        {"指标": "解析不可用行数", "数值": int((layer["解析可用"] == "否").sum()), "说明": "这些行保留原值，不自动修正，并排除出阈值分布和特征相似度。"},
    ]
    overview = pd.DataFrame(metrics + blank_rows)
    labels = _distribution(layer, "风险标签_规范值", "风险标签")
    types = _distribution(layer, "风险类型_规范值", "风险类型")
    type_action = _cross(layer, "风险类型_规范值", "处置建议_规范值")
    scope = pd.concat(
        [
            _distribution(layer, "公司_规范值", "公司"),
            _distribution(layer, "应用_规范值", "应用"),
            _distribution(layer, "渠道/事件_规范值", "渠道/事件"),
            _distribution(layer, "策略场景_规范值", "策略场景"),
            _distribution(layer, "来源_规范值", "来源"),
            _distribution(layer, "处置建议_规范值", "处置建议"),
            _distribution(layer, "规则状态_规范值", "规则状态"),
            _distribution(layer, "规则类型_规范值", "规则类型"),
        ],
        ignore_index=True,
    )
    feature_dist = _distribution(usable, "解析特征", "解析可用的模型特征") if len(usable) else pd.DataFrame()
    operator_dist = _distribution(usable, "解析运算符", "解析可用的运算符") if len(usable) else pd.DataFrame()
    scope_cross = _cross(layer, "公司_规范值", "渠道/事件_规范值")
    complexity = _complexity(layer)
    return {
        "overview": overview,
        "labels": labels,
        "types": pd.concat(
            [types.assign(区块="风险类型分布"), type_action.assign(区块="风险类型×处置建议")],
            ignore_index=True,
        ),
        "scope": pd.concat(
            [scope.assign(区块="单维分布"), scope_cross.assign(区块="公司×渠道"), feature_dist.assign(区块="模型特征") if len(feature_dist) else feature_dist, operator_dist.assign(区块="运算符") if len(operator_dist) else operator_dist],
            ignore_index=True,
        ),
        "complexity": complexity,
    }


def _complexity(layer: pd.DataFrame) -> pd.DataFrame:
    rows = []
    fields = ("处置建议", "得分", "标签状态", "风险标签", "风险类型")
    for rule_id, group in layer.groupby("规则标识", sort=False):
        blank_fields = [
            field
            for field in SCOPE_FIELDS + ("风险标签", "关联四级标签", "处置建议", "得分", "标签状态")
            if (group[f"{field}_规范来源"] == "空值记为未配置").any()
        ]
        item = {
            "规则标识": rule_id,
            "原始行数": len(group),
            "父行组数": int(group["父行组"].nunique()),
            "原子条件数": int(group["条件指纹"].nunique()),
            "投放范围数": int(group["投放范围键"].nunique()),
            "解析不可用行数": int((group["解析可用"] == "否").sum()),
            "存在未配置的业务字段": _join(blank_fields, 200) if blank_fields else "无",
            "原始Excel行号": _rows(group["原始Excel行号"]),
        }
        for field in fields:
            values = set(group[f"{field}_规范值"])
            item[f"{field}全部取值"] = _join(sorted(values), 200)
            item[f"{field}是否一致"] = "是" if len(values) == 1 else "否"
        rows.append(item)
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    return frame.sort_values(["解析不可用行数", "原始行数"], ascending=[False, False])


def exact_duplicates(layer: pd.DataFrame) -> pd.DataFrame:
    keys = [
        "条件指纹",
        "条件骨架",
        "风险标签_规范值",
        "风险类型_规范值",
        "处置建议_规范值",
        "得分_规范值",
        "标签状态_规范值",
        "投放范围键",
    ]
    rows = []
    for index, (_, group) in enumerate(layer.groupby(keys, sort=False), start=1):
        if len(group) < 2:
            continue
        if group["规则标识"].nunique() == 1 and group["父行组"].nunique() == 1 and group["原始Excel行号"].nunique() == 1:
            continue
        sample = group.iloc[0]
        rows.append(
            {
                "候选编号": f"DUP-{index:04d}",
                "标记": "完全重复候选",
                "条件指纹": sample["条件指纹"],
                "条件骨架": sample["条件骨架"],
                "规则标识": _join(group["规则标识"]),
                "父行组": _join(group["父行组"]),
                "投放范围": sample["投放范围键"],
                "风险标签": sample["风险标签_规范值"],
                "风险类型": sample["风险类型_规范值"],
                "处置建议": sample["处置建议_规范值"],
                "得分": sample["得分_规范值"],
                "标签状态": sample["标签状态_规范值"],
                "行数": len(group),
                "原始Excel行号": _rows(group["原始Excel行号"]),
                "事实": "这些行的规范化条件、风险标签、风险类型、处置建议、得分、标签状态和投放范围键一致。",
                "不能直接下的结论": "这不是删除建议。相同配置可能是重复录入，也可能是尚未识别的发布副本。",
            }
        )
    return pd.DataFrame(rows)


def reuse_across_scope(layer: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for fingerprint, group in layer.groupby("条件指纹", sort=False):
        if group["投放范围键"].nunique() <= 1 and group["规则标识"].nunique() <= 1:
            continue
        actions = set(group["处置建议_规范值"])
        scores = set(group["得分_规范值"])
        statuses = set(group["标签状态_规范值"])
        labels = set(group["风险标签_规范值"])
        types = set(group["风险类型_规范值"])
        decision_diff = len(actions) > 1 or len(scores) > 1 or len(statuses) > 1
        risk_diff = len(labels) > 1 or len(types) > 1
        has_blank = any((group[f"{field}_规范值"] == UNCONFIGURED).any() for field in SCOPE_FIELDS)
        quality = (group["解析可用"] == "否").any()
        if decision_diff:
            kind = "处置配置不同"
        elif risk_diff:
            kind = "风险标签或风险类型不同"
        elif has_blank:
            kind = "部分投放维度未配置"
        elif quality:
            kind = "条件解析或字段一致性存在问题"
        else:
            kind = "配置完全相同"
        rows.append(
            {
                "条件指纹": fingerprint,
                "条件骨架": group.iloc[0]["条件骨架"],
                "复用分类": kind,
                "是否合理复用仍待确认": "是",
                "直接标为冗余": "否",
                "处置是否不同": "是" if decision_diff else "否",
                "风险标签或类型是否不同": "是" if risk_diff else "否",
                "是否存在未配置投放维度": "是" if has_blank else "否",
                "是否存在解析或字段问题": "是" if quality else "否",
                "规则标识": _join(group["规则标识"]),
                "规则标识数": int(group["规则标识"].nunique()),
                "投放范围数": int(group["投放范围键"].nunique()),
                "投放范围": _join(group["投放范围键"], 500),
                "处置建议全部取值": _join(sorted(actions)),
                "得分全部取值": _join(sorted(scores)),
                "风险类型全部取值": _join(sorted(types)),
                "行数": len(group),
                "原始Excel行号": _rows(group["原始Excel行号"]),
            }
        )
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    return frame.sort_values(["规则标识数", "行数"], ascending=False)


def similar_candidates(layer: pd.DataFrame, profiles: dict[str, RuleProfile]) -> pd.DataFrame:
    weights = load_weights()
    rows = []
    for left_id, right_id in candidate_pairs(profiles):
        left = profiles[left_id]
        right = profiles[right_id]
        if left.condition_fps & right.condition_fps:
            continue
        compared = compare_profiles(left, right, weights)
        if compared["正一致维度数"] < 2 and compared["名称达标且风险类型一致"] != "是":
            continue
        quality = "候选含不可靠解析，特征比较已排除不可用条件" if left.unreliable_rows or right.unreliable_rows else "两侧用于比较的特征均来自解析可用行"
        rows.append(
            {
                "规则标识甲": left_id,
                "规则标识乙": right_id,
                "排序参考": compared["排序参考"],
                "排序参考含义": "只用于候选排序，不是重复概率或风险概率",
                "一致维度": compared["一致维度"],
                "不同或未完全一致": compared["不同或未完全一致"],
                "未计入维度": compared["未计入维度"],
                "名称相似度": compared["名称相似度"],
                "名称说明": compared["名称说明"],
                "风险类型比较": compared["风险类型比较"],
                "风险标签比较": compared["风险标签比较"],
                "特征比较": compared["特征比较"],
                "运算符比较": compared["运算符比较"],
                "阈值比较": compared["阈值比较"],
                "处置比较": compared["处置比较"],
                "投放比较": compared["投放比较"],
                "条件数甲": len(left.condition_fps),
                "条件数乙": len(right.condition_fps),
                "质量标记": quality,
                "原始Excel行号甲": _join(left.rows, 300),
                "原始Excel行号乙": _join(right.rows, 300),
            }
        )
    frame = pd.DataFrame(rows)
    if frame.empty:
        return frame
    frame = frame.sort_values("排序参考", ascending=False)
    if len(frame) > SIMILAR_CAP:
        frame = frame.head(SIMILAR_CAP).copy()
        frame["截断说明"] = f"候选超过 {SIMILAR_CAP} 对，本表只保留排序参考最高的 {SIMILAR_CAP} 对"
    else:
        frame["截断说明"] = "未截断"
    return frame


def _mixed_within(group: pd.DataFrame, scope_col: str, value_col: str) -> bool:
    if group[value_col].nunique() <= 1:
        return False
    for _, sub in group.groupby(scope_col, sort=False):
        if sub[value_col].nunique() > 1:
            return True
    return False


def same_rule_differences(layer: pd.DataFrame) -> pd.DataFrame:
    rows = []
    fields = ("处置建议", "得分", "标签状态", "风险标签", "风险类型")
    for rule_id, group in layer.groupby("规则标识", sort=False):
        if len(group) < 2:
            continue
        changed = [field for field in fields if group[f"{field}_规范值"].nunique() > 1]
        if not changed:
            continue
        rows.append(
            {
                "规则标识": rule_id,
                "差异字段": "、".join(changed),
                "差异是否等于错误": "否，需业务确认",
                "处置建议全部取值": _join(sorted(set(group["处置建议_规范值"]))),
                "得分全部取值": _join(sorted(set(group["得分_规范值"]))),
                "标签状态全部取值": _join(sorted(set(group["标签状态_规范值"]))),
                "风险标签全部取值": _join(sorted(set(group["风险标签_规范值"]))),
                "风险类型全部取值": _join(sorted(set(group["风险类型_规范值"]))),
                "同一投放范围键内处置是否分歧": "是" if _mixed_within(group, "投放范围键", "处置建议_规范值") else "否",
                "同一公司内处置是否分歧": "是" if _mixed_within(group, "公司_规范值", "处置建议_规范值") else "否",
                "投放范围": _join(group["投放范围键"], 500),
                "父行组": _join(group["父行组"]),
                "原始行数": len(group),
                "原始Excel行号": _rows(group["原始Excel行号"]),
                "事实": "同一规则标识下，上述字段出现了多个规范值，全部取值都保留。",
                "可能的合理解释": "不同投放范围可以配置不同处置；若同一投放范围键内也有分歧，这个解释不充分。",
                "待确认问题": "这些取值是否都仍应生效？若只保留一条，以哪一条为准？",
            }
        )
    return pd.DataFrame(rows)


def threshold_spread(layer: pd.DataFrame) -> pd.DataFrame:
    usable = _usable(layer)
    rows = []
    if usable.empty:
        return pd.DataFrame()
    for (feature, operator), group in usable.groupby(["解析特征", "解析运算符"], sort=False):
        if not feature or not operator:
            continue
        public_values = []
        for threshold, fingerprint in zip(group["解析阈值"], group["阈值指纹"]):
            if operator in {"contain", "notContain", "subsetp"}:
                public_values.append(f"名单指纹 {fingerprint} 长度 {len(str(threshold))}")
            elif _is_number(str(threshold)):
                public_values.append(str(threshold))
            else:
                public_values.append(f"文本指纹 {fingerprint} 长度 {len(str(threshold))}")
        numeric = [float(value) for value in group["解析阈值"] if _is_number(str(value))]
        kind = "名单或集合" if operator in {"contain", "notContain", "subsetp"} else "阈值"
        rows.append(
            {
                "记录类型": kind,
                "模型特征": feature,
                "运算符": operator,
                "规则标识数": int(group["规则标识"].nunique()),
                "行数": len(group),
                "不同阈值或名单数": len(set(public_values)),
                "数值最小": min(numeric) if numeric else "",
                "数值最大": max(numeric) if numeric else "",
                "阈值或名单证据": _join(sorted(set(public_values)), 400),
                "风险类型": _join(group["风险类型_规范值"]),
                "处置建议": _join(group["处置建议_规范值"]),
                "原始Excel行号": _rows(group["原始Excel行号"]),
                "纳入条件": "只含解析可用行。部分解析和字段不一致的行未修正，也未纳入。",
            }
        )
    list_rows = []
    lists = usable[usable["解析运算符"].isin(["contain", "notContain", "subsetp"])]
    for (operator, list_fp), group in lists.groupby(["解析运算符", "名单指纹"], sort=False):
        if group["规则标识"].nunique() < 2 or not list_fp:
            continue
        list_rows.append(
            {
                "记录类型": "相同名单跨规则引用",
                "模型特征": _join(group["解析特征"]),
                "运算符": operator,
                "规则标识数": int(group["规则标识"].nunique()),
                "行数": len(group),
                "不同阈值或名单数": 1,
                "数值最小": "",
                "数值最大": "",
                "阈值或名单证据": f"名单指纹 {list_fp}，不输出名单原文",
                "风险类型": _join(group["风险类型_规范值"]),
                "处置建议": _join(group["处置建议_规范值"]),
                "原始Excel行号": _rows(group["原始Excel行号"]),
                "纳入条件": "同一名单指纹出现在多个规则标识。引用本身不是错误。",
            }
        )
    frame = pd.DataFrame(rows + list_rows)
    if frame.empty:
        return frame
    return frame.sort_values(["规则标识数", "不同阈值或名单数"], ascending=False)


def _is_number(value: str) -> bool:
    import re

    return bool(re.fullmatch(r"-?\d+(?:\.\d+)?", value))


def quality_sheet(layer: pd.DataFrame) -> pd.DataFrame:
    summary = []
    for code, count in Counter(code for codes in layer["质量代码"] for code in str(codes).split(",") if code).most_common():
        summary.append({"记录类型": "问题计数", "质量代码": code, "行数": count, "原始Excel行号": "", "规则标识": "", "解析级别": "", "解析可用": "", "条件骨架": "", "说明": "只计数，不修正。"})
    detail_source = layer[(layer["解析可用"] == "否") | (layer["质量代码"] != "")]
    detail = pd.DataFrame(
        {
            "记录类型": "明细",
            "质量代码": detail_source["质量代码"],
            "行数": 1,
            "原始Excel行号": detail_source["原始Excel行号"],
            "规则标识": detail_source["规则标识"],
            "解析级别": detail_source["解析级别"],
            "解析可用": detail_source["解析可用"],
            "条件骨架": detail_source["条件骨架"],
            "说明": "保留原始拆分列和条件原文。解析阈值未回写到源字段。",
        }
    )
    excluded = int((layer["解析可用"] == "否").sum())
    summary.insert(0, {"记录类型": "排除说明", "质量代码": "解析不可用", "行数": excluded, "原始Excel行号": "", "规则标识": "", "解析级别": "", "解析可用": "否", "条件骨架": "", "说明": "阈值分布和特征相似度排除这些行。"})
    return pd.concat([pd.DataFrame(summary), detail], ignore_index=True)


def conflicts(layer: pd.DataFrame, differences: pd.DataFrame, reuse: pd.DataFrame) -> pd.DataFrame:
    rows = []
    if len(differences):
        for record in differences.to_dict("records"):
            rows.append(
                {
                    "冲突标记": "潜在冲突，待确认执行逻辑",
                    "观察": "同一规则标识的处置、得分、标签状态或风险字段存在多个取值",
                    "规则标识": record["规则标识"],
                    "条件骨架": "",
                    "处置建议全部取值": record["处置建议全部取值"],
                    "得分全部取值": record["得分全部取值"],
                    "标签状态全部取值": record["标签状态全部取值"],
                    "投放范围": record["投放范围"],
                    "原始Excel行号": record["原始Excel行号"],
                    "未知的执行逻辑": "不知道这些配置谁优先、是否聚合、有没有白名单或后置处置。",
                    "不能下的结论": "不能说线上已经发生冲突。",
                }
            )
    if len(reuse):
        cross = reuse[reuse["处置是否不同"] == "是"]
        for record in cross.to_dict("records"):
            rows.append(
                {
                    "冲突标记": "潜在冲突，待确认执行逻辑",
                    "观察": "相同条件指纹下处置配置不同",
                    "规则标识": record["规则标识"],
                    "条件骨架": record["条件骨架"],
                    "处置建议全部取值": record["处置建议全部取值"],
                    "得分全部取值": record["得分全部取值"],
                    "标签状态全部取值": "",
                    "投放范围": record["投放范围"],
                    "原始Excel行号": record["原始Excel行号"],
                    "未知的执行逻辑": "相同条件被多条规则使用时，命中后如何选处置仍未知。",
                    "不能下的结论": "不能说线上已经发生冲突，也不能直接要求统一处置。",
                }
            )
    return pd.DataFrame(rows)


def _diagnosis_row(**kwargs) -> dict[str, str]:
    base = {
        "问题编号": "",
        "问题类型": "",
        "涉及的规则标识": "",
        "原始Excel行号": "",
        "相关条件和投放范围": "",
        "发现的事实": "",
        "具体差异证据": "",
        "可能的业务影响": "",
        "可能的合理解释": "",
        "待业务确认的问题": "",
        "建议核查动作": "",
        "处理优先级": "",
        "优先级理由": "",
        "证据可信度": "",
        "当前状态": "待业务确认",
    }
    base.update(kwargs)
    return base


def diagnosis_list(layer: pd.DataFrame, duplicates: pd.DataFrame, reuse: pd.DataFrame, differences: pd.DataFrame, thresholds: pd.DataFrame) -> pd.DataFrame:
    items: list[dict[str, str]] = []

    def add(item: dict[str, str]) -> None:
        item["问题编号"] = f"D{len(items) + 1:03d}"
        items.append(item)

    shift = layer[layer["质量代码"].str.contains("column_shift", na=False)]
    if len(shift):
        add(
            _diagnosis_row(
                问题类型="疑似列错位",
                涉及的规则标识=_join(shift["规则标识"]),
                原始Excel行号=_rows(shift["原始Excel行号"]),
                相关条件和投放范围=_join(shift["条件骨架"], 300),
                发现的事实=f"有 {len(shift)} 行比较运算值不在运算符词表，阈值列像运算符，且无表头列有值。",
                具体差异证据="质量代码含 column_shift。解析结果没有回写到拆分列。",
                可能的业务影响="若后续直接使用拆分列，特征和阈值会错配，资产统计和相似度都会偏。",
                可能的合理解释="导出或按符号拆列时，特征名内部的比较符导致错位。这是数据形态假设，不是已经核对过的原因。",
                待业务确认的问题="这些行应以条件原文还是以拆分列作为配置事实？",
                建议核查动作="按原始行号回看原表，人工确认三列和条件原文。确认前不要批量修正。",
                处理优先级="P0",
                优先级理由="拆分列可能不能代表真实条件，直接影响策略配置是否被读对。出现次数只说明覆盖行数，不代表线上损失大小。",
                证据可信度="高。错位形态来自字段对照，未验证每条业务含义。",
            )
        )
    mismatch = layer[layer["质量代码"].str.contains("feature_mismatch|operator_mismatch|threshold_mismatch|threshold_missing_in_column", na=False)]
    mismatch = mismatch[~mismatch["质量代码"].str.contains("column_shift", na=False)]
    if len(mismatch):
        add(
            _diagnosis_row(
                问题类型="条件与拆分字段不一致",
                涉及的规则标识=_join(mismatch["规则标识"]),
                原始Excel行号=_rows(mismatch["原始Excel行号"]),
                相关条件和投放范围=f"涉及 {mismatch['条件指纹'].nunique()} 个条件指纹",
                发现的事实=f"除疑似列错位外，还有 {len(mismatch)} 行条件原文和特征、运算符或阈值列不一致。",
                具体差异证据="见数据质量明细中的质量代码。本阶段没有选择其中一列覆盖另一列。",
                可能的业务影响="用错来源列会把不同特征当成同一条规则，或把空阈值当成没有限制。",
                可能的合理解释="拆列规则没有覆盖名单、空阈值或特征名中的符号。",
                待业务确认的问题="分析应以条件原文的解析候选为准，还是以拆分列为准？",
                建议核查动作="先抽查每个质量代码的若干原始行，再决定后续模块的可信字段。",
                处理优先级="P0",
                优先级理由="字段来源不统一时，后面的重复和冲突判断会跟着错。",
                证据可信度="高。对照的是原文和拆分列，未把解析失败说成策略错误。",
            )
        )
    if len(differences):
        same_scope = differences[differences["同一投放范围键内处置是否分歧"] == "是"]
        by_company = differences[(differences["同一公司内处置是否分歧"] == "是") & (differences["同一投放范围键内处置是否分歧"] == "否")]
        across = differences[differences["同一公司内处置是否分歧"] == "否"]
        if len(same_scope):
            add(
                _diagnosis_row(
                    问题类型="同一规则同一投放范围的处置分歧",
                    涉及的规则标识=_join(same_scope["规则标识"]),
                    原始Excel行号=_join(same_scope["原始Excel行号"], 500),
                    相关条件和投放范围=_join(same_scope["投放范围"], 400),
                    发现的事实=f"{len(same_scope)} 个规则标识在同一个投放范围键里出现了多个处置建议。全部取值见同规则配置差异表。",
                    具体差异证据=_join(same_scope["处置建议全部取值"], 300),
                    可能的业务影响="同一范围下没有唯一处置时，静态配置无法判断哪一条会生效。",
                    可能的合理解释="可能是版本残留，或还有表外的优先级字段。当前表不能区分这两种情况。",
                    待业务确认的问题="同一范围是否允许多条处置同时存在？若不允许，保留哪一条？",
                    建议核查动作="按规则标识和原始行号逐条核对，不要按出现次数自动选取得分更高的一条。",
                    处理优先级="P0",
                    优先级理由="投放范围已经相同，不能再用渠道或公司差异解释处置不同。",
                    证据可信度="高。比较的是规范后的处置建议和投放范围键。",
                )
            )
        if len(by_company):
            add(
                _diagnosis_row(
                    问题类型="同一规则同一公司内的处置分歧",
                    涉及的规则标识=_join(by_company["规则标识"]),
                    原始Excel行号=_join(by_company["原始Excel行号"], 500),
                    相关条件和投放范围=_join(by_company["投放范围"], 400),
                    发现的事实=f"{len(by_company)} 个规则标识在同一公司规范值下有多个处置建议，但投放范围键不完全相同。",
                    具体差异证据="同一公司内处置是否分歧=是。",
                    可能的业务影响="公司内部若没有进一步的渠道或场景优先级，处置结果不确定。",
                    可能的合理解释="渠道、场景或来源不同，处置可以不同。",
                    待业务确认的问题="公司内的处置差异是否都有对应的投放维度支撑？",
                    建议核查动作="对照投放范围键，确认分歧是否落在已配置维度上，而不是未配置维度上。",
                    处理优先级="P1",
                    优先级理由="范围比完全相同的投放键更宽，仍可能影响同一公司的策略结果。",
                    证据可信度="中。公司字段一致，但其他投放维度可能不同。",
                )
            )
        if len(across):
            add(
                _diagnosis_row(
                    问题类型="同一规则跨投放范围的配置差异",
                    涉及的规则标识=_join(across["规则标识"]),
                    原始Excel行号=_join(across["原始Excel行号"], 400),
                    相关条件和投放范围=f"{len(across)} 个规则标识。范围见同规则配置差异表。",
                    发现的事实="这些规则标识的处置、得分或标签在不同范围下取值不同，且同一公司内没有看到处置分歧。",
                    具体差异证据="全部取值已分列保留，没有压成一个代表值。",
                    可能的业务影响="若范围维度被误当成同一次命中，处置会看起来互相矛盾。",
                    可能的合理解释="按公司、应用、渠道或来源分别配置是可能的业务设计。",
                    待业务确认的问题="哪些差异是故意按范围拆开的，哪些是配置漂移？",
                    建议核查动作="按公司或渠道分组查看全部取值，不要求先统一成一个处置。",
                    处理优先级="P1",
                    优先级理由="覆盖多个规则标识，但是差异本身可以被范围解释，所以不直接视为数据错误。",
                    证据可信度="中。事实是取值不同；原因是否合理仍待确认。",
                )
            )
    if len(reuse):
        decision_diff = reuse[reuse["处置是否不同"] == "是"]
        identical = reuse[reuse["复用分类"] == "配置完全相同"]
        if len(decision_diff):
            add(
                _diagnosis_row(
                    问题类型="相同条件的处置差异",
                    涉及的规则标识=_join(decision_diff["规则标识"], 400),
                    原始Excel行号=_join(decision_diff["原始Excel行号"], 400),
                    相关条件和投放范围=f"{len(decision_diff)} 个条件指纹。骨架见相同条件跨范围复用表。",
                    发现的事实="同一条件指纹对应了多个处置建议、得分或标签状态。",
                    具体差异证据="复用表中处置是否不同=是，并保留了全部取值。",
                    可能的业务影响="若这些规则会命中同一段内容，静态表看不出最终处置。",
                    可能的合理解释="不同规则标识或不同范围本来就允许不同处置。",
                    待业务确认的问题="相同条件命中后，处置是覆盖、并行还是按范围选择？",
                    建议核查动作="先确认执行和聚合逻辑，再决定是否要整理配置。",
                    处理优先级="P1",
                    优先级理由="条件文本相同使候选更具体，但缺少命中优先级，不能升成已证实冲突。",
                    证据可信度="中。条件指纹来自原文；线上是否同时生效未知。",
                )
            )
        if len(identical):
            add(
                _diagnosis_row(
                    问题类型="相同条件跨范围复用",
                    涉及的规则标识=_join(identical["规则标识"], 300),
                    原始Excel行号=_join(identical["原始Excel行号"], 300),
                    相关条件和投放范围=f"{len(identical)} 个条件指纹的配置完全相同，投放范围不同。",
                    发现的事实="条件、处置和风险字段一致，范围键不同。",
                    具体差异证据="复用分类=配置完全相同。未标记为冗余。",
                    可能的业务影响="维护时可能要改多处；也可能是有意按范围各放一份。",
                    可能的合理解释="同一条策略复用到多个公司、应用或渠道。",
                    待业务确认的问题="这些复用是否应保留多份配置？",
                    建议核查动作="抽查投放范围是否都需要独立副本。不要因为范围不同就合并或删除。",
                    处理优先级="P2",
                    优先级理由="更像维护结构问题，现有证据不能说明策略结果错误。",
                    证据可信度="中。",
                )
            )
    if len(duplicates):
        add(
            _diagnosis_row(
                问题类型="完全重复配置候选",
                涉及的规则标识=_join(duplicates["规则标识"], 400),
                原始Excel行号=_join(duplicates["原始Excel行号"], 400),
                相关条件和投放范围=f"{len(duplicates)} 组。条件和投放范围键一致。",
                发现的事实="一组内的条件指纹、风险、处置、得分、标签状态和投放范围键相同，且对应多行。",
                具体差异证据="标记为完全重复候选。父行拆开的不同条件不会进入同一组。",
                可能的业务影响="重复维护会让后续修改漏掉其中一份。",
                可能的合理解释="可能是发布副本或导出重复，需要对照规则标识和父行组。",
                待业务确认的问题="这些行是否都应保留？",
                建议核查动作="按候选编号回看原始行号。未确认前不删除。",
                处理优先级="P1",
                优先级理由="配置键完全相同，重复维护的可能性高于仅跨范围复用；仍不是删除决定。",
                证据可信度="高。比较键都来自已保留的字段，没有使用不可用解析去补值。",
            )
        )
    if len(thresholds):
        spread = thresholds[(thresholds["记录类型"] != "相同名单跨规则引用") & (thresholds["不同阈值或名单数"] >= 3) & (thresholds["规则标识数"] >= 5)]
        shared_lists = thresholds[thresholds["记录类型"] == "相同名单跨规则引用"]
        if len(spread):
            add(
                _diagnosis_row(
                    问题类型="同特征同运算符的阈值分布差异",
                    涉及的规则标识=f"见同特征阈值分布，符合条件的特征组 {len(spread)} 个",
                    原始Excel行号="见同特征阈值分布表",
                    相关条件和投放范围="只统计解析可用行。",
                    发现的事实=f"{len(spread)} 个特征加运算符组合有至少 3 个阈值，且至少 5 个规则标识。",
                    具体差异证据="表中给出数值最小、最大或指纹，名单原文未输出。",
                    可能的业务影响="阈值分散会让相似风险的松紧不一致，但是否过松或过严需要业务标准。",
                    可能的合理解释="不同风险标签、渠道或客户可以有不同阈值。",
                    待业务确认的问题="哪些阈值差是设计，哪些需要回收到统一档位？",
                    建议核查动作="按特征和运算符查看分布，不按极值自动改阈值。",
                    处理优先级="P2",
                    优先级理由="这是配置分布观察。没有效果数据时，不能把阈值多解释成风险更高。",
                    证据可信度="中。已排除解析不可用行。",
                )
            )
        if len(shared_lists):
            add(
                _diagnosis_row(
                    问题类型="相同名单跨规则引用",
                    涉及的规则标识=f"{len(shared_lists)} 个名单指纹被多个规则使用",
                    原始Excel行号="见同特征阈值分布中的相同名单跨规则引用",
                    相关条件和投放范围="名单原文未写入报告，只用指纹和长度。",
                    发现的事实="多个规则标识引用了同一名单指纹。",
                    具体差异证据="记录类型=相同名单跨规则引用。",
                    可能的业务影响="名单更新时可能需要同步多条规则。",
                    可能的合理解释="共用名单是正常治理方式。",
                    待业务确认的问题="这些名单是否应有统一的维护入口？",
                    建议核查动作="用指纹回原表定位名单，确认引用关系是否故意。",
                    处理优先级="P2",
                    优先级理由="属于名单治理，不是已证实的策略冲突。",
                    证据可信度="中。",
                )
            )
    partial = layer[layer["解析级别"] == "部分解析"]
    if len(partial):
        add(
            _diagnosis_row(
                问题类型="条件只能部分解析",
                涉及的规则标识=_join(partial["规则标识"]),
                原始Excel行号=_rows(partial["原始Excel行号"]),
                相关条件和投放范围=_join(partial["条件骨架"], 300),
                发现的事实=f"{len(partial)} 行存在多个顶层运算符或结构不完整，不能唯一切成一个特征、运算符和阈值。",
                具体差异证据="解析级别=部分解析。常见情况是特征文本自身含有比较符。",
                可能的业务影响="自动特征统计会漏掉或切错这些行。",
                可能的合理解释="特征名合法地包含 >= 等符号，当前解析器拒绝猜测切分点。",
                待业务确认的问题="这些条件的真实特征边界在哪里？",
                建议核查动作="人工看原始行。不要按第一个比较符自动切开。",
                处理优先级="P2",
                优先级理由="影响的是分析可用性。没有证据表明线上执行也按同样方式误切。",
                证据可信度="高。解析器明确拒绝了不唯一的切分。",
            )
        )
    remark_rules = int((layer.groupby("规则标识")["备注_规范值"].nunique() > 1).sum()) if "备注_规范值" in layer.columns else 0
    if remark_rules:
        add(
            _diagnosis_row(
                问题类型="备注或描述在同一规则下不一致",
                涉及的规则标识=f"{remark_rules} 个规则标识的备注规范值多于一个",
                原始Excel行号="未逐条展开，避免把长文本写入诊断清单",
                相关条件和投放范围="这是元数据差异，不代表条件不同。",
                发现的事实=f"{remark_rules} 个规则标识下备注不完全相同。",
                具体差异证据="按规则标识分组后备注规范值数量大于 1。原文未抄入本清单。",
                可能的业务影响="主要影响人工阅读和版本追踪。",
                可能的合理解释="不同范围或不同时间的备注本来就不同。",
                待业务确认的问题="备注是否需要统一？",
                建议核查动作="只在整理文档时处理，不据此修改处置。",
                处理优先级="P3",
                优先级理由="没有看到它改变条件或处置。出现次数多也不提高优先级。",
                证据可信度="中。",
            )
        )
    if not items:
        add(
            _diagnosis_row(
                问题类型="未形成诊断条目",
                发现的事实="当前数据没有命中第一版诊断规则。",
                可能的合理解释="样本很小，或关键字段不足。",
                待业务确认的问题="是否还需要补充业务字段？",
                建议核查动作="核对字段映射。",
                处理优先级="P3",
                优先级理由="没有观察到需要优先核实的配置事实。",
                证据可信度="中。",
            )
        )
    return pd.DataFrame(items)


def run_diagnosis(layer: pd.DataFrame) -> dict[str, pd.DataFrame]:
    profiles = build_profiles(layer)
    sheets = portrait(layer)
    duplicates = exact_duplicates(layer)
    reuse = reuse_across_scope(layer)
    similar = similar_candidates(layer, profiles)
    differences = same_rule_differences(layer)
    thresholds = threshold_spread(layer)
    quality = quality_sheet(layer)
    conflict = conflicts(layer, differences, reuse)
    items = diagnosis_list(layer, duplicates, reuse, differences, thresholds)
    return {
        "策略资产总览": sheets["overview"],
        "风险标签分布": sheets["labels"],
        "风险类型分布": sheets["types"],
        "投放范围分布": sheets["scope"],
        "规则复杂度": sheets["complexity"],
        "完全重复候选": duplicates,
        "相同条件跨范围复用": reuse,
        "相似规则候选": similar,
        "同规则配置差异": differences,
        "同特征阈值分布": thresholds,
        "潜在处置冲突": conflict,
        "数据质量与排除记录": quality,
        "策略诊断清单": items,
        "_profiles": profiles,
    }


def summary_counts(layer: pd.DataFrame, sheets: dict[str, pd.DataFrame]) -> dict[str, int]:
    items = sheets["策略诊断清单"]
    priority = Counter(items["处理优先级"]) if len(items) else Counter()
    return {
        "原始行数": len(layer),
        "规则标识数": int(layer["规则标识"].nunique()),
        "父行组数": int(layer["父行组"].nunique()),
        "原子条件数": int(layer["条件指纹"].nunique()),
        "规则与投放范围组合数": int(layer.groupby(["规则标识", "投放范围键"]).ngroups),
        "完全重复候选组数": len(sheets["完全重复候选"]),
        "跨范围复用条件数": len(sheets["相同条件跨范围复用"]),
        "相似规则候选对数": len(sheets["相似规则候选"]),
        "同规则配置差异数": len(sheets["同规则配置差异"]),
        "阈值分布组数": len(sheets["同特征阈值分布"]),
        "潜在处置冲突条数": len(sheets["潜在处置冲突"]),
        "解析不可用行数": int((layer["解析可用"] == "否").sum()),
        "诊断条目数": len(items),
        "P0": int(priority.get("P0", 0)),
        "P1": int(priority.get("P1", 0)),
        "P2": int(priority.get("P2", 0)),
        "P3": int(priority.get("P3", 0)),
    }
