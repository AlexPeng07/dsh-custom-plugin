# dsh-custom-plugin 桌面版迁移修复计划（目标版本 0.7.0）

> 入库存证日期：2026-09-30。本计划与实现会话的对齐结论一致，执行全程以下文为准。

## 一、核心思想（用户原话，原封不动，执行全程勿偏离）

背景：这个项目我将原来的web版移植到了DeepSeek harness桌面端之后，许多功能出现了较大异常，本次你需要帮我列好计划、并且规划好。
问题（我说的问题加上后面跟你对齐的内容原封不动的放在计划文档的最顶端，是本次修改的核心思想和内容、以防后面跑偏，计划后面按照你的规范进行）：
1.外观个性化、主题颜色没问题，但是出现了文案错误以及适配错误：a.仍然会显示''在 Chromium 启用液态玻璃，Safari/Firefox 自动回退毛玻璃。''文案，这下明明是桌面端，应该删除。b.点击液态玻璃，点击未配置密钥是液态过滤效果（但是这个效果我在之前的某一次修改中优化掉了，当时觉得这样会使后面的文字看不清，但我现在觉得这个可以留着，不过要删除后面一排排的点阵，这样会很丑而且降低可读性），同时，液态玻璃只显示在密钥配置界面、在插件的两个界面：个性化界面，提示词界面、和系统的设置界面，这三个界面都没有液态玻璃。
2.消息时间线、我觉得可以删除了，因为系统已经加上了对话时间线了
3.项目文件夹、暂时没发现问题，你可以检查一下
4.提示词库、暂时没发现问题，你可以检查一下
5.会话导出与搜索的所有功能（我指的是全部导出：包括Json、HTML等等等各种功能）都不可以用了，显示forbidden
6.Mermaid 渲染、同样的，所有功能都不能用，点击预加载渲染引擎报错：加载失败：可改用 mermaid.live 按钮，但是在对话里面的mermaid思维导图都无法展示，并且也没有所说的按钮。
7.引用回复、暂时没发现问题，你可以检查一下
8.DeepSeek 余额与token 用量、似乎已经无法自动获取api密钥了，因为桌面版改成了账号登录，在文案''Key 不回传浏览器；当前来源：未配置。留空后保存可清除插件自定义 Key。''下面显示forbidden。我觉得可以获取应用内消耗的token来预估价格，但是不用显示余额了，或者用户愿意输入api key可以保留查看余额的功能（在下面变成可选项，点击可以开启）。
约束：
我上面所说的要修改的点，如果你有不懂，需要跟我及时对齐。我希望你可以在列计划时多次跟我对齐，直到我们的想法完全相同。
每完成一大步就commit。
质量、结果优于时间和效率，结果一定要好，过程要仔细。
背景和资料（请你充足的调用文档来获取建设插件所需要的相关资料，需要仔细、细心）：
官方网址：https://www.deepseek.com/harness/
GitHub仓库地址：https://github.com/deepseek-ai/deepseek-harness
官方开发者文档：https://deepseek-harness.github.io/deepseek-harness/guide/quickstart
cordis论文：https://arxiv.org/abs/2608.25512

## 二、对齐结论（2026-09-30 四问四答，与上面原话同权重）

1. **点阵：全局删除**。所有玻璃表面（余额浮层、个性化中心、提示词浮层、各弹窗）不再显示点阵；玻璃本体（毛玻璃/液态）保留；液态效果要让「个性化中心、提示词浮层、系统设置弹窗」都可感知。
2. **额度顶栏胶囊**：无 Key 时显示「≈¥费用估算 · 今日 N 次」（估算=本机 token 用量×官方峰/闲时价目表，不用 Key、不显示余额）；配置了 Key 才显示真实余额。
3. **时间线删除范围**：删轨道、悬停卡（跳转/星标/分支/全文）、三个时间线开关、时间线标签页；消息尾部 LaTeX/MathML/Mermaid 芯片和搜索定位跳转保留（数据链路保留）。
4. **验收发布**：desktop profile 临时 link 本地构建 → 重启桌面版逐项实测 → 全过后升 0.7.0、更新双语 README/CHANGELOG → npm publish 由用户在交互终端（127.0.0.1:7890 代理、2FA）手动执行。

