# Changelog

All notable changes to this project are documented here. The format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/).

## 0.7.1 — 2026-10-03

数据安全与健壮性加固版：封住两条不可恢复配置丢失路径与一条跨宿主丢更新路径，装上浏览器提交的形状门，补齐卸载回收与凭据状态缓存；测试从 143 增至 185。

### Fixed

- **宿主读档失败不再静默用默认值覆盖状态文件**：此前 `loadStateFile` 把
  `ENOENT`、瞬态占用（Windows 杀毒扫描 / 同步盘 / 与桌面宿主的 rename 竞争）
  与 JSON 损坏一律折叠成「无文件」，随后启动流程立即把默认文档写入真实路径——
  folders / prompts / stars / 用量台账被无条件清空且不留副本。现在：瞬态错误按
  1.5s/3s/6s 重试（与客户端重试梯子同节奏）；重试耗尽或 JSON 损坏时先以
  pid 后缀名将原文件改名隔离（`.corrupt-<pid>`，两个宿主共享一个
  `$DSH_HOME` 也不会互相抢占恢复名）再采用默认值；仅当原文件既读不出又移不走
  时 loader 才 reject，宿主转入只读模式（抑制一切保存）而不是销毁可能完好的
  文档。启动后的首次规范化保存失败也不再误入加载失败分支。
- **客户端重试耗尽后不再把出厂空配置写回宿主**：桌面壳页面可能先于宿主路由
  就绪，客户端重试梯子（约 10.5 秒）耗尽后停在出厂默认值；此后用户切换任何
  开关都会触发一次全量 POST，把已存 folders / prompts / stars 整组替换为空。
  现在 `saveCfg` 以「曾成功读取过状态」为门槛：未加载成功一律改为重新读取并
  提示「配置尚未读取完成，已重新加载，请重试」。
- **插件停用/重声明后全局副作用全部回收**：卸载清理器此前只注销插槽并移除动
  态样式，`theme.overrideTokens` 的设计令牌覆盖（停用后 GUI 配色仍被插件锁
  死）、`<html>` 上的 `vx-liquid/vx-dark/vx-light` 类、液态玻璃 SVG 滤镜节点、
  待触发的余额重试定时器（会继续外呼最多 3 次）全部残留。现在清理器逐一还原。
- **共享 `$DSH_HOME` 的两个宿主不再互相清空对方的写入**（Web 与 Desktop 各自持有整份内存文档、整文件回写，最后写者赢）：现在每次保存前先用 stat 身份（mtime+size）对比本进程上次读/写看到的文件，发现外部变更就回读并做三方合并——本进程未动过的配置段（cfg/folders/prompts/stars）采纳外部版本，动过的保留本地版本，用量台账按计数器做 `对方 + 本地 − 共同基线` 的精确并集（两个宿主的会话流来自不同 profile、天然不重叠）。启动加载也改用同一文件句柄做 fstat+read，基线与合并字节描述同一份文档。
- **`POST /state` 形状门**：浏览器提交的 folders / stars 此前未经校验直接落
  state——畸形深层嵌套可让此后每次保存的 `JSON.stringify` 抛 `RangeError`，
  保存从此持续失败需手改状态文件。现在 `normalizeFolders`（唯一 id、纯字符
  串 id 列表、深度 ≤32、节点 ≤2000）与 `normalizeStars`（安全对象键、纯数字
  序号、`true` 值、总量 ≤10000）把关，违规整笔拒绝（400「文件夹数据无效」/
  「星标数据无效」），绝不截断——客户端持有全量文档，静默丢段等于丢数据。
- **缓冲用量回放不再把宿主已学到的模型覆盖为 `unknown`**：启动缓冲的
  `session/event` 用量回放时，`null` 模型改为传 `undefined`，让宿主回退到自己
  在加载期间学到的 session 模型映射。
- **用量重扫不再白付全量代价后必然失败**：流式对话期间触发重扫时，revision 检查从「全部 I/O 完成后查一次」改为每个会话读取前检查，已注定作废的扫描会立即停止读取剩余会话日志。
- **Mermaid CDN 兜底不再被 200-HTML 投毒**：绑架门户/镜像异常返回的 200 HTML 页此前会被缓存为「引擎」且宿主生命周期内不再重取；现在要求载荷是 ≥1000 字节、不以 `<` 开头的脚本形态，否则记为该镜像失败并继续尝试下一个。
- **客户端脚本加载挂起不再无限等待**：`ensureMermaid` 的 120ms 轮询等待没有出口，网络黑洞（onload/onerror 都不触发）会让每个流式新代码块再挂一个永久等待者、「预加载」按钮永远「加载中」；现在 30 秒看门狗翻到 failed 并移除 script 标签，重试可重新插入。
- **GUI 主题与 OS 配色不一致时玻璃/面板不再用错颜色**：深色 GUI + 浅色 OS 下余额悬浮卡、面板、模态保持浅色磨砂（反之亦然）——这些规则此前只跟 `prefers-color-scheme` 走；现在按客户端镜像到 `<html>` 的 `vx-dark/vx-light` 类选择，媒体查询降级为类就绪前的启动兜底（液态玻璃规则本就按此模式工作，磨砂路径对齐）。

### Changed

- **凭据状态短 TTL 缓存**：`credentialStatus` 每次 `/state` GET 与保存响应都
  打一次 OS keychain + 读凭据文件；现在对「来源判定」结果缓存 5 秒（从不缓
  存键值本身），`applyEdit` 与遗留迁移立即失效，保存响应永远如实反映刚应用
  的编辑。
