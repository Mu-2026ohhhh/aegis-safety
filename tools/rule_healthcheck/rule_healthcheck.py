#!/usr/bin/env python3
"""本地规则表数据体检。只读 Excel，不修改、不覆盖、不上传原始文件。"""

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
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from analyze import HealthcheckError, build_analysis, prepare_frame, resolve_columns  # noqa: E402
from report_excel import write_report  # noqa: E402
from synthetic_cases import CANARY, DATA_SHEET, MARKER_SHEET, write_workbook  # noqa: E402

LOGGER = logging.getLogger("rule_healthcheck")


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


def inspect_workbook(path: Path) -> tuple[list[str], bool]:
    import openpyxl

    workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
    try:
        names = list(workbook.sheetnames)
        subject = workbook.properties.subject or ""
    finally:
        workbook.close()
    synthetic = MARKER_SHEET in names or "healthcheck-synthetic" in subject
    visible = [name for name in names if name != MARKER_SHEET]
    return visible, synthetic


def ensure_output_path(source: Path, output: Path, synthetic: bool) -> None:
    source_resolved = source.resolve()
    output_resolved = output.resolve()
    reports = (ROOT / "reports").resolve()
    if output_resolved == source_resolved:
        raise HealthcheckError("输出路径与原始文件相同，已拒绝写入")
    if reports not in output_resolved.parents:
        raise HealthcheckError("报告只能写入工具 reports 目录，已拒绝写入其他位置")
    self_test_dir = (ROOT / "reports" / "self_test").resolve()
    real_dir = (ROOT / "reports" / "real").resolve()
    if synthetic:
        if self_test_dir != output_resolved.parent and self_test_dir not in output_resolved.parents:
            raise HealthcheckError("合成数据报告只能写入 reports/self_test，避免混入真实报告")
        return
    if self_test_dir == output_resolved.parent or self_test_dir in output_resolved.parents:
        raise HealthcheckError("真实数据报告不能写入 self_test 目录")
    if real_dir != output_resolved.parent and real_dir not in output_resolved.parents:
        raise HealthcheckError("真实数据报告只能写入 reports/real")


def default_output(synthetic: bool) -> Path:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S_%f")
    folder = ROOT / "reports" / ("self_test" if synthetic else "real")
    folder.mkdir(parents=True, exist_ok=True)
    return folder / f"数据体检_{stamp}.xlsx"


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


def run_job(source: Path, sheet: str | None, output: Path | None, log_path: Path, stream: io.TextIOBase) -> Path:
    if not source.is_file():
        raise HealthcheckError(f"找不到文件：{source}")
    if source.suffix.lower() not in {".xlsx", ".xlsm"}:
        raise HealthcheckError("目前只读取 .xlsx 或 .xlsm")
    setup_logging(log_path, stream)
    before_hash = sha256_file(source)
    before_mtime = source.stat().st_mtime_ns
    before_size = source.stat().st_size
    LOGGER.info("只读打开 %s", source.name)
    LOGGER.info("读取前 SHA256 %s", before_hash)
    names, synthetic = inspect_workbook(source)
    if not names:
        raise HealthcheckError("工作簿里没有可读取的工作表")
    selected = choose_sheet(names, sheet)
    destination = output or default_output(synthetic)
    ensure_output_path(source, destination, synthetic)
    LOGGER.info("工作表 %s，数据性质 %s", selected, "合成测试" if synthetic else "真实数据")
    LOGGER.info("报告将写入 %s", destination)
    raw = pd.read_excel(source, sheet_name=selected, dtype=object, engine="openpyxl")
    if raw.columns.duplicated().any():
        raise HealthcheckError("存在重复字段名，已停止")
    if raw.empty:
        raise HealthcheckError("所选工作表没有数据行")
    resolved = resolve_columns(list(raw.columns))
    frame = prepare_frame(raw)
    analysis = build_analysis(
        frame,
        resolved,
        data_kind="synthetic" if synthetic else "real",
        source_name=source.name,
        sheet_name=selected,
        sha256=before_hash,
        file_size=before_size,
    )
    mid_hash = sha256_file(source)
    mid_mtime = source.stat().st_mtime_ns
    if mid_hash != before_hash or mid_mtime != before_mtime:
        raise HealthcheckError("源文件在读取期间发生变化，已停止且不写报告")
    for line in analysis.log_lines:
        LOGGER.info("%s", line)
    write_report(analysis, destination)
    after_hash = sha256_file(source)
    after_mtime = source.stat().st_mtime_ns
    if after_hash != before_hash or after_mtime != before_mtime:
        destination.unlink(missing_ok=True)
        raise HealthcheckError("写出报告后源文件哈希或修改时间变化，已删除本次报告")
    LOGGER.info("源文件未修改，SHA256 仍为 %s", after_hash)
    LOGGER.info("报告已写成 %s", destination)
    LOGGER.info("日志文件 %s", log_path)
    return destination