## 三、根因（已从代码 + F:\DSH 桌面版 app.asar 实际源码核实）

- **全部 forbidden 的唯一来源是插件自己的围栏** `src/routes.ts:30-39`：`guard()` 要求请求带 `sec-fetch-site: same-origin` 或 `origin` 头；桌面版 Electron 壳转发渲染进程请求前会**删掉 `host`/`origin`/`sec-fetch-site`/`cookie`** 再挂自己的凭证，于是每个 `/api/custom-plugin/*` 路由和 `/custom-plugin/mermaid.js` 都 403。官方 dsh 围栏（`isTrustedApiRequest`）对「无 origin」放行，所以系统其它功能正常。导出（问题5）、Mermaid 引擎+连锁导致 mermaid.live 按钮不出现（问题6）、余额/用量（问题8 的 forbidden）全是这一根因。
- **问题 3/4/7 其实也坏了，只是静默**：设置保存走 POST /state，客户端吞掉失败（`custom.tsx:594-613`），主题/文件夹/提示词在桌面版从未持久化，刷新即回默认。围栏修复后一并恢复；引用回复是纯客户端功能本就正常，仅列入验证清单。
- **问题 1a**：文案在 `custom.tsx:2062`，删除即可（README 两语种同步）。
- **问题 1b**：面板们都挂了 `.vx-glass`，液态滤镜 `.vx-liquid .vx-glass → backdrop-filter: url(#vx-lg)` 生效但位移贴图只在大面板边缘可感知；系统浮层只有 globalGlass 的 blur。需要加强位移贴图可感知度 + 液态模式扩展到 globalGlass 选择器（含系统设置弹窗）+ 按对齐结论全局删除 `.vx-pattern` 点阵（styles.ts 及 10 处 `<div class="vx-pattern">`）。
- **问题 8 语义**：余额数字需要 sk- Key（桌面版账号登录没有）；本地用量/费用估算（`pricing.ts` 峰闲时折算）不依赖 Key，改版为默认展示。

## 四、实施步骤（每步一个 commit；每个 commit 前过全套门禁：`pnpm check:readme` → `pnpm typecheck` → `pnpm test` → `pnpm build` → `pnpm smoke`；凡动 README 必须同 commit 重记 README.i18n.yaml 哈希）

**Step 0（docs）**：本计划全文（含上面原话）写入 `docs/plans/2026-09-30-desktop-port-fix.md` 入库。commit：`docs: 桌面版迁移修复计划（0.7.0）入库存证`。

**Step 1（fix，根因修复）**：
- `src/routes.ts`：`guard()` 放弃 `browserSameOriginMarker` 这个附加要求，信任判定对齐官方围栏语义 = `isLoopbackRequest()` 单独裁决（回环套接字 + 回环 Host + 非 cross-site + origin 缺省或与 Host 匹配）。跨站/异源仍 403；无标记的回环请求（桌面壳转发形态）放行。同步更新 routes.ts/loopback.ts 的注释与文档说明。
- 客户端不再静默吞错：`loadCfg` 失败、`saveCfg` 失败改为 toast+diag 上报，杜绝「看起来生效其实没存上」。
- 测试：`tests/routes.spec.ts` 新增 guard 级用例——桌面 HTTP 转发形态（仅 `host: 127.0.0.1:19387`，无 origin/sec-fetch）→ 200；异源 Origin → 403；`sec-fetch-site: cross-site` → 403；非法 Origin/非回环 Host → 403；桌面 WS 形态 → 200。
- `scripts/live-dsh-check.sh` 围栏探针改语义：无标记回环请求现在应通过；异源/cross-site 仍 403。
- README.md/README.zh.md 的围栏/桌面段落改写为准确表述（此前「桌面版不碰围栏」的说法是错的），同 commit 重记哈希。
- commit：`fix: 桌面版壳转发的无 Origin/Sec-Fetch-Site 请求被插件围栏误拒，对齐官方围栏语义`。