- **长会话交互开销**：`TurnTailEntry`（每条消息一个）对轮次数据的查找从每次 store 变更 O(轮数) 线性扫描改为 fetch 时构建的 `seq → item` Map O(1) 查表；选中拖拽时 `selectionchange` 以 60Hz 触发 `setS`，现在文本与坐标未变（<1px）时跳过发布；用量面板的 90 天汇总/按天/按模型统计改为 `useMemo`（预算输入每次击键不再重算全部统计）；面板拖拽改为 mousemove 直写 DOM、mouseup 才落 store；预算状态判定复用 `productivity.budgetState`（此前为生产死代码，客户端内联了一份会漂移的副本）。
- **死代码清理**：六个无引用 ICONS 条目（clock/fork/arrowUp/arrowDown/moon/
  sun）、两条无匹配死规则（`.vx-swatch:disabled`、`.vx-textarea`）移除；
  `hexToRgb` 收敛到 palette.ts 单一导出实现。
- **smoke 收紧**：未构建即跑 smoke 给出明确「先 pnpm build」报错而非裸 ENOENT 堆栈；新增 bundle `require()` 字面量 ⊆ `PLATFORM_MODULES` 交叉校验（防未声明外部化导致的静默消失类断裂）；`lib/client.js` 落后于 `src/client` 或 `tsdown.config.ts` 时判红（防对过期产物盖章）；Windows 下 PATH 探测补 `.exe` 后缀。
- **typecheck 收编构建配置**：`tsdown.config.ts`、`vitest.config.ts` 进入 `pnpm typecheck` 范围。
- **CI 补浏览器段**：`setup-chrome` 后跑全量 `pnpm smoke`——客户端注册握手
  （bundle 必须注册 {id, factory} 且不物化、无页面错误）首次进入 CI，此前只
  在本机跑。

### Tests

测试从 143 增至 185。

- **路由错误面**（信任边界此前只测了围栏与备份校验）：全部路由的 405、坏
  JSON → 400、流级超限 → 413、timeline/export 缺 `sessionId` → 400、kinds
  数组内单项非法 → 400、`POST /state` 成功路径与 `applyEdit` 失败 → 400 映射、
  Mermaid 脚本路由引擎未就绪 → 503 及其围栏 403。
- **状态加载失败处理**：损坏文档隔离、重试耗尽后隔离、瞬态故障恢复后正常合
  并、隔离失败时 reject 且原文件字节不动。
- **跨宿主同步合并**：外部写入按段采纳/保留、同一用量行两宿主并发累加的精确
  并集、全新安装保存不触发合并。
- **形状门**：合法树/星标通过、重复 id 与非字符串成员拒绝、超深树拒绝、不安
  全对象键（`JSON.parse` 产生的自有 `__proto__`）拒绝。
- **装载入口集成测试**（`src/index.ts` 此前零覆盖）：全路由与状态工具注册、
  启动规范化落盘、`stateReady` 前的用量缓冲、500ms 防抖合并为一次写入、损坏
  文档隔离后继续写入、隔离失败转只读（诊断含 read-only、内存台账仍在、磁盘
  无写入）、fiber 卸载回收路由/工具并重新武装单例守卫。
- **单例守卫 / 家目录 / 凭据存储零覆盖补齐**：`mountOnce` 首挂生效、重挂静默、
  fiber 卸载后重武装（effect 须「返回」解标记的契约被锁死）；`resolveDshHome`
  的 `~` 展开与相对路径锚定；keytar 缺席时 `SystemCredentialStore` 全操作软
  失败（本仓库与最小安装实际走的路径）。
- **凭据缓存**：TTL 窗口内命中缓存、编辑后失效重解析。
- **样式不变量**（`styles.spec.ts`）：把 0.7.0 的实发 bug 类锁死为断言
  ——`.vx-liquid` 永不出现在 `.vx-root` 之后（死规则类）、磨砂/液态玻璃与余
  额卡必须按 `:root.vx-dark/vx-light` 主题类出规则、无退役类名（vx-dots /
  vx-timeline）、花括号平衡。测试首次落地就抓出一个存量孤儿 `}`（历史上删
  媒体块残留，浏览器静默忽略），已清除。
- **Mermaid 载荷校验**：200-HTML 拒收并落到下一镜像、全部镜像 HTML 时不投毒
  缓存、过小 200 体拒收。
- **用量重扫提前中止**：扫描进行中来新用量时，剩余会话不再被读取即返回重试
  错误。

## 0.7.0 — 2026-09-30

桌面版适配修复版。0.6.0 及之前的产物在 dsh Desktop 里几乎全部功能失效——本版
定位根因、修复围栏，并按桌面版重新校准了外观与额度两个界面。

### Fixed

- **桌面版全线 `forbidden` 的根因**：插件的访问围栏在回环判定之外额外要求一个
  浏览器同源标记（`sec-fetch-site: same-origin` 或 `origin` 头），而桌面版
  Electron 壳把渲染进程请求转发给它自己的 Host 之前会删掉 `host`、`origin`、
  `sec-fetch-site`、`cookie`——于是每个 `/api/custom-plugin/*` 路由和
  `/custom-plugin/mermaid.js` 都被误拒为 403 `forbidden`：三种导出、会话搜索、
  Mermaid 引擎预加载与就地渲染（连带 mermaid.live 按钮不出现）、余额与用量、
  以及**一切静默失败的状态保存**（主题、玻璃模式、项目文件夹、提示词库在桌面
  版从未真正持久化过）。0.7.0 起围栏对齐官方 API 围栏的信任语义：回环套接字 +
  回环 Host、非 `cross-site`、`origin` 缺省或与 Host 一致即放行；异源与跨站
  仍然 403。新增 guard 级单测（桌面转发形状、桌面 WS 形状、异源、跨站、非法
  origin、非回环 Host）与 `scripts/desktop-shape-probe.mjs` 活体探针；并在
  真实桌面安装（F:\DSH，dsh 0.2.0-rc.2）上实测：11 项通过 / 0 失败。
