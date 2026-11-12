# 阅卷归档提醒

DSH 的本地 JavaScript 插件：扫描用户选择的阅卷目录，显示评分标准收件情况，从用户配置的钉钉群归档文件，并手动预演提醒。首次安装路径与群名为空，不访问群、不发送消息。

## 安装与配置

通过 DSH 插件管理器安装发布的 tarball。包名保持 `@local/dsh-exam-archive`，`private: true` 表示不通过 npm 注册表发布，不影响 tarball 分发。

在自己的 DSH 插件配置中填写 `archiveRoot`（考试目录根路径）、`rosterDir`（组长表目录）、`groupName`（钉钉群名）。路径可以是本机绝对路径或当前用户可访问的共享盘。分发包不含个人路径、账号、群标识或真实名单。

`sendReminders` 默认 `false`，只记录预演；设为 `true` 后点击提醒按钮会通过 DWS 向匹配姓名发送私信。发送使用本机 DWS 当前登录账号；先核对该账号、收件人及文案。没有单独的 profile/groupId 选择参数。`pollSec` 是兼容字段，目前无自动轮询或按考试时间自动提醒；开始/结束时间由面板填写，提醒由按钮触发。

## 输入格式

考试目录名须含 8 位日期，例如 `20300101高一期末考`。其下使用年级目录（高一/高二/高三），再下设科目目录（语文、数学、英语等）。技术目录按信息/通用识别子单元。评分文件使用 `.xlsx` 或 `.xls` 扩展名；文件名含年级、科目，以及“主观/划分要求”或“客观/答案及分值”。这里只按名称扫描评分文件，不解析旧版 `.xls` 内容。

组长表必须为 `.xlsx`，文件名以 `组长.xlsx` 结束，自动选修改时间最新的一份。工作表名须能识别年级，标题行包含“科目”和“姓名/组长/备课组长”。每行对应科目和组长姓名。请自行提供合法取得的名单，不要将真实名单附入公开包。

## 运行依赖与数据

需要支持 Client UI slots 和 webServer 的 DSH，以及 Node.js 20+。浏览器端 React 由 DSH 提供。调用钉钉需要另行安装并登录 `dingtalk-workspace-cli`，确保 `dws` 在 PATH；也可通过 `dwsCommand` 配置可执行入口。Windows 下优先探测当前用户 npm 全局安装目录中的 CLI；桌面版此分支还需要 PATH 上的独立 `node`。共享盘须由当前用户取得读写权限。

数据写入 `DSH_HOME/exam-archive`，未设置 DSH_HOME 时使用用户主目录下 `.dsh/exam-archive`，含考试时间、提醒记录和 staging 下载文件。不要把运行数据、登录资料、真实试卷/名单随发布包分发。插件不附 DWS、DSH、React 或其他软件安装文件。

## 随包与验证

运行文件：`package.json`、`index.js`、`client.js`、`xlsx.js`、`cordis.patch.yml`、`locale/*.json`、`icon.svg` 及本说明。`tests/*.test.mjs` 为离线测试，使用临时虚构数据，不调用真实钉钉；不包含备份脚本。

运行 `node --check index.js`、`node --check client.js`、`node --check xlsx.js` 和 `node --test tests/*.test.mjs`。Client 是 DSH ModuleLoader 普通脚本，不要改成顶层 ESM import/export。

代码和图标来源及许可请以仓库发布说明为准；本说明不授予第三方软件或用户输入资料的再分发权。
