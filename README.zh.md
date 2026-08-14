# dsh-custom-plugin

[English](README.md) | 中文

DeepSeek Harness（DSH）Web GUI 的 Custom 便利套件：个性化外观、天气特效、液态玻璃、按用户消息的时间线导航、项目文件夹、提示词库、会话导出、Mermaid 渲染、引用回复，以及 DeepSeek 额度与今日 token 用量。插件以双半区形态（Host 状态 + 浏览器 UI）经官方 profile 机制挂载，浏览器半区直连 Host 的 `/api/custom-plugin` 路由（同源 fetch），不改 DSH 源码。

## 功能

### 外观个性化

- **背景颜色**：20 组低饱和典雅色（每组合配 tab 栏色），另有「无颜色」（默认主题）与高饱和「极光」渐变。深色模式下仅「无颜色」与「极光」可选，其余颜色禁用，插件文字自动转白保证可读性。
- **天气特效**：一键切换——飘雪、电影感雨滴（三层景深 + 地面溅起）、樱花飘落（画布渲染，不挡交互）。
- **玻璃效果**：所有 Custom 面板默认毛玻璃；可切换液态玻璃（Chromium 位移折射，无色散、轻微背景模糊；Safari/Firefox 自动回退毛玻璃）。「全局浮层玻璃」可对弹窗/菜单/提示框/下拉框统一加模糊。

### 时间线导航

每条用户消息在右侧（或左侧）轨道生成节点：悬停弹出预览、点击跳转到对应消息、拖动滑块滚动。节点支持星标（可只显示星标）、在该消息处创建分支会话、一键复制全文；预览内直接显示 LaTeX / MathML / Mermaid 标记。

### 项目文件夹

多级文件夹树，保存在用户主目录，跨工作区共享。任意工作区与会话都可收纳进文件夹；支持拖拽排序（插入前 / 内部 / 插入后）、重命名、删除与「添加当前会话」快捷操作。

### 提示词库

提示词支持新增 / 复制 / 删除 / 搜索；会话顶部的「提示词」按钮一键把提示词插入输入框。

### 会话导出

导出当前会话为 JSON（标准 messages 结构，可导入其他工具）、Markdown 或含图片的 PDF 版（打开 HTML 打印另存为 PDF）。

### Mermaid

消息中出现 ```mermaid 代码块时，消息下方显示渲染按钮：模态窗口内用 Host 拉取的 Mermaid 引擎渲染图表，并附 mermaid.live 兜底链接；Mermaid 页可预加载引擎。

### 效率工具

- **引用回复**：选中对话文本后出现「引用回复」按钮，以引用块形式插入输入框。
- **防自动跳转**：强制 `scroll-behavior: auto`，发送消息不再把视图拽到底部。
- **公式复制**：含公式的消息下方显示 LaTeX / MathML 复制按钮（MathML 可直接粘贴进 Word）。
- **批量归档**：勾选多个会话批量归档（日志仍保留在存储中）。

### 额度与用量

会话头部（会话日志按钮旁）常驻额度徽标：通过官方余额接口查询 DeepSeek 余额（Key 在额度面板粘贴，仅存本机状态文件，也可自动探测环境变量），附今日按模型统计的 token 用量表、费用估算与「扫描今日会话日志」刷新。

### 设置入口

「设置 > 个性化」页提供外观与工具开关的整页配置（背景、天气、玻璃、时间线、功能开关、Mermaid 引擎预加载）；会话头部与左侧底部的「个性化」按钮打开同一套面板。

### 智能体集成

`custom_plugin_status` 工具可查看外观配置、今日用量、余额、时间线样本、Mermaid 引擎状态与客户端诊断。

## 安装

本插件是独立插件，不经插件市场或社区插件注册，直接以本地链接装入 DSH profile：

```sh
# 构建（本仓库根目录执行，需要 Node 22+ 与 pnpm）
pnpm install
pnpm build
# 装入 web profile。链接路径不能含空格：Windows 上若源码路径含空格，
# 先创建无空格目录联接（如 F:\dsh-plugin-dev），再链接到联接路径
dsh plugin --profile web add link:F:/dsh-plugin-dev
# 重启 dsh web
```

`dsh plugin add` 会写入 profile 依赖并把包自动加入 `dsh.profile.bundles`（行 id `custom-plugin`）；浏览器半区经官方客户端模块系统按同一行加载。

## 配置

插件读取 `$DSH_HOME/custom-plugin-state.json` 单个 JSON 文档（外观配置、文件夹、提示词、星标、API Key、用量账本）。

## 安全模型

浏览器仅通过回环地址的 `/api/custom-plugin` 路由与 Host 通信（同源围栏校验）；DeepSeek API Key 只保存在本机状态文件（用户主目录，不写入浏览器日志），仅用于调用 `https://api.deepseek.com/user/balance`。会话导出与时间线数据全部停留在本机。

## 已知限制

- Mermaid 首次渲染需要能访问 CDN（Host 在进程生命周期内缓存引擎）。
- 用量账本折叠自实时 `session/event` 记录；错过实时事件时可手动「扫描」重读今日会话日志。
- 费用按 DeepSeek 官方单价 × 汇率 7.25 估算，仅供参考。
- 深色模式下背景限制是刻意设计：仅「无颜色」与「极光」可选。

## 许可证

Apache-2.0。部分代码参考 [Nagi-ovo/voyager](https://github.com/Nagi-ovo/voyager) 与 [unovue/inspira-ui](https://github.com/unovue/inspira-ui)。
