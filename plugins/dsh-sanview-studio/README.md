# 三视图工作台

DSH 侧栏内的二维绘图与尺寸标注工具，支持 SVG/DXF 导入导出，以及从三维模型生成视图。发布包自带 `embed/` 绘图应用，默认不依赖其他项目目录。

## 安装

从本仓库 Release 下载 `local-dsh-sanview-studio-1.0.0.tgz` 后，让 DSH 智能体安装，或使用已有 CLI：

```powershell
dsh plugin --profile desktop add ./local-dsh-sanview-studio-1.0.0.tgz
```

从仓库源码也可运行 `dsh plugin --profile desktop add ./plugins/dsh-sanview-studio`。刷新 DSH 后打开侧栏「三视图」。

## 配置

默认直接使用内置绘图应用。如需使用自己开发的静态资源，在个人 profile 的覆盖层写入：

```yaml
- id: sanview-studio
  config:
    distPath: '/path/to/your/dist'
    basePath: '/sanview-studio'
```

侧栏页面使用默认 `/sanview-studio/` 地址；若修改路由前缀，也需相应调整客户端地址。图纸通过浏览器本地存储保存，清理站点数据前请导出备份。系统字体用于公开版本，无须下载字体。

## 验证

仓库根目录运行 `node scripts/check.mjs`，会验证主页面、主题注入与所有页面引用的脚本和样式可被插件 HTTP 路由读取。