- **客户端不再静默吞错**：`loadCfg` / `saveCfg` 失败现在 toast + 上报客户端
  诊断，「看起来生效其实没存上」从此不可复现。
- **余额「额度?」的间歇性根因**：宿主对 `api.deepseek.com` 的外呼与桌面版
  GUI 一样走本机直连，而本机代理/安全软件按规则间歇性对 443 做 TLS 解密——
  被接管的时刻 Node 校验不了其自签名证书（`SELF_SIGNED_CERT_IN_CHAIN`），
  于是登录时首次查询失败、稍后手动刷新又成功，顶栏停在 `额度?` 上。0.7.0 起
  宿主把这类连接层失败（TLS 拦截 / DNS / 连接超时）翻译成可读的中文原因，
  客户端失败后按 8s/30s/30s 自动重试（60 秒轮询继续兜底），顶栏悬停即可看到
  真实原因。失败态顶栏文案按反馈只显示「额度」两字，不带问号。

### Removed

- **极光背景预设**：与整体配色不再协调，从色板中移除；旧存档的 `bg: 'aurora'`
  在宿主归一化与客户端加载两侧自动迁移为 `default`。
- **消息时间线轨道**（系统已内置对话时间线）：轨道、悬停卡（跳转/星标/分支/
  全文）、「显示时间线 / 时间线在左侧 / 仅显示星标」三个开关与时间线标签页
  全部移除；`timeline` / `timelineLeft` / `starsOnly` 配置键退役（旧状态文件
  里的残留键会被宿主归一化丢弃）。保留：消息尾部的 LaTeX / MathML / Mermaid
  芯片（其数据链 `/timeline` 原样保留，会话运行期间由 OverlayRoot 每 3 秒
  轮询驱动）、星标数据字段（备份兼容）与搜索定位跳转。

### Changed

- **色板适配深色模式**：20 组色系在深色下不再禁用——按同色系自动派生深色
  变体（保留色相与低饱和，明度落到深色档，饱和度压缩至 0.55 倍，避免暖色系
  在深底上抢眼），色板预览即当前模式的实际效果；「深色强制重置背景」的旧
  逻辑随之移除，主题翻转只重新着色。
- **头部入口交互统一**：个性化 / 提示词 / 额度三张卡片统一为「点一下显示、
  再点一下关闭」——额度卡片移除悬停即开与固定/取消固定的混合逻辑，提示词
  浮层重复点击按钮即可关闭；四个浮层表面（含项目文件夹侧栏）互斥，打开一个
  自动收起其它。
- **液态玻璃**：删除「在 Chromium 启用液态玻璃…」的桌面端无关文案；位移折射
  链上轻微模糊与饱和（`url(#vx-lg) blur(2.5px) saturate(1.12)`），大面积面板
  中部文字清晰、玻璃可感知；液态模式下「全局浮层玻璃」把同样的位移链延伸到
  弹窗 / 菜单 / 提示框 / 下拉框与系统设置窗（`CSS.supports` 门控，不支持
  SVG 位移滤镜的引擎回退毛玻璃）。并修复了一个让面板「看起来没有液态」的
  作用域缺陷：主题毛玻璃底色（64% 白底）特异性压过 10% 液态底色，而本应翻盘
  的选择器要求 `vx-liquid` 出现在 `.vx-root` 内部（它实际挂在 `<html>` 上），
  从未匹配——只有不在 `.vx-root` 里的额度浮层是真液态。现以 `:root.vx-liquid`
  作用域重写液态底色，并把主题类镜像到 `<html>`，所有玻璃表面统一。
- **点阵背景全局移除**：所有玻璃表面不再渲染滚动的点阵纹理。
- **额度区改版**：顶栏胶囊在未配置 Key 时显示本机费用估算（`≈¥0.42 · 今日
  N 次`，按官方价目表折算，不用 Key、不联网）；配置了 Key 照旧显示真实余额。
  面板默认区只放用量趋势 / 预算 / 今日明细 / 扫描按钮；「余额查询」收为可折
  叠可选项（配置过 Key 默认展开），未配置时不再显示任何报错。
- **价目表更新**（2026-09-30 核对官方页）：`deepseek-flash` 峰时输入 ¥2 / 输出
  ¥8 / 缓存命中 ¥0.04（旧名 `deepseek-v4-flash` / `-vision-exp` 仍按 Flash 计
  价路由），`deepseek-v4-pro` ¥9 / ¥27 不变；闲时一律半价。

## 0.6.0 — 2026-09-30

### Published

- `npm publish` went out at 2026-09-29T17:26:16Z — 01:26 local on 2026-09-30, which is
  why this entry is dated 09-30 — and registry `dist-tags.latest` is now `0.6.0`.
  The first `PUT` returned 401, npm opened its browser sign-in flow, and
  the retried `PUT` returned **202 Accepted** — npm then keeps the version
  processing for a few minutes, during which the registry still reads
  `latest: 0.5.0`. Anyone re-checking too early will see "not published"; check
  `time["0.6.0"]` before re-running `npm publish`, because a second publish of an
  accepted-but-processing version fails on the version already existing.
- The published tarball was unpacked and compared to the repository build:
  `lib/client.js` 207762 B (sha256 `f559cd7f1bd8a49a`), `lib/index.js` 81224 B,
  `package.json`, `cordis.patch.yml`, `icon.svg`, `README.md` — all byte-identical.
