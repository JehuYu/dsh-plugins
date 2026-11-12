# AMEQP 阅卷工作台

DSH 可选插件：连接用户自己的 AMEQP 阅卷站点，维护评分标准，使用 DSH 模型或兼容 Chat Completions 的视觉模型逐份试评，并支持多账号任务管理。

公开版本不附带考试题干、参考答案、学生答卷、参考成绩、账号或 API Key。原始开发项目与生产数据目录不是安装依赖。

## 安装与运行

需要 Node.js 20 或更新版本，以及提供 `llm`、`attachments` 和 `@deepseek-ai/dsh-client-ui-slots` 的 DSH。客户端由 DSH 提供 React 和模块加载器，不需要单独编译前端或启动服务。

1. 克隆本仓库，在 DSH 插件管理器中选择本目录 `plugins/dsh-ameqp-grading` 安装 bundle。
2. 检查安装结果；需要重启时按提示重启，刷新现有 DSH 页面。
3. 在工作台填写自己的站点地址和有权限的阅卷账号，选择账号可见的考试、科目和题目。
4. 配置本题满分、评分项、规则和模型；自行上传有权使用的题干图与参考图。空配置不能直接用于评分。

`cordis.patch.yml` 的默认站点 `https://example.invalid/AMEQP/` 是不可用的占位地址。默认没有考试/科目编号，`productionMarking: false`。按实际站点修改配置；只有在明确需要正式领卷、写分与取消领卷时才开启 `productionMarking`。

```yaml
config:
  ameqpBase: 'https://example.invalid/AMEQP/' # 替换为自己的站点
  examId: null
  subjectId: null
  productionMarking: false
  maxConcurrentModels: 2
  providerConcurrency: {}
```

Decisions 自图试评是可选功能，固定调用 `https://decisions-api.dev/v1/systemone`。在已载入题目配置的页面上传有权使用的作答图，输入本次页面使用的 Key，或由运行 DSH 的进程提供 `DECISIONS_API_KEY`。试评可能计费；第三方会接收评分规则与图片。公开版内置样本入口已停用。

## 数据与凭据

Host 状态位于 `<DSH_HOME>/ameqp-grading`，包括账号注册表、规则、任务日志、缓存、图片与结果。该目录不属于源码分发范围。模型 Key 不写入 Host 模型设置；登录信息沿用现有浏览器 localStorage 行为，模型草稿可包含用户输入的配置。共享浏览器或导出浏览器存储前须先清除账号凭据和草稿。不要公开运行数据、浏览器存储、日志或备份。

## 开发与验证

这是直接加载的 JavaScript 插件，没有构建步骤。CI 的 Host 离线回归使用 Node 内置测试器与合成图片，不需要安装 npm 开发依赖：

```sh
node --check index.js
node --check client.js
npm test
```

额外的客户端开发测试使用 `react@18` 与 `react-test-renderer@18`：先运行 `npm install --ignore-scripts --package-lock=false`，再运行 `npm run test:client`。公开版已验证 Host 229 项与客户端 49 项，全部通过。客户端覆盖未连接时的无样本提示、自传合成图片、临时 Key、图像角色和大小限制、重复请求与迟到回执，以及账号切换和任务控制。测试不含真实试卷素材，不访问实际模型或阅卷站点；离线检查不验证真实 AMEQP 接口权限、模型质量或在线提交。

## 第三方来源与发布限制

React、react-test-renderer 及其 npm 依赖为 MIT 授权，仅用于本地测试；运行中的 React 由 DSH 提供。AMEQP 是外部业务系统，使用者需要站点授权。

公开版移除了来源/许可不明的旧 JavaScript DES 实现，使用 `login-cipher.js` 调用 Node 内置 `crypto` 实现登录协议。已对原算法运行 153 项合成输入兼容对照，覆盖 ASCII、中文、代理对、NUL、明文分组和 ASCII 参数长度边界；另保留可移植的固定向量回归。此协议兼容验证不代表实际站点登录已验证。Node/OpenSSL 的许可随用户所安装的运行时分发；本包不复制其源码或二进制。
