# 策略资产画像与配置诊断

只读分析。它不修改原始 Excel，也不改线上规则。

仓库里现有的是第一阶段体检和条件解析，没有单独的第二阶段结构化文件。本工具在运行时复用 `tools/rule_healthcheck/condition_parser.py` 生成分析层：原始行、父行组、规则标识、原子条件、投放实例分开保留。部分解析和字段不一致只标记，不自动改正。

业务字段的空单元格记为“未配置”，原始空值仍保留。规则标识、序号、条件解析结果不用这个词。

## 安装

```bash
python3 -m pip install -r tools/rule_healthcheck/requirements.txt
```

## 合成测试

```bash
python3 tools/rule_diagnosis/diagnosis.py --self-test
```

通过时输出 `SELF_TEST_OK`。合成报告在 `tools/rule_diagnosis/reports/self_test/`，不会写入 `reports/real/`。

## 真实规则表

```bash
python3 tools/rule_diagnosis/diagnosis.py \
  --file "/绝对路径/规则表.xlsx" \
  --sheet "Sheet1"
```

省略 `--file` 时使用文件选择框；图形界面不可用时改为输入路径。多个工作表必须用 `--sheet` 指定。

每次运行新建带时间戳的目录，里面有：

- `策略诊断.xlsx`
- `策略诊断摘要.md`
- 日志在 `tools/rule_diagnosis/logs/`

相似度权重写在 `similarity_weights.json`，并复制到报告的“口径与限制说明”。