- That registry artifact was then installed into a fresh scratch profile on
  dsh 0.2.0-rc.2 — dsh Desktop's exact bundled version — and scored the same
  18 pass / 1 skip / 0 fail as the locally packed one.
- **Install it by exact version for now.** A bare `dsh plugin … add
  @alexpeng/dsh-custom-plugin` resolved `0.4.2` on this machine minutes after
  the publish: the plugin manager reads a cached packument whose `latest` was
  still stale. `@alexpeng/dsh-custom-plugin@0.6.0` installs cleanly. Use
  `npm view @alexpeng/dsh-custom-plugin dist-tags --prefer-online` to read the
  real tag instead of the cached one.

### Changed

- **Built against dsh 0.2.0-rc.2, and the declared range now names it.** Every
  `@deepseek-ai/dsh-*` devDependency moved to 0.2.0-rc.2 and the source
  type-checked against that release's own published types with no source
  changes. The gate-relevant peer became
  `@deepseek-ai/dsh-tools >=0.1.7-rc.2 <0.2.0-0 || >=0.2.0-rc.2 <0.2.0-rc.3`,
  and `engines.dsh` was set to the same range. That spelling is load-bearing:
  `^0.1.7-rc.2` desugars to `>=0.1.7-rc.2 <0.2.0-0`, and every `0.2.0-rc.N`
  sorts above `0.2.0-0`, so no caret form can admit a verified prerelease — and
  `^0.2.0-rc.2` would additionally admit 0.2.0 stable plus every later 0.2.x,
  which is exactly the unverified support this range exists to withhold.
  0.2.0-rc.1 is left out on purpose: the bundle is now built for rc.2.
- `pnpm smoke`'s two range checks were rewritten, because both encoded the old
  premise that a peer range is a single caret pin. They now assert what is
  actually load-bearing: the installed build target must **satisfy** the peer
  range (same comparator and `includePrerelease` semantics dsh's own gate uses),
  a range that admits every version is rejected as stating no support at all,
  and `engines.dsh` must admit the same versions as the peer range across ten
  probed releases. `semver` became a devDependency to make the first check
  possible. Verified by mutation: a stale range, a `*` range, and a diverging
  `engines.dsh` each turn the gate red.
- The desktop release line pins its shell and runtime together, so dsh Desktop
  always ships one exact dsh version — this is why 0.2.0-rc.2 stopped being a
  speculative target: any Desktop install *is* that runtime.

### Added

- `tests/loopback.spec.ts`: the request-level fence had never had a unit test —
  only the live probe script exercised it. Twelve tests now pin the two header
  shapes dsh Desktop's shell produces (`web-document.ts` deletes `host`,
  `origin`, `cookie` and `sec-fetch-site` before forwarding; the WebSocket
  upgrade rewrites `Origin` to the Host authority), plus the rejections a
  forged Origin, a cross-site marker, and a non-loopback socket must still get.
- `scripts/desktop-runtime.mjs`: reads which dsh version an **installed** dsh
  Desktop carries, straight out of `resources/app.asar/dsh/desktop-runtime.json`,
  and prints whether the peer range declared here admits it. Promoted from a
  throwaway probe because Desktop pins shell and runtime together, so "what does
  this installer actually run" is a question every future Desktop release
  re-asks and the repository cannot answer. Read-only; takes the installation
  directory or the archive path. Verified in both directions: on this machine's
  install it reports `0.2.0-rc.2 / ADMITTED`, and with the peer range temporarily
  reverted to `^0.1.7-rc.2` the same run reports `REFUSED`.
- README (both languages) gained an "On dsh Desktop" section: how the shell
  routes requests, why the profile is managed by Desktop's own `dsh` command,
  and which part still needs a window and a login.

### Fixed

- **A second dsh host could read a half-written state document.** The atomic
  replace wrote to one shared temp name, `custom-plugin-state.json.tmp`, while
  the queue that serializes saves lives inside a single process. dsh Desktop
  owns `$DSH_HOME/profiles/desktop` and the Web profile owns `profiles/web`,
  but both hosts read and write the same
  `$DSH_HOME/custom-plugin-state.json`, so two hosts saving at the same moment
  wrote and renamed that one temp file against each other — the Windows
  EPERM/EBUSY shape this queue was built to stop, reachable across processes.
  Temp names are now qualified by the writing pid (both the state document and
  the pre-import recovery backup), and a failed turn deletes its own temp
  instead of leaving a per-pid file behind. Building that cleanup surfaced a
  second bug: `rm` was used in the new `catch` but never imported, so a failed
  save reported `ReferenceError` instead of the real rename error and left the
  temp file on disk.

### Verified

