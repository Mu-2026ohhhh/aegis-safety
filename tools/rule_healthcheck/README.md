# 规则表数据体检

本地只读脚本。它检查 Excel 的字段、空值、重复行、规则标识多行分布，以及规则条件能不能解析。

脚本不会修改、覆盖或上传原始文件。报告写在本目录的 `reports/` 下。条件原文、特征名、阈值和描述不会进入控制台、日志和报告，样例只保留运算符骨架。

当前环境已可运行：Python 3.12，并已安装 `pandas` 与 `openpyxl`。

## 安装

在项目根目录执行：

```bash
python3 -m pip install -r tools/rule_healthcheck/requirements.txt
```

## 合成数据自测

不读取真实规则表：

```bash
python3 tools/rule_healthcheck/rule_healthcheck.py --self-test
```

通过时最后一行是 `SELF_TEST_OK`。合成报告在 `tools/rule_healthcheck/reports/self_test/`，日志在 `tools/rule_healthcheck/logs/selftest.log`。

## 体检真实文件

只有一个工作表时可以不写 `--sheet`。多个工作表时必须指定，避免读错表。

```bash
python3 tools/rule_healthcheck/rule_healthcheck.py \
  --file "/绝对路径/规则表.xlsx" \
  --sheet "Sheet1"
```

省略 `--file` 时会打开系统文件选择框；图形界面不可用时，改为在终端输入路径。

真实报告写到 `tools/rule_healthcheck/reports/real/`。合成工作簿带有内部标记，不能把合成报告写进该目录。

## 日志

每次真实体检会新建 `tools/rule_healthcheck/logs/healthcheck_时间戳.log`。日志只记录行数、字段数、解析级别和输出路径。
