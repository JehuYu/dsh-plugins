# WorkBuddy 签到面板

为已有 WorkBuddy-Daily 脚本提供 DSH 侧栏入口：查看日志摘要、连签天数、积分和 Windows 计划任务，手动执行签到，或调用外部脚本添加账号。本包仅提供面板和宿主适配，**不是独立签到客户端**。

## 安装

从本仓库 Release 下载 `local-dsh-wb-signin-1.0.0.tgz` 后让 DSH 安装，或使用已有 CLI：

```powershell
dsh plugin --profile desktop add ./local-dsh-wb-signin-1.0.0.tgz
```

也可从源码安装 `./plugins/dsh-wb-signin`。

## 外部脚本要求

自行准备兼容的 WorkBuddy-Daily 目录；本仓库不附第三方脚本或任何账号凭据。面板分别使用：

- `signin.log`：包含 `===== 日期 args: =====` 批次标记与 `[时间][账号N]` 日志。
- `run-signin.cmd`：Windows 下手动签到入口。
- `workbuddy_login.py`：提供 `send_sms(phone)`、`login(phone, code)`。
- `workbuddy_intl_login.py`：提供 `start_login()`、`poll_token(state, timeout)`、`fetch_account(state, token)`、`_uid_of(state)`。
- 本机 Python 及上述外部脚本要求的 Python 依赖。

令牌库 `wb_refresh_tokens.json`、`wb_intl_tokens.json` 只在用户本机读写；不要提交到公开仓库。安装面板本身不会新增 Windows 计划任务，也不会自动执行签到。国际版授权和短信登录会通过外部脚本联网。

## 配置

默认脚本根目录为环境变量 `WORKBUDDY_DAILY_ROOT`，未设置时为用户主目录下的 `WorkBuddy-Daily`。也可在个人 profile 的覆盖层设置：

```yaml
- id: wb-signin
  config:
    root: '/path/to/WorkBuddy-Daily'
    mainTask: WorkBuddyDailySignin
    pollTask: WorkBuddyGrowthPoll
    runCommand: ''
```

`runCommand` 留空表示使用根目录的 `run-signin.cmd`。Windows 路径可使用单引号和正斜杠。缺少外部脚本时，面板会显示日志/任务缺失，运行或登录按钮将返回错误；仅安装插件不能补齐这些依赖。Windows 任务和命令功能在其他系统不可用。

本插件的日志查看接口会向当前 DSH 用户展示外部脚本的日志内容；应在外部脚本中对敏感信息打码，并谨慎共享 DSH 访问权限。
