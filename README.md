# DSH 自制插件合集

面向 DeepSeek Harness 的教学、阅卷与绘图插件。一个仓库维护，五个插件分别安装；无需全部启用。

| 插件 | 功能 | 使用前提 |
| --- | --- | --- |
| [阅卷归档](plugins/dsh-exam-archive) | 从钉钉群归档评分标准，检查收件并准备提醒 | DWS CLI 登录；配置归档目录和群 |
| [AMEQP 辅助阅卷](plugins/dsh-ameqp-grading) | 模型辅助批阅、任务调度、人工复核 | 自有阅卷平台账户、考试与模型；候选版本 |
| [授课进度](plugins/dsh-lesson-tracker) | 按课表记录课程进度、读取 PPT 页码 | 配置个人课表；PPT 自动探测需 Windows + WPS/PowerPoint |
| [三视图工作台](plugins/dsh-sanview-studio) | 二维绘图、尺寸标注、SVG/DXF 与模型三视图 | 绘图应用已内置，无需另行部署 |
| [小题成绩分析](plugins/dsh-score-analysis) | 导入成绩，输出班级与学科分析文件 | Python 3.10+、pandas、openpyxl；PDF 另需 reportlab |

## 安装：推荐使用 Release 安装包

打开 [Releases](https://github.com/JehuYu/dsh-plugins/releases)，下载所需插件的 `.tgz`，在 DSH 对话中说明：

> 请安装我下载的 DSH 插件包，文件路径是……

也可以在已有 DSH CLI 的终端中安装。桌面版使用 `desktop` profile，命令行 Web 版通常使用 `web`：

```powershell
dsh plugin --profile desktop add ./local-dsh-sanview-studio-1.0.0.tgz
```

本仓库根据 DSH `0.2.2-rc.1` 的现用本地插件整理；发布副本经过离线检查，其他宿主版本和外部业务服务需自行验证。只有桌面应用、找不到 `dsh` 命令时，直接在应用内让智能体安装本地 `.tgz`，不需要为了安装插件另装一套 DSH。

安装后根据 DSH 的安装结果提示刷新页面或重启；进入插件说明完成个人配置。各包保留 `@local/...` 包名作为稳定模块标识，`private: true` 仅防止误发 npm，不影响本地目录或 tarball 安装。本项目没有发布到 npm。

## 从源码安装

```powershell
git clone https://github.com/JehuYu/dsh-plugins.git
cd dsh-plugins
dsh plugin --profile desktop add ./plugins/dsh-sanview-studio
```

将最后的目录名替换为所需插件即可。所有插件均附 JavaScript 运行入口，不需要 TypeScript 编译。**不要直接安装仓库根目录或 `github:JehuYu/dsh-plugins`**，根目录只是合集；也不要移动或删除已通过本地链接安装的目录。

## 配置与数据

每个插件的默认挂载层在其目录的 `cordis.patch.yml`。个人设置应写入当前 profile 的覆盖层，例如 `~/.dsh/profiles/desktop/cordis.patch.yml`，按插件 README 中的 `id` 覆盖 `config`。安装命令会维护 bundle 注册，无需手工重复插入插件。

公开版本不包含真实名单、学生成绩、答卷图片、考试种子、群标识、凭据、运行日志或个人目录。需要这些输入的功能由使用者自行配置。自动记录、消息发送与正式写分默认关闭；模型辅助阅卷应保留人工复核。

`@local` 版本与已有同名本地开发插件属于同一模块，安装会替换该模块来源。已有开发环境请先备份个人配置，或用不同 profile 试装。

## 开发与发布

```powershell
node scripts/check.mjs
python scripts/check-python.py
npm run pack
```

`check.mjs` 检查 JavaScript 语法、manifest、静态资源、禁止公开的配置模式及插件加载冒烟；`check-python.py` 仅解析 Python 语法。`pack` 使用 npm pack，为每个插件生成独立 tarball，并生成 `release/SHA256SUMS`。打包后可用 Python 3.12+ 执行 `python scripts/verify-packages.py`，在临时目录验证解压后的包。有独立 pnpm 路径时可用 `node scripts/pack.mjs --pnpm /path/to/pnpm.cjs`，以当前 Node 运行它。

在已安装 pandas 和 openpyxl 的 Python 环境下，可额外执行 `python scripts/smoke-score-analysis.py`，用完全合成的成绩表验证 Excel 输入到分析工作簿的实际流程；不生成 PDF。

创建 `v*` 标签并推送后，[发布工作流](.github/workflows/release.yml) 会校验、打包并在 GitHub Release 附上五个安装包。包内有第三方代码时需保留对应许可证；[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 记录随包资源说明。

## 许可

原创代码采用 [MIT](LICENSE)。成绩分析随附的 xlrd 保留其原始 BSD 许可证。本仓库不附 DSH、WPS、PowerPoint、DWS、第三方账户信息或试题素材。