def _cover_map(path: Path) -> dict[str, str]:
    frame = pd.read_excel(path, sheet_name="00_说明", dtype=str)
    return {str(row["项目"]): str(row["内容"]) for _, row in frame.iterrows()}


def _assert_parser() -> None:
    from condition_parser import parse_condition, skeleton

    parsed = parse_condition("(toxicity_score > 10)")
    if parsed.level != "能够解析" or parsed.operator != ">" or parsed.feature != "toxicity_score" or parsed.threshold != "10":
        raise AssertionError("数值比较解析结果不符合预期")
    if parse_condition("(account_level neq guest)").operator != "neq":
        raise AssertionError("neq 被错误切分")
    if parse_condition("(kw notContain hello)").operator != "notContain":
        raise AssertionError("notContain 被 contain 吃掉")
    ambiguous = parse_condition("(score>=10 >= 1)")
    if ambiguous.level != "部分解析" or ambiguous.top_level_ops != 2:
        raise AssertionError("多个顶层运算符应判为部分解析")
    nested = parse_condition("(foo(a>=b) >= 1)")
    if nested.level != "能够解析" or not nested.operator_inside_feature or nested.operator != ">=":
        raise AssertionError("括号内运算符不应被当成顶层切分点")
    if parse_condition(f"({CANARY})").level != "无法解析":
        raise AssertionError("无运算符文本应无法解析")
    if parse_condition("").expr_type != "空条件":
        raise AssertionError("空条件分类错误")
    if parse_condition("(tag subsetp a,b)").threshold != "a,b":
        raise AssertionError("集合关系的名单未被完整保留在解析结果中")
    if CANARY in skeleton(f"({CANARY})"):
        raise AssertionError("骨架未去掉测试令牌")
    if skeleton("(toxicity_score > 10)") != "(id > n)":
        raise AssertionError("数值比较骨架未保留运算符")
    if skeleton("(account_level neq guest)") != "(id neq id)":
        raise AssertionError("等值判断骨架不正确")
    if skeleton("(kw notContain hello)") != "(id notContain id)":
        raise AssertionError("notContain 骨架不正确")


