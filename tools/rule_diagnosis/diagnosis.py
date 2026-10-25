#!/usr/bin/env python3
"""内容安全策略资产画像与配置诊断。只读源文件，不修改线上规则。"""

from __future__ import annotations

import argparse
import hashlib
import io
import logging
import sys
import zipfile
from datetime import datetime
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent
HEALTHCHECK_DIR = ROOT.parent / "rule_healthcheck"
for path in (ROOT, HEALTHCHECK_DIR):
    if str(path) not in sys.path:
        sys.path.insert(0, str(path))

from analyze import HealthcheckError, prepare_frame  # noqa: E402
from compare import dimension_status  # noqa: E402
from diagnose import run_diagnosis, summary_counts  # noqa: E402
from layer import UNCONFIGURED, build_layer, normalize_business, require_layer_columns  # noqa: E402
from report_diagnosis import render_markdown, write_workbook  # noqa: E402
from rule_healthcheck import inspect_workbook  # noqa: E402
from synthetic_diagnosis import CANARY, DATA_SHEET, write_workbook as write_synthetic  # noqa: E402

LOGGER = logging.getLogger("rule_diagnosis")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def xlsx_contains(path: Path, token: str) -> bool:
    encoded = token.encode("utf-8")
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if encoded in archive.read(name):
                return True
    return False


def ensure_output_dir(source: Path, directory: Path, synthetic: bool) -> None:
    source_resolved = source.resolve()
    directory_resolved = directory.resolve()
    reports = (ROOT / "reports").resolve()
    if directory_resolved == source_resolved or source_resolved in directory_resolved.parents:
        raise HealthcheckError("输出目录不能是原始文件或其上级，已拒绝写入")
    if reports not in directory_resolved.parents and directory_resolved != reports:
        raise HealthcheckError("诊断报告只能写到 tools/rule_diagnosis/reports")
    self_test_dir = (ROOT / "reports" / "self_test").resolve()
    real_dir = (ROOT / "reports" / "real").resolve()
    if synthetic:
        if self_test_dir not in directory_resolved.parents and directory_resolved != self_test_dir:
            raise HealthcheckError("合成诊断报告只能写入 reports/self_test，避免混入真实报告")
        return
    if self_test_dir in directory_resolved.parents or directory_resolved == self_test_dir:
        raise HealthcheckError("真实诊断报告不能写入 self_test")
    if real_dir not in directory_resolved.parents and directory_resolved != real_dir:
        raise HealthcheckError("真实诊断报告只能写入 reports/real")


def setup_logging(log_path: Path, stream: io.TextIOBase) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    LOGGER.handlers.clear()
    LOGGER.setLevel(logging.INFO)
    LOGGER.propagate = False
    formatter = logging.Formatter("%(asctime)s %(levelname)s %(message)s")
    file_handler = logging.FileHandler(log_path, encoding="utf-8")
    file_handler.setFormatter(formatter)
    stream_handler = logging.StreamHandler(stream)
    stream_handler.setFormatter(formatter)
    LOGGER.addHandler(file_handler)
    LOGGER.addHandler(stream_handler)


def choose_file(given: str | None) -> Path:
    if given:
        return Path(given).expanduser()
    try:
        import tkinter as tk
        from tkinter import filedialog

        root = tk.Tk()
        root.withdraw()
        root.update()
        selected = filedialog.askopenfilename(
            title="选择规则 Excel（只读，不会修改原文件）",
            filetypes=[("Excel 文件", "*.xlsx *.xlsm"), ("所有文件", "*.*")],
        )
        root.destroy()
        if selected:
            return Path(selected)
    except Exception as exc:
        print(f"图形选择不可用：{exc}")
    typed = input("请输入 Excel 路径: ").strip().strip('"').strip("'")
    if not typed:
        raise HealthcheckError("未选择文件")
    return Path(typed).expanduser()


def choose_sheet(names: list[str], given: str | None) -> str:
    if given:
        if given not in names:
            raise HealthcheckError("找不到工作表 " + given + "。可选：" + "、".join(names))
        return given
    if len(names) == 1:
        return names[0]
    if not sys.stdin.isatty():
        raise HealthcheckError("有多个工作表，请用 --sheet 指定。可选：" + "、".join(names))
    print("请选择工作表：")
    for index, name in enumerate(names, start=1):
        print(f"{index}. {name}")
    typed = input("请输入序号: ").strip()
    if not typed.isdigit() or not 1 <= int(typed) <= len(names):
        raise HealthcheckError("工作表序号无效")
    return names[int(typed) - 1]


