# 授课进度

DSH 本地 JavaScript 插件：按用户配置的作息与课程显示当前课、记录授课进度，可导入 XLSX 和导出 CSV。首次安装教师、科目、班级、课代表、课表及导入路径均为空，自动记录关闭；不会自动探测 PPT 或写入课程记录。

## 安装与配置

通过 DSH 插件管理器安装 tarball。包名保持 `@local/dsh-lesson-tracker`，`private: true` 表示不向 npm 注册表发布。

在自己的 DSH 插件配置中填写下列参数，示例完全虚构，不随首次安装自动启用：

```yaml
teacher: '示例教师'
subject: '示例课程'
autoRecord: false
importPath: ''
periods:
  1: ['09:00', '09:40']
classes:
  - name: '示例班'
    leader: ''
courses:
  - d: 1
    period: 1
    className: '示例班'
endGraceSec: 90
```

`d` 为周日 0 至周六 6；`period` 对应 periods 的键；时间使用本机时区的 24 小时 HH:mm，结束必须晚于开始。班级必须存在于 classes。配置后重新加载插件；确认课表无误，再启用 `autoRecord`。自动记录会在下课后等待 endGraceSec 秒落盘。关闭自动记录会停止自动 PPT 探测和跟踪；手动刷新可以主动探测。课表以当前插件配置为准，每次重新加载生效；已有本机记录和开关会保留，autoRecord 配置用于首次初始化。要重新初始化运行记录请先备份自己的数据。

## 导入与导出

可选择上传自己的 `.xlsx`，或填写 `importPath` 后使用路径导入。路径仅保存在本机配置，不应公开分发。读取第一张工作表：首行为日期标题；包含“班级”列（缺省第二列）；班级前一列为课代表；后续日期列如 `0903周四` 或 `9.3周四`，使用导入时的当前年份。跨年历史数据需自行核对年份，当前不支持可靠导入完整 ISO 日期标题。每格可写 `P12-示例课题`；导出为 UTF-8 BOM CSV。导入功能不需要安装 Office，XLSX 读取使用随包的零依赖解析器。不要随包附真实学生名单、个人课表或历史进度。

## 运行依赖与数据

需要支持 Client UI slots 与 webServer 的 DSH，以及 Node.js 20+；React 由宿主提供。PPT 页码检测仅支持 Windows：需要系统 `powershell.exe` 和已经安装、打开演示文稿的 WPS 演示或 Microsoft PowerPoint，并支持对应 COM 接口。其他平台可用手动记录与导入/导出。插件不分发这些第三方软件。

探测脚本内嵌于源码，运行时生成，无需外部 `.ps1` 文件。数据保存于 `DSH_HOME/lesson-tracker`；未设 DSH_HOME 时为用户主目录下 `.dsh/lesson-tracker`，包括记录、教师、PPT 名称和完整本机路径。运行数据、探测输出和个人文件不得放入公开包。

## 随包与检查

运行文件包括 `package.json`、`index.js`、`client.js`、`xlsx.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg` 和本说明。不存在额外个人 Excel 或脚本依赖。

使用 `node --check index.js`、`node --check client.js`、`node --check xlsx.js` 验证语法。Client 必须保持 DSH ModuleLoader 普通脚本格式。代码/图标来源与许可见仓库发布说明；第三方软件与个人输入资料不因此获得再分发授权。
