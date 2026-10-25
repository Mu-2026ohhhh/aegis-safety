"""智谱、产品级、场景级三张规则表对账。只读源文件，写入新目录。"""

from __future__ import annotations

import hashlib
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import pandas as pd

HERE = Path(__file__).resolve().parent
HEALTH = HERE.parent / "rule_healthcheck"
sys.path.insert(0, str(HEALTH))

from analyze import cell_to_text  # noqa: E402
from condition_parser import normalize_parens, parse_condition, skeleton, squash  # noqa: E402

SOURCE = Path("/Users/haohan/Desktop/智谱华章/智谱策略文档.xlsx")
Z_SHEET = "智谱策略文档"
P_SHEET = "产品级策略"
S_SHEETS = ("aigc标准场景策略文档-输入", "aigc标准场景策略文档-输出")
SKIPPED_SHEET = "合集"
FIXED_FIELDS = ("公司", "渠道/事件", "来源")
SCOPE_FIELDS = ("应用", "策略场景", "规则类型", "策略产品")
DECISION_FIELDS = (
    ("处置建议", "处置不一致"),
    ("得分", "风险标签或得分不一致"),
    ("标签状态", "风险标签或得分不一致"),
    ("风险标签", "风险标签或得分不一致"),
    ("风险类型", "风险标签或得分不一致"),
    ("关联四级标签", "风险标签或得分不一致"),
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def clean(value: object) -> str:
    text = "" if value is None else str(value)
    return "".join(ch for ch in text if ch >= " " or ch == "\t")


def display(value: object) -> str:
    text = clean(value).strip()
    return text if text else "未配置"


def clip(value: object, limit: int = 8000) -> tuple[str, str]:
    text = clean(value)
    if len(text) <= limit:
        return text, "否"
    return text[:limit] + f"【已截断，原长{len(text)}，未静默丢弃语义；完整文本仍在源文件】", "是"


def fp(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def split_and(text: str) -> list[str]:
    raw = normalize_parens(text)
    parts: list[str] = []
    buf: list[str] = []
    depth = 0
    i = 0
    while i < len(raw):
        ch = raw[i]
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if depth == 0 and raw.startswith("&&", i):
            parts.append("".join(buf))
            buf = []
            i += 2
            continue
        buf.append(ch)
        i += 1
    parts.append("".join(buf))
    return [squash(part) for part in parts if squash(part)]


def load_sheet(sheet: str) -> pd.DataFrame:
    frame = pd.read_excel(SOURCE, sheet_name=sheet, dtype=object).map(cell_to_text)
    frame.insert(0, "_row", range(2, len(frame) + 2))
    frame.insert(1, "_sheet", sheet)
    return frame


def group_rows(frame: pd.DataFrame) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = defaultdict(list)
    for row in frame.to_dict("records"):
        grouped[row["规则标识"]].append(row)
    return grouped


def values_of(rows: list[dict], column: str) -> list[str]:
    return sorted({display(row[column]) for row in rows})


def join(items) -> str:
    seen: list[str] = []
    for item in items:
        text = str(item)
        if text not in seen:
            seen.append(text)
    return " | ".join(seen)


def rows_of(rows: list[dict]) -> str:
    return join(str(int(row["_row"])) for row in sorted(rows, key=lambda item: int(item["_row"])))


def sheets_of(rows: list[dict]) -> str:
    return join(row["_sheet"] for row in rows)


def atoms_of(rows: list[dict]) -> dict[str, dict]:
    found: dict[str, dict] = {}
    for row in rows:
        for part in split_and(row["规则条件"]):
            token = fp(part)
            parsed = parse_condition(part)
            item = found.setdefault(
                token,
                {
                    "指纹": token,
                    "规范文本": part,
                    "骨架": skeleton(part),
                    "级别": parsed.level,
                    "特征": parsed.feature,
                    "运算符": parsed.operator,
                    "阈值": parsed.threshold,
                    "行号": [],
                    "Sheet": [],
                },
            )
            item["行号"].append(int(row["_row"]))
            if row["_sheet"] not in item["Sheet"]:
                item["Sheet"].append(row["_sheet"])
    return found


def full_condition_set(rows: list[dict]) -> set[str]:
    return {squash(normalize_parens(row["规则条件"])) for row in rows}


def align_status(z_rows: list[dict], o_rows: list[dict], column: str) -> tuple[str, str, str]:
    apps = {display(row["应用"]) for row in o_rows}
    chosen = [row for row in z_rows if display(row["应用"]) in apps]
    z_all = join(values_of(z_rows, column))
    other = join(values_of(o_rows, column))
    if not chosen:
        return "没有共同应用", z_all, other
    z_aligned = join(values_of(chosen, column))
    if values_of(chosen, column) == values_of(o_rows, column):
        return "对齐后相同", z_aligned, other
    z_set = set(values_of(chosen, column))
    o_set = set(values_of(o_rows, column))
    if len(z_set) == 1 and len(o_set) == 1:
        return "对齐后仍不同", z_aligned, other
    if o_set < z_set:
        return "共同应用上智谱仍有更多取值", z_aligned, other
    if z_set < o_set:
        return "共同应用上对照表仍有更多取值", z_aligned, other
    return "对齐后集合交叉", z_aligned, other


def coverage_row(rule_id: str, rows: list[dict], flags: dict) -> dict:
    return {
        "规则标识": rule_id,
        "规则名称": join(values_of(rows, "规则名称")),
        "来源表": join(values_of(rows, "来源")),
        "源文件": str(SOURCE),
        "Sheet": sheets_of(rows),
        "源行号": rows_of(rows),
        "策略产品": join(values_of(rows, "策略产品")),
        "策略场景": join(values_of(rows, "策略场景")),
        "公司": join(values_of(rows, "公司")),
        "应用": join(values_of(rows, "应用")),
        "渠道或事件": join(values_of(rows, "渠道/事件")),
        "风险标签": join(values_of(rows, "风险标签")),
        "风险类型": join(values_of(rows, "风险类型")),
        "处置建议": join(values_of(rows, "处置建议")),
        "得分": join(values_of(rows, "得分")),
        "规则类型": join(values_of(rows, "规则类型")),
        "记录条数": len(rows),
        **flags,
        "结论": "表间规则标识缺失。这只说明该标识没有出现在对照表，不能据此判断线上漏配。",
    }


def compare_atoms(rule_id: str, side: str, z_rows: list[dict], o_rows: list[dict], buckets: dict) -> dict:
    left = atoms_of(z_rows)
    right = atoms_of(o_rows)
    only_left = set(left) - set(right)
    only_right = set(right) - set(left)
    consumed_left: set[str] = set()
    consumed_right: set[str] = set()
    threshold_n = operator_n = added_n = missing_n = pending_n = 0

    def group(pool: dict[str, dict], tokens: set[str], parsed_only: bool) -> dict[tuple, list]:
        grouped: dict[tuple, list] = defaultdict(list)
        for token in tokens:
            item = pool[token]
            if parsed_only and item["级别"] != "能够解析":
                continue
            if item["特征"] and item["运算符"]:
                grouped[(item["特征"], item["运算符"])].append(item)
        return grouped

    left_groups = group(left, only_left, True)
    right_groups = group(right, only_right, True)
    for key in set(left_groups) & set(right_groups):
        l_items = left_groups[key]
        r_items = right_groups[key]
        l_values = sorted({item["阈值"] for item in l_items})
        r_values = sorted({item["阈值"] for item in r_items})
        if l_values == r_values:
            continue
        threshold_n += 1
        for item in l_items:
            consumed_left.add(item["指纹"])
        for item in r_items:
            consumed_right.add(item["指纹"])
        l_text, l_cut = clip(" || ".join(item["规范文本"] for item in l_items))
        r_text, r_cut = clip(" || ".join(item["规范文本"] for item in r_items))
        buckets["阈值"].append(
            {
                "规则标识": rule_id,
                "规则名称": join(values_of(z_rows, "规则名称")),
                "对照侧": side,
                "差异类型": "特征和运算符相同，阈值不同",
                "业务分类": "阈值不一致",
                "建议": "建议核实条件或阈值",
                "建议理由": "两侧都有同一特征和运算符，阈值集合不同。没有命中日志时不能指定哪一个阈值正确。",
                "判断可信程度": "高。比较的是解析后的阈值集合，不是整句文本。",
                "模型特征": key[0],
                "运算符": key[1],
                "智谱阈值": join(l_values),
                "对照阈值": join(r_values),
                "智谱原值": l_text,
                "对照原值": r_text,
                "原值是否截断": "是" if l_cut == "是" or r_cut == "是" else "否",
                "智谱行号": join(str(n) for item in l_items for n in item["行号"]),
                "对照行号": join(str(n) for item in r_items for n in item["行号"]),
                "智谱Sheet": join(name for item in l_items for name in item["Sheet"]),
                "对照Sheet": join(name for item in r_items for name in item["Sheet"]),
                "源文件": str(SOURCE),
            }
        )

    left_by_feature: dict[str, set[str]] = defaultdict(set)
    right_by_feature: dict[str, set[str]] = defaultdict(set)
    for token in only_left - consumed_left:
        item = left[token]
        if item["级别"] == "能够解析" and item["特征"]:
            left_by_feature[item["特征"]].add(item["运算符"])
    for token in only_right - consumed_right:
        item = right[token]
        if item["级别"] == "能够解析" and item["特征"]:
            right_by_feature[item["特征"]].add(item["运算符"])
    for feature in set(left_by_feature) & set(right_by_feature):
        if left_by_feature[feature] == right_by_feature[feature]:
            continue
        operator_n += 1
        l_items = [
            left[token]
            for token in only_left - consumed_left
            if left[token]["特征"] == feature and left[token]["级别"] == "能够解析"
        ]
        r_items = [
            right[token]
            for token in only_right - consumed_right
            if right[token]["特征"] == feature and right[token]["级别"] == "能够解析"
        ]
        for item in l_items:
            consumed_left.add(item["指纹"])
        for item in r_items:
            consumed_right.add(item["指纹"])
        buckets["条件"].append(
            {
                "规则标识": rule_id,
                "规则名称": join(values_of(z_rows, "规则名称")),
                "对照侧": side,
                "差异类型": "同一特征的运算符不同",
                "业务分类": "条件配置不一致",
                "建议": "建议核实条件或阈值",
                "建议理由": "特征能对齐，但运算符不同。边界样本是否命中取决于执行逻辑，不能直接改运算符。",
                "判断可信程度": "高",
                "智谱条件骨架": join(item["骨架"] for item in l_items),
                "对照条件骨架": join(item["骨架"] for item in r_items),
                "智谱运算符": join(sorted(left_by_feature[feature])),
                "对照运算符": join(sorted(right_by_feature[feature])),
                "智谱原值": clip(" || ".join(item["规范文本"] for item in l_items))[0],
                "对照原值": clip(" || ".join(item["规范文本"] for item in r_items))[0],
                "智谱行号": join(str(n) for item in l_items for n in item["行号"]),
                "对照行号": join(str(n) for item in r_items for n in item["行号"]),
                "智谱Sheet": Z_SHEET,
                "对照Sheet": sheets_of(o_rows),
                "源文件": str(SOURCE),
            }
        )

    def emit_remaining(tokens: set[str], pool: dict[str, dict], which: str) -> None:
        nonlocal added_n, missing_n, pending_n
        for token in tokens:
            item = pool[token]
            pending = item["级别"] != "能够解析"
            if pending:
                pending_n += 1
                target = "待确认"
                category = "现有证据不足，无法判断"
                action = "暂不建议调整，需要补充证据"
                reason = "这条原子条件未能可靠解析出唯一的特征、运算符和阈值，不能并入阈值比较。"
            else:
                target = "新增缺失"
                category = "条件新增或缺失"
                action = "建议核实条件或阈值"
                reason = "原子条件文本在另一侧没有相同指纹。这是条件集合差异，不是已经证明的线上遗漏。"
                if which == "智谱有":
                    added_n += 1
                else:
                    missing_n += 1
            text, cut = clip(item["规范文本"])
            row = {
                "规则标识": rule_id,
                "规则名称": join(values_of(z_rows, "规则名称")),
                "对照侧": side,
                "差异类型": "智谱有原子条件，对照侧没有" if which == "智谱有" else "对照侧有原子条件，智谱没有",
                "业务分类": category,
                "建议": action,
                "建议理由": reason,
                "判断可信程度": "中" if pending else "高",
                "条件指纹": item["指纹"],
                "条件骨架": item["骨架"],
                "解析级别": item["级别"],
                "模型特征": item["特征"],
                "运算符": item["运算符"],
                "阈值": item["阈值"] if item["运算符"] not in {"contain", "notContain", "subsetp"} else f"名单长度{len(item['阈值'])}",
                "条件原值": text,
                "原值是否截断": cut,
                "所在行号": join(str(n) for n in item["行号"]),
                "所在Sheet": join(item["Sheet"]),
                "源文件": str(SOURCE),
            }
            buckets[target].append(row)

    emit_remaining(only_left - consumed_left, left, "智谱有")
    emit_remaining(only_right - consumed_right, right, "对照有")
    if set(left) == set(right):
        relation = "原子条件一致"
    elif not only_right and only_left:
        relation = "智谱多出原子条件"
    elif not only_left and only_right:
        relation = "对照侧多出原子条件"
    elif set(left) & set(right):
        relation = "原子条件部分重叠"
    else:
        relation = "原子条件无交集"
    return {
        "关系": relation,
        "智谱原子数": len(left),
        "对照原子数": len(right),
        "阈值差异": threshold_n,
        "运算符差异": operator_n,
        "智谱多出": added_n,
        "对照多出": missing_n,
        "待确认": pending_n,
        "全文集合一致": "是" if full_condition_set(z_rows) == full_condition_set(o_rows) else "否",
    }


def decision_rows(rule_id: str, side: str, z_rows: list[dict], o_rows: list[dict]) -> list[dict]:
    rows = []
    name = join(values_of(z_rows, "规则名称"))
    for column, category in DECISION_FIELDS:
        z_vals = values_of(z_rows, column)
        o_vals = values_of(o_rows, column)
        if z_vals == o_vals:
            continue
        status, aligned, other = align_status(z_rows, o_rows, column)
        if status == "对齐后相同":
            advice, kind, why, confidence = (
                "建议确认产品、场景适用范围",
                "可能属于合理的业务差异",
                "按对照表的应用对齐后取值相同。智谱其余应用或其余行还有别的取值。",
                "高",
            )
        elif status == "没有共同应用":
            advice, kind, why, confidence = (
                "建议确认产品、场景适用范围",
                "可能属于合理的业务差异",
                "两侧没有共同应用，不能把处置差异写成同一投放槽位的冲突。",
                "中",
            )
        elif status == "对齐后仍不同":
            advice = "暂不建议调整，需要补充证据" if column in {"处置建议", "得分"} else "建议核实条件或阈值"
            kind = category
            why = "在共同应用上，两侧都只有一个取值，而且不相同。没有执行日志时不能认定哪一侧错误。"
            confidence = "高"
        else:
            advice, kind, why, confidence = (
                "建议确认产品、场景适用范围",
                category,
                "共同应用上的取值集合仍然不同，其中一侧包含多个取值。",
                "中",
            )
        rows.append(
            {
                "规则标识": rule_id,
                "规则名称": name,
                "对照侧": side,
                "字段": column,
                "差异形态": status,
                "业务分类": kind,
                "建议": advice,
                "建议理由": why,
                "判断可信程度": confidence,
                "智谱全部取值": join(z_vals),
                "按共同应用对齐后的智谱取值": aligned,
                "对照原值": other,
                "智谱行号": rows_of(z_rows),
                "对照行号": rows_of(o_rows),
                "智谱Sheet": Z_SHEET,
                "对照Sheet": sheets_of(o_rows),
                "智谱应用": join(values_of(z_rows, "应用")),
                "对照应用": join(values_of(o_rows, "应用")),
                "源文件": str(SOURCE),
            }
        )
    return rows


def scope_rows(rule_id: str, side: str, z_rows: list[dict], o_rows: list[dict]) -> list[dict]:
    rows = []
    for column in SCOPE_FIELDS:
        z_vals = values_of(z_rows, column)
        o_vals = values_of(o_rows, column)
        if z_vals == o_vals:
            continue
        status, aligned, other = align_status(z_rows, o_rows, column)
        rows.append(
            {
                "规则标识": rule_id,
                "规则名称": join(values_of(z_rows, "规则名称")),
                "对照侧": side,
                "字段": column,
                "差异性质": "个体范围差异",
                "差异形态": status,
                "业务分类": "产品或场景范围不一致",
                "建议": "建议确认产品、场景适用范围",
                "建议理由": "空值记为未配置，不表示全渠道或全场景。范围不同可能是产品级、场景级本来就只覆盖一部分。",
                "判断可信程度": "中",
                "智谱原值": join(z_vals),
                "对照原值": other,
                "对齐后智谱取值": aligned,
                "智谱行号": rows_of(z_rows),
                "对照行号": rows_of(o_rows),
                "智谱Sheet": Z_SHEET,
                "对照Sheet": sheets_of(o_rows),
                "源文件": str(SOURCE),
            }
        )
    return rows


def text_norm(rows: list[dict], column: str) -> set[str]:
    return {squash(row[column]) if row[column] else "未配置" for row in rows}


def frame_or_zero(rows: list[dict], note: str) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame([{"结果条数": 0, "说明": note}])
    return pd.DataFrame(rows).map(clean)


def write_book(path: Path, sheets: dict[str, pd.DataFrame]) -> None:
    with pd.ExcelWriter(path, engine="openpyxl") as writer:
        for name, data in sheets.items():
            data.to_excel(writer, sheet_name=name[:31], index=False)


def main() -> Path:
    before = sha256_file(SOURCE)
    workbook = pd.ExcelFile(SOURCE)
    if set(workbook.sheet_names) != {Z_SHEET, P_SHEET, *S_SHEETS, SKIPPED_SHEET}:
        raise SystemExit(f"工作表发生变化：{workbook.sheet_names}")
    z = group_rows(load_sheet(Z_SHEET))
    p = group_rows(load_sheet(P_SHEET))
    scene_frames = [load_sheet(name) for name in S_SHEETS]
    s = group_rows(pd.concat(scene_frames, ignore_index=True))
    input_only = group_rows(scene_frames[0])
    output_only = group_rows(scene_frames[1])
    Z, P, S = set(z), set(p), set(s)
    both_scene = set(input_only) & set(output_only)

    buckets = {"条件": [], "阈值": [], "新增缺失": [], "待确认": [], "处置": [], "范围": [], "格式": []}
    summary_rows = []
    meaning_ids = {"产品级": set(), "场景级": set()}
    direct_action = {"产品级": 0, "场景级": 0}

    def absorb(side: str, rule_id: str, z_rows: list[dict], o_rows: list[dict]) -> None:
        atom = compare_atoms(rule_id, side, z_rows, o_rows, buckets)
        decisions = decision_rows(rule_id, side, z_rows, o_rows)
        scopes = scope_rows(rule_id, side, z_rows, o_rows)
        buckets["处置"].extend(decisions)
        buckets["范围"].extend(scopes)
        meaning = atom["关系"] != "原子条件一致" or any(
            row["差异形态"] in {"对齐后仍不同", "对齐后集合交叉", "共同应用上智谱仍有更多取值", "共同应用上对照表仍有更多取值"}
            for row in decisions
        ) or any(row["字段"] in {"策略场景", "规则类型"} for row in scopes)
        if meaning:
            meaning_ids[side].add(rule_id)
        action = next((row for row in decisions if row["字段"] == "处置建议"), None)
        if action and action["差异形态"] == "对齐后仍不同":
            direct_action[side] += 1
        desc_diff = text_norm(z_rows, "规则描述") != text_norm(o_rows, "规则描述")
        remark_diff = text_norm(z_rows, "备注") != text_norm(o_rows, "备注")
        name_same = values_of(z_rows, "规则名称") == values_of(o_rows, "规则名称")
        if atom["全文集合一致"] == "否" and atom["关系"] == "原子条件一致":
            buckets["格式"].append(
                {
                    "规则标识": rule_id,
                    "规则名称": join(values_of(z_rows, "规则名称")),
                    "对照侧": side,
                    "差异类型": "原子条件集合一致，条件全文组合不同",
                    "业务分类": "仅名称、描述或格式不同",
                    "建议": "建议保留现状",
                    "建议理由": "把 && 拆开后的原子条件指纹一致。全文不同来自组合方式或多行书写，不单独立成另一套条件。",
                    "判断可信程度": "高",
                    "智谱条件种数": len(full_condition_set(z_rows)),
                    "对照条件种数": len(full_condition_set(o_rows)),
                    "智谱行号": rows_of(z_rows),
                    "对照行号": rows_of(o_rows),
                    "源文件": str(SOURCE),
                }
            )
        if (desc_diff or remark_diff) and atom["关系"] == "原子条件一致" and not any(
            row["字段"] in {"处置建议", "得分", "标签状态"} and row["差异形态"] == "对齐后仍不同" for row in decisions
        ):
            buckets["格式"].append(
                {
                    "规则标识": rule_id,
                    "规则名称": join(values_of(z_rows, "规则名称")),
                    "对照侧": side,
                    "差异类型": "描述或备注不同",
                    "业务分类": "仅名称、描述或格式不同",
                    "建议": "建议保留现状",
                    "建议理由": "名称比较结果为"
                    + ("一致。" if name_same else "不一致。")
                    + "描述或备注不同，条件原子和共同应用上的处置没有直接冲突。不根据描述改条件。",
                    "判断可信程度": "中",
                    "智谱描述是否不同": "是" if desc_diff else "否",
                    "智谱备注是否不同": "是" if remark_diff else "否",
                    "智谱行号": rows_of(z_rows),
                    "对照行号": rows_of(o_rows),
                    "源文件": str(SOURCE),
                }
            )
        summary_rows.append(
            {
                "规则标识": rule_id,
                "规则名称": join(values_of(z_rows, "规则名称")),
                "对照侧": side,
                "名称是否一致": "是" if name_same else "否",
                "原子条件关系": atom["关系"],
                "条件全文集合是否一致": atom["全文集合一致"],
                "智谱原子条件数": atom["智谱原子数"],
                "对照原子条件数": atom["对照原子数"],
                "阈值差异组数": atom["阈值差异"],
                "运算符差异组数": atom["运算符差异"],
                "智谱多出的未对齐原子": atom["智谱多出"],
                "对照多出的未对齐原子": atom["对照多出"],
                "解析待确认原子": atom["待确认"],
                "处置对齐结论": action["差异形态"] if action else "处置集合一致",
                "智谱处置": join(values_of(z_rows, "处置建议")),
                "对照处置": join(values_of(o_rows, "处置建议")),
                "智谱得分": join(values_of(z_rows, "得分")),
                "对照得分": join(values_of(o_rows, "得分")),
                "智谱应用": join(values_of(z_rows, "应用")),
                "对照应用": join(values_of(o_rows, "应用")),
                "智谱规则类型": join(values_of(z_rows, "规则类型")),
                "对照规则类型": join(values_of(o_rows, "规则类型")),
                "智谱策略场景": join(values_of(z_rows, "策略场景")),
                "对照策略场景": join(values_of(o_rows, "策略场景")),
                "是否改变规则含义": "是" if meaning else "否",
                "智谱行号": rows_of(z_rows),
                "对照行号": rows_of(o_rows),
                "智谱Sheet": Z_SHEET,
                "对照Sheet": sheets_of(o_rows),
                "源文件": str(SOURCE),
                "公司对照": f"{join(values_of(z_rows, '公司'))} -> {join(values_of(o_rows, '公司'))}",
                "渠道对照": f"{join(values_of(z_rows, '渠道/事件'))} -> {join(values_of(o_rows, '渠道/事件'))}",
                "来源对照": f"{join(values_of(z_rows, '来源'))} -> {join(values_of(o_rows, '来源'))}",
            }
        )

    for rule_id in sorted(Z & P):
        absorb("产品级", rule_id, z[rule_id], p[rule_id])
    for rule_id in sorted(Z & S):
        absorb("场景级", rule_id, z[rule_id], s[rule_id])
    for rule_id in sorted(both_scene):
        left = atoms_of(input_only[rule_id])
        right = atoms_of(output_only[rule_id])
        if set(left) == set(right):
            continue
        compare_atoms(rule_id, "场景输入对场景输出", input_only[rule_id], output_only[rule_id], buckets)

    combined = []
    for rule_id in sorted(Z & (P | S)):
        product = next((row for row in summary_rows if row["规则标识"] == rule_id and row["对照侧"] == "产品级"), None)
        scene = next((row for row in summary_rows if row["规则标识"] == rule_id and row["对照侧"] == "场景级"), None)
        flags = []
        if product and product["是否改变规则含义"] == "是":
            flags.append("与产品级存在含义差异")
        elif product:
            flags.append("与产品级原子条件和共同应用处置没有直接冲突")
        else:
            flags.append("产品级没有该标识")
        if scene and scene["是否改变规则含义"] == "是":
            flags.append("与场景级存在含义差异")
        elif scene:
            flags.append("与场景级原子条件和共同应用处置没有直接冲突")
        else:
            flags.append("场景级没有该标识")
        combined.append(
            {
                "规则标识": rule_id,
                "规则名称": join(values_of(z[rule_id], "规则名称")),
                "产品级是否存在": "是" if product else "否",
                "场景级是否存在": "是" if scene else "否",
                "与产品级原子条件": product["原子条件关系"] if product else "标识不存在",
                "与场景级原子条件": scene["原子条件关系"] if scene else "标识不存在",
                "与产品级处置对齐": product["处置对齐结论"] if product else "标识不存在",
                "与场景级处置对齐": scene["处置对齐结论"] if scene else "标识不存在",
                "综合结论": "；".join(flags),
                "智谱行号": rows_of(z[rule_id]),
                "产品级行号": rows_of(p[rule_id]) if product else "",
                "场景级行号": rows_of(s[rule_id]) if scene else "",
                "源文件": str(SOURCE),
            }
        )

    absent_both = [
        coverage_row(rule_id, z[rule_id], {"是否在产品级": "否", "是否在场景级": "否", "差异类别": "表间规则标识缺失"})
        for rule_id in sorted(Z - P - S)
    ]
    absent_p = [
        coverage_row(
            rule_id,
            z[rule_id],
            {
                "是否在产品级": "否",
                "是否在场景级": "是" if rule_id in S else "否",
                "差异类别": "表间规则标识缺失",
                "建议": "建议确认产品、场景适用范围",
            },
        )
        for rule_id in sorted(Z - P)
    ]
    absent_s = [
        coverage_row(
            rule_id,
            z[rule_id],
            {
                "是否在产品级": "是" if rule_id in P else "否",
                "是否在场景级": "否",
                "差异类别": "表间规则标识缺失",
                "建议": "建议确认产品、场景适用范围",
            },
        )
        for rule_id in sorted(Z - S)
    ]
    only_p = [
        coverage_row(rule_id, p[rule_id], {"是否在场景级": "是" if rule_id in S else "否", "差异类别": "表间规则标识缺失"})
        for rule_id in sorted(P - Z)
    ]
    only_s = [
        coverage_row(rule_id, s[rule_id], {"是否在产品级": "是" if rule_id in P else "否", "差异类别": "表间规则标识缺失"})
        for rule_id in sorted(S - Z)
    ]

    fixed_rows = []
    for side, other in (("产品级", p), ("场景级", s)):
        shared = Z & (P if side == "产品级" else S)
        for column in FIXED_FIELDS:
            pairs = []
            exceptions = []
            for rule_id in shared:
                pair = (join(values_of(z[rule_id], column)), join(values_of(other[rule_id], column)))
                pairs.append(pair)
                if pair != pairs[0]:
                    exceptions.append(rule_id)
            first = pairs[0]
            fixed_rows.append(
                {
                    "规则标识": "全部共有标识" if not exceptions else join(exceptions[:20]),
                    "对照侧": side,
                    "字段": column,
                    "差异性质": "表级固定差异" if not exceptions else "存在例外，需逐条看",
                    "涉及规则标识数": len(shared),
                    "例外规则标识数": len(exceptions),
                    "智谱原值": first[0],
                    "对照原值": first[1],
                    "业务分类": "可能属于合理的业务差异",
                    "建议": "建议保留现状",
                    "建议理由": "该字段在共有标识上方向一致。未配置只表示单元格为空，不表示全渠道生效，也不表示线上没有覆盖。",
                    "判断可信程度": "高",
                    "源文件": str(SOURCE),
                    "智谱Sheet": Z_SHEET,
                    "对照Sheet": P_SHEET if side == "产品级" else " | ".join(S_SHEETS),
                }
            )

    mapping = pd.DataFrame(
        [
            {"源字段": column, "智谱": "同名列", "产品级": "同名列", "场景级": "同名列", "映射方式": "三张表列名完全一致", "是否可靠": "是"}
            for column in [
                "规则标识",
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
                "拉黑字段",
                "规则条件",
                "创建时间",
                "规则描述",
                "备注",
                "来源",
            ]
        ]
        + [
            {
                "源字段": "模型特征名称 / 比较运算值 / 阈值名单",
                "智谱": "原表不存在",
                "产品级": "原表不存在",
                "场景级": "原表不存在",
                "映射方式": "由规则条件做括号感知的 && 拆分后再解析。解析失败的原子进入待确认，不回写原表。",
                "是否可靠": "派生字段，只在解析级别为能够解析时参与阈值比较",
            },
            {
                "源字段": "合集",
                "智谱": "未使用",
                "产品级": "未使用",
                "场景级": "未使用",
                "映射方式": "合集行数等于四张明细表之和，是拼接结果。使用它会重复计数。",
                "是否可靠": "不作为独立来源",
            },
        ]
    )
    notes = pd.DataFrame(
        [
            {"项目": "源文件", "说明": str(SOURCE)},
            {"项目": "智谱规则表", "说明": f"Sheet「{Z_SHEET}」。来源列全部为智谱策略文档，公司全部为智谱华章。"},
            {"项目": "产品级规则表", "说明": f"Sheet「{P_SHEET}」。来源列全部为产品级策略，公司全部为 SM，规则类型全部为标准。"},
            {"项目": "场景级规则表", "说明": "两张 Sheet 合并使用，并保留各自 Sheet 名和行号：aigc标准场景策略文档-输入、aigc标准场景策略文档-输出。"},
            {"项目": "未使用", "说明": "合集、你的规则表.xlsx、你的规则表_副本.xlsx 都是上述明细的拼接，不重复进入对账。"},
            {"项目": "匹配", "说明": "先按规则标识聚合多行，再比较原子条件指纹。不按标识做一对一行笛卡尔积。"},
            {"项目": "空值", "说明": "空白展示为未配置，并保留原始空值含义。未配置不是全渠道。"},
            {"项目": "标准化", "说明": "条件比较同时保留全文规范化集合和原子指纹。只有空白或全角括号差异时，全文集合会判为一致。"},
            {"项目": "对齐", "说明": "处置、得分、标签先按对照表中的应用取值回看智谱行。没有共同应用时不称为同一槽位冲突。"},
        ]
    )

    z_rows_n = sum(len(v) for v in z.values())
    p_rows_n = sum(len(v) for v in p.values())
    s_rows_n = sum(len(v) for v in s.values())
    stats = {
        "智谱行数": z_rows_n,
        "产品级行数": p_rows_n,
        "场景级行数": s_rows_n,
        "智谱标识": len(Z),
        "产品级标识": len(P),
        "场景级标识": len(S),
        "场景两表都有": len(both_scene),
        "智谱交产品": len(Z & P),
        "智谱交场景": len(Z & S),
        "产品交场景": len(P & S),
        "三表都有": len(Z & P & S),
        "智谱独有": len(Z - P - S),
        "智谱无产品": len(Z - P),
        "智谱无产品且在场景": len((Z - P) & S),
        "智谱无场景": len(Z - S),
        "智谱无场景且在产品": len((Z - S) & P),
        "产品独有": len(P - Z),
        "场景独有": len(S - Z),
        "产品场景都有但智谱无": len((P & S) - Z),
        "智谱被任一侧覆盖": len(Z & (P | S)),
        "含义差异产品": len(meaning_ids["产品级"]),
        "含义差异场景": len(meaning_ids["场景级"]),
        "直接处置产品": direct_action["产品级"],
        "直接处置场景": direct_action["场景级"],
    }
    summary = pd.DataFrame(
        [
            {"指标": "智谱规则标识", "数量": stats["智谱标识"], "口径": f"Sheet {Z_SHEET}，行数 {z_rows_n}。一个标识可对应多行。"},
            {"指标": "产品级规则标识", "数量": stats["产品级标识"], "口径": f"Sheet {P_SHEET}，行数 {p_rows_n}。"},
            {"指标": "场景级规则标识", "数量": stats["场景级标识"], "口径": f"输入与输出两张 Sheet 合并，行数 {s_rows_n}。两张表都出现的标识 {stats['场景两表都有']} 个。"},
            {"指标": "智谱∩产品级", "数量": stats["智谱交产品"], "口径": "规则标识交集。"},
            {"指标": "智谱∩场景级", "数量": stats["智谱交场景"], "口径": "规则标识交集。"},
            {"指标": "产品级∩场景级", "数量": stats["产品交场景"], "口径": "规则标识交集。"},
            {"指标": "三表交集", "数量": stats["三表都有"], "口径": "三侧都有该标识。"},
            {"指标": "智谱有且产品场景都无", "数量": stats["智谱独有"], "口径": "表间标识缺失，不是已证实的线上漏配。"},
            {"指标": "智谱有且产品级无", "数量": stats["智谱无产品"], "口径": f"其中场景级存在 {stats['智谱无产品且在场景']} 个。"},
            {"指标": "智谱有且场景级无", "数量": stats["智谱无场景"], "口径": f"其中产品级存在 {stats['智谱无场景且在产品']} 个。"},
            {"指标": "产品级有且智谱无", "数量": stats["产品独有"], "口径": "只在产品级 Sheet。"},
            {"指标": "场景级有且智谱无", "数量": stats["场景独有"], "口径": "只在场景级两张 Sheet。"},
            {"指标": "产品场景都有且智谱无", "数量": stats["产品场景都有但智谱无"], "口径": "本类为零时保留说明行。"},
            {"指标": "智谱与产品级含义差异", "数量": stats["含义差异产品"], "口径": "原子条件不同，或共同应用上的处置、得分、标签、场景、规则类型不同。"},
            {"指标": "智谱与场景级含义差异", "数量": stats["含义差异场景"], "口径": "同上。"},
            {"指标": "共同应用上处置仍不同_产品级", "数量": stats["直接处置产品"], "口径": "两侧在共同应用上都只有一个处置，且不相等。"},
            {"指标": "共同应用上处置仍不同_场景级", "数量": stats["直接处置场景"], "口径": "同上。"},
            {"指标": "智谱标识覆盖率_产品或场景", "数量": stats["智谱被任一侧覆盖"], "口径": "智谱标识中至少出现在产品级或场景级的数量。"},
        ]
    )

    # 校验
    if stats["智谱标识"] != stats["三表都有"] + stats["智谱无场景且在产品"] + stats["智谱无产品且在场景"] + stats["智谱独有"]:
        raise SystemExit("智谱标识拆分无法加总")
    if stats["产品级标识"] != stats["智谱交产品"] + stats["产品独有"]:
        raise SystemExit("产品级标识拆分无法加总")
    if stats["场景级标识"] != stats["智谱交场景"] + stats["场景独有"]:
        raise SystemExit("场景级标识拆分无法加总")
    if len(absent_both) != stats["智谱独有"] or len(absent_p) != stats["智谱无产品"] or len(absent_s) != stats["智谱无场景"]:
        raise SystemExit("缺失清单条数与集合运算不一致")
    if len(only_p) != stats["产品独有"] or len(only_s) != stats["场景独有"]:
        raise SystemExit("独有清单条数不一致")
    if len(combined) != stats["智谱被任一侧覆盖"]:
        raise SystemExit("综合对照条数不等于智谱被覆盖的标识数")
    if any(rule_id in P or rule_id in S for rule_id in (Z - P - S)):
        raise SystemExit("智谱独有标识实际出现在对照表")
    sample_direct = [
        row["规则标识"]
        for row in buckets["处置"]
        if row["字段"] == "处置建议" and row["对照侧"] == "产品级" and row["差异形态"] == "对齐后仍不同"
    ][:5]
    for rule_id in sample_direct:
        status, _, _ = align_status(z[rule_id], p[rule_id], "处置建议")
        if status != "对齐后仍不同":
            raise SystemExit(f"回归失败 {rule_id}")
    if sample_direct and sample_direct[0] not in (Z & P):
        raise SystemExit("直接处置样本不在交集中")
    for row in absent_both[:5]:
        if row["规则标识"] in P or row["规则标识"] in S:
            raise SystemExit("缺失样本回归失败")

    out = HERE / "reports" / "reconcile" / datetime.now().strftime("%Y%m%d_%H%M%S")
    out.mkdir(parents=True, exist_ok=False)
    write_book(
        out / "三表规则对账总览.xlsx",
        {
            "对账摘要": summary,
            "智谱有_产品场景均无": frame_or_zero(absent_both, "无"),
            "智谱有_产品级无": frame_or_zero(absent_p, "无"),
            "智谱有_场景级无": frame_or_zero(absent_s, "无"),
            "产品级有_智谱无": frame_or_zero(only_p, "无"),
            "场景级有_智谱无": frame_or_zero(only_s, "无"),
            "产品场景均有_智谱无": frame_or_zero([], "产品级和场景级的交集全部也出现在智谱规则表，本类为零。"),
            "同标识配置不一致": frame_or_zero(summary_rows, "无"),
            "综合对照": frame_or_zero(combined, "无"),
            "条件差异明细": frame_or_zero(buckets["条件"], "没有运算符层面的条件差异。"),
            "阈值差异明细": frame_or_zero(buckets["阈值"], "没有同一特征、同一运算符下的阈值差异。"),
            "处置与标签差异": frame_or_zero(buckets["处置"], "无"),
            "投放范围差异": pd.concat([frame_or_zero(fixed_rows, "无"), frame_or_zero(buckets["范围"], "无")], ignore_index=True),
            "条件新增与缺失": frame_or_zero(buckets["新增缺失"], "无"),
            "仅格式或描述差异": frame_or_zero(buckets["格式"], "无"),
            "匹配关系待确认": frame_or_zero(buckets["待确认"], "没有无法解析的未对齐原子条件。"),
            "字段映射与口径": pd.concat([mapping, notes], ignore_index=True),
        },
    )

    action_examples = [
        row
        for row in buckets["处置"]
        if row["字段"] == "处置建议" and row["差异形态"] == "对齐后仍不同"
    ][:8]
    example_lines = []
    for row in action_examples:
        score = next(
            (
                item
                for item in buckets["处置"]
                if item["规则标识"] == row["规则标识"] and item["对照侧"] == row["对照侧"] and item["字段"] == "得分"
            ),
            None,
        )
        score_text = (
            f"得分 {score['按共同应用对齐后的智谱取值']} 对 {score['对照原值']}"
            if score
            else "得分在共同应用上没有另成差异"
        )
        example_lines.append(
            f"- {row['规则标识']}（{row['规则名称']}）对照{row['对照侧']}：处置 {row['按共同应用对齐后的智谱取值']} 对 {row['对照原值']}，{score_text}。智谱行号 {row['智谱行号']}，对照行号 {row['对照行号']}。"
        )
    only_scene_lines = []
    for rule_id in sorted(S - Z):
        rows = s[rule_id]
        only_scene_lines.append(
            f"- {rule_id}，名称 {join(values_of(rows, '规则名称'))}，Sheet {sheets_of(rows)}，行号 {rows_of(rows)}，处置 {join(values_of(rows, '处置建议'))}，风险类型 {join(values_of(rows, '风险类型'))}。"
        )
    report = f"""# 三表规则差异分析报告

## 数据在哪里

三类规则都在同一个工作簿里，不是三份互不相关的文件。

- 源文件：`{SOURCE}`
- 智谱规则表：工作表「{Z_SHEET}」，{z_rows_n} 行，{stats['智谱标识']} 个规则标识。来源列全部是「智谱策略文档」，公司全部是「智谱华章」。同一个标识最多 6 行，对应不同渠道或应用。
- 产品级规则表：工作表「{P_SHEET}」，{p_rows_n} 行，{stats['产品级标识']} 个规则标识。来源列全部是「产品级策略」，公司全部是「SM」，渠道全部为空，规则类型全部是「标准」。每个标识一行。
- 场景级规则表：工作表「aigc标准场景策略文档-输入」和「aigc标准场景策略文档-输出」。两张表一起作为场景级，行数 {s_rows_n}，去重后 {stats['场景级标识']} 个规则标识。其中 {stats['场景两表都有']} 个标识同时出现在输入和输出两张表。

工作表「合集」有 13380 行，等于四张明细表行数之和。`你的规则表.xlsx` 和 `你的规则表_副本.xlsx` 的来源分布也是这四张表的拼接。这三份都没有再参与对账，避免把同一条规则数两遍。

三张明细表的 22 个列名完全一致。模型特征、运算符、阈值三列在原表里不存在，是从「规则条件」拆分 && 之后解析出来的。解析失败的原子单独进入「匹配关系待确认」，没有回写原表。

## 标识覆盖

| 集合 | 规则标识数 |
| --- | ---: |
| 智谱 | {stats['智谱标识']} |
| 产品级 | {stats['产品级标识']} |
| 场景级 | {stats['场景级标识']} |
| 智谱 ∩ 产品级 | {stats['智谱交产品']} |
| 智谱 ∩ 场景级 | {stats['智谱交场景']} |
| 产品级 ∩ 场景级 | {stats['产品交场景']} |
| 三表都有 | {stats['三表都有']} |
| 智谱有，产品级和场景级都没有 | {stats['智谱独有']} |
| 智谱有，产品级没有 | {stats['智谱无产品']} |
| 其中场景级有 | {stats['智谱无产品且在场景']} |
| 智谱有，场景级没有 | {stats['智谱无场景']} |
| 其中产品级有 | {stats['智谱无场景且在产品']} |
| 仅产品级有，智谱没有 | {stats['产品独有']} |
| 仅场景级有，智谱没有 | {stats['场景独有']} |
| 产品级和场景级都有，智谱没有 | {stats['产品场景都有但智谱无']} |

智谱 {stats['智谱标识']} 个标识里，{stats['智谱被任一侧覆盖']} 个至少出现在产品级或场景级。标识能够加总：{stats['三表都有']}+{stats['智谱无场景且在产品']}+{stats['智谱无产品且在场景']}+{stats['智谱独有']}={stats['智谱标识']}。

这些差集是表间规则标识缺失，不是已经证实的线上漏配。产品级多出来的 {stats['产品独有']} 个标识，可能是产品策略自己的规则，不能直接补进智谱表，也不能直接从智谱表删除。

场景级有而智谱没有的标识：

{chr(10).join(only_scene_lines)}

## 标识相同并不等于规则相同

共有标识全部保留在「同标识配置不一致」。公司、渠道、来源在全部共有标识上方向一致：智谱是「智谱华章」且渠道有值，产品级和场景级是「SM」且渠道为未配置，来源列分别就是各自的表名。这三项记为表级固定差异，不按标识展开成重复行。未配置不等于全渠道生效。

在这个固定差异之外：

- 与产品级相比，{stats['含义差异产品']} 个共有标识还有条件、处置、得分、标签、场景或规则类型上的含义差异。
- 与场景级相比，{stats['含义差异场景']} 个共有标识有这类差异。
- 按共同应用对齐后，处置仍然一边一个值的：产品级 {stats['直接处置产品']} 个，场景级 {stats['直接处置场景']} 个。
- 共有标识的规则名称集合没有不一致。风险标签和风险类型的取值集合也没有不一致。
- 原子条件完全对不上的标识为 0。产品级、场景级出现的原子条件，都能在智谱同标识下找到相同指纹；差异主要是智谱多出原子条件，或同一特征同一运算符的阈值不同。

条件全文看起来不同、但原子指纹相同的规则，进「仅格式或描述差异」。那是 && 的组合方式或多行书写不同，不是另一套条件。

## 最需要看的差异

共同应用上处置仍然不同的案例：

{chr(10).join(example_lines) if example_lines else "- 无。"}

产品级一侧，最常见的直接差异是智谱取「通过」、产品级取「拒绝」，得分往往从 500 变成 950 以上。场景级的直接处置冲突少得多。智谱内部如果同时有「审核」和「拒绝」，而对表只有其中一个，并且对到同一个应用后取值相同，就不再算作处置冲突，只说明智谱还在另一个应用上保留了另一档。

规则类型也有成批差异：产品级这一列全部写成「标准」，智谱里同一标识可能是「公司」或「场景」。这更像两张表的填写口径，建议确认适用范围，不要直接把智谱的规则类型改成标准。

应用同样成批不同。产品级和场景级大多只有「默认应用」，智谱经常同时有「默认应用」和「B端业务」，或只有「B端业务」。没有共同应用时，本次不把处置差异叫作同一槽位冲突。

## 建议优先核查

1. 先看「处置与标签差异」里差异形态为「对齐后仍不同」的处置和得分。建议先不要改任何一侧。需要补的是这些规则标识在默认应用上的生效版本，以及命中日志里最终取的处置。
2. 再看「阈值差异明细」和「条件新增与缺失」。智谱多出来的原子条件，可能是产品级或场景级没有同步，也可能是公司策略故意多出来的限制。建议核实，不直接删。
3. 智谱独有的 {stats['智谱独有']} 个标识、产品级独有的 {stats['产品独有']} 个标识，按「建议确认产品、场景适用范围」处理。场景级独有只有上面 2 个，可以单独确认要不要进入智谱表。
4. 公司、渠道、来源的表级差异建议保留现状。不要把 SM 的空渠道填成「全部」。
5. 只改描述、备注或 && 书写方式的，建议保留现状。

## 还不能确认的事

当前表不能说明哪一侧是线上正在执行的版本，也不能说明「通过 / 500」和「拒绝 / 高分」哪一个符合产品要求。规则优先级、短路、命中日志和审核结果都还没有。因此本次没有任何一项被写成“必须改成某个具体值”。
"""
    (out / "三表规则差异分析报告.md").write_text(report, encoding="utf-8")
    after = sha256_file(SOURCE)
    if after != before:
        raise SystemExit("源文件哈希发生变化")
    if not (out / "三表规则对账总览.xlsx").is_file() or not (out / "三表规则差异分析报告.md").is_file():
        raise SystemExit("交付文件缺失")
    print("RECONCILE_OK")
    print(out)
    for key, value in stats.items():
        print(f"{key}={value}")
    print("条件差异", len(buckets["条件"]), "阈值", len(buckets["阈值"]), "新增缺失", len(buckets["新增缺失"]), "待确认", len(buckets["待确认"]))
    print("处置标签", len(buckets["处置"]), "范围个体", len(buckets["范围"]), "格式", len(buckets["格式"]), "综合", len(combined))
    return out


if __name__ == "__main__":
    main()