def run_job(source: Path, sheet: str | None, output_dir: Path | None, log_path: Path, stream: io.TextIOBase) -> Path:
    if not source.is_file():
        raise HealthcheckError(f"找不到文件：{source}")
    if source.suffix.lower() not in {".xlsx", ".xlsm"}:
        raise HealthcheckError("目前只读取 .xlsx 或 .xlsm。请重新选择规则表。")
    setup_logging(log_path, stream)
    before_hash = sha256_file(source)
    before_mtime = source.stat().st_mtime_ns
    LOGGER.info("只读打开 %s", source.name)
    LOGGER.info("读取前 SHA256 %s", before_hash)
    names, synthetic = inspect_workbook(source)
    if not names:
        raise HealthcheckError("工作簿里没有可读取的工作表")
    selected = choose_sheet(names, sheet)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    directory = output_dir or (ROOT / "reports" / ("self_test" if synthetic else "real") / stamp)
    ensure_output_dir(source, directory, synthetic)
    directory.mkdir(parents=True, exist_ok=True)
    raw = pd.read_excel(source, sheet_name=selected, dtype=object, engine="openpyxl")
    resolved = require_layer_columns(raw)
    layer = build_layer(prepare_frame(raw), resolved)
    sheets = run_diagnosis(layer)
    sheets.pop("_profiles", None)
    counts = summary_counts(layer, sheets)
    report_path = directory / "策略诊断.xlsx"
    markdown_path = directory / "策略诊断摘要.md"
    write_workbook(report_path, sheets)
    markdown_path.write_text(
        render_markdown(source.name, selected, "synthetic" if synthetic else "real", counts, sheets["策略诊断清单"]),
        encoding="utf-8",
    )
    if sha256_file(source) != before_hash or source.stat().st_mtime_ns != before_mtime:
        report_path.unlink(missing_ok=True)
        raise HealthcheckError("源文件在诊断期间发生变化，已删除本次报告")
    for key, value in counts.items():
        LOGGER.info("%s %s", key, value)
    LOGGER.info("源文件未修改")
    LOGGER.info("报告目录 %s", directory)
    return directory


def _assert_unit() -> None:
    status, score = dimension_status(UNCONFIGURED, UNCONFIGURED)
    if status != "双方未配置" or score != 0:
        raise AssertionError("双方未配置仍被当成相似")
    blank_value, blank_origin = normalize_business("")
    literal_value, literal_origin = normalize_business("未配置")
    if blank_value != "未配置" or blank_origin != "空值记为未配置":
        raise AssertionError("空业务值没有按约定规范")
    if literal_value != "未配置" or literal_origin != "原始业务值":
        raise AssertionError("原文未配置被当成了空值")
    try:
        require_layer_columns(pd.DataFrame([{"只有名称": "x"}]))
    except HealthcheckError as exc:
        if "规则标识" not in str(exc) and "规则条件" not in str(exc):
            raise AssertionError("缺字段时的错误信息不可理解") from exc
    else:
        raise AssertionError("缺少必要字段时没有报错")
    try:
        require_layer_columns(pd.DataFrame(columns=["规则标识", "规则条件"]))
    except HealthcheckError as exc:
        if "没有数据行" not in str(exc):
            raise AssertionError("空表错误信息不可理解") from exc
    else:
        raise AssertionError("空表没有报错")


