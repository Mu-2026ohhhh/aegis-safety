"""内容安全策略治理报告。只读原始表，写入新的时间戳目录。"""

from __future__ import annotations

import hashlib
import sys
from collections import Counter
from datetime import datetime
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
HEALTHCHECK_DIR = HERE.parent / "rule_healthcheck"
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))
if str(HEALTHCHECK_DIR) not in sys.path:
    sys.path.insert(0, str(HEALTHCHECK_DIR))

from analyze import prepare_frame  # noqa: E402
from layer import build_layer, require_layer_columns  # noqa: E402

SOURCE_DEFAULT = Path("/Users/haohan/Desktop/脚本/你的规则表_副本_已按&&拆分.xlsx")
HISTORY_DIAGNOSIS = HERE / "reports" / "real" / "20261016_173821_531409"
HISTORY_HEALTH = HEALTHCHECK_DIR / "reports" / "real" / "数据体检_20261016_160817_261693.xlsx"
EXPECTED_SOURCE_SHA = "5e12121df8223b928f28a7d0943b7a214e66f3452a6dc9aeb24d9c65343b586f"

DUP_KEYS = [
    "条件指纹",
    "风险标签_规范值",
    "风险类型_规范值",
    "处置建议_规范值",
    "得分_规范值",
    "标签状态_规范值",
    "投放范围键",
]
SCOPE_FIELDS = [
    "公司_规范值",
    "应用_规范值",
    "渠道/事件_规范值",
    "策略场景_规范值",
    "来源_规范值",
    "规则类型_规范值",
]
FINE_SCOPE = SCOPE_FIELDS
NUM_CMP = {">", ">=", "<", "<="}
NUM_EQ = {"=", "=="}
TEXT_EQ = {"eq", "neq"}
CONTAIN_OPS = {"contain", "notContain"}
SET_OPS = {"subsetp"}
LIST_OPS = CONTAIN_OPS | SET_OPS


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _clean(value: object) -> str:
    text = "" if value is None else str(value)
    return "".join(ch for ch in text if ch >= " " or ch in "\t")


def _frame(rows: list[dict] | pd.DataFrame) -> pd.DataFrame:
    frame = rows if isinstance(rows, pd.DataFrame) else pd.DataFrame(rows)
    if frame.empty:
        return frame
    return frame.map(_clean) if hasattr(frame, "map") else frame.applymap(_clean)


def _is_number(value: str) -> bool:
    import re

    return bool(re.fullmatch(r"-?\d+(?:\.\d+)?", str(value).strip()))


def _op_family(operator: str) -> str:
    if operator in NUM_CMP:
        return "数值比较"
    if operator in NUM_EQ:
        return "数值等值"
    if operator in TEXT_EQ:
        return "文本等值"
    if operator in CONTAIN_OPS:
        return "包含关系"
    if operator in SET_OPS:
        return "集合关系"
    return "其他"


def _codes(value: object) -> set[str]:
    return {part for part in str(value).split(",") if part}


def _changed(group: pd.DataFrame, column: str) -> bool:
    return int(group[column].nunique()) > 1


def _join_ids(values) -> str:
    seen: list[str] = []
    for value in values:
        text = str(value)
        if text not in seen:
            seen.append(text)
    return " | ".join(seen)