**Step 2（feat，时间线删除）**：删 `TimelineRail`/`RailPopover`/轨道定位与拖拽逻辑/450ms tick 与轨道专用 MutationObserver/`vx-rail-scroller` 滚动条隐藏/`TimelineTab` 与三个 cfg 开关（`timeline`/`timelineLeft`/`starsOnly`，protocol.ts 类型与默认值同步删，旧状态文件多余字段容忍加载）/`toggleStar`/`forkAt`/轨道样式块；保留 `fetchTurns` 数据链（新消息轮询驱动挪到 OverlayRoot，保证芯片及时出现）、`S.anchors`+`scrollToSeq`（搜索定位）、`stars` 状态字段（备份兼容）；AboutTab 文案、package.json description 去「时间线」；README 两语种功能列表/配置表/展示图（删 timeline.png 格位并重排）同步+重记哈希。commit：`feat: 移除消息时间线轨道（系统已内置对话时间线），保留芯片与搜索定位链路`。

**Step 3（feat，外观）**：删 `custom.tsx:2062` Chromium 文案；全局删除点阵（styles.ts 全部 `.vx-pattern` 规则 + 10 处节点）；加强 LG 位移贴图在大面板中部的可感知度（调 `LG_MAP` 内衬/模糊与 `feDisplacementMap` scale，保留 `@supports not` 回退）；液态模式下 globalGlass 动态 CSS 对弹窗/菜单/下拉/系统设置弹窗改用 `url(#vx-lg)`（JS `CSS.supports` 门控，不支持回退 blur；实现时在运行中的 shell 里确认系统设置容器的选择器）；更新「全局浮层玻璃」提示文案；README 玻璃描述两语种同步+重记哈希。无头 Edge 截图对比辅助调参，最终以你在桌面版的目验为准。commit：`feat(外观): 液态玻璃覆盖三大界面并全局移除点阵，删除桌面端无关文案`。

**Step 4（feat，额度改版）**：`HeaderBalance` 胶囊无 Key 时显示 `≈¥X.XX · 今日 N 次`（有 Key 且成功则照旧显示真实余额）；`BalancePanelContent` 重排——默认区只放用量趋势/预算/今日明细/扫描按钮，「余额查询（可选，需要 API Key）」折叠区（配置过 Key 则默认展开）内含 Key 输入/保存/刷新/来源说明/余额行，未配置时不再有任何报错文案；`pricing.ts` 对照官方价格页核对并更新 `DEEPSEEK_PRICING_CHECKED_ON`，面板加一行「按官方价目表折算的估算值，可能与账号账单有差异」说明。commit：`feat(额度): 无 Key 默认本地用量费用估算，余额查询收为可选项`。

**Step 5（docs+chore）**：版本升 0.7.0；CHANGELOG 0.7.0 条目；README 两语种全面对齐（功能列表、桌面版实测声明、隐私段落措辞、live-check 围栏描述）+重记哈希；AGENTS.md 更新围栏语义与桌面验证状态。commit：`docs: 发布 0.7.0——桌面版适配修复说明与文档对齐`。

## 五、验证方案（质量优先）

1. **每步门禁**：check:readme / typecheck / test / build / smoke 全绿才 commit（CI 同款）。
2. **Web 侧活体**：`scripts/live-dsh-check.sh`（scratch DSH_HOME，改后围栏语义）全过；无头 Edge 验证客户端视觉（点阵全无、面板液态、额度布局、无轨道）。
3. **桌面版实测**：`~/.dsh/profiles/desktop/package.json` 改 link 本地构建 → 重启 F:\DSH → 先用 node 直连 127.0.0.1:19387 按桌面形态（无 origin/sec-fetch、Host=127.0.0.1:19387）逐路由探测（/state GET+POST 往返、/export×3、/search、/usage-scan、/mermaid、/custom-plugin/mermaid.js 全 200；异源与 cross-site 探针仍 403）→ GUI 人工清单：个性化保存重启后仍生效、三种导出落盘、Mermaid 思维导图就地渲染且 mermaid.live 链接可打开（Electron 外链若被拦则记录并加复制链接兜底）、额度胶囊 ≈¥+次数、折叠余额区、三处液态效果、点阵全无、时间线 UI 全无而芯片/搜索定位仍在、项目文件夹/提示词/引用回复照常。
4. 全部通过后：desktop profile 恢复 registry 依赖 `@alexpeng/dsh-custom-plugin@^0.7.0`，由你在交互终端（127.0.0.1:7890 代理）执行 `pnpm publish`。

