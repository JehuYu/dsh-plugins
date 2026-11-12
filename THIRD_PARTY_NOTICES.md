# 第三方与资源说明

- 本仓库原创插件代码与几何图标按根目录 MIT 许可证分发。
- `plugins/dsh-score-analysis/python/vendor_xlrd/xlrd/` 为 xlrd 源码，遵循其原始 BSD 许可证；许可证随对应目录及独立安装包保留。
- 三视图绘图应用作为本插件资源放在 `plugins/dsh-sanview-studio/embed/`。公开分发使用系统字体，未附本机项目中原有的字体二进制。
- DSH 宿主和 React 由用户现有 DSH 安装提供，本仓库不打包宿主安装文件。其他 Node 模块使用 Node 内建接口；开发测试依赖按包内说明安装。
- pandas、openpyxl、reportlab、DWS CLI、WPS/PowerPoint、WorkBuddy-Daily 与远程阅卷平台为外部运行依赖，不随本仓库重新分发。各自名称与商标属于各自权利人。
- xlrd 原始许可证同时涵盖 Stephen John Machin / Lingfo Pty Ltd 的条款和 David Giffin 早期实现的条款。完整条款见随包 LICENSE，并保留以下致谢：This product includes software developed by David Giffin <david@giffin.org>.
- 原本本地阅卷插件包含的真实试题、参考答案、答卷图像与采样评分均不在公开分发范围内。用户应自行提供拥有使用权限的输入。