- **dsh 0.2.0-rc.2, the version Desktop ships.** Confirmed from the installed
  app's own bytes, not the repository: `resources/app.asar/dsh/desktop-runtime.json`
  records `release.version 0.2.0-rc.2`, `node 24.18.1`, `pnpm 11.7.0`, and lists
  `@deepseek-ai/dsh 0.2.0-rc.2` with `@deepseek-ai/cordis 4.0.4` (the version
  this package's cordis peer already names) among its shared packages.
- 0.5.0 on that runtime behaved as predicted: `dsh plugin --profile web add`
  refused it, naming `peerDependencies {"@deepseek-ai/dsh-tools":"^0.1.7-rc.2"}`,
  and rolled the profile back. With the exemption granted, 18 of 19 live host
  probes passed, 0 failed.
- **0.6.0 installs on 0.2.0-rc.2 with no exemption at all** (`plugin add` exit
  0, profile kept), and the same 18-pass/1-skip/0-fail result holds there and on
  0.1.7-rc.2 — boot graph 66 module rows on 0.2.0-rc.2 and 65 on 0.1.7-rc.2, our
  row served, all
  five `dsh.client.inject` targets present, Mermaid engine loaded locally, UTF-8
  state round trip restored. The single skip is the session-dependent probe; a
  credential-free scratch home holds no session.
- The rebuild of `pnpm-lock.yaml` (required: the old lockfile cached a
  `minimumReleaseAge` policy snapshot that no longer matched the allow-list, so
  every install was rejected) also moved the dev tree's `mermaid` from 11.17.0
  to 11.17.2. That is inside the declared `^11.6.0`, and the scratch profiles
  used for the live probes resolved 11.17.2 themselves, so the measured Mermaid
  engine is the version an installing user gets.
- The installed `lib/client.js` is byte-identical to the repository build
  (207762 bytes, sha256 prefix `f559cd7f1bd8a49a`). The *served* bundle is 49
  bytes larger because dsh's composite `/plugins/??…` route joins modules with
  `;\n` and rewrites the `sourceMappingURL` — so byte identity is asserted at
  the installed file, never at the HTTP response.
- 126 unit tests pass, typecheck is clean, `pnpm smoke` and `check:readme` are
  green. Not verified: opening the plugin inside a real Desktop window (needs a
  login), the desktop profile's own composition, and the per-turn chips.

## 0.5.0 — 2026-09-28

### Changed

- **Target dsh 0.1.7-rc.2.** All `@deepseek-ai/dsh-*` dependencies, the
  `@deepseek-ai/dsh-tools` peer range, and `@deepseek-ai/cordis` moved to the
  versions that release ships, and `engines.dsh` now states the supported range.
  dsh checks a bundle's `@deepseek-ai/dsh-*` peer ranges against its own runtime
  version at install and startup and skips a bundle that does not match. The
  declared floor is the release this package was built and verified against;
  `^0.1.7-rc.2` additionally admits later 0.1.x releases that have not been
  re-verified, and `engines.dsh` is declarative — no part of dsh reads it.
- The browser half declares `dsh.client.inject` as the five packages that own
  the slots it registers into, replacing the retired
  `@deepseek-ai/dsh-client-runtime` row.
- Slot-provided data shapes (`SessionListState`, `WorkspaceListState`,
  `TurnLocation`) are now declared locally instead of imported from harness
  controller packages that rename across releases; only `SnapshotSelectorHook`
  still comes from the slot SDK.
- In-session search uses dsh's event index when the deployment opens one and
  otherwise scans the session log it already read, reporting which path answered
  in the panel. dsh's shipped `web` profile configures the index with
  `openAt: never`, so the indexed route was unavailable on a default install.
- Plugin Manager cards, bundle details, and the settings inventory now show a
  real name and icon: `locale/en.json`, `locale/zh.json`, and `icon.svg`.

### Fixed

- **The timeline rail, export, and quote features lost the current session.**
  The session list snapshot has had no `current` field since dsh
  0.1.6-alpha.2 (view selection moved to the Workspace browser), so the rail
  tracked nothing. The viewed session now comes from the standard `sessionId`
  prop every session-scoped slot entry receives.
- **Opening a session or a workspace failed silently.** `ctx.sessions.open` is
  gone; navigation goes through `ctx.uiWorkspace.openSession()` /
  `connectWorkspace()`. Branching and full-text search go through
  `ctx.remote.session.fork()` / `.search()` — `ctx.sessions` still declares
  those two, but the remote namespace is the documented surface — each with an
  honest failure message when the service is absent.
- **Exports lost tool results and the new model-visible messages.** The
  `tool-result` content block was replaced by a tool-role message whose call id
  now sits on the message (`toolCallId`, still falling back to `source.callId`
  for older logs); `system/message` and `developer/message` are exported as
  injected context; and `file`, `tool-addition`, `tool-removal`, and offloaded
  `image` blocks are named instead of dropped.
- `conversation.chat.turnTail` changed from a chain slot to a list slot, so its
  `select` registration option no longer applies and was replaced by an id and
  order.
- Client diagnostics are throttled per message kind. The previous single shared
  window let the frequently emitted rail line swallow the one-shot timeline
  result line, which made a successful timeline fetch look like zero turns.
- `pnpm smoke` now checks the manifest fields dsh reads before it activates a
  bundle (client platform and `./client` export, patch path, icon size, locale
  display metadata, and peer ranges agreeing with the build target), so an
  unsupported or stale declaration fails the local gate instead of being skipped
  silently in a user's profile. The peer check refuses to read a range form it
  cannot interpret, and every `files` entry must resolve to something in the tree
  — an entry matching nothing used to publish a bundle missing that piece. Both
  new rules were confirmed red by breaking them on purpose. The
  `dsh.client.inject` rows are counted, not resolved: only a running shell knows
  which module ids it serves, so a retired name there is caught by the live
  boot-graph probe below, not by this gate.
- A search excerpt now extends its window so a pasted query longer than two
  thirds of the excerpt is still shown whole. Measured first: the previous
  centering already covered ordinary queries, including a hit at the very end of
  a long message, so only the long-query case was affected — the fix is narrow,
  and the added test fails against the old formula.
- Exports no longer fail outright on a `tool/result` event whose `message` is
  absent, and the scan fallback reads each event shape through its own typed
  case instead of a cast that hid real field drift.
- When cross-session full-text search is unavailable, the palette says what still
  works (title matching over sessions and workspaces) instead of showing a bare
  error.
- Added `scripts/live-dsh-check.sh`: a manual probe that runs against a *running*
  isolated dsh profile and exercises the host half on real session data
  (timeline, the three export formats, the search scan path, usage scan, backup,
  a UTF-8 state round trip, the Mermaid engine route, the client→host diagnostic
  ring, both fences, and the boot graph the shell serves), exiting non-zero on
  any failure. CI has no harness to talk to, so this is the check to run when a
  dsh release lands. Verified against 0.1.7-rc.2 with 19 probes green; the
  session-dependent ones `SKIP` — and the closing line counts them instead of
  claiming a clean sweep — when the scratch home holds no session, and the UTF-8
  probe was shown to distinguish a correct write from the mangled-bytes write it
  guards against.
- The live check itself was then tested against a dead endpoint and found two of
  its own probes green-by-absence; the restore probe now refuses to pass when the
  append it restores never landed. Running it against a real profile exposed five
  more defects in the tool, all fixed: restoring the prompt library through
  `curl -d "$var"` mangled non-ASCII to U+FFFD (Git Bash re-encodes non-ASCII
  argv for `curl.exe`), so bodies are now written by node and sent with
  `--data-binary @file`; the script checked out with CRLF endings (the stored
  blobs were already LF — `core.autocrlf` was rewriting them on checkout, now
  pinned by `.gitattributes`); its search probe read the query word with a greedy
  `sed` that needed *some* six-letter run anywhere after the last `"text":"`, so
  it silently `SKIP`ped the one probe covering the scan path; it looked for
  sessions under `<state file>/../sessions`, which only finds anything because
  Windows folds the path lexically and would see nothing on a POSIX shell; and
  the real-home guard missed a `DSH_HOME` written with a trailing separator,
  which is exactly the spelling that would have probed a developer's own harness
  home.
- The READMEs add a plugin-to-dsh compatibility table. A mismatched pair is not
  silent — dsh logs `disabling profile plugin …` on stderr, rejects the install,
  and models the state as `incompatible` in the plugin manager — but none of that
  reaches the page a user is looking at, so the supported window belongs in the
  README.

### Verified by independent review

Four reviewers were dispatched against `30e025b..HEAD` with separate charters
(code correctness, claims-vs-evidence, contract-vs-installed-runtime, and a
deep re-audit pinned to the previous commit). Their findings were each
re-verified before being acted on; three of their "critical" items were
refuted by measurement and are recorded below so nobody re-litigates them.

- Fixed: `package.json` declared `"icon"` twice. `JSON.parse` keeps the last
  value, so every gate stayed green on a manifest npm would warn about. `pnpm
  smoke` now counts top-level keys in the file text and compares them with what
  survived parsing, and separately checks that `engines.dsh`'s floor names the
  installed dsh-tools release (nothing in dsh reads `engines.dsh`, so this is
  the only place that keeps it honest).
- Fixed: the session probes looked under `<state file>/../sessions`, which only
  resolves because Windows folds the path lexically; they now use the home
  directory directly. Skips are counted and named in the closing line, a missing
  boot-graph URL line fails instead of vanishing, the Mermaid probe reads
  `mermaidSource` rather than inferring "local" from a byte count, and a
  rejected state write now carries the host's own error text.
- Fixed: the restore probe was vacuously green — it never checked that the
  append it restores had landed. It now refuses to pass when the write failed,
  verified by mutating the write condition and watching exactly that line go
  red.
- Fixed: the client's last-holder clear left `turns` and the rail positions
  behind with no session identity, and a holder whose `sessionId` prop flipped to
  null could wipe the identity other holders were still rendering. A null holder
  now claims nothing at all.
- Fixed: `slots.inject`'s callback registered the component outside the
  surrounding `try`, so a rejected registration would take a surface down
  silently while the diagnostic ring still read green; the deferred `register`
  has its own guard now, and the summary line reports how many injection
  requests it actually submitted rather than asserting "8 / 7" — dsh defers the
  callback until a slot is declared, so no line printed at install time can
  claim a surface materialized; the per-slot `ok` / `register` lines do that.
- Fixed: the search request was passed as `as never`, which hid that `values`
  must be `keyof SessionEventMap` rather than `string`; typed, the compiler
  caught it immediately. A synchronous throw from `searchEvents` now degrades to
  the scan path like a rejection does, a log with exactly 100 hits no longer
  claims there are more, and the scan's role filter is exercised by a fixture
  that only it can exclude. Each of the three is pinned by a test that fails
  against the code it replaces (verified by reverting one at a time).
- Fixed: the sidebar footer button ignored the `wide` prop the host supplies, so
  its label wrapped into a vertical stack inside the 56px rail — measured both
  ways on a live profile: 36px icon-only when collapsed, "项目" again at 280px.
- Added `scripts/check-boot-graph.mjs`, run by the live check: the served
  `__DSH_BOOT__` graph must contain our row, every `dsh.client.inject` target,
  and reachable client bytes. This is the only gate that can see the failure
  shape that started this whole upgrade — a manifest naming a module the shell no
  longer serves — and it was confirmed red by pointing the inject list at the
  retired `@deepseek-ai/dsh-client-runtime`.
- Measured against dsh 0.2.0-rc.1 (published the day after this release):
  `dsh plugin add` rejects the bundle and rolls the profile back; with the
  exact-version exemption granted, the source typechecks against 0.2's own
  types, 111/111 unit tests pass, 19/19 live probes pass, and the browser
  behaves as on 0.1.7 — eight slot registrations, the rail, prompt insertion,
  the `Ctrl+K` palette with title search, and quote-reply. The peer range is
  deliberately not widened: `^0.2.0-rc.1` would silently admit every 0.2.x
  release, including a stable nobody has reviewed — the very failure this
  upgrade exists to prevent. What stays unverified there (branch / Mermaid /
  LaTeX chips) is unverified here too: those need a real model reply.
- Accepted and published: a human walked the isolated 0.1.7-rc.2 profile in a
  browser (personalization panel, prompts into the composer, project folders, the
  timeline rail, quote reply, export entries, `Ctrl+K`) and reported it behaving.
  The same person then ran 0.5.0 on their own machine — dsh upgraded to
  0.1.7-rc.2, plugin updated through the in-app market — and reported it
  behaving there too. That install's `lib/client.js` is md5
  `6639a0aebbe7d0eed32b0c2c5c50c544`, 207762 bytes: byte-identical to the repo
  build this section describes, so the chain "what was verified = what was
  published = what a user runs" is closed at both ends.
  Not covered by either pass, in this or any release until someone runs it with a
  key: the per-turn chips (branch, Mermaid render, LaTeX/MathML) and the real
  balance figures, all of which need an actual model reply. `0.5.0` was then
  published to npm, and the tarball pulled back from the registry was verified
  byte-identical to the `lib/` this section describes (34 files, 215634 B).
- Retracted after re-measurement, so the record does not carry them: "the
  `slots.inject(key, fn)` service method does not exist in 0.1.7" (it is
  declared at `dsh-client-ui-renderer`'s registry interface, and all eight
  surfaces materialize in a live browser); "`data-chat-flow-kind` is gone, so the
  rail has no anchors" (the reading was taken while the host's trajectory tab had
  the chat flow unmounted); "`WorkspaceSnapshot.state` was renamed to `phase`"
  (both axes ship side by side). Corrected in place: `ctx.sessions` still
  declares `fork()` and `search()` (only `open` is gone), the `current` field and
  the turnTail kind change both landed in 0.1.6-alpha.2 rather than 0.1.7, and
  the bilingual README gate enforces hash freshness, not content parity.

