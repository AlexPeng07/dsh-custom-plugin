# dsh-custom-plugin

[![npm version](https://img.shields.io/npm/v/%40alexpeng%2Fdsh-custom-plugin?style=flat-square)](https://www.npmjs.com/package/@alexpeng/dsh-custom-plugin)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue?style=flat-square)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D22-339933?style=flat-square)](#安装)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![CI](https://github.com/AlexPeng07/dsh-custom-plugin/actions/workflows/ci.yml/badge.svg)](https://github.com/AlexPeng07/dsh-custom-plugin/actions/workflows/ci.yml)

[English](README.md) | 中文

DeepSeek Harness（DSH）Web GUI 的 Custom 便利套件：个性化外观、天气特效、玻璃效果、按用户消息的时间线导航、项目文件夹、提示词库、会话导出、Mermaid 渲染、引用回复，以及 DeepSeek 额度与今日 token 用量。

插件为双半区架构：宿主半区（`src/`）持有状态文档、注册 `/api/custom-plugin` 路由与 `custom_plugin_status` 智能体工具；浏览器半区（`src/client/`）通过 7 个官方 slot 的 8 处注入挂载 UI，以同源 fetch 与宿主通信。经官方 profile 机制挂载，不改 DSH 源码。

## 部分界面展示

<table>
<tr>
<td width="50%" valign="top"><b>「设置 → 个性化」整页外观配置</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/settings-appearance.png" alt="设置 → 个性化 整页外观配置" width="100%"></td>
<td width="50%" valign="top"><b>会话头部弹出的同一套面板（浅色主题）</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/personalization-panel.png" alt="个性化弹窗面板" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top"><b>液态玻璃（Custom 面板位移折射）</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/liquid-glass.png" alt="液态玻璃" width="100%"></td>
<td width="50%" valign="top"><b>时间线轨道与悬停预览</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/timeline.png" alt="时间线轨道" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><b>余额与今日分模型用量</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/balance-usage.png" alt="余额与用量面板" width="100%"></td>
<td width="50%" valign="top" align="center"><b>雨（三层景深）</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/weather-rain.gif" alt="下雨特效" width="100%"></td>
</tr>
<tr>
<td width="50%" valign="top" align="center"><b>樱花</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/weather-sakura.gif" alt="樱花特效" width="100%"></td>
<td width="50%" valign="top" align="center"><b>飘雪</b><br><img src="https://github.com/AlexPeng07/dsh-custom-plugin/raw/main/docs/weather-snow.gif" alt="飘雪特效" width="100%"></td>
</tr>
</table>

天气特效截自深色模式（深色下仅「无颜色」与「极光」背景可选）。

## 功能

### 外观个性化

- **背景颜色**：20 组低饱和典雅色（每组合配 tab 栏色，默认「天青灰」），另有「无颜色」（跟随 GUI 默认主题）与高饱和「极光」渐变。深色模式下仅「无颜色」与「极光」可选，其余颜色禁用，插件文字自动转白保证可读性。
- **天气特效**：画布渲染、不挡交互，一键切换——飘雪、电影感雨滴（三层景深 + 地面溅起）、樱花飘落；关闭时自动清空画布。
- **玻璃效果**：所有 Custom 面板默认毛玻璃；可切换液态玻璃（Chromium 位移折射，无色散、轻微背景模糊；Safari/Firefox 自动回退毛玻璃）。「全局浮层玻璃」对弹窗、菜单、提示框、下拉框统一加模糊。

### 时间线导航

每条用户消息在右侧（或左侧）轨道生成一个节点：

- 悬停弹出预览卡（自动防溢出定位），卡内直接显示 LaTeX / MathML / Mermaid 标记；
- 点击跳转到对应消息（直接驱动聊天滚动容器，消息位于嵌套滚动区时也能居中）；
- 拖动滑块或在轨道上滚轮滚动（轨道替代原生滚动条）；
- 节点支持星标（可只显示星标）、在该消息处创建分支会话、一键复制全文。

节点按渲染出的用户消息行定位（DOM 行 sourcing），加载历史后自动刷新；轨道尾部最多保留 400 个节点。

### 项目文件夹

多级文件夹树，保存在 `$DSH_HOME` 状态文件中，跨工作区共享。任意工作区与会话都可收纳进文件夹；支持拖拽排序（插入前 / 内部 / 插入后）、重命名、删除与「添加当前会话」。

### 提示词库

提示词支持新增 / 复制 / 删除 / 搜索；会话顶部的「提示词」按钮一键把提示词插入输入框。

### 会话导出

导出当前会话为三种格式（文件名带日期戳）：

- **JSON**：标准 `messages` 结构（user / assistant / tool），meta 携带会话标题、创建时间、工作目录与导出时间，可导入其他工具；
- **Markdown**：按角色分块的纯文本；
- **PDF**：A4 打印版式 HTML，浏览器打开后打印另存为 PDF；图片以 base64 内嵌（最多 30 张、总量 12 MB、单张 ≤ 4 MB）。

工具调用行携带工具名与参数摘要（从配对的 tool/call 事件解析）。

### Mermaid 渲染

消息中出现 ```mermaid 代码块时，下方显示渲染按钮：模态窗口内用宿主拉取的 Mermaid 11 引擎渲染（jsdelivr / fastly / unpkg 三镜像回退，引擎在宿主进程内缓存，可在 Mermaid 页预加载）；另附 mermaid.live 兜底链接（DEFLATE 压缩的 `#pako:` 格式，打开即还原图表）。

### 效率工具

- **引用回复**：选中对话文本后出现「引用回复」按钮，以引用块插入输入框；
- **防自动跳转**：强制 `scroll-behavior: auto`，发送消息不再把视图拽到底部（默认关闭）；
- **公式复制**：含公式的消息下方显示 LaTeX / MathML 复制按钮（MathML 可直接粘贴进 Word）；
- **批量归档**：勾选多个会话批量归档，带确认守卫（日志仍保留在存储中）。

### 额度与用量

会话头部常驻额度徽标（可点击固定），额度面板提供：

- **余额**：调用官方 `https://api.deepseek.com/user/balance` 接口，优先显示 CNY，赠送与充值余额分列，并显示账户可用状态。
- **Key 解析顺序**：面板粘贴（仅存本机状态文件）→ 环境变量 `DEEPSEEK_API_KEY` / `DEEPSEEK_KEY` / `DEEPSEEK_TOKEN`（取值需以 `sk-` 开头）→ DSH 凭据文件 `$DSH_HOME/.credentials.yaml`（自动复用 DSH 已配置的 DeepSeek key，无需重复填写）。
- **今日用量**：按模型统计输入 / 输出 / 缓存 token 与调用次数，实时折叠自 `session/event` 事件。
- **费用估算**：按 DeepSeek 官方峰谷价目（2026-08-17 生效）估算——高峰时段（北京时间 9–12 / 14–18 时）全价，空闲时段半价：`deepseek-v4-flash` ¥3 / ¥9，`deepseek-v4-pro` ¥9 / ¥27（每百万 tokens 输入 / 输出，缓存写入 ¥0.1 / ¥0.3；已停用的 `deepseek-chat` / `deepseek-reasoner` 按 v4-flash 计），仅供参考。
- **扫描**：「扫描今日会话日志」重放全部会话、按事件自身时间戳归入今日（跨午夜会话不丢量），完成后显示扫描到的活跃会话数。

### 设置入口

「设置 > 个性化」页提供外观与工具开关的整页配置；会话头部与侧边栏底部的「个性化」按钮打开同一套面板弹框。

### 智能体集成

`custom_plugin_status` 工具报告：外观配置、今日按模型用量、余额、时间线样本、Mermaid 引擎加载情况、状态文件路径与客户端诊断。插件不注入任何系统提示。

## 安装

前置：Node 22+、pnpm，以及 `dsh` CLI（官方 npm 包 `@deepseek-ai/dsh`；未全局安装时，可用 `npx @deepseek-ai/dsh` 代替 `dsh`）。

### 从 npm 安装

```sh
dsh plugin --profile web add @alexpeng/dsh-custom-plugin
# 重启 dsh web
```

registry 上是预构建产物，安装端无需从源码构建。

### 从 GitHub 安装（源码安装）

```sh
dsh plugin --profile web add github:AlexPeng07/dsh-custom-plugin
# 重启 dsh web
```

git 安装拉取的是源码，`prepare` 脚本会在安装端构建 `lib/`。pnpm ≥10 需要一次性授权该构建——把 pnpm 提示的确切包键复制进 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 下，再重新执行 add。走上方 npm 路线可免去构建授权。

### 本地链接（开发）

```sh
# 构建（本仓库根目录执行）
pnpm install
pnpm build
# 装入 web profile。链接路径不能含空格：Windows 上若源码路径含空格，
# 先创建无空格目录联接（如 F:\dsh-plugin-dev），再链接到联接路径
dsh plugin --profile web add link:F:/dsh-plugin-dev
# 重启 dsh web
```

包按官方组合包协议声明 manifest：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml` 配置层（行 id `custom-plugin`），`dsh.client` 声明浏览器半区。`dsh plugin add` 在 profile 目录内转发给 pnpm，安装后因该声明被自动加入 `dsh.profile.bundles`；浏览器半区经官方客户端模块系统按同一行加载。

## 配置

插件读写 `$DSH_HOME/custom-plugin-state.json` 单个 JSON 文档（默认 `~/.dsh`，可用 `DSH_HOME` 环境变量覆盖），包含外观配置、文件夹、提示词、星标、API Key 与按日用量账本；写入为原子写（临时文件 + 重命名），崩溃不会截断文档。

外观与功能开关（`cfg` 字段，均有默认值）：

| 配置项 | 默认值 | 说明 |
|---|---|---|
| `bg` | `天青灰` | `default`（无颜色）/ `aurora`（极光）/ 20 组调色板名之一 |
| `weather` | `none` | `none` / `snow` / `rain` / `sakura` |
| `glass` | `true` | Custom 面板玻璃总开关 |
| `glassMode` | `frost` | `frost` 毛玻璃 / `liquid` 液态玻璃 |
| `globalGlass` | `true` | 全局浮层（弹窗/菜单/提示）加模糊 |
| `timeline` | `true` | 时间线轨道开关 |
| `timelineLeft` | `false` | 轨道放左侧 |
| `starsOnly` | `false` | 只显示星标节点 |
| `quote` | `true` | 划词引用回复 |
| `antiScroll` | `false` | 防自动跳底 |
| `mermaid` | `true` | Mermaid 渲染按钮 |
| `formula` | `true` | LaTeX / MathML 复制按钮 |

## 安全模型

- 浏览器仅通过回环地址上的 `/api/custom-plugin` 路由与宿主通信；每条路由同时校验回环 socket 地址、回环 Host 头与浏览器同源标记（`sec-fetch-site` / `Origin`），`X-Forwarded-For` 永不信任。
- DeepSeek API Key 只保存在本机状态文件（或沿用 DSH 自身凭据），仅用于调用 DeepSeek 官方余额接口。
- 会话导出与时间线数据全部停留在本机。

## 已知限制

- Mermaid 首次渲染需要能访问 CDN（宿主在进程生命周期内缓存引擎）。
- 用量账本折叠自实时 `session/event` 记录；错过实时事件时可手动「扫描」重读今日会话日志。
- 费用按 DeepSeek 官方峰谷单价估算，仅供参考。
- 深色模式下背景限制是刻意设计：仅「无颜色」与「极光」可选。

## 开发

```sh
pnpm typecheck   # 类型检查
pnpm test        # vitest 单元测试
pnpm build       # 构建 node ESM 库与浏览器 bundle 到 lib/
```

## 许可证

Apache-2.0。部分代码参考 [Nagi-ovo/voyager](https://github.com/Nagi-ovo/voyager) 与 [unovue/inspira-ui](https://github.com/unovue/inspira-ui)。
