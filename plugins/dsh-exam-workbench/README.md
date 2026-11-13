# 统一阅卷工作台

DSH 插件，将多账号 AI 阅卷、评分配置、人工复核及恢复、评分标准归档与收件提醒放在同一个工作台。公开包不含真实试卷、答卷、标准、分数或样本，需自行配置题目和有权使用的材料。正式领卷、提交与取消默认关闭；提醒默认仅预演。

## 安装和切换

独立安装本包 tarball（包名 `@local/dsh-exam-workbench`，`private: true` 不妨碍 tarball 安装）。需要 Node.js 20+ 和提供 client UI slots、locale、webServer 的 DSH。**不要与 `@local/dsh-ameqp-grading` 或 `@local/dsh-exam-archive` 同时启用**：它们共用 API 路由和数据目录。切换前停止旧插件并备份 `DSH_HOME/ameqp-grading`、`DSH_HOME/exam-archive`；未设置 DSH_HOME 时位于用户主目录 `.dsh` 下。配置现在嵌套在 `grading` 和 `archive` 中，旧配置不会自动迁移；检查后再启用。

在插件配置的 `grading` 中填写自己的 `ameqpBase`、考试和科目 ID；默认地址为不可用占位地址，考试和科目默认未配置。`productionMarking` 仅在核对权限与后果后显式启用才允许正式领卷、写分及取消。AI 服务的密钥由用户自行提供；试验密钥不写入配置或草稿。

在 `archive` 中填写 `archiveRoot`、`rosterDir`、`groupName`；默认均为空。归档和钉钉操作需要另行安装并登录 `dingtalk-workspace-cli`，默认运行 `dws`，可配置 `dwsCommand`。Windows 全局 CLI 检测分支需要 PATH 上的独立 Node。`sendReminders: false` 只预演；设为 true 后手动触发会通过当前 DWS 账号向匹配人员发送私信。`pollSec` 为兼容字段，目前没有自动轮询。

考试目录以八位日期开头，其下为年级、科目目录；评分文件名需标识年级、科目和主观或客观。组长表为文件名以 `组长.xlsx` 结尾的 XLSX，工作表名包含年级，表头包含科目和姓名或组长。归档按文件名识别文件，不解析旧版 XLS 内容。

## 数据与访问

阅卷状态、恢复记录、题目配置和账号信息保存在 `DSH_HOME/ameqp-grading`，归档状态、提醒记录和下载暂存保存在 `DSH_HOME/exam-archive`。浏览器本地存储会保存站点用户名和密码；共用浏览器或设备时请注意，清除站点存储后需重新登录。登录过程向站点发送密码；使用 HTTP 将使传输缺少加密，应使用可信 HTTPS 站点。工作台 API 和归档状态可向能访问宿主服务的使用者暴露配置、群信息、名单和业务数据，请自行限制宿主访问，不应假设插件额外提供认证。

下载文件会在 staging 留存，归档可能覆盖目标位置的同名文件；定期按本地数据管理要求清理并备份。恢复记录损坏时插件阻止新任务，需在原系统核对占卷和提交结果并修复记录。不要将运行数据、凭据或真实材料放进公开包。

## 开发与验证

`client.js` 由 `grading-client.js`、`archive-view.js` 和 `workbench-shell.js` 使用 `npm run build` 生成；修改这些源文件后重新构建。运行 `npm run check` 和 `npm test`；测试使用合成数据和模拟服务，客户端测试需要开发依赖 React 与 react-test-renderer。插件不附带依赖安装目录。Node crypto 实现登录协议的 DES 兼容格式，不包含原无许可的 DES 代码。项目代码按 MIT 许可发布；第三方软件及用户资料各自适用其许可。