## 六、风险与注意

- README 与 README.i18n.yaml 哈希必须同 commit，否则 check:readme 红。
- profiles/desktop 归桌面版自带的 dsh 管理，只手改 package.json 做 link，不跑全局 CLI，验收后恢复。
- 围栏放宽=「无浏览器标记的回环请求」从拒绝变为放行（官方同语义）；本机任意进程本可直读 $DSH_HOME 数据，实际信任面不变，README 安全段落如实改写。
- 液态玻璃调参是视觉活，代码侧用截图对比逼近，最终验收以你的目验为准，不满意则在该步内继续迭代（不进下一步）。


## 七、执行记录与经验（2026-09-30 收官）

本计划已全部执行完毕：主线上共 11 个 commit（`5d48d81` 计划入库 → `4143269` 围栏 → `017bc11` 时间线 → `e992097` 外观 → `c475219` 额度 → `9d40fbe` 发布文档 → `6988664` 额度失败可读化 → `8100aab` 液态作用域 → `6213aad` 点击开合 → `bad14aa` 色板深色适配 → `7b46f0e` 饱和度压缩 → `15af1e0` 收尾文档），GitHub main 已推送且 CI 绿，npm 0.7.0 已发布（latest），desktop profile 已用桌面自带 CLI 恢复 registry 安装并删除临时联接与备份。143 测试全绿，桌面探针 11 pass / 0 fail。

执行中确立的经验（已沉淀进 CHANGELOG 0.7.0 与 AGENTS.md，此处留档缘由）：

1. **计划与实际的三处偏差及原因**：
   - 液态玻璃一度引入「全表面低频湍流位移」（已被整体 reset 撤销）——用户要的是「和额度卡片一样的原效果」，不是新效果；感知不一致的真凶是 CSS 作用域缺陷（见 3）。
   - 时间线删除前评估过「轨道 DOM 行定位（seqAnchor）需保留给搜索定位」，实际删净后搜索定位单靠 turnTail 锚点即工作正常，未观察到回退场景劣化。
   - 「深色强制重置背景」在计划中保留，色板深色适配落地后此逻辑成为障碍，整段移除。
2. **验证方法的分界**：合成测试页（提取 STATIC_CSS + 滤镜参数的自建页 + 无头 Edge 截图）适合调参迭代，但会把「类挂载位置」类 bug 完全掩盖（vx-liquid 与 vx-root 在合成页同元素、真实应用分居两处）；**凡涉及选择器匹配、挂载点、计算样式的结论，必须真机 CDP 验证**——桌面版 `--remote-debugging-port=9222` 启动后用 puppeteer-core `browserURL` 连入，可读计算样式、可点真实 UI（注意按钮多为 toggle，脚本要先感知状态再点击）。
3. **本轮三个非显而易见的根因**（完整版见 CHANGELOG 0.7.0 与仓库记忆）：
   - forbidden：插件围栏额外要求同源标记，桌面壳转发形状（无 origin/sec-fetch-site）全灭；对齐官方围栏语义修复。
   - 「面板没有液态」：主题毛玻璃底色 64% 特异性压过 10% 液态底色，翻盘选择器要求 vx-liquid 在 .vx-root 内部（实际挂 html）从未匹配。
   - 余额间歇失败：本机代理间歇性 TLS 解密（SELF_SIGNED_CERT_IN_CHAIN），宿主 Node fetch 间歇命中；错误翻译 + 客户端退避重试解决。
4. **流程教训**：`pnpm test | tail && commit` 会吃掉 vitest 退出码导致带病提交——门禁链必须用退出码变量判断；两轮均靠随后补测发现并修正。
5. **收尾状态**：docs/ 三张截图（liquid-glass / balance-usage / settings-appearance）仍为旧界面，下次改版时顺手重截。