def run_self_test() -> None:
    _assert_unit()
    fixture = ROOT / "fixtures" / "synthetic_diagnosis.xlsx"
    write_synthetic(fixture)
    before = sha256_file(fixture)
    blocked = ROOT / "reports" / "real" / "synthetic_must_not_land"
    try:
        run_job(fixture, DATA_SHEET, blocked, ROOT / "logs" / "blocked.log", io.StringIO())
    except HealthcheckError:
        pass
    else:
        raise AssertionError("合成报告被允许写入真实目录")
    if blocked.exists():
        raise AssertionError("真实目录出现了合成诊断")
    text_file = ROOT / "fixtures" / "not_excel.txt"
    text_file.write_text("bad", encoding="utf-8")
    try:
        run_job(text_file, None, ROOT / "reports" / "self_test" / "bad", ROOT / "logs" / "bad.log", io.StringIO())
    except HealthcheckError as exc:
        if "xlsx" not in str(exc):
            raise AssertionError("异常格式的错误信息不可理解") from exc
    else:
        raise AssertionError("非 Excel 文件没有报错")

    buffer = io.StringIO()
    directory = run_job(
        fixture,
        DATA_SHEET,
        ROOT / "reports" / "self_test" / "latest",
        ROOT / "logs" / "selftest.log",
        buffer,
    )
    report = directory / "策略诊断.xlsx"
    markdown = (directory / "策略诊断摘要.md").read_text(encoding="utf-8")
    console = buffer.getvalue() + (ROOT / "logs" / "selftest.log").read_text(encoding="utf-8")
    if CANARY in console or CANARY in markdown or xlsx_contains(report, CANARY):
        raise AssertionError("诊断输出含有未脱敏测试令牌")
    if sha256_file(fixture) != before:
        raise AssertionError("合成源文件被修改")
    book = pd.ExcelFile(report)
    expected_sheets = [
        "策略资产总览",
        "风险标签分布",
        "风险类型分布",
        "投放范围分布",
        "规则复杂度",
        "完全重复候选",
        "相同条件跨范围复用",
        "相似规则候选",
        "同规则配置差异",
        "同特征阈值分布",
        "潜在处置冲突",
        "数据质量与排除记录",
        "策略诊断清单",
        "口径与限制说明",
    ]
    for name in expected_sheets:
        if name not in book.sheet_names:
            raise AssertionError(f"缺少工作表 {name}")
    raw = pd.read_excel(fixture, sheet_name=DATA_SHEET, dtype=object)
    layer = build_layer(prepare_frame(raw), require_layer_columns(raw))
    if len(layer) != 21:
        raise AssertionError("干扰表被读进了诊断")
    blank = layer[layer["规则标识"] == "R_BLANK"].iloc[0]
    literal = layer[layer["规则标识"] == "R_LITERAL"].iloc[0]
    if blank["渠道/事件_规范值"] != "未配置" or blank["渠道/事件_规范来源"] != "空值记为未配置":
        raise AssertionError("空渠道没有记为未配置")
    if literal["渠道/事件_规范来源"] != "原始业务值" or literal["渠道/事件_原始值"] != "未配置":
        raise AssertionError("原文未配置没有和空值分开")
    sheets = run_diagnosis(layer)
    duplicates = sheets["完全重复候选"]
    dup_rules = " ".join(duplicates["规则标识"].astype(str)) if len(duplicates) else ""
    if "R_PARENT" in dup_rules:
        raise AssertionError("父行拆分被当成了完全重复")
    if "R_REUSE" in dup_rules:
        raise AssertionError("跨投放范围复用被当成了完全重复")
    if "R_DUP_A" not in dup_rules or "R_DUP_B" not in dup_rules:
        raise AssertionError("完全重复候选漏掉了预构造样例")
    reuse = sheets["相同条件跨范围复用"]
    reuse_hit = reuse[reuse["规则标识"].astype(str).str.contains("R_REUSE")]
    if reuse_hit.empty or (reuse_hit["复用分类"] != "配置完全相同").all() is False and "配置完全相同" not in set(reuse_hit["复用分类"]):
        raise AssertionError("跨范围复用没有按配置完全相同分开")
    if "配置完全相同" not in set(reuse_hit["复用分类"]):
        raise AssertionError("跨范围复用分类不对")
    similar = sheets["相似规则候选"]
    pair_text = similar["规则标识甲"].astype(str) + "|" + similar["规则标识乙"].astype(str) if len(similar) else pd.Series(dtype=str)
    if not any({"R_SIM_A", "R_SIM_B"} == set(text.split("|")) for text in pair_text):
        raise AssertionError("相似候选漏掉了预构造样例")
    sim_row = similar[pair_text.map(lambda text: set(text.split("|")) == {"R_SIM_A", "R_SIM_B"})].iloc[0]
    if "双方未配置" not in str(sim_row["投放比较"]) and "双方未配置" not in str(sim_row["未计入维度"]):
        raise AssertionError("两侧渠道都未配置时没有按未配置处理")
    differences = sheets["同规则配置差异"]
    same = differences[differences["规则标识"] == "R_SAMECO"]
    if same.empty or "拒绝" not in str(same.iloc[0]["处置建议全部取值"]) or "通过" not in str(same.iloc[0]["处置建议全部取值"]):
        raise AssertionError("同一规则的处置取值没有完整保留")
    if str(same.iloc[0]["原始Excel行号"]) == "":
        raise AssertionError("诊断不能追溯到原始行号")
    thresholds = sheets["同特征阈值分布"]
    features = " ".join(thresholds["模型特征"].astype(str)) if len(thresholds) else ""
    if "device_risk" in features or "score>=10" in features:
        raise AssertionError("错位或部分解析被静默纳入了阈值分布")
    quality = sheets["数据质量与排除记录"]
    if "column_shift" not in " ".join(quality["质量代码"].astype(str)):
        raise AssertionError("列错位没有进入质量记录")
    conflict = sheets["潜在处置冲突"]
    if "潜在冲突，待确认执行逻辑" not in set(conflict["冲突标记"].astype(str)):
        raise AssertionError("冲突结果没有保持待确认标记")
    sys.stdout.write(buffer.getvalue())
    LOGGER.info("合成测试通过 %s", directory)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="内容安全策略资产画像与配置诊断。只读源文件。")
    parser.add_argument("--file", help="Excel 路径。省略时弹出文件选择框。")
    parser.add_argument("--sheet", help="工作表名称。只有一个工作表时可以省略。")
    parser.add_argument("--self-test", action="store_true", help="只用合成数据测试，不读取真实规则表。")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        if args.self_test:
            run_self_test()
            print("SELF_TEST_OK")
            return 0
        source = choose_file(args.file)
        stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        directory = run_job(source, args.sheet, None, ROOT / "logs" / f"diagnosis_{stamp}.log", sys.stdout)
        print(f"诊断完成，目录：{directory}")
        return 0
    except HealthcheckError as exc:
        print(f"诊断未完成：{exc}", file=sys.stderr)
        return 2
    except AssertionError as exc:
        print(f"合成测试失败：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
