# 成绩分析

DSH 可选插件：上传 `.xls`、`.xlsx` 或成绩报表 ZIP，生成小题分析工作簿，导入教学班映射后可导出成绩单 PDF 压缩包，并将考试保存为可复用项目。公开版不带学生名册、实际成绩、学校或教学班映射数据。

## 安装与依赖

需要 Node.js 22.15.0 或更新版本（ZIP/XLSX 使用 `node:zlib` 的 `crc32`；CI 使用 Node.js 24）、Python 3.10 或更新版本，以及提供客户端模块加载器、React 和 `@deepseek-ai/dsh-client-ui-slots` 的 DSH。JavaScript 没有额外 npm 运行依赖，不需要编译前端或单独启动 Web 服务。

Python 环境需要 `pandas`、`openpyxl`；生成成绩单 PDF 还需要 `reportlab`。在自己选择的 Python 环境中安装：

```sh
python -m pip install pandas openpyxl reportlab
```

读取旧版 `.xls` 的 `xlrd 2.0.2` 已随插件提供。核心分析代码直接位于 `python/`，无需安装原始成绩分析站点项目，也不需要该项目的数据库或 Node.js 服务。上述 Python 包在本目录没有版本锁定；部署时应记录所选版本并验证合成数据。

1. 克隆本仓库，在 DSH 插件管理器中选择 `plugins/dsh-score-analysis` 安装 bundle。
2. 检查安装结果，需要重启时按提示重启并刷新现有 DSH 页面。
3. 在侧栏打开“成绩分析”，上传自己有权处理的数据。先使用合成数据验证列结构与输出。
4. 按需要导入教学班映射，再生成 PDF。公开版不设置个人教学班映射文件默认值。

## 配置

在 `cordis.patch.yml` 中设置：

```yaml
config:
  pythonPath: '' # 填自己的 Python 可执行文件；留空使用环境变量或 PATH
  timeoutMs: 240000
  mappingFile: '' # 可选：自己的教学班映射表
  classes: [] # 可选：[{ name, students: [{ name, homeClass }] }]
```

Host 通过 stdio 调用 `python/run_analysis.py`。中文 PDF 使用系统可用的中文字体，源码列出的 Windows/macOS/Linux 字体目录是通用探测位置；插件不分发微软或苹果字体。可使用有相应许可的 Noto CJK 系统字体。

## 数据位置

工作目录为 `<DSH_HOME>/score-analysis`。项目索引、上传文件、映射表、分析工作簿和成绩单属于业务数据，不应提交源码仓库或公开打包。公开文件名与字段名保留格式说明；测试中的示例姓名是虚构夹具。未知错误、Python traceback 和运行诊断也可能涉及输入名称或本机路径，分享前需要检查。

## 验证

```sh
npm run check
npm test
```

Node 测试使用内置测试器、React shim 和合成结果，覆盖客户端协议、结果显示、ZIP 挑选、映射表写入和教学建议；不读取本机历史业务结果。仓库根目录另有 `python scripts/smoke-score-analysis.py`，已用四名虚构学生的 Excel 验证实际 Python CLI 能生成包含七张工作表的分析文件。PDF 与自定义映射的 Python 端到端流程仍需在自己的环境验证。

没有 JavaScript 构建步骤；客户端必须保持普通脚本形式。Python 语法可以使用 `ast.parse` 只读检查，避免把 `__pycache__` 加入发布包。

## 第三方许可

内置 `xlrd 2.0.2` 的版本记录位于 `python/vendor_xlrd/xlrd/info.py`。完整上游许可证保存在 `python/vendor_xlrd/LICENSE`，取自：

https://raw.githubusercontent.com/python-excel/xlrd/2.0.2/LICENSE

该许可证同时包含 Stephen John Machin / Lingfo Pty Ltd 的 BSD 条款与 David Giffin 早期实现的条款。须保留全部版权、条件、免责声明和致谢；涉及相应特性或使用的宣传材料也须按原文保留要求的致谢：

This product includes software developed by David Giffin <david@giffin.org>.

`pandas`、`openpyxl` 和 `reportlab` 是环境安装依赖，应遵守各自所安装版本的许可证；插件不将这些包或系统字体复制进发布包。本仓库维护的分析核心按根目录 MIT 许可分发；xlrd 继续适用上述完整原始条款。