## 0.4.2 — 2026-09-12

### Fixed

- **Exports fail on forked/resumed sessions with "读取会话失败: seeded
  session constructor seed must equal its inherited prefix".** Newer dsh
  builds replay-validate inside `sessionQuery.readSession()` through a
  snapshot-mode constructor that rejects any seeded (forked or resumed) session
  whose log outgrew its seed boundary, so timeline, export, in-session
  search, and usage scans all failed on those sessions. Every read now goes
  through a shared helper that falls back to `observeSession()` (the live and
  restore paths dsh's own session page uses) when `readSession()` rejects, and
  surfaces the original error only when no fallback exists.
- **The "PDF（含图片）" export button produced an `.html` file.** The button and
  its description now say what actually lands on disk: "HTML（含图片）", a
  print-ready HTML document you turn into a PDF via the browser print dialog.
- **Weather FX are invisible on light backgrounds.** Snow, rain, and sakura
  colors were tuned for the dark theme only — pure-white flakes, 6%-alpha pale
  rain, and 90%-lightness pink petals all vanish over the near-white palette
  backgrounds. The FX canvas now picks a darker particle palette (cool slate
  snow, steel-blue rain, deeper rose petals, each with a lifted alpha floor)
  whenever the resolved theme is light or the saturated aurora background is
  active, and swaps palettes live on theme/background changes without
  rebuilding the particle field.

## 0.4.1 — 2026-09-09

### Fixed

- **Fresh installs show nothing after a "successful" install.** `keytar` (a
  native optional dependency) tripped pnpm 11's strict build-script gate, so
  `dsh plugin add` exited non-zero and the harness never reconciled the bundle
  layer — the package sat inert in `dependencies` with no host half and no
  browser half. `keytar` is no longer a dependency: the OS-keyring adapter
  still detects a `keytar` module present in the profile's `node_modules`, and
  users who want the OS keyring can add it themselves
  (`dsh plugin --profile web add keytar`).
- The browser half now waits for the `slots` service (a child fiber) before
  mounting its surfaces instead of reading it synchronously: newer dsh builds
  activate the slots provider after this plugin's entry, and the synchronous
  read lost that race every time, logging "slots service unavailable" and
  skipping all UI. The mount stays fail-soft — the GUI boots even when the
  service never appears.

## 0.4.0 — 2026-09-03

### Added

- 7 / 30 / 90-day usage trends, per-model summaries, CSV export, and local monthly CNY budget warnings.
- Versioned, secret-free state backup with previewed merge/replace import and automatic recovery copies.
- Editable, tagged, sortable favorite prompts with usage recency, `{{variable}}` templates, and JSON / Markdown portability.
- Indexed current-session search and a Ctrl/Cmd+K command palette backed by DSH's official search APIs.

### Changed

- Batch archive skips running sessions and reports separate success and failure counts.
- Existing prompt and config documents are normalized for the new optional fields.

### Fixed

- State-dependent routes now wait for the initial local state load; usage events
  arriving during an import, edit, or usage scan are queued and persisted instead
  of racing a stale snapshot.
- Backup imports reject malformed counters/configuration, honor imported folder
  parents and sibling order, and keep the 5 MiB document boundary distinct from
  the JSON request envelope.
- Search hits carry their session id and archive batches retain per-item errors;
  stale cross-session clicks and swallowed archive failures now surface clearly.
- Malformed persisted peak counters, invalid calendar buckets, failed usage
  rebuilds, and partial state edits are handled without presenting or keeping
  a misleading snapshot; backup requests now validate their envelope fields.

### Security

- Backups exclude API keys and credential metadata; imports preserve the active credential.
- Archive restore remains deferred until DSH exposes an official API.

## 0.1.6 — 2026-09-02

### Fixed

- Usage scans now preserve the live ledger when a session read fails or new
  usage arrives during replay, and return the replayed Beijing day so a
  midnight-crossing scan cannot relabel its result.
- Legacy API-key migration no longer overwrites an existing system credential;
  failed system-key deletion is reported instead of being treated as success.
- Legacy usage rows without a recoverable peak/off-peak split are marked as
  inexact and are no longer shown with a misleading cost estimate.
- DeepSeek peak/off-peak cost estimates now treat only Beijing Monday-Friday
  09:00–12:00 / 14:00–18:00 as peak; weekends are off-peak.
- The browser usage panel now uses the same Beijing-time day bucket as the
  Host, including when the desktop host runs outside UTC+8.
- Client state snapshots are serialized in invocation order so rapid settings
  changes cannot be overwritten by an older save completing later.
- Timeline refreshes ignore stale session/request responses and follow live
  conversation running-state changes.
- Mermaid modal changes reload correctly, while concurrent CDN loads share one
  in-flight request; the balance hover panel also remains reachable across its
  trigger gap.

### Changed

- Centralized the cost formula, added explicit `deepseek-v4-flash-vision-exp`
  pricing, and covered the rule with unit tests.
- Usage history is pruned to 90 Beijing calendar days; usage scans use four
  concurrent reads and share one in-flight scan instead of duplicating work.
- The balance panel now shows the peak/off-peak token and cost split, pricing
  source link, and the built-in rule check date.
- Saved panel keys prefer the optional OS credential store, migrate legacy
  state-file keys when possible, and no longer cross the browser state boundary.
- Light/dark root theme styles now take precedence over the host OS preference,
  and the build uses the current tsdown dependency configuration without
  deprecation warnings.

### Added

- Regression coverage for ordered state saves and shared in-flight Mermaid
  loading.

## 0.1.3 — 2026-08-23

### Fixed

- Concurrent state saves are serialized per state file: two racing saves could
  collide on the shared `.tmp` file and fail the rename on Windows; a failed
  debounced save now surfaces in the status-tool diagnostics instead of being
  swallowed silently.

### Added

- CI: bilingual README hash consistency check (`node scripts/check-readme-i18n.mjs`)
  — editing one language without the other, or forgetting to re-record the
  hashes in `README.i18n.yaml`, now fails the build instead of drifting silently.
- CI: Dependabot with monthly schedules (GitHub Actions and grouped npm
  minor/patch bumps); workflow actions upgraded to current majors.
- `pnpm smoke` — post-build smoke script: headless Edge loads `lib/client.js`
  against a stubbed module loader and asserts the registration handshake, plus
  artifact contract checks (loader banner/footer, node-half ESM import,
  patch row, local Mermaid engine).
- Tests: the balance key resolution chain (panel → environment → DSH
  credentials, via a new credential-reader seam), state merge edge cases, and
  concurrent-save serialization.
- Docs: the security section now states explicitly that the panel-pasted key
  is stored in plaintext in the state file (same trust domain as DSH's own
  credentials).
- This changelog (also shipped in the npm tarball).

## 0.1.2 — 2026-08-23

### Fixed

- **Mermaid diagrams in assistant replies now render in place.** The rendering
  entry previously hooked only user messages, so assistant-generated diagrams —
  mindmaps in particular — never got an entry point. A `MutationObserver` now
  scans GUI code blocks and renders ```mermaid``` fences where they are
  (`MermaidInPlace`), without moving any React-owned nodes.

### Changed

- Mermaid engine is a local runtime dependency served by the host; the CDN
  mirrors are a fallback only. The source (`local` / `cdn`) is visible in the
  status tool diagnostics.

### Added (repository-side)

- GitHub Actions CI (Node 22 + pnpm 11: typecheck / test / build), README
  badges, and a bilingual screenshot gallery under `docs/`.

## 0.1.1 — 2026-08-22

### Security

- Mermaid rendering hardened: `securityLevel: strict` (was `loose`), and the
  `/custom-plugin/mermaid.js` engine route is behind the same loopback trust
  fence as every other route.

### Fixed

- Peak/off-peak pricing and daily usage buckets are computed in Beijing time
  (UTC+8) regardless of the host machine's timezone; tests are
  timezone-independent.

### Changed

- `@deepseek-ai/dsh-tools` moved to `peerDependencies` and externalized from
  the bundle — `lib/index.js` shrinks from ~245 KB to ~45 KB and shares the
  harness instance at runtime.
- Dead code removed: unused `afterSeq` incremental timeline protocol and cache,
  unused type re-exports, dead client state fields, unconditional startup log.

### Added

- Self-contained `prepare` script — GitHub source installs build themselves
  (pnpm ≥ 10 users: allowlist the build script, see README).
- Package metadata: `repository`, `author`, `bugs`, `homepage`,
  `engines` (Node ≥ 22); LICENSE copyright line filled in.

## 0.1.0 — 2026-08-22

Initial release: a personalization suite for the DSH web GUI, mounted through
the official profile mechanism without touching DSH source.

- Appearance: background palettes, liquid glass, weather effects
  (rain / sakura / snow).
- Per-user-message timeline rail with stars and branching.
- Multi-level project folders; prompt library.
- Conversation export (JSON / Markdown / PDF with images).
- Mermaid rendering; quote reply.
- DeepSeek balance and daily token usage (peak/off-peak aware).
- `custom_plugin_status` agent-facing diagnostic tool.