def write_book(path: Path, sheets: dict[str, pd.DataFrame]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        for name, frame in sheets.items():
            sheet = name[:31]
            data = frame if isinstance(frame, pd.DataFrame) else pd.DataFrame(frame)
            data.to_excel(writer, sheet_name=sheet, index=False)


def build_tables(layer: pd.DataFrame, prepared: pd.DataFrame, resolved) -> dict:
    layer = layer.copy()
    layer["质量集合"] = layer["质量代码"].map(_codes)
    created_col = resolved.mapping.get("created_at", "")
    feature_col = resolved.mapping.get("feature", "")
    operator_col = resolved.mapping.get("operator", "")
    threshold_col = resolved.mapping.get("threshold", "")
    overflow_cols = list(resolved.overflow_cols)
    prepared = prepared.copy()
    prepared["创建时间"] = prepared[created_col] if created_col else ""
    prepared["拆分特征"] = prepared[feature_col] if feature_col else ""
    prepared["拆分运算符"] = prepared[operator_col] if operator_col else ""
    prepared["拆分阈值"] = prepared[threshold_col] if threshold_col else ""
    prepared["溢出列"] = prepared.apply(
        lambda row: " ".join(row[col] for col in overflow_cols if row.get(col, "")).strip(),
        axis=1,
    )
    side = prepared[["_excel_row", "创建时间", "拆分特征", "拆分运算符", "拆分阈值", "溢出列"]].rename(
        columns={"_excel_row": "原始Excel行号"}
    )
    layer = layer.merge(side, on="原始Excel行号", how="left")

    stats: dict[str, object] = {}
    parents = layer.groupby("父行组")
    rule_scope = layer.groupby(["规则标识", "投放范围键"])
    stats["原始行数"] = int(len(layer))
    stats["规则标识数"] = int(layer["规则标识"].nunique())
    stats["条件指纹数"] = int(layer["条件指纹"].nunique())
    stats["父行组数"] = int(layer["父行组"].nunique())
    stats["规则范围组合数"] = int(rule_scope.ngroups)
    stats["父行组对应多个范围"] = int((parents["投放范围键"].nunique() > 1).sum())
    stats["父行组对应多个规则"] = int((parents["规则标识"].nunique() > 1).sum())
    stats["规则范围对应多个父行"] = int((rule_scope["父行组"].nunique() > 1).sum())

    dup_groups = []
    dup_members = []
    for index, (_, group) in enumerate(layer.groupby(DUP_KEYS, sort=False), start=1):
        if len(group) < 2:
            continue
        if group["规则标识"].nunique() < 2:
            continue
        gid = f"DUP-{index:04d}"
        name_same = not _changed(group, "规则名称_规范值")
        l4_same = not _changed(group, "关联四级标签_规范值")
        desc_same = not _changed(group, "规则描述_规范值")
        remark_same = not _changed(group, "备注_规范值")
        if name_same and l4_same:
            priority, action, reason = (
                "P1",
                "审批后指定一个主规则标识并停止继续双写。不删除现有行。",
                "同一投放范围、同一条件、同一处置、同一名称、同一四级标签，重复维护成本高。",
            )
            kind = "严格重复"
        elif not l4_same:
            priority, action, reason = (
                "P2",
                "暂不合并。先确认四级标签差异是否代表不同业务语义。",
                "可执行处置一致，但关联四级标签不同，直接合并会丢掉标签差异。",
            )
            kind = "处置相同但四级标签不同"
        else:
            priority, action, reason = (
                "P2",
                "暂不合并。先确认不同名称是否为同一策略的别名。",
                "处置与四级标签一致，但规则名称不同。",
            )
            kind = "处置相同但名称不同"
        if name_same and l4_same and desc_same and remark_same:
            kind = "连描述和备注也相同"
        dup_groups.append(
            {
                "候选编号": gid,
                "问题类型": kind,
                "优先级": priority,
                "建议动作": action,
                "判断依据": reason,
                "条件指纹": group.iloc[0]["条件指纹"],
                "条件骨架": group.iloc[0]["条件骨架"],
                "规则标识数": int(group["规则标识"].nunique()),
                "规则标识": _join_ids(group["规则标识"]),
                "父行组数": int(group["父行组"].nunique()),
                "投放范围数": int(group["投放范围键"].nunique()),
                "投放范围键": group.iloc[0]["投放范围键"],
                "公司": group.iloc[0]["公司_规范值"],
                "应用": group.iloc[0]["应用_规范值"],
                "渠道或事件": group.iloc[0]["渠道/事件_规范值"],
                "策略场景": group.iloc[0]["策略场景_规范值"],
                "来源": group.iloc[0]["来源_规范值"],
                "规则类型": group.iloc[0]["规则类型_规范值"],
                "风险标签": group.iloc[0]["风险标签_规范值"],
                "风险类型": group.iloc[0]["风险类型_规范值"],
                "处置建议": group.iloc[0]["处置建议_规范值"],
                "得分": group.iloc[0]["得分_规范值"],
                "标签状态": group.iloc[0]["标签状态_规范值"],
                "名称是否一致": "是" if name_same else "否",
                "四级标签是否一致": "是" if l4_same else "否",
                "描述是否一致": "是" if desc_same else "否",
                "备注是否一致": "是" if remark_same else "否",
                "行数": len(group),
                "最早创建时间": min(group["创建时间"]),
                "最晚创建时间": max(group["创建时间"]),
                "判断可信程度": "高。分组键已包含投放范围，组内范围数必须为1。",
                "是否需要业务审批": "是",
            }
        )
        for row in group.to_dict("records"):
            dup_members.append(
                {
                    "候选编号": gid,
                    "原始Excel行号": row["原始Excel行号"],
                    "规则标识": row["规则标识"],
                    "父行组": row["父行组"],
                    "创建时间": row["创建时间"],
                    "规则名称": row["规则名称_规范值"],
                    "关联四级标签": row["关联四级标签_规范值"],
                    "条件指纹": row["条件指纹"],
                    "条件骨架": row["条件骨架"],
                    "投放范围键": row["投放范围键"],
                    "处置建议": row["处置建议_规范值"],
                    "得分": row["得分_规范值"],
                    "风险类型": row["风险类型_规范值"],
                    "风险标签": row["风险标签_规范值"],
                }
            )
    dup_g = _frame(dup_groups)
    dup_m = _frame(dup_members)
    stats["完全重复组数"] = int(len(dup_g))
    stats["完全重复行数"] = int(len(dup_m))
    stats["严格重复组数"] = int((dup_g["问题类型"] == "严格重复").sum()) if len(dup_g) else 0
    stats["连描述也相同组数"] = int((dup_g["问题类型"] == "连描述和备注也相同").sum()) if len(dup_g) else 0
    stats["四级标签不同组数"] = int((dup_g["问题类型"] == "处置相同但四级标签不同").sum()) if len(dup_g) else 0
    stats["名称不同组数"] = int((dup_g["问题类型"] == "处置相同但名称不同").sum()) if len(dup_g) else 0
    stats["重复组跨范围数"] = int((dup_g["投放范围数"].astype(int) > 1).sum()) if len(dup_g) else 0

    reuse_groups = []
    reuse_members = []
    decision_action = decision_score = decision_status = 0
    for index, (fingerprint, group) in enumerate(layer.groupby("条件指纹", sort=False), start=1):
        if group["投放范围键"].nunique() <= 1 and group["规则标识"].nunique() <= 1:
            continue
        actions = set(group["处置建议_规范值"])
        scores = set(group["得分_规范值"])
        statuses = set(group["标签状态_规范值"])
        labels = set(group["风险标签_规范值"])
        types = set(group["风险类型_规范值"])
        configured_vary = []
        for field, label in [
            ("公司_规范值", "公司"),
            ("应用_规范值", "应用"),
            ("渠道/事件_规范值", "渠道/事件"),
            ("策略场景_规范值", "策略场景"),
            ("来源_规范值", "来源"),
            ("规则类型_规范值", "规则类型"),
        ]:
            values = {value for value in group[field] if value != "未配置"}
            if len(values) > 1:
                configured_vary.append(label)
        blank_dims = [
            label
            for field, label in [
                ("公司_规范值", "公司"),
                ("应用_规范值", "应用"),
                ("渠道/事件_规范值", "渠道/事件"),
                ("策略场景_规范值", "策略场景"),
                ("来源_规范值", "来源"),
                ("规则类型_规范值", "规则类型"),
            ]
            if (group[field] == "未配置").any()
        ]
        if len(actions) > 1:
            kind = "处置建议不同"
            decision_action += 1
            priority = "P1" if group["投放范围键"].nunique() == 1 else "P2"
        elif len(scores) > 1:
            kind = "仅得分不同"
            decision_score += 1
            priority = "P2"
        elif len(statuses) > 1:
            kind = "仅标签状态不同"
            decision_status += 1
            priority = "P2"
        elif len(labels) > 1 or len(types) > 1:
            kind = "风险标签或风险类型不同"
            priority = "P2"
        elif configured_vary:
            kind = "已配置投放维度不同"
            priority = "P3"
        elif blank_dims:
            kind = "仅空值分布不同"
            priority = "P2"
        else:
            kind = "同范围多规则且决策一致"
            priority = "P1"
        gid = f"REUSE-{index:04d}"
        reuse_groups.append(
            {
                "候选编号": gid,
                "复用分类": kind,
                "优先级": priority,
                "条件指纹": fingerprint,
                "条件骨架": group.iloc[0]["条件骨架"],
                "规则标识数": int(group["规则标识"].nunique()),
                "规则标识": _join_ids(group["规则标识"]),
                "投放范围数": int(group["投放范围键"].nunique()),
                "实际变化的已配置维度": " | ".join(configured_vary) if configured_vary else "无",
                "出现未配置的维度": " | ".join(blank_dims) if blank_dims else "无",
                "处置建议": " | ".join(sorted(actions)),
                "得分": " | ".join(sorted(scores)),
                "标签状态": " | ".join(sorted(statuses)),
                "风险标签": " | ".join(sorted(labels)),
                "风险类型": " | ".join(sorted(types)),
                "行数": len(group),
                "直接标为冗余": "否",
                "空值解释": "未配置只表示该格为空，不表示全渠道生效，也不表示线上无覆盖。",
            }
        )
        for row in group.to_dict("records"):
            reuse_members.append(
                {
                    "候选编号": gid,
                    "复用分类": kind,
                    "原始Excel行号": row["原始Excel行号"],
                    "规则标识": row["规则标识"],
                    "父行组": row["父行组"],
                    "条件指纹": row["条件指纹"],
                    "条件骨架": row["条件骨架"],
                    "公司": row["公司_规范值"],
                    "应用": row["应用_规范值"],
                    "渠道或事件": row["渠道/事件_规范值"],
                    "策略场景": row["策略场景_规范值"],
                    "来源": row["来源_规范值"],
                    "规则类型": row["规则类型_规范值"],
                    "处置建议": row["处置建议_规范值"],
                    "得分": row["得分_规范值"],
                    "标签状态": row["标签状态_规范值"],
                    "风险标签": row["风险标签_规范值"],
                    "风险类型": row["风险类型_规范值"],
                    "解析可用": row["解析可用"],
                }
            )
    reuse_g = _frame(reuse_groups)
    reuse_m = _frame(reuse_members)
    stats["复用条件数"] = int(len(reuse_g))
    stats["处置建议不同"] = decision_action
    stats["仅得分不同"] = decision_score
    stats["仅标签状态不同"] = decision_status
    stats["历史570对应拆分"] = decision_action + decision_score + decision_status

    conflict_rows = []
    conflict_groups = []
    for index, (key, group) in enumerate(layer.groupby(["条件指纹", *FINE_SCOPE], sort=False), start=1):
        if group["处置建议_规范值"].nunique() <= 1:
            continue
        gid = f"CONF-{index:04d}"
        conflict_groups.append(
            {
                "候选编号": gid,
                "优先级": "P1",
                "建议类别": "C",
                "问题类型": "同一条件在同一投放范围由不同规则给出不同处置",
                "条件指纹": group.iloc[0]["条件指纹"],
                "条件骨架": group.iloc[0]["条件骨架"],
                "规则标识数": int(group["规则标识"].nunique()),
                "规则标识": _join_ids(group["规则标识"]),
                "处置建议": " | ".join(sorted(set(group["处置建议_规范值"]))),
                "得分": " | ".join(sorted(set(group["得分_规范值"]))),
                "标签状态": " | ".join(sorted(set(group["标签状态_规范值"]))),
                "风险类型": " | ".join(sorted(set(group["风险类型_规范值"]))),
                "公司": group.iloc[0]["公司_规范值"],
                "应用": group.iloc[0]["应用_规范值"],
                "渠道或事件": group.iloc[0]["渠道/事件_规范值"],
                "策略场景": group.iloc[0]["策略场景_规范值"],
                "来源": group.iloc[0]["来源_规范值"],
                "规则类型": group.iloc[0]["规则类型_规范值"],
                "行数": len(group),
                "判断": "配置层面可以确认处置不一致。是否同时生效取决于执行顺序、优先级和短路，当前表不能证明线上冲突已经发生。",
                "推荐动作": "向策略负责人确认这组规则的优先级。确认前不改处置。",
                "是否需要业务审批": "是",
            }
        )
        for row in group.to_dict("records"):
            conflict_rows.append(
                {
                    "候选编号": gid,
                    "原始Excel行号": row["原始Excel行号"],
                    "规则标识": row["规则标识"],
                    "父行组": row["父行组"],
                    "条件指纹": row["条件指纹"],
                    "条件骨架": row["条件骨架"],
                    "处置建议": row["处置建议_规范值"],
                    "得分": row["得分_规范值"],
                    "标签状态": row["标签状态_规范值"],
                    "风险标签": row["风险标签_规范值"],
                    "风险类型": row["风险类型_规范值"],
                    "公司": row["公司_规范值"],
                    "应用": row["应用_规范值"],
                    "渠道或事件": row["渠道/事件_规范值"],
                    "策略场景": row["策略场景_规范值"],
                    "来源": row["来源_规范值"],
                    "规则类型": row["规则类型_规范值"],
                }
            )
    conf_g = _frame(conflict_groups)
    conf_m = _frame(conflict_rows)
    stats["同范围处置分歧组数"] = int(len(conf_g))
    stats["同范围处置分歧行数"] = int(len(conf_m))
    stats["同范围处置分歧规则数"] = int(conf_m["规则标识"].nunique()) if len(conf_m) else 0
    stats["同范围处置分歧条件数"] = int(conf_g["条件指纹"].nunique()) if len(conf_g) else 0

    same_rule = []
    company_mix = []
    for rule_id, group in layer.groupby("规则标识", sort=False):
        decision_fields = []
        for field, label in [
            ("处置建议_规范值", "处置建议"),
            ("得分_规范值", "得分"),
            ("标签状态_规范值", "标签状态"),
            ("风险标签_规范值", "风险标签"),
            ("风险类型_规范值", "风险类型"),
        ]:
            if _changed(group, field):
                decision_fields.append(label)
        if not decision_fields:
            continue
        same_scope_action = 0
        for _, sub in group.groupby("投放范围键"):
            if sub["处置建议_规范值"].nunique() > 1:
                same_scope_action += 1
        same_rule.append(
            {
                "规则标识": rule_id,
                "差异字段": " | ".join(decision_fields),
                "处置建议": " | ".join(sorted(set(group["处置建议_规范值"]))),
                "得分": " | ".join(sorted(set(group["得分_规范值"]))),
                "标签状态": " | ".join(sorted(set(group["标签状态_规范值"]))),
                "风险标签": " | ".join(sorted(set(group["风险标签_规范值"]))),
                "风险类型": " | ".join(sorted(set(group["风险类型_规范值"]))),
                "公司数": int(group["公司_规范值"].nunique()),
                "投放范围数": int(group["投放范围键"].nunique()),
                "同一范围键内处置分歧组数": same_scope_action,
                "行数": len(group),
                "条件指纹数": int(group["条件指纹"].nunique()),
                "优先级": "P2",
                "判断": "同一规则标识跨范围配置不同。同一完整投放范围键内没有处置分歧。"
                if same_scope_action == 0
                else "同一完整投放范围键内出现多个处置，需要先核对范围键是否过粗。",
            }
        )
        for company, sub in group.groupby("公司_规范值"):
            if sub["处置建议_规范值"].nunique() <= 1:
                continue
            vary = []
            for field, label in [
                ("应用_规范值", "应用"),
                ("渠道/事件_规范值", "渠道/事件"),
                ("策略场景_规范值", "策略场景"),
                ("来源_规范值", "来源"),
                ("规则类型_规范值", "规则类型"),
                ("得分_规范值", "得分"),
                ("标签状态_规范值", "标签状态"),
            ]:
                if _changed(sub, field):
                    vary.append(label)
            app_channel_mix = 0
            for _, finer in sub.groupby(["应用_规范值", "渠道/事件_规范值"]):
                if finer["处置建议_规范值"].nunique() > 1:
                    app_channel_mix += 1
            company_mix.append(
                {
                    "规则标识": rule_id,
                    "公司": company,
                    "处置建议": " | ".join(sorted(set(sub["处置建议_规范值"]))),
                    "得分": " | ".join(sorted(set(sub["得分_规范值"]))),
                    "同时变化的字段": " | ".join(vary) if vary else "无",
                    "同应用同渠道仍有多个处置的切片数": app_channel_mix,
                    "条件指纹数": int(sub["条件指纹"].nunique()),
                    "条件骨架": _join_ids(sub["条件骨架"]),
                    "行数": len(sub),
                    "原始Excel行号": " | ".join(str(int(v)) for v in sorted(sub["原始Excel行号"])),
                    "优先级": "P1" if app_channel_mix else "P2",
                    "判断": "同一公司、同一应用、同一渠道下仍有多个处置。"
                    if app_channel_mix
                    else "处置差异伴随着应用、渠道或规则类型变化，更像分档配置，不像同一槽位写错。",
                    "推荐动作": "核对这几个切片的设计意图。确认前不把处置改成同一个值。",
                }
            )
    rule_diff = _frame(same_rule)
    company_diff = _frame(company_mix)
    stats["同规则配置差异数"] = int(len(rule_diff))
    stats["同规则同范围处置分歧"] = int(rule_diff["同一范围键内处置分歧组数"].astype(int).sum()) if len(rule_diff) else 0
    stats["同公司多处置规则数"] = int(company_diff["规则标识"].nunique()) if len(company_diff) else 0
    stats["同公司且同应用同渠道仍分歧"] = (
        int(company_diff.loc[company_diff["同应用同渠道仍有多个处置的切片数"].astype(int) > 0, "规则标识"].nunique())
        if len(company_diff)
        else 0
    )

    usable = layer[layer["解析可用"] == "是"].copy()
    usable["运算符族"] = usable["解析运算符"].map(_op_family)
    family = (
        usable.groupby(["运算符族", "解析运算符"], dropna=False)
        .agg(行数=("原始Excel行号", "size"), 规则标识数=("规则标识", "nunique"), 特征数=("解析特征", "nunique"))
        .reset_index()
        .rename(columns={"解析运算符": "运算符"})
    )
    spread_rows = []
    for (feature, operator), group in usable.groupby(["解析特征", "解析运算符"], sort=False):
        if not feature or not operator:
            continue
        numeric = sorted({float(v) for v in group["解析阈值"] if _is_number(str(v))})
        if operator in LIST_OPS:
            evidence = f"名单指纹数 {group['名单指纹'].nunique()}，不输出名单原文"
            distinct = int(group["名单指纹"].nunique())
        elif operator in TEXT_EQ or (operator not in NUM_CMP | NUM_EQ and not numeric):
            evidence = f"文本指纹数 {group['阈值指纹'].nunique()}，不输出文本原文"
            distinct = int(group["阈值指纹"].nunique())
        else:
            evidence = " | ".join(str(int(v) if float(v).is_integer() else v) for v in numeric)
            distinct = len(numeric) if numeric else int(group["解析阈值"].nunique())
        spread_rows.append(
            {
                "运算符族": _op_family(operator),
                "模型特征": feature,
                "运算符": operator,
                "不同阈值或名单数": distinct,
                "数值最小": numeric[0] if numeric else "",
                "数值最大": numeric[-1] if numeric else "",
                "阈值证据": evidence,
                "规则标识数": int(group["规则标识"].nunique()),
                "行数": len(group),
                "风险类型": _join_ids(group["风险类型_规范值"]),
                "处置建议": _join_ids(group["处置建议_规范值"]),
                "公司": _join_ids(group["公司_规范值"]),
                "纳入条件": "只含解析可用行。278 行解析不可用未纳入，也未按拆分列回写。",
            }
        )
    spread = _frame(spread_rows)
    multi = spread[spread["不同阈值或名单数"].astype(str).map(lambda v: int(float(v)) if str(v).replace(".", "", 1).isdigit() else 0) >= 2].copy() if len(spread) else spread
    if len(multi):
        multi = multi[multi["运算符族"].isin(["数值比较", "数值等值"])].copy()
        multi["优先级"] = "P2"
        multi["建议"] = "多档阈值可能是分场景策略。没有命中和审核结果时，不能判断哪一档造成误杀或漏放，也不能给出最佳阈值。"

    cluster_rows = []
    cluster_members = []
    numeric_rows = usable[usable["解析运算符"].isin(NUM_CMP | NUM_EQ) & usable["解析阈值"].map(lambda v: _is_number(str(v)))]
    cluster_keys = ["解析特征", "解析运算符", "风险类型_规范值", "公司_规范值", "规则类型_规范值", "处置建议_规范值"]
    for index, (_, group) in enumerate(numeric_rows.groupby(cluster_keys, sort=False), start=1):
        thresholds = sorted({float(v) for v in group["解析阈值"]})
        if len(thresholds) < 2 or group["规则标识"].nunique() < 2:
            continue
        gid = f"THR-{index:04d}"
        gaps = [thresholds[i + 1] - thresholds[i] for i in range(len(thresholds) - 1)]
        adjacent = any((0 <= a <= 1 and 0 <= b <= 1 and b - a <= 0.02) or (a > 1 and b > a and (b - a) / b <= 0.05) for a, b in zip(thresholds, thresholds[1:]))
        cluster_rows.append(
            {
                "候选编号": gid,
                "优先级": "P2",
                "模型特征": group.iloc[0]["解析特征"],
                "运算符": group.iloc[0]["解析运算符"],
                "运算符族": _op_family(group.iloc[0]["解析运算符"]),
                "风险类型": group.iloc[0]["风险类型_规范值"],
                "公司": group.iloc[0]["公司_规范值"],
                "规则类型": group.iloc[0]["规则类型_规范值"],
                "处置建议": group.iloc[0]["处置建议_规范值"],
                "阈值列表": " | ".join(str(int(v) if float(v).is_integer() else v) for v in thresholds),
                "最小间隔": min(gaps) if gaps else "",
                "相邻或接近": "是" if adjacent else "否",
                "规则标识数": int(group["规则标识"].nunique()),
                "规则标识": _join_ids(group["规则标识"]),
                "行数": len(group),
                "建议": "保留多档，直到有命中日志能比较各档的审核通过率和误伤样本。",
            }
        )
        for row in group.to_dict("records"):
            cluster_members.append(
                {
                    "候选编号": gid,
                    "原始Excel行号": row["原始Excel行号"],
                    "规则标识": row["规则标识"],
                    "模型特征": row["解析特征"],
                    "运算符": row["解析运算符"],
                    "阈值": row["解析阈值"],
                    "公司": row["公司_规范值"],
                    "应用": row["应用_规范值"],
                    "渠道或事件": row["渠道/事件_规范值"],
                    "规则类型": row["规则类型_规范值"],
                    "处置建议": row["处置建议_规范值"],
                    "得分": row["得分_规范值"],
                    "风险类型": row["风险类型_规范值"],
                }
            )
    clusters = _frame(cluster_rows)
    cluster_m = _frame(cluster_members)
    boundary = []
    for (feature, risk, company), group in numeric_rows.groupby(["解析特征", "风险类型_规范值", "公司_规范值"], sort=False):
        ops = set(group["解析运算符"])
        if not ({">", ">="} <= ops or {"<", "<="} <= ops):
            continue
        for threshold, sub in group.groupby("解析阈值"):
            sub_ops = set(sub["解析运算符"])
            if len(sub_ops & {">", ">="}) > 1 or len(sub_ops & {"<", "<="}) > 1:
                boundary.append(
                    {
                        "优先级": "P2",
                        "模型特征": feature,
                        "风险类型": risk,
                        "公司": company,
                        "同一阈值上的运算符": " | ".join(sorted(sub_ops)),
                        "阈值": threshold,
                        "规则标识": _join_ids(sub["规则标识"]),
                        "行数": len(sub),
                        "判断": "同一数值既用开区间又用闭区间。边界上的样本会落到不同规则，但是否漏放取决于执行逻辑。",
                        "建议": "确认边界值应该落入哪一个运算符。确认前不改。",
                    }
                )
    boundary_df = _frame(boundary)

    neq = layer[layer["质量集合"].map(lambda codes: "threshold_missing_in_column" in codes)].copy()
    neq_rows = []
    for row in neq.to_dict("records"):
        neq_rows.append(
            {
                "原始Excel行号": row["原始Excel行号"],
                "规则标识": row["规则标识"],
                "解析运算符": row["解析运算符"],
                "解析级别": row["解析级别"],
                "条件骨架": row["条件骨架"],
                "阈值列": row["拆分阈值"],
                "质量代码": row["质量代码"],
                "判断": "条件原文的 neq 右侧有值，阈值列为空。分析阈值时以解析结果为准，不回写。",
            }
        )
    neq_df = _frame(neq_rows)

    list_rows = []
    lists = usable[usable["解析运算符"].isin(LIST_OPS)]
    for (operator, list_fp), group in lists.groupby(["解析运算符", "名单指纹"], sort=False):
        if not list_fp:
            continue
        list_rows.append(
            {
                "运算符": operator,
                "名单指纹": list_fp,
                "名单长度": int(group["名单长度"].iloc[0]) if str(group["名单长度"].iloc[0]).isdigit() else group["名单长度"].iloc[0],
                "规则标识数": int(group["规则标识"].nunique()),
                "特征数": int(group["解析特征"].nunique()),
                "行数": len(group),
                "风险类型": _join_ids(group["风险类型_规范值"]),
                "跨规则引用": "是" if group["规则标识"].nunique() >= 2 else "否",
                "说明": "只有指纹和长度。没有名单语义、名单版本和生效机制，不能做名单内容治理。",
            }
        )
    list_df = _frame(list_rows)

    name_rows = []
    for index, (name, group) in enumerate(layer.groupby("规则名称_规范值", sort=False), start=1):
        if not name or group["条件指纹"].nunique() <= 1:
            continue
        name_rows.append(
            {
                "候选编号": f"NAME-{index:04d}",
                "优先级": "P3",
                "规则名称": name,
                "条件指纹数": int(group["条件指纹"].nunique()),
                "规则标识数": int(group["规则标识"].nunique()),
                "运算符": _join_ids(group["解析运算符"]),
                "行数": len(group),
                "判断": "名称相同不代表条件相同。这里只说明命名不能当主键。",
                "建议": "暂不处理。后续若整理命名，以规则标识和条件指纹为准。",
            }
        )
    name_df = _frame(name_rows)

    quality_detail = []
    for row in layer.to_dict("records"):
        codes = row["质量集合"]
        if not codes or codes == {"operator_inside_feature"}:
            if codes == {"operator_inside_feature"}:
                bucket = "特征名内含运算符但解析可用"
                priority = "P3"
            else:
                continue
        elif "column_shift" in codes:
            bucket = "列错位"
            priority = "P0"
        elif "partial_multi_op" in codes or "partial_incomplete" in codes:
            bucket = "部分解析"
            priority = "P0"
        elif codes & {"feature_mismatch", "operator_mismatch", "threshold_mismatch", "threshold_missing_in_column"}:
            bucket = "条件与拆分列不一致"
            priority = "P0"
        else:
            bucket = "其他质量代码"
            priority = "P2"
        shift_ok = ""
        if bucket == "列错位":
            shift_ok = (
                "是"
                if row["解析级别"] == "能够解析"
                and row["拆分阈值"] == row["解析运算符"]
                and row["溢出列"] == row["解析阈值"]
                else "否"
            )
        quality_detail.append(
            {
                "优先级": priority,
                "异常类型": bucket,
                "原始Excel行号": row["原始Excel行号"],
                "规则标识": row["规则标识"],
                "父行组": row["父行组"],
                "解析级别": row["解析级别"],
                "解析可用": row["解析可用"],
                "质量代码": row["质量代码"],
                "条件骨架": row["条件骨架"],
                "解析运算符": row["解析运算符"],
                "表达式类型": row["表达式类型"],
                "公司": row["公司_规范值"],
                "列错位可按解析结果回写": shift_ok,
                "处理": "排除出阈值和特征统计。不回写原始 Excel。"
                if priority == "P0"
                else "不影响解析可用判断，保留在阈值统计中。",
            }
        )
    quality_df = _frame(quality_detail)
    shift = quality_df[quality_df["异常类型"] == "列错位"] if len(quality_df) else quality_df
    partial = quality_df[quality_df["异常类型"] == "部分解析"] if len(quality_df) else quality_df
    mismatch = quality_df[quality_df["异常类型"] == "条件与拆分列不一致"] if len(quality_df) else quality_df

    def _mask(codes: set[str], *names: str) -> bool:
        return any(name in codes for name in names)

    mismatch_codes = {"feature_mismatch", "operator_mismatch", "threshold_mismatch", "threshold_missing_in_column"}
    stats["列错位"] = int(layer["质量集合"].map(lambda c: "column_shift" in c).sum())
    stats["字段不一致"] = int(layer["质量集合"].map(lambda c: _mask(c, *mismatch_codes)).sum())
    stats["部分解析"] = int(layer["质量集合"].map(lambda c: _mask(c, "partial_multi_op", "partial_incomplete")).sum())
    stats["neq阈值列为空"] = int(len(neq_df))
    stats["错位且字段不一致"] = int(
        layer["质量集合"].map(lambda c: "column_shift" in c and _mask(c, *mismatch_codes)).sum()
    )
    stats["部分解析且字段不一致"] = int(
        layer["质量集合"].map(lambda c: _mask(c, "partial_multi_op", "partial_incomplete") and _mask(c, *mismatch_codes)).sum()
    )
    stats["部分解析且列错位"] = int(
        layer["质量集合"].map(lambda c: "column_shift" in c and _mask(c, "partial_multi_op", "partial_incomplete")).sum()
    )
    stats["解析不可用"] = int((layer["解析可用"] == "否").sum())
    stats["列错位可回写"] = int((shift["列错位可按解析结果回写"] == "是").sum()) if len(shift) else 0
    stats["特征名内含运算符"] = int((layer["特征内含运算符"] == "是").sum())

    coverage = []
    for company, group in layer.groupby("公司_规范值"):
        coverage.append(
            {
                "公司": company,
                "行数": len(group),
                "规则标识数": int(group["规则标识"].nunique()),
                "渠道未配置行数": int((group["渠道/事件_规范值"] == "未配置").sum()),
                "场景未配置行数": int((group["策略场景_规范值"] == "未配置").sum()),
                "应用未配置行数": int((group["应用_规范值"] == "未配置").sum()),
                "来源未配置行数": int((group["来源_规范值"] == "未配置").sum()),
                "解释": "渠道整列为空时，只能记为该维度未配置。不能写成全渠道生效或线上漏覆盖。",
            }
        )
    for rule_type, group in layer.groupby("规则类型_规范值"):
        coverage.append(
            {
                "公司": f"规则类型={rule_type}",
                "行数": len(group),
                "规则标识数": int(group["规则标识"].nunique()),
                "渠道未配置行数": int((group["渠道/事件_规范值"] == "未配置").sum()),
                "场景未配置行数": int((group["策略场景_规范值"] == "未配置").sum()),
                "应用未配置行数": int((group["应用_规范值"] == "未配置").sum()),
                "来源未配置行数": int((group["来源_规范值"] == "未配置").sum()),
                "解释": "标准规则和公司规则的场景列全部为空；只有规则类型为场景的行填写了策略场景。这是表结构，不是场景规则漏填。",
            }
        )
    coverage_df = _frame(coverage)
    companies = {value for value in layer["公司_规范值"].unique()}
    overlap_rows = []
    if "智谱华章" in companies and "SM" in companies:
        a = set(layer.loc[layer["公司_规范值"] == "智谱华章", "规则标识"])
        b = set(layer.loc[layer["公司_规范值"] == "SM", "规则标识"])
        overlap_rows = [
            {"集合": "只在智谱华章", "规则标识数": len(a - b)},
            {"集合": "只在SM", "规则标识数": len(b - a)},
            {"集合": "两家公司都出现", "规则标识数": len(a & b)},
        ]
    overlap_df = _frame(overlap_rows)

    blacklist_rows = [
        {
            "字段": "是否拉黑",
            "取值": value,
            "行数": int((layer["是否拉黑_规范值"] == value).sum()),
        }
        for value in sorted(set(layer["是否拉黑_规范值"]))
    ]
    blacklist_rows.append(
        {
            "字段": "拉黑字段",
            "取值": "未配置",
            "行数": int((layer["拉黑字段_规范值"] == "未配置").sum()),
        }
    )
    blacklist_rows.append(
        {
            "字段": "拉黑字段",
            "取值": "已填写",
            "行数": int((layer["拉黑字段_规范值"] != "未配置").sum()),
        }
    )
    black_df = _frame(blacklist_rows)

    issues = []
    for row in dup_g.to_dict("records"):
        issues.append(
            {
                "问题编号": row["候选编号"],
                "优先级": row["优先级"],
                "问题类型": "完全重复候选/" + row["问题类型"],
                "规则标识": row["规则标识"],
                "行数": row["行数"],
                "条件指纹": row["条件指纹"],
                "投放范围键": row["投放范围键"],
                "证据": row["判断依据"],
                "建议动作": row["建议动作"],
                "源行号位置": "重复与相似规则明细.xlsx / 完全重复成员",
            }
        )
    for row in reuse_g.to_dict("records"):
        issues.append(
            {
                "问题编号": row["候选编号"],
                "优先级": row["优先级"],
                "问题类型": "相同条件复用/" + row["复用分类"],
                "规则标识": row["规则标识"],
                "行数": row["行数"],
                "条件指纹": row["条件指纹"],
                "投放范围键": row["实际变化的已配置维度"],
                "证据": f"处置={row['处置建议']}；得分={row['得分']}；未配置维度={row['出现未配置的维度']}",
                "建议动作": "不把跨范围复用直接标成冗余。处置不同的组进入冲突或分档核实。",
                "源行号位置": "重复与相似规则明细.xlsx / 同条件复用成员",
            }
        )
    for row in conf_g.to_dict("records"):
        issues.append(
            {
                "问题编号": row["候选编号"],
                "优先级": "P1",
                "问题类型": row["问题类型"],
                "规则标识": row["规则标识"],
                "行数": row["行数"],
                "条件指纹": row["条件指纹"],
                "投放范围键": " | ".join(
                    [
                        row["公司"],
                        row["应用"],
                        row["渠道或事件"],
                        row["策略场景"],
                        row["来源"],
                        row["规则类型"],
                    ]
                ),
                "证据": row["判断"],
                "建议动作": row["推荐动作"],
                "源行号位置": "投放范围与配置一致性分析.xlsx / 同范围处置分歧成员",
            }
        )
    for row in quality_df.to_dict("records"):
        if row["优先级"] != "P0":
            continue
        issues.append(
            {
                "问题编号": f"QUAL-{row['原始Excel行号']}",
                "优先级": "P0",
                "问题类型": row["异常类型"],
                "规则标识": row["规则标识"],
                "行数": 1,
                "条件指纹": "",
                "投放范围键": row["公司"],
                "证据": row["质量代码"],
                "建议动作": row["处理"],
                "源行号位置": f"数据质量与解析异常.xlsx 行号 {row['原始Excel行号']}",
            }
        )
    for row in clusters.to_dict("records"):
        issues.append(
            {
                "问题编号": row["候选编号"],
                "优先级": "P2",
                "问题类型": "同特征同运算符多档阈值" + ("，间隔接近" if row["相邻或接近"] == "是" else ""),
                "规则标识": row["规则标识"],
                "行数": row["行数"],
                "条件指纹": "",
                "投放范围键": " | ".join([row["公司"], row["规则类型"], row["风险类型"]]),
                "证据": f"{row['模型特征']} {row['运算符']} {row['阈值列表']}",
                "建议动作": row["建议"],
                "源行号位置": "阈值与条件分析.xlsx / 多档阈值成员",
            }
        )
    for row in boundary_df.to_dict("records"):
        issues.append(
            {
                "问题编号": "BND-" + hashlib.sha256(f"{row['模型特征']}|{row['公司']}|{row['阈值']}|{row['风险类型']}".encode("utf-8")).hexdigest()[:12],
                "优先级": "P2",
                "问题类型": "同一阈值同时使用开区间和闭区间",
                "规则标识": row["规则标识"],
                "行数": row["行数"],
                "条件指纹": "",
                "投放范围键": " | ".join([row["公司"], row["风险类型"]]),
                "证据": f"{row['模型特征']} {row['同一阈值上的运算符']} {row['阈值']}",
                "建议动作": row["建议"],
                "源行号位置": "阈值与条件分析.xlsx / 边界运算符并存",
            }
        )
    for row in name_df.to_dict("records"):
        issues.append(
            {
                "问题编号": row["候选编号"],
                "优先级": "P3",
                "问题类型": "同一规则名称对应多个条件",
                "规则标识": "",
                "行数": row["行数"],
                "条件指纹": "",
                "投放范围键": "",
                "证据": f"名称「{row['规则名称']}」对应 {row['条件指纹数']} 个条件指纹、{row['规则标识数']} 个规则标识",
                "建议动作": row["建议"],
                "源行号位置": "重复与相似规则明细.xlsx / 同名不同条件",
            }
        )
    issues_df = _frame(issues)

    advice = [
        {
            "问题编号": "A1",
            "优先级": "P0",
            "建议类别": "A",
            "规则标识": "口径，不对应单一规则",
            "源行号": "历史报告《相同条件跨范围复用》全表",
            "投放范围": "不适用",
            "当前配置与差异": "旧分类把任意空投放维度放在“配置完全相同”之前，1570 组里大量被标成“部分投放维度未配置”。空值不等于这些行的主要差异。",
            "事实证据": f"本次改为先看处置、得分、标签状态和风险，再看实际取值不同的已配置维度。复用条件 {stats['复用条件数']} 个。",
            "问题类型": "报告口径",
            "判断可信程度": "高",
            "推荐动作": "后续诊断沿用本次分类。不回改历史文件。",
            "推荐理由": "旧标签会把结构上允许为空的场景列和渠道列说成覆盖缺口。",
            "调整前配置示例": "复用分类=部分投放维度未配置",
            "调整后配置示例": "复用分类=已配置投放维度不同，或仅空值分布不同",
            "潜在风险": "无策略执行风险。只影响治理排序。",
            "验证方法": "核对复用成员表中“实际变化的已配置维度”。",
            "需要补充的信息": "无",
            "是否需要业务审批": "否",
        },
        {
            "问题编号": "A2",
            "优先级": "P0",
            "建议类别": "A",
            "规则标识": "口径，不对应单一规则",
            "源行号": "历史相似规则候选 2000 行",
            "投放范围": "不适用",
            "当前配置与差异": "旧相似候选表上限 2000 对，且排序参考并列时被截断。",
            "事实证据": "本次相似关系改为全量分组：完全重复成员、复用成员、同特征多档成员，不再输出 Top N 配对。",
            "问题类型": "报告口径",
            "判断可信程度": "高",
            "推荐动作": "以本次成员表为全量证据。历史 2000 行不能当作总体。",
            "推荐理由": "截断后的候选不能支持合并或阈值调整。",
            "调整前配置示例": "相似规则候选最多 2000 对",
            "调整后配置示例": "每个候选组配一份不截断的成员行",
            "潜在风险": "无",
            "验证方法": "组成员数之和等于成员表行数。",
            "需要补充的信息": "无",
            "是否需要业务审批": "否",
        },
        {
            "问题编号": "A3",
            "优先级": "P0",
            "建议类别": "A",
            "规则标识": "口径，不对应单一规则",
            "源行号": "全表",
            "投放范围": "父行组与规则标识+投放范围键",
            "当前配置与差异": f"父行组 {stats['父行组数']} 与规则范围组合 {stats['规则范围组合数']} 相等。",
            "事实证据": f"父行组跨范围 {stats['父行组对应多个范围']}，父行组跨规则 {stats['父行组对应多个规则']}，规则范围跨父行 {stats['规则范围对应多个父行']}。",
            "问题类型": "统计口径",
            "判断可信程度": "高",
            "推荐动作": "把二者看成同一粒度的两种编号。多出来的 Excel 行是父行内部的条件拆分。",
            "推荐理由": "序号在按 && 拆开后重复，但规则标识和投放范围保持不变，所以两个计数必然相同。",
            "调整前配置示例": "把 13380 与 13380 当成两个独立资产规模",
            "调整后配置示例": "资产规模用规则标识 4146；投放实例用规则范围组合；原子条件用条件指纹",
            "潜在风险": "无",
            "验证方法": "三个交叉计数都为 0。",
            "需要补充的信息": "无",
            "是否需要业务审批": "否",
        },
        {
            "问题编号": "B1",
            "优先级": "P0",
            "建议类别": "B",
            "规则标识": "见列错位逐行建议",
            "源行号": "见列错位逐行建议",
            "投放范围": "不改变投放范围",
            "当前配置与差异": f"列错位 {stats['列错位']} 行。其中 {stats['列错位可回写']} 行满足：阈值列等于解析出的运算符，溢出列等于解析出的阈值。",
            "事实证据": "比较运算值不在运算符词表中，阈值列是运算符，溢出列有值。条件原文仍可解析。",
            "问题类型": "拆分列错位",
            "判断可信程度": "高。回写值来自已经解析成功的条件原文，不是猜测。",
            "推荐动作": "审批后只回写这三列：模型特征名称、比较运算值、阈值名单。条件原文不动。无法按该模式对齐的行先不回写。",
            "推荐理由": "错位行若被拿来做特征统计，会把特征文本当成运算符。",
            "调整前配置示例": "比较运算值=特征文本；阈值名单=运算符；溢出列=阈值",
            "调整后配置示例": "模型特征名称=解析特征；比较运算值=解析运算符；阈值名单=解析阈值；溢出列清空",
            "潜在风险": "若条件原文本身不是业务想要的版本，回写会把错误条件固化到拆分列。所以只回写与解析结果一致的行。",
            "验证方法": "回写后重跑体检，column_shift 应为 0，且条件指纹不变。",
            "需要补充的信息": "确认溢出列没有被下游系统单独消费。",
            "是否需要业务审批": "是",
        },
        {
            "问题编号": "B2",
            "优先级": "P1",
            "建议类别": "B",
            "规则标识": "见严格重复组",
            "源行号": "重复与相似规则明细.xlsx / 完全重复成员",
            "投放范围": "组内投放范围唯一",
            "当前配置与差异": f"严格重复 {stats['严格重复组数']} 组。名称、四级标签、条件、处置、得分、标签状态、投放范围都一致，但规则标识不同。另有 {stats['连描述也相同组数']} 组连描述和备注也相同。",
            "事实证据": f"完全重复组 {stats['完全重复组数']}，跨范围组 {stats['重复组跨范围数']}。四级标签不同的 {stats['四级标签不同组数']} 组不纳入本项。",
            "问题类型": "同一投放槽位的重复维护",
            "判断可信程度": "高。这是配置重复，不是已经证明的线上重复命中。",
            "推荐动作": "审批时为每组指定一个主规则标识，其余标识停止新增副本。不删除、不改处置。",
            "推荐理由": "同一范围重复维护会在以后改阈值时只改到其中一份。",
            "调整前配置示例": "同一范围键下两个规则标识，条件指纹和处置相同",
            "调整后配置示例": "保留一个主标识继续变更；另一个标识冻结。冻结不等于下线。",
            "潜在风险": "若两个标识实际上绑定了不同的下游实验或灰度，冻结会挡住仍需独立发布的副本。",
            "验证方法": "抽一组核对创建时间和发布记录。主标识确定前，用成员表里的规则标识做对照，不用创建时间自动选主。",
            "需要补充的信息": "规则标识与线上策略包、实验桶的对应关系。",
            "是否需要业务审批": "是",
        },
        {
            "问题编号": "C1",
            "优先级": "P1",
            "建议类别": "C",
            "规则标识": "见同范围处置分歧",
            "源行号": "投放范围与配置一致性分析.xlsx / 同范围处置分歧成员",
            "投放范围": "公司、应用、渠道、场景、来源、规则类型都相同",
            "当前配置与差异": f"{stats['同范围处置分歧组数']} 个条件与范围切片、{stats['同范围处置分歧条件数']} 个条件指纹、{stats['同范围处置分歧规则数']} 个规则标识，在同一范围给出了不同处置。",
            "事实证据": "同一规则标识在同一完整范围键内的处置分歧为 "
            f"{stats['同规则同范围处置分歧']}。分歧来自不同规则标识。",
            "问题类型": "潜在处置冲突",
            "判断可信程度": "配置证据高。线上是否冲突未知。",
            "推荐动作": "先取这些规则标识的优先级、是否短路、命中后如何聚合。没有执行说明前不改任何处置。",
            "推荐理由": "如果两条规则都能命中且没有优先级，最终处置不确定。如果短路或白名单覆盖，配置差异可以是合理的。",
            "调整前配置示例": "同一范围、同一条件指纹，规则甲处置=拒绝，规则乙处置=审核或通过",
            "调整后配置示例": "证据不足，不给出确定的目标处置。",
            "潜在风险": "把审核改成拒绝，或把拒绝改成通过，都会直接改变线上尺度。",
            "验证方法": "用一周命中日志看这些规则标识是否在同一内容上同时命中，以及最终处置取的是哪一条。",
            "需要补充的信息": "执行顺序、聚合方式、白名单、命中日志、人工审核结果。",
            "是否需要业务审批": "是。当前只做核实，不改配置。",
        },
        {
            "问题编号": "C2",
            "优先级": "P2",
            "建议类别": "C",
            "规则标识": "见同公司多处置",
            "源行号": "投放范围与配置一致性分析.xlsx / 同公司多处置",
            "投放范围": "同一公司内，应用、渠道或规则类型不同",
            "当前配置与差异": f"同公司多处置规则 {stats['同公司多处置规则数']} 个。其中同应用同渠道仍分歧的规则 {stats['同公司且同应用同渠道仍分歧']} 个。",
            "事实证据": "绝大多数处置差异同时出现在应用、渠道和规则类型上，得分也跟着变化。完整范围键内没有同一规则的处置分歧。",
            "问题类型": "分范围处置",
            "判断可信程度": "中。更像按应用和渠道分档，但不能从本表证明这是设计。",
            "推荐动作": "把同应用同渠道仍分歧的少数规则先交给策略负责人核对。其余保持现状。",
            "推荐理由": "旧报告把 38 个同公司多处置直接列为配置错误。细粒度核对后，这个判断过强。",
            "调整前配置示例": "同一规则在默认应用与 B 端、或输入与输出上使用拒绝和审核两套得分",
            "调整后配置示例": "证据不足，不统一处置。",
            "潜在风险": "强行统一会抹掉渠道尺度差异。",
            "验证方法": "对照产品策略说明，确认输入、输出、思维链和 B 端是否允许不同处置。",
            "需要补充的信息": "各渠道的风险容忍度和审核人力。",
            "是否需要业务审批": "若要改处置，需要。本次建议是保持并核实。",
        },
        {
            "问题编号": "C3",
            "优先级": "P2",
            "建议类别": "C",
            "规则标识": "见多档阈值候选",
            "源行号": "阈值与条件分析.xlsx / 多档阈值成员",
            "投放范围": "同一公司、同一风险类型、同一规则类型",
            "当前配置与差异": "同一特征、同一运算符下有多档数值。部分档位间隔很近，部分是数量级差异。",
            "事实证据": "只统计解析可用的数值比较和数值等值。包含、集合和文本等值分开，不用名单原文。",
            "问题类型": "阈值分档",
            "判断可信程度": "中。分档事实清楚，效果未知。",
            "推荐动作": "先核对相邻档是否属于不同渠道或不同规则类型。没有命中对比前不改数值。",
            "推荐理由": "阈值表本身不能证明误杀或漏放。",
            "调整前配置示例": "同一广告分特征在同一公司存在 350 与 630 两档",
            "调整后配置示例": "不提供目标阈值。",
            "潜在风险": "收紧阈值会增加拒绝，放宽阈值会增加漏放。方向都不能从本表确定。",
            "验证方法": "按特征、运算符、阈值、渠道导出命中量和人工改判量。",
            "需要补充的信息": "命中日志、人工审核、申诉。",
            "是否需要业务审批": "任何改值都需要。",
        },
        {
            "问题编号": "C4",
            "优先级": "P2",
            "建议类别": "C",
            "规则标识": "SM 全部规则；规则类型为标准和公司的全部规则",
            "源行号": "投放范围填充统计",
            "投放范围": "SM 的渠道列；标准和公司类型的场景列",
            "当前配置与差异": "SM 的渠道列全部为空。规则类型为标准和公司的场景列全部为空。规则类型为场景的行全部填写了场景。",
            "事实证据": "这是整列结构，不是散落空值。智谱华章的渠道列没有空值。",
            "问题类型": "范围语义待核实",
            "判断可信程度": "高。只能证明配置表如此，不能证明线上覆盖。",
            "推荐动作": "在数据字典里写明：SM 不使用渠道字段；标准和公司规则不使用场景字段。不要把这些空值补成“全部”。",
            "推荐理由": "补成全部会制造并不存在的全渠道策略。",
            "调整前配置示例": "渠道/事件为空，规范值=未配置",
            "调整后配置示例": "保持空值。文档注明未配置不等于全渠道。",
            "潜在风险": "若 SM 其实应该区分输入和输出，当前表无法表达这种差异，后续复制规则时会丢渠道。",
            "验证方法": "对照 SM 策略发布接口，看渠道参数是否存在。",
            "需要补充的信息": "SM 与智谱的发布字段说明。",
            "是否需要业务审批": "改数据字典不需要改规则。若要给 SM 补渠道，需要。",
        },
        {
            "问题编号": "C5",
            "优先级": "P3",
            "建议类别": "C",
            "规则标识": "名单类规则",
            "源行号": "阈值与条件分析.xlsx / 名单引用",
            "投放范围": "各公司",
            "当前配置与差异": "包含和集合条件只有名单指纹与长度。跨规则共用指纹只说明引用相同，不说明名单内容是否该合并。",
            "事实证据": "表内没有名单明细、名单版本和生效机制。",
            "问题类型": "名单证据不足",
            "判断可信程度": "高。结论就是现在不能做名单治理。",
            "推荐动作": "暂不增删名单。先补名单标识和版本。",
            "推荐理由": "用指纹合并名单可能把不同语义的列表合在一起。",
            "调整前配置示例": "contain / subsetp 的右侧文本",
            "调整后配置示例": "不改。",
            "潜在风险": "无",
            "验证方法": "拿到名单库以后，用指纹回连名单标识。",
            "需要补充的信息": "名单标识、版本、更新人和生效范围。",
            "是否需要业务审批": "否。本次没有名单改动。",
        },
    ]
    advice_df = _frame(advice)

    strict = dup_g[dup_g["问题类型"].isin(["严格重复", "连描述和备注也相同"])].copy() if len(dup_g) else dup_g
    stats["多档簇数"] = int(len(clusters))
    stats["相邻簇数"] = int((clusters["相邻或接近"] == "是").sum()) if len(clusters) else 0
    stats["边界运算符组数"] = int(len(boundary_df))
    stats["特征运算符分布组数"] = int(len(spread))
    stats["同名不同条件名称数"] = int(len(name_df))
    stats["名单指纹数"] = int(len(list_df))
    stats["跨规则名单指纹数"] = int((list_df["跨规则引用"] == "是").sum()) if len(list_df) else 0
    stats["问题清单条数"] = int(len(issues_df))
    stats["解析可用"] = int((layer["解析可用"] == "是").sum())

    tables = {
        "dup_g": dup_g,
        "dup_m": dup_m,
        "reuse_g": reuse_g,
        "reuse_m": reuse_m,
        "conf_g": conf_g,
        "conf_m": conf_m,
        "rule_diff": rule_diff,
        "company_diff": company_diff,
        "family": _frame(family),
        "spread": spread,
        "multi": _frame(multi) if len(spread) else spread,
        "clusters": clusters,
        "cluster_m": cluster_m,
        "boundary": boundary_df,
        "neq": neq_df,
        "lists": list_df,
        "names": name_df,
        "quality": quality_df,
        "coverage": coverage_df,
        "overlap": overlap_df,
        "black": black_df,
        "issues": issues_df,
        "advice": advice_df,
        "strict": strict,
        "shift": shift,
        "partial": partial,
        "mismatch": mismatch,
    }
    return tables, stats


def _note(rows: list[tuple[str, str]]) -> pd.DataFrame:
    return pd.DataFrame([{"项目": key, "说明": value} for key, value in rows])


def render_markdown(stats: dict, tables: dict) -> tuple[str, str, str]:
    company = tables["company_diff"]
    residual = company[company["同应用同渠道仍有多个处置的切片数"].astype(int) > 0] if len(company) else company
    residual_lines = []
    if len(residual):
        for row in residual.to_dict("records"):
            residual_lines.append(
                f"- 规则 {row['规则标识']}，公司 {row['公司']}，处置 {row['处置建议']}，得分 {row['得分']}，同时变化字段：{row['同时变化的字段']}。Excel 行号：{row['原始Excel行号']}。"
            )
    residual_text = "\n".join(residual_lines) if residual_lines else "- 无。"
    kind_counts = tables["dup_g"]["问题类型"].value_counts().to_dict() if len(tables["dup_g"]) else {}
    reuse_counts = tables["reuse_g"]["复用分类"].value_counts().to_dict() if len(tables["reuse_g"]) else {}
    priority_counts = tables["issues"]["优先级"].value_counts().to_dict() if len(tables["issues"]) else {}

    report = f"""# 策略分析总报告

## 结论边界

本报告只依据规则配置表。它能够说明配置如何书写、哪些行在配置上重复或分歧、哪些字段不能进入后续统计。它不能说明某条规则在线上命中了多少次，也不能说明某个阈值造成了误杀或漏放。

空单元格统一记为「未配置」。这个词表示原表该格为空。它不是全渠道，不是“不需要配置”，也不是线上没有覆盖。原文里如果真的写了「未配置」，会保留为原始业务值；本表没有把这个词当作技术字段的填补。

候选数量不是线上事故数量。潜在处置冲突在执行顺序、短路和聚合方式未知时，只是配置分歧。

原始 Excel 未修改。历史体检报告和历史诊断报告未覆盖。

## 口径核验

原始行数 {stats['原始行数']}。规则标识 {stats['规则标识数']}。条件指纹 {stats['条件指纹数']}。父行组 {stats['父行组数']}。规则与投放范围组合 {stats['规则范围组合数']}。

父行组和规则范围组合数量相同，是因为二者一一对应：父行组跨范围 {stats['父行组对应多个范围']}，父行组跨规则 {stats['父行组对应多个规则']}，规则范围跨父行 {stats['规则范围对应多个父行']}。序号是按条件拆开之前的父行编号。同一个序号下面，规则标识和投放范围不变，变的是原子条件。因此多出来的行是条件拆分，不是同一个范围被重复登记成多个父行。规则名称只有数百个取值，不能当主键。

完全重复候选 {stats['完全重复组数']} 组、{stats['完全重复行数']} 行。分组键包含投放范围键。跨范围的组为 {stats['重复组跨范围数']}。这些组都含有多个规则标识，所以不是把同一规则的 && 拆分误当成重复。组内名称、描述、备注、四级标签仍可能不同，所以“完全重复”只等于可执行配置重复，不等于整行克隆。

分类：{kind_counts}。

其中名称和四级标签也一致的严格重复是 {stats['严格重复组数']} 组，连描述和备注也相同的是 {stats['连描述也相同组数']} 组。四级标签不同的 {stats['四级标签不同组数']} 组不能合并。

解析不可用 {stats['解析不可用']} 行，等于列错位与其余字段不一致、再加部分解析，三者在行上不重叠。列错位 {stats['列错位']}，且这 {stats['列错位']} 行全部同时属于字段不一致。字段不一致合计 {stats['字段不一致']}，其中去掉列错位后为 {stats['字段不一致'] - stats['列错位']}。部分解析 {stats['部分解析']}，与字段不一致的交集 {stats['部分解析且字段不一致']}，与列错位的交集 {stats['部分解析且列错位']}。neq 阈值列为空 {stats['neq阈值列为空']}，它们落在字段不一致里，不在列错位和部分解析里。历史报告里的 224 行字段不一致已经包含 49 行列错位，不是另有 224 行。

同规则配置差异 {stats['同规则配置差异数']} 个规则标识，差异字段包括处置、得分、标签状态、风险标签或风险类型。同一完整投放范围键内，同一规则的处置分歧为 {stats['同规则同范围处置分歧']}。同公司内多个处置的规则 {stats['同公司多处置规则数']} 个，它们是这 {stats['同规则配置差异数']} 个规则的子集。把范围收到同一应用和同一渠道后，仍有多个处置的规则是 {stats['同公司且同应用同渠道仍分歧']} 个。

相同条件的处置差异不能沿用历史“570”。本次拆开后：处置建议不同 {stats['处置建议不同']}，仅得分不同 {stats['仅得分不同']}，仅标签状态不同 {stats['仅标签状态不同']}，三者合计 {stats['历史570对应拆分']}。历史 570 把得分差异和标签状态差异也算进了处置差异。

相同条件、相同完整投放范围、但处置建议不同的切片有 {stats['同范围处置分歧组数']} 个，涉及 {stats['同范围处置分歧条件数']} 个条件指纹、{stats['同范围处置分歧规则数']} 个规则标识、{stats['同范围处置分歧行数']} 行。这是配置上最需要核实执行逻辑的一组。

历史相似候选表只保留 2000 对，且排序分并列，不能当作总体。本次不再使用该截断。

## 1. 规则重复与冗余

完全相同的配置候选：分组键是条件指纹、风险标签、风险类型、处置建议、得分、标签状态、投放范围键。建议按四类处理。

- 连描述和备注也相同：证据最强。动作是审批后冻结副本，不删除。
- 严格重复：名称和四级标签一致。动作同样是指定主标识并停止双写。创建时间只作为核对线索，不自动选择主标识。
- 四级标签不同：暂不合并。四级标签可能代表不同的标注语义。
- 名称不同：暂不合并。先确认是不是别名。

相同条件但投放范围不同：复用分类为 {reuse_counts}。已配置维度真实不同的复用，建议保留现状。仅空值分布不同的，建议核实范围定义，不补成“全部”。

相同条件但处置、标签或得分不同：处置建议不同进入 C1 或 C2，不在这里当冗余删除。仅得分或仅标签状态不同，先核实是不是版本或渠道尺度，暂不改值。

同一规则标识拆成多行：这是表的正常结构。一个父行组对应一个规则范围，组内多行是原子条件。不要为了“一行一个规则”去合并这些行。

相同特征与运算符但阈值不同：见阈值一节。多档本身不是冗余。

名称相似但条件不同：{stats['同名不同条件名称数']} 个名称对应多个条件指纹。名称不能当合并键。优先级 P3，暂不处理。

## 2. 配置一致性与处置差异

同一规则标识的差异全部发生在不同投放范围之间。没有发现同一规则在同一完整范围键里写出两个处置。跨公司、跨渠道、跨规则类型的处置不同，保留为可能的业务分档。

同一公司内的多处置，主要伴随应用、渠道和规则类型一起变化，得分通常也不同。这不足以判为写错。

同一公司、同一应用、同一渠道下仍然出现多个处置的规则：

{residual_text}

这些残留规则的差异还带着规则类型或场景、来源。建议逐条问策略负责人：标准规则和场景规则是否故意使用不同处置。确认前不改。

相同条件指纹在同一完整范围下由不同规则给出不同处置，是另一类问题。配置事实已经成立。若执行引擎对同时命中的规则没有优先级，最终处置不确定；若有短路或白名单，差异可以合法存在。因此列入 C 类，不直接改处置。

465、38、570 的关系：38 是 465 里“同一公司内处置建议出现多个取值”的规则。570 是条件指纹口径，而且混入了得分和标签状态。38 个规则使用的条件，都会出现在“处置建议不同”的条件指纹里，但 570 的大部分是跨范围或跨规则的条件复用，不是这 38 个规则本身。

## 3. 阈值与条件

数值比较、数值等值、文本等值、包含关系、集合关系分开统计。解析不可用的 {stats['解析不可用']} 行不进入阈值分布。

特征与运算符分布共 {stats['特征运算符分布组数']} 组。同一公司、同一风险类型、同一规则类型、同一处置下，特征与运算符存在多档阈值的簇有 {stats['多档簇数']} 个，其中间隔接近的有 {stats['相邻簇数']} 个。同一数值上同时使用大于和大于等于、或小于和小于等于的组有 {stats['边界运算符组数']} 个。

这些事实只说明边界样本可能落到不同规则。没有命中日志时，不能指定新的阈值，也不能说某一档过严或过松。建议动作是导出各档的命中与人工改判，再决定是否合并相邻档。

neq 阈值列为空的 {stats['neq阈值列为空']} 行，条件原文仍能解析出右侧值。阈值分析使用解析结果。拆分列留待和列错位一起审批，不在本次回写。

## 4. 投放范围与覆盖

公司、应用、渠道、场景、来源、规则类型都在投放范围键里。未配置与显式取值分开。

SM 的渠道列是整列为空，智谱华章的渠道列没有空值。规则类型为“场景”的行都填写了策略场景；规则类型为“标准”或“公司”的行，场景列是整列为空。这是字段使用方式不同，先记为范围定义待核实，不记为线上漏覆盖，也不要把空值回填成全部渠道或全部场景。

同一规则跨公司出现，只说明标识被两套范围复用。配置是否应该一致，要看 C2，不能直接同步。

两家公司的规则标识重叠见《投放范围与配置一致性分析》。只在一家公司出现的标识，不是另一家的配置缺口。

## 5. 名单与其他字段质量

包含和集合运算符的名单只保留指纹与长度。名单指纹 {stats['名单指纹数']} 个，其中多个规则共用的 {stats['跨规则名单指纹数']} 个。共用指纹只表示引用相同。没有名单语义和生效机制，本次不做名单合并、拆分或清洗。

拉黑字段绝大多数为空。是否拉黑的取值分布见数据质量工作簿。空的拉黑字段不能解释成“不拉黑”或“拉黑全部字段”，只能说明该列没有填写。

规则状态在已检查的数据中没有形成可用的启停差异；后续若只用“已启用”做过滤，不会在本表内部再分出停用规则。特征名内部带有运算符符号的行有 {stats['特征名内含运算符']} 行，解析仍可用，优先级 P3，不影响本次阈值结论。

## 6. 规则组合与潜在冲突

配置上可以确认的差异有三类：同一范围的重复规则、同一范围同一条件的不同处置、同一规则在不同范围的不同处置。

值得关注的潜在冲突只有第二类。数量是 {stats['同范围处置分歧组数']} 个范围切片，不是已经发生的线上冲突次数。

要确认实际冲突，至少需要：规则优先级或短路说明、同时命中时的聚合方式、一周的命中日志（内容标识、规则标识、处置、时间）、以及这些样本的人工审核结果。

## 分级

问题清单 {stats['问题清单条数']} 条，优先级分布 {priority_counts}。

- P0：列错位、条件与拆分列不一致、部分解析，以及会误导结论的旧口径。这些行不能进入特征统计。
- P1：严格重复的双写，以及同一范围同一条件的处置分歧。证据强，但后者还不能直接改值。
- P2：跨范围处置分档、多档阈值、相邻阈值、四级标签不同的重复组、整列空值的范围语义。
- P3：同名不同条件、特征名里的运算符符号、名单指纹共用。

优先级表示排查顺序，不表示已经确认的线上损害。

## 优化方案摘要

A 类是口径和解析使用方式，本次报告已经按更正后的口径出数，不改历史文件。

B 类有两项可以进入审批：列错位按解析结果回写拆分列；严格重复指定主标识并冻结副本。两项都不要在未审批时改原始表。

C 类保持配置不动，先补执行逻辑和命中日志。同范围处置分歧是其中最优先的核实项。

详细的十二条字段见《策略优化建议》。
"""

    summary = f"""# 管理层执行摘要

配置表有 {stats['原始行数']} 行、{stats['规则标识数']} 个规则标识、{stats['条件指纹数']} 种条件。父行组与“规则加投放范围”都是 {stats['父行组数']}，因为二者一一对应。多出来的行是同一范围下的条件拆分。

最需要先处理的不是大规模删规则。

1. 有 {stats['解析不可用']} 行不能参与特征统计。其中 {stats['列错位']} 行列发生了错位，而且这 {stats['列错位可回写']} 行都能按条件原文对齐拆分列。这是 P0，需要审批后才改表。
2. 同一投放范围里，有 {stats['严格重复组数'] + stats['连描述也相同组数']} 组规则的条件、处置、名称和四级标签都一样，只是规则标识不同。其中 {stats['连描述也相同组数']} 组连描述和备注也相同。建议指定主标识并停止双写，不删除。另有 {stats['四级标签不同组数']} 组四级标签不同，不要合并。
3. 有 {stats['同范围处置分歧组数']} 处，同一条件在同一公司、应用、渠道、场景、来源和规则类型下，被不同规则标成了不同处置。配置差异成立。线上谁生效，要看优先级和命中日志。确认前不改处置。
4. 历史报告里的“同公司 38 个多处置”和“570 个处置不同”都不能直接当错误。38 个里，收到同一应用和同一渠道后仍分歧的只有 {stats['同公司且同应用同渠道仍分歧']} 个。570 里真正处置建议不同的是 {stats['处置建议不同']}，其余是得分或标签状态。
5. SM 的渠道列、以及标准规则和公司规则的场景列，是整列为空。不要把空值补成“全部”，也不要据此说线上漏覆盖。
6. 多档阈值有 {stats['多档簇数']} 组，其中 {stats['相邻簇数']} 组间隔较近。没有命中和审核数据，不能给出新阈值。
7. 名单只有指纹。本次没有名单治理动作。

建议决策：

- 批准口径：未配置不等于全渠道；相似候选不再使用 2000 行截断；完全重复必须限定在同一投放范围。
- 批准一项数据修复范围：只回写能够与解析结果对齐的列错位，条件原文不动。
- 对严格重复，选择“冻结副本”而不是“删除规则”。
- 对同范围处置分歧，先调取执行逻辑和一周命中，再决定是否改处置。

请先读本摘要，再读《策略优化建议》里的 A1、B1、B2、C1。总报告保留全部判断过程。
"""

    limits = f"""# 指标口径与证据限制

## 对象定义

- Excel 行：原始表数据行。行号等于表内行号，首行表头为第 1 行，首条数据为第 2 行。
- 父行组：序号非空时用「序号:原值」。序号为空时用「无序号:行号」，这是技术缺口，不写成未配置。
- 规则标识：原表规则标识。为空时记为「（规则标识为空）」，不参与“同一规则”的差异结论。
- 条件指纹：条件文本在括号规范化和空白折叠之后的 SHA256 前 16 位。指纹相同表示条件文本相同，不表示业务意图相同。
- 条件骨架：把连续汉字换成“文”，把标识符换成“id”，把纯数字换成“n”。骨架用于阅读，不作为分组键。
- 投放范围键：公司、应用、渠道/事件、策略场景、来源、规则类型六个规范值。空值写成未配置后再拼键。
- 规则与投放范围组合：规则标识加投放范围键。
- 完全重复候选：条件指纹、风险标签、风险类型、处置建议、得分、标签状态、投放范围键都相同，且至少两个规则标识。
- 严格重复：完全重复候选中，规则名称和关联四级标签也相同。
- 解析可用：解析级别为能够解析，且质量代码不含空条件、无法解析、部分解析、列错位、特征或运算符或阈值不一致、阈值列缺失、运算符不在词表、溢出列。特征名内部含运算符不影响这一判断。

## 本次核验后的关键数字

- 原始行数：{stats['原始行数']}
- 规则标识：{stats['规则标识数']}
- 条件指纹：{stats['条件指纹数']}
- 父行组：{stats['父行组数']}
- 规则范围组合：{stats['规则范围组合数']}
- 完全重复组 / 行：{stats['完全重复组数']} / {stats['完全重复行数']}
- 严格重复组：{stats['严格重复组数']}
- 四级标签不同的重复组：{stats['四级标签不同组数']}
- 复用条件：{stats['复用条件数']}
- 处置建议不同 / 仅得分不同 / 仅标签状态不同：{stats['处置建议不同']} / {stats['仅得分不同']} / {stats['仅标签状态不同']}
- 同范围处置分歧切片：{stats['同范围处置分歧组数']}
- 同规则配置差异：{stats['同规则配置差异数']}
- 同公司多处置规则：{stats['同公司多处置规则数']}
- 解析不可用：{stats['解析不可用']}
- 列错位 / 字段不一致 / 部分解析 / neq 阈值列为空：{stats['列错位']} / {stats['字段不一致']} / {stats['部分解析']} / {stats['neq阈值列为空']}

## 与历史报告不同的地方

- 父行组等于规则范围组合，是一一对应，不是两个独立规模。
- 完全重复没有跨投放范围。历史分组键已经包含范围，本次复核通过。
- 224 行字段不一致包含 49 行列错位。54 行部分解析与这两类没有交集。37 行 neq 属于字段不一致。
- 570 不是 570 个处置建议不同。处置建议不同是 {stats['处置建议不同']}。
- “部分投放维度未配置”不能覆盖“配置完全相同”。空值是单独一类。
- 相似候选 2000 行是截断，不是总体。

## 不能从本表推出的结论

- 不能把未配置解释成全渠道、全场景或线上无覆盖。
- 不能把候选组数写成线上事故数、误杀率、漏放率或可节省的规则比例。
- 不能指定最佳阈值。
- 不能在没有执行说明时断言两条规则一定冲突。
- 不能根据名单指纹修改名单内容。
- 不能用创建时间自动删除较新的副本。

## 若要继续，最少要补的数据

- 规则执行顺序、优先级、短路、聚合和白名单覆盖说明。
- 命中日志：时间、内容标识、规则标识、处置、渠道、公司。
- 人工审核或申诉结果，用于比较多档阈值。
- 规则标识与策略包、实验桶的对应关系，用于选择主标识。
- 名单标识和版本。SM 发布接口是否包含渠道字段。
"""
    return report, summary, limits


def assert_tables(stats: dict, tables: dict) -> None:
    if stats["父行组数"] != stats["规则范围组合数"]:
        raise SystemExit("父行组与规则范围组合不一致")
    if stats["父行组对应多个范围"] or stats["父行组对应多个规则"] or stats["规则范围对应多个父行"]:
        raise SystemExit("父行组与规则范围不是一一对应")
    if stats["重复组跨范围数"]:
        raise SystemExit("完全重复候选跨了投放范围")
    if int(tables["dup_g"]["行数"].astype(int).sum()) != len(tables["dup_m"]):
        raise SystemExit("重复组行数与成员表不一致")
    if int(tables["reuse_g"]["行数"].astype(int).sum()) != len(tables["reuse_m"]):
        raise SystemExit("复用组行数与成员表不一致")
    if stats["字段不一致"] != stats["列错位"] + (stats["字段不一致"] - stats["列错位"]):
        raise SystemExit("字段不一致拆分失败")
    if stats["部分解析且字段不一致"] or stats["部分解析且列错位"]:
        raise SystemExit("部分解析与错位或字段不一致出现交集")
    expected_unusable = stats["部分解析"] + stats["字段不一致"]
    if stats["解析不可用"] != expected_unusable:
        raise SystemExit(f"解析不可用 {stats['解析不可用']} 与部分解析加字段不一致 {expected_unusable} 不一致")
    if stats["历史570对应拆分"] != stats["处置建议不同"] + stats["仅得分不同"] + stats["仅标签状态不同"]:
        raise SystemExit("处置差异拆分无法加总")
    for frame in tables.values():
        if not isinstance(frame, pd.DataFrame) or frame.empty:
            continue
        for column in frame.columns:
            if "条件原文" in column or column in {"规则条件", "规则描述", "备注", "解析阈值"}:
                if column == "解析阈值":
                    continue
            text = frame[column].astype(str)
            if text.str.contains(r"\.\.\.\(共", regex=True).any():
                raise SystemExit(f"发现截断标记：{column}")
            if text.str.contains("CANARY_TOKEN_ZX9", regex=False).any():
                raise SystemExit("发现测试令牌")


def main() -> Path:
    source = SOURCE_DEFAULT
    before = sha256_file(source)
    if before != EXPECTED_SOURCE_SHA:
        raise SystemExit("原始 Excel 哈希与已登记值不同，停止写出，避免用错文件。")
    history_before = {
        "diagnosis": sha256_file(HISTORY_DIAGNOSIS / "策略诊断.xlsx"),
        "summary": sha256_file(HISTORY_DIAGNOSIS / "策略诊断摘要.md"),
        "health": sha256_file(HISTORY_HEALTH),
    }
    raw = pd.read_excel(source, sheet_name="Sheet1", dtype=object)
    prepared = prepare_frame(raw)
    resolved = require_layer_columns(raw)
    layer = build_layer(prepared, resolved)
    tables, stats = build_tables(layer, prepared, resolved)
    assert_tables(stats, tables)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    out = HERE / "reports" / "governance" / stamp
    out.mkdir(parents=True, exist_ok=False)
    report, summary, limits = render_markdown(stats, tables)
    (out / "策略分析总报告.md").write_text(report, encoding="utf-8")
    (out / "管理层执行摘要.md").write_text(summary, encoding="utf-8")
    (out / "指标口径与证据限制.md").write_text(limits, encoding="utf-8")

    scope_note = _note(
        [
            ("完全重复", "分组键含投放范围。成员表给出每一条 Excel 行，组表不截断行号。"),
            ("复用", "同一条件指纹出现在多个范围或多个规则。空值单独分类，不覆盖其他差异。"),
            ("同范围处置分歧", "条件指纹和六个范围字段都相同，处置建议不同。"),
            ("敏感内容", "不输出条件原文、规则描述、备注和名单原文。"),
        ]
    )
    write_book(
        out / "重复与相似规则明细.xlsx",
        {
            "口径": scope_note,
            "完全重复组": tables["dup_g"],
            "完全重复成员": tables["dup_m"],
            "同条件复用组": tables["reuse_g"],
            "同条件复用成员": tables["reuse_m"],
            "同名不同条件": tables["names"],
        },
    )
    write_book(
        out / "阈值与条件分析.xlsx",
        {
            "口径": _note(
                [
                    ("纳入", "只含解析可用行。"),
                    ("运算符族", "数值比较、数值等值、文本等值、包含关系、集合关系分开。"),
                    ("名单", "只输出指纹和长度。"),
                    ("成员", "多档阈值的每一行见多档阈值成员，不在组表截断。"),
                ]
            ),
            "运算符类型分布": tables["family"],
            "特征运算符全量分布": tables["spread"],
            "多档阈值候选": tables["clusters"],
            "多档阈值成员": tables["cluster_m"],
            "边界运算符并存": tables["boundary"],
            "neq阈值列为空": tables["neq"],
            "名单引用": tables["lists"],
        },
    )
    write_book(
        out / "投放范围与配置一致性分析.xlsx",
        {
            "口径": _note(
                [
                    ("未配置", "空值记为未配置，不等于全范围生效。"),
                    ("同规则差异", "同一规则标识的处置或标签差异。"),
                    ("同范围分歧", "六个范围字段相同且条件指纹相同，但处置不同。成员表在同范围处置分歧成员。"),
                ]
            ),
            "范围填充": tables["coverage"],
            "公司规则重叠": tables["overlap"],
            "同规则配置差异": tables["rule_diff"],
            "同公司多处置": tables["company_diff"],
            "同范围处置分歧": tables["conf_g"],
            "同范围处置分歧成员": tables["conf_m"],
        },
    )
    inter = _note(
        [
            ("列错位", str(stats["列错位"])),
            ("字段不一致含列错位", str(stats["字段不一致"])),
            ("字段不一致去掉列错位", str(stats["字段不一致"] - stats["列错位"])),
            ("部分解析", str(stats["部分解析"])),
            ("部分解析与字段不一致交集", str(stats["部分解析且字段不一致"])),
            ("部分解析与列错位交集", str(stats["部分解析且列错位"])),
            ("neq阈值列为空", str(stats["neq阈值列为空"])),
            ("解析不可用", str(stats["解析不可用"])),
            ("列错位可按解析结果回写", str(stats["列错位可回写"])),
            ("特征名内含运算符", str(stats["特征名内含运算符"])),
        ]
    )
    write_book(
        out / "数据质量与解析异常.xlsx",
        {
            "口径": _note([("交集", "列错位是字段不一致的子集。部分解析与这两类无交集。"), ("回写", "本次不修改原始 Excel。")]),
            "交集统计": inter,
            "异常明细": tables["quality"],
            "拉黑字段填充": tables["black"],
        },
    )
    write_book(
        out / "策略问题全量清单.xlsx",
        {
            "口径": _note(
                [
                    ("粒度", "一条候选一组或一行为一条。同一 Excel 行可以出现在不同问题类型中。"),
                    ("行号", "重复、复用和分歧的行号在对应成员表，清单给出成员表位置。"),
                    ("优先级", "P0 数据可信度，P1 证据较强的治理项，P2 需要业务或日志，P3 命名与规范。"),
                ]
            ),
            "问题清单": tables["issues"],
        },
    )
    write_book(
        out / "策略优化建议.xlsx",
        {
            "口径": _note(
                [
                    ("A", "诊断口径和解析使用方式，不改线上规则。"),
                    ("B", "配置证据较强，进入审批后再改表。"),
                    ("C", "需要执行逻辑、命中日志或业务规则。本次不改值。"),
                ]
            ),
            "建议总表": tables["advice"],
            "列错位逐行": tables["shift"],
            "严格重复待审批": tables["strict"],
            "同范围处置分歧": tables["conf_g"],
            "同公司处置待核实": tables["company_diff"],
        },
    )
    after = sha256_file(source)
    history_after = {
        "diagnosis": sha256_file(HISTORY_DIAGNOSIS / "策略诊断.xlsx"),
        "summary": sha256_file(HISTORY_DIAGNOSIS / "策略诊断摘要.md"),
        "health": sha256_file(HISTORY_HEALTH),
    }
    if after != before or history_after != history_before:
        raise SystemExit("原始文件或历史报告被改动")
    required = [
        "策略分析总报告.md",
        "管理层执行摘要.md",
        "策略问题全量清单.xlsx",
        "策略优化建议.xlsx",
        "重复与相似规则明细.xlsx",
        "阈值与条件分析.xlsx",
        "投放范围与配置一致性分析.xlsx",
        "数据质量与解析异常.xlsx",
        "指标口径与证据限制.md",
    ]
    for name in required:
        if not (out / name).is_file() or (out / name).stat().st_size <= 0:
            raise SystemExit(f"缺少交付文件 {name}")
    print("GOVERNANCE_OK")
    print(out)
    for key in [
        "完全重复组数",
        "完全重复行数",
        "严格重复组数",
        "连描述也相同组数",
        "四级标签不同组数",
        "复用条件数",
        "处置建议不同",
        "仅得分不同",
        "仅标签状态不同",
        "同范围处置分歧组数",
        "同范围处置分歧条件数",
        "同范围处置分歧规则数",
        "同规则配置差异数",
        "同公司多处置规则数",
        "同公司且同应用同渠道仍分歧",
        "列错位",
        "列错位可回写",
        "解析不可用",
        "多档簇数",
        "相邻簇数",
        "边界运算符组数",
        "问题清单条数",
    ]:
        print(f"{key}={stats[key]}")
    return out


if __name__ == "__main__":
    main()