def run_self_test() -> None:
    _assert_parser()
    fixture_dir = ROOT / "fixtures"
    fixture_dir.mkdir(parents=True, exist_ok=True)
    fixture = fixture_dir / "synthetic_rules.xlsx"
    write_workbook(fixture)
    before_hash = sha256_file(fixture)
    before_mtime = fixture.stat().st_mtime_ns

    blocked = ROOT / "reports" / "real" / "synthetic_must_not_land.xlsx"
    blocked.parent.mkdir(parents=True, exist_ok=True)
    log_dir = ROOT / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    try:
        run_job(fixture, DATA_SHEET, blocked, log_dir / "blocked.log", io.StringIO())
    except HealthcheckError:
        pass
    else:
        raise AssertionError("合成数据被允许写入真实报告目录")
    if blocked.exists():
        blocked.unlink()
        raise AssertionError("真实报告目录出现了合成报告")

    try:
        run_job(fixture, DATA_SHEET, fixture, log_dir / "overwrite.log", io.StringIO())
    except HealthcheckError:
        pass
    else:
        raise AssertionError("脚本允许把报告写回原始文件")

    output = ROOT / "reports" / "self_test" / "数据体检_selftest.xlsx"
    log_path = log_dir / "selftest.log"
    buffer = io.StringIO()
    written = run_job(fixture, DATA_SHEET, output, log_path, buffer)
    console_text = buffer.getvalue()
    log_text = log_path.read_text(encoding="utf-8")
    hidden_tokens = [CANARY, "toxicity_score", "device_risk", "account_level", "keyword_list", "hello", "guest"]
    for token in hidden_tokens:
        if token in console_text or token in log_text or xlsx_contains(written, token):
            raise AssertionError("合成测试的控制台、日志或报告含有未脱敏样例")
    if sha256_file(fixture) != before_hash or fixture.stat().st_mtime_ns != before_mtime:
        raise AssertionError("合成源文件被修改")

    cover = _cover_map(written)
    expected = {
        "数据性质": "合成测试",
        "数据行数": "21",
        "规则标识数": "13",
        "能够解析行数": "18",
        "部分解析行数": "1",
        "无法解析行数": "2",
        "疑似列错位行数": "1",
        "完全重复行数": "2",
        "语义冲突的规则标识数": "1",
        "版本差异的规则标识数": "1",
        "范围展开的规则标识数": "2",
    }
    for key, value in expected.items():
        if cover.get(key) != value:
            raise AssertionError(f"说明页 {key} 期望 {value}，实际 {cover.get(key)}")

    detail = pd.read_excel(written, sheet_name="03_规则标识明细", dtype=str)
    reasons = dict(zip(detail["规则标识"], detail["多行原因"]))
    if reasons.get("R_AND") != "同一标识对应多条不同原子条件":
        raise AssertionError("原子条件拆分未被识别")
    if reasons.get("R_SCOPE") != "同一原子条件按投放范围展开":
        raise AssertionError("投放范围展开未被识别")
    if reasons.get("R_BOTH") != "原子条件拆分与投放范围展开同时存在":
        raise AssertionError("拆分与范围展开的叠加未被识别")

    anomalies = pd.read_excel(written, sheet_name="08_异常明细", dtype=str)
    codes = set(anomalies["问题代码"])
    for code in (
        "column_shift",
        "empty_condition",
        "unparsed",
        "partial_multi_op",
        "threshold_missing_in_column",
        "threshold_mismatch",
        "exact_duplicate",
        "operator_inside_feature",
        "overflow_column",
    ):
        if code not in codes:
            raise AssertionError(f"异常明细缺少 {code}")

    samples = pd.read_excel(written, sheet_name="07_解析样例", dtype=str)
    levels = set(samples["解析级别"])
    if levels != {"能够解析", "部分解析", "无法解析"}:
        raise AssertionError("解析样例未同时覆盖三个级别")
    if "干扰" in "".join(pd.ExcelFile(written).sheet_names):
        raise AssertionError("干扰表被写进了报告")
    sys.stdout.write(console_text)
    LOGGER.info("合成测试通过，报告 %s", written)


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="内容安全规则表本地数据体检。只读源文件，不修改原表。")
    parser.add_argument("--file", help="Excel 路径。省略时弹出文件选择框，图形不可用时改为手工输入。")
    parser.add_argument("--sheet", help="工作表名称。只有一个工作表时可以省略。")
    parser.add_argument("--output", help="报告路径。真实数据只能写到 reports/real，合成数据只能写到 reports/self_test。")
    parser.add_argument("--self-test", action="store_true", help="用合成数据测试脚本，不读取真实规则表。")
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
        log_path = ROOT / "logs" / f"healthcheck_{stamp}.log"
        output = Path(args.output).expanduser() if args.output else None
        written = run_job(source, args.sheet, output, log_path, sys.stdout)
        print(f"体检完成，报告：{written}")
        print(f"日志：{log_path}")
        return 0
    except HealthcheckError as exc:
        print(f"体检未完成：{exc}", file=sys.stderr)
        return 2
    except AssertionError as exc:
        print(f"合成测试失败：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
