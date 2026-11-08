# Changelog

All notable changes to this project are documented here. The format loosely
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions
follow [Semantic Versioning](https://semver.org/).

## Unreleased — 2026-11-08

### Fixed

- **背景动效"看不见"的真瓶颈（第二轮定性）**：不是墨色不够黑，而是壳把墨色吃掉
  了。实测（Desktop 1280×822 CSS / DPR 1.5、浅色 天青灰、玻璃开）：正文列叠了
  **三层**半透明表面（`--dsw-alias-bg-base` 两次 + `--dsw-alias-bg-layer-1`
  一次），透到眼睛的墨色是各层 alpha 补集的乘积 —— 0.5 × 0.5 × 0.6 = **10%**，
  侧栏 24%。162 luma 的墨色阶复合后只剩 16，所以上一轮把 ΔL 从 −0.31 推到 −0.7
  也只让观感从"几乎无"变成"很浅"；玻璃关时表面完全不透明，透过率为 0。
- **背衬 token 组（替代上一版的纱）**：只要挂载了任意渲染器（玻璃开或关），外观
  绘制就把上面三个 token 改成色板本色 + `BACKDROP_ALPHA_BASE = 0.25` /
  `BACKDROP_ALPHA_LAYER1 = 0.27` / `BACKDROP_ALPHA_SIDEBAR = 0.27`。补集相乘后
  正文列透射 ≈ 0.41、侧栏 ≈ 0.40（墨色可见度 4×），而 RGB 与画布底色一致，所以
  页面色相一点不动，开关差异只剩墨色。卡片、弹窗、菜单、输入框使用自己的不透明
  填充，不受影响；`-bg-layer-2` / `-bg-overlay` 刻意不碰（它们画菜单，实测没有
  正文表面压在后面）。`appearanceTokenKey` 的第三维从 `veil` 改名 `backdrop`，
  面板提示改为"动效开启时页面底色会调成半透明以便透出纹理（卡片和弹窗保持不
  透明）"，仍然不会替用户打开玻璃。
- **墨色不透明度定标**：`LIGHT_INK_DELTA = −0.7`（浅色表面 234.8 → 墨色 55，
  179 luma 阶）；`DARK_INK_DELTA = +0.15` 不变（DeVries-Rose：暗面等感知点本来
  就要相对更强的阶，不是同一个数）。
- **`flow` / `static` 的覆盖面积**：新增 `FLOW_LEVEL_FLOOR = 0.45`，值噪声不再
  压在 `+` / `*` 这两级（12 px 下每格只有 5.5% / 4.4% 的墨色面积），典型格子上移
  到 `#`–`%`（12–17%），墨色质量 2–3×。这是"看得见"的主因，ΔL 只是次要项。

### Added

- **内容区感应淡出（空间遮罩）**：`src/client/bg-focus.ts` 提供两档渲染器共用的纯
  几何。淡区是正文读取列（输入框的横向范围 × 从滚动视口顶到输入框顶），每 350 ms
  重新实测一次并在每次外观重绘时推送，所以 resize、侧栏折叠/展开、面板开合、全屏
  切换后都跟着文字走。`focusWeight` 用矩形外的对角距离（不是逐轴 `min`）、
  `FOCUS_FEATHER_PX = 116` 羽化、`FOCUS_FLOOR = 0.3` 下限后 smoothstep，边缘是
  渐变带而不是硬切；淡区不消失（正文背后仍有极淡纹理）。ASCII 档用
  `buildFocusCaps` 一次性把每格等级压到 `round(lastLevel × weight + dither)`
  （复用同一 `Uint8Array`，只在网格或淡区变化时重建，绘制循环每格一次查表）；
  光影档新增 `u_focus`（CSS px vec4）+ `u_focusFeather` / `u_focusFloor`，在 GLSL
  里乘同一个 `focusWeight()`，`u_focus.z <= 0` 即禁用。`grain` 原有径向淡出删除，
  改由这一层统一（避免两套淡出叠加出双倍宽的边）。
  实测（背衬 token 组 + `flow`、浅色、标准墨色、1:1 裁切）：整页 `>2` luma
  32.5%（p99 53、均值 5.5），右留白峰值 74、侧栏 61，正文列 3.2%（最大 50、
  均值 1.05）；在渲染器自己的画布上（文字不会落在那里）正文列达到等级上限的像素
  只有 0.86%，右留白 7.0%、侧栏 9.8%，且随 1280×822 → 1600×1000 → 复原的 resize
  跟着移动。`liquid` 整页 77.6%（p99 51）。

### Tests

- `tests/bg-focus.spec.ts`：矩形归一化/相等、对角羽化、零羽化硬边、
  `buildFocusCaps` 的限幅与缓冲复用；`tests/bg-shader.spec.ts` 增加 `u_focus`
  映射与 `setFocus` 只重绘一次的用例；`tests/palette.spec.ts` 覆盖 `backdrop`
  维度的四种 key 形状；`tests/bg-ascii.spec.ts` 新增 `FLOW_LEVEL_FLOOR` 下限与
  均值用例（防止后续"调淡"把格子压回空白半边），并把墨色阶定标带宽改到
  −0.7（165–195 luma）；`tests/bg-params.spec.ts` / `tests/bg-layer.spec.ts`
  跟随 liquid 强度上限与中性底色改动。

## Unreleased — 2026-11-06

### Added

- **背景动效骨架（默认关闭）**：扁平配置 `bgFx: 'none' | 'ascii' | 'shader'`
  （默认 `'none'`），以及 `src/client/bg-layer.ts` 的决策门
  （关闭 / 无 2D canvas / `animated` / `static` / `paused`）、幂等挂载/卸载与主题取色。
  层是 `<body>` 下的 `div#vx-bg`（`position:fixed; z-index:-1; pointer-events:none;
  aria-hidden`），由 `applyAppearance` 同步、插件 disposer 移除；默认关闭时不含
  canvas、rAF 或第三方库，也不改变任何可见像素。
- **ASCII 渲染器（Phase 2）**：`src/client/bg-ascii.ts` 在 `#vx-bg` 内挂一块 canvas。
  效果函数只向复用的 `Uint8Array` 写等级（不产出字符串），glyph 按等级预烘焙进
  单块 atlas（单一墨色 `inkFor`，ΔL 0.13；level 0 恒为空白字形，主题只换墨色），
  每帧仅一次 `fillRect` + 每非空格一次 `drawImage`，无逐帧小分配。网格由实测等宽
  字体的 `advance` 定 cell（`cellH = fontPx × 1.15`），DPR 上限 2，`density` 乘在
  cell 尺寸上，`cols/rows` 硬上限 240/96 且超限时放大 cell 而不是截断。先只提供
  `flow`（默认可动）与 `static`（一次性静止帧，零 rAF）；系统预设与自定义面板留待
  下一阶段。
- **ASCII 系统预设（Phase 3a）**：新增 `rain` / `ocean` / `starfield` / `ripple`
  四套独立效果（各自一种画面语言，不是同一算法换参数）：`rain` 逐列下落雨丝
  （亮头 + 二次淡出拖尾、14% 空列、16 级 `classic` ramp）；`ocean` 低频横向波涌
  + 固定泡沫点（`dots` + 抖动）；`starfield` 稀疏视差星场（空白格 >50%，不开
  抖动）；`ripple` 三固定中心同心环（`CELL_ASPECT = 1.9` 校正单元纵横比、关抖动
  保等值线）。墨色仍只由 surface 亮度按固定 ΔL 派生，浅色/深色与全部色板下都成立，
  没有霓虹或高饱和撞色。每套 spec 附带可写的 `ranges`（`density`/`speed`/`fps`/
  `fontPx`/`opacity` 上下限）与默认值，留给下一阶段的自定义面板；配置仍是扁平
  boolean/number/string。
- **Shader 档（Phase 3b，WebGL1）**：`src/client/bg-shader.ts` 用一块 WebGL1
  上下文、一个全屏三角形（`[-1,-1, 3,-1, -1,3]`）与内联 GLSL 实现 GPU 背景，
  零第三方依赖。uniform 契约固定为 `u_time` / `u_resolution`（CSS px）/
  `u_dpr`（≤2）/ `u_surface` / `u_ink` / `u_speed` / `u_density` /
  `u_intensity` / `u_seed`，`shaderUniforms` 逐项夹紧到 `SHADER_UNIFORM_RANGES`。
  两套画面语言：`liquid` 低频 domain-warp 墨云（3 octave fbm + 竖向呼吸，
  24 fps 可动）、`grain` 静态细颗粒（CSS 像素网格 + 低频雾 + 边缘渐隐，零 rAF）。
  墨色仍由 `inkFor(surface, isDarkSurface(surface))` 派生（浅色固定 ΔL 0.13、
  深色 +0.20），浅色/深色与全部色板下都成立，没有霓虹或高饱和撞色。两档互斥：
  切换经 `swapBgRenderer` 先建后拆，离开 shader 档删除 program/buffer 并
  `WEBGL_lose_context`；`static` 与 `prefers-reduced-motion` 只画首帧，页面隐藏
  停 rAF 并冻结时间；WebGL 探测失败、编译失败或运行中上下文丢失都回退 ASCII，
  并以 toast 明示（每页一次），不会静默换成另一种画。`bgFxPreset` 仍是单个扁平
  字段，按当前档位单向收窄。
- **背景动效面板（Phase 3c）**：`AppearanceTab` 内新增档位（关闭 / 字符 / 光影）、
  预设选择、参数滑块与「恢复默认」。六个扁平字段 `bgDensity` / `bgSpeed` /
  `bgFps` / `bgFontPx` / `bgOpacity` / `bgIntensity`（`-1` 表示跟随预设），面板
  写入前按当前预设声明的 `ranges` clamp，渲染器 `resolveAsciiSpec` /
  `resolveShaderSpec` 再夹一次；字符档显示 5 项，光影档显示 4 项（字号/浓度
  不适用），未知预设随档位回落到该档默认值。拖动滑块即时写入存储并重绘，POST 经
  320 ms 防抖只发一次；换档、换预设与恢复默认立即保存并取消待发请求。玻璃关闭时
  面板明确说明背景被不透明内容层完全遮住，且不会替用户自动打开玻璃。面板只在
  弹层/设置页打开时挂载，`AppearanceTab` 仅订阅 `cfg` 与 `dark`。
- **固定降级阶梯（只降不升）**：L1 fps 24→15、L2 密度 ×0.75、L3 单色（ASCII 档
  已是单墨色）、L4 关抖动、L5 画一帧后停 rAF、L6 只留底色。60 帧滑窗均值超过
  `budget × 1.6` 记为坏窗，连续 2 个坏窗降一档；好窗抵消一个坏窗；切换预设回到
  L0。L6 不在自动路径上（L5 已停 rAF），仅保留给显式关闭路径。
- **动效生命周期与回收**：读取 `data-vx-bg-motion` 与 `--vx-bg-tint`；
  `visibilitychange` 隐藏时停 rAF 并冻结累计时间，返回时立即补画一帧；
  `prefers-reduced-motion` 与 `static` 预设都只画静止帧；主题切换重建 atlas 并立即
  重绘。卸载回收 canvas、rAF、resize 定时器、`visibilitychange`、reduced-motion 与
  resolution 查询、`ResizeObserver`、atlas/probe 画布和等级缓冲，并已并入
  `custom.tsx` 底部 disposer。

### Changed

- **「恢复默认参数」语义写明**：按钮只把六个扁平参数恢复为 `-1`
  （「跟随当前预设」），档位与预设保持不变——点一下不该突然换画。按钮改名为
  「恢复默认参数」，`title` 提示与按钮旁的灰字（「仅重置参数，不改档位与预设」）
  都把这条语义写在面板里；`resetBgParams` 行为本身未变（已有单测覆盖档位/预设/
  玻璃字段原样保留）。
- **背景配置改为枚举**：`bgFx` 从布尔迁移为 `'none' | 'ascii' | 'shader'`
  （默认 `'none'`；旧存档 `true → 'ascii'`、`false → 'none'`，未知值回落
  `'none'`），`bgFxPreset` 改为一个承载两档 id 的扁平字段：ASCII 档
  `flow`/`rain`/`ocean`/`starfield`/`ripple`/`static`（默认 `flow`），shader 档
  `liquid`/`grain`（默认 `liquid`）。`normalizeCfg` 按当前档位单向收窄，跨档或
  未知 id 回落当前档默认值。挂载门按档位判定：shader 需要 WebGL1，只有 2D
  canvas 时同层回退 ASCII；`body` 只在背景真正挂载时透明，`bgFx:'none'` 与
  渲染器落地前的页面逐像素一致（活体 A/B 实测差 0）。

- **等级语义统一（修正 Phase 2 浅色主题反转）**：level 0 在浅色与深色主题都渲染为
  空白字形，ramp 只随等级增加墨密度；主题切换只换墨色（`inkFor`），不再反转字形
  与 alpha 斜坡。此前浅色主题会把空白格画成最密字形，导致 `rain`/`starfield`
  的空白帧被铺满（rain 每帧 14,010 次 blit）；修正后 rain 3,490、starfield 280。
- **预设切换复用**：`setPreset` 只重置降级阶梯，复用同一 canvas、等级缓冲与网格；
  atlas 仅在 key（charset/ink/theme/dpr/tile 尺寸/fontPx/opacity）变化时重建，
  切换后立即按当前 motion 补画一帧（静止档停 rAF，动效档重启 rAF），不会白屏或
  残留上一套的帧。
- **面板不再挡输入区（Round 2）**：新增 `src/client/panel-bounds.ts`（纯几何，
  未依赖 DOM）——`pickComposerTop` 从当前页面的输入框里挑最靠下且尺寸合理的那个，
  `panelFrame` 把面板夹进可视区、并把高度截到 `输入框顶 − 10px`
  （`COMPOSER_CLEARANCE`）。会话头部的弹框改用它：默认位置右上、高度随窗口变，
  1280×822 下实测 `774..1204 × 74..692`，输入框 top=702，不重叠；拖到窗口外会被
  夹回可见范围。`Escape`（面板内键）与点击面板外都会关闭，清理时把焦点还给触发
  按钮（关闭后 `activeElement` 回到 `.vx-header-btn`）。面板是 `role="dialog"` +
  `aria-modal="false"`，Tab 不设陷阱，顺序仍在面板内。11 个几何单测在
  `tests/panel-bounds.spec.ts`。
- **弹窗遮罩对齐原生（Round 2）**：`.vx-modal-mask` 由 `rgba(8, 10, 16, .4)` 改为
  `.25`。Desktop 1280×822 实测，原生确认框把页面压到原亮度的 0.764，插件弹窗
  原本是 0.616，两者并排能看出"多盖了一层"；改后为 0.762。色相本来就一致，只调
  alpha，不改任何画面数值。
- **深色墨色加深（Round 2）**：`DARK_INK_DELTA` 从 0.11 提到 0.20（浅色仍 −0.13）。
  深色色板下内容面 0.5–0.7 alpha，阅读列只剩 8–13% 墨色，旧值实测只差 2 luma，
  表现为"完全平板"；新值在同口径 on/off 差分下把背景贡献从 2.2 luma 提到 4.2–4.3
  （std 0.33 → 0.54–0.68），纹理出现但仍低饱和、不发脏。
- **档位文案改为「关闭 / 字符 / 光影」（Round 2）**：面板不再把实现名词摆到用户
  面前（原「WebGL」）；说明改成"整页铺一层很淡的背景动效，垫在内容下面，不挡任何
  操作"；帧率滑块的 `fps` 单位去掉（标签已写「帧率」）；回退 toast 与玻璃关闭提示
  同步改写。
- **面板内拖参数不再触发全文档重算（Round 3）**：外观绘制改为按
  `appearanceTokenKey(bg, glass)` 去重——滑杆每动一次都会重跑 `applyAppearance`，
  但色板与玻璃没变时不再重新注册同一套主题 token；`setDynCss` 同时改为文本未变就
  跳过写入（原实现每次重写约 21k 字符的样式表，触发全文档 style recalc）。
  Desktop 真机、同口径（同一 6.5 s 拖动、同一插桩）：长任务 21 个 / 2,375 ms →
  11 个 / 813 ms，`documentpreview` 与侧栏 `layout` 从热点列表消失；剩余成本是
  atlas `drawImage` 搬运（968 ms / 37%）。新增 `appearanceTokenKey` 单测
  （三形态分离、玻璃折入 key、同输入稳定）。

- **构建与测试队列切到 dsh 0.2.1-rc.5**：九个 `@deepseek-ai/dsh-*` devDependencies
  从 0.2.1-rc.3 升到 0.2.1-rc.5；`pnpm-workspace.yaml` 为同日发布的 35 个
  `@deepseek-ai/dsh-*@0.2.1-rc.5` 包补 `minimumReleaseAgeExclude`（未删旧条目），
  锁文件只做同名包版本替换。类型检查、214 单测、build、smoke 全绿；构建产物与
  已发布的 0.9.3 逐字节一致（`lib/client.js` sha256 `984e1b6c…`、
  `lib/index.js` `88dc8166…`），因此没有重发 0.9.3。
- **rc.5 事实同步**：README 双语兼容表与桌面段、AGENTS 的桌面钉版事实更新到
  0.2.1-rc.5；`tests/manifest.spec.ts` 与 `scripts/smoke.mjs` 的版本探测点补
  rc.4/rc.5；`tsdown.config.ts` 注明 11 项 seed 表在 rc.5 上未变。

### Verified

- 已发布 0.9.3 在隔离 dsh 0.2.1-rc.5 profile 中安装并冷启动：boot 图 71 行、
  五个 `dsh.client.inject` 目标齐全、客户端 bundle 服务 208,217 字节、Mermaid
  本地引擎 3,572,661 字节；活体探针 16 通过 / 1 跳过（无会话）。
- 真实桌面版 0.2.1-rc.5（运行中的 Host）桌面形态探针 11 通过 / 0 失败；1 项
  会话相关链路因尚无宿主注册会话跳过。探针前后状态文件逐字段一致。
- 平台 seed 表 11 项与 `PLATFORM_MODULES` 完全一致（从 Desktop asar 的
  `dsh-web-frontend` bundle 读取）。
- 背景 ASCII 渲染器在隔离 dsh 0.2.1-rc.5 活体宿主（1440×900，有会话）实测：
  `flow` 空闲 10 秒 24.27 fps、帧间隔 p50 41.1 ms / p95 45.4 ms / max 45.8 ms，
  0 掉帧、0 long task；6 秒连续滚动 24.33 fps、p95 45.5 ms、0 掉帧；6 秒逐字
  流式追加 24.51 fps、p95 45.5 ms、0 掉帧。隐藏 2.5 秒内 0 帧，返回后立即恢复
  24 fps；`prefers-reduced-motion`/`static` 档 3 秒 0 帧但保留静止画面。DPR 2 与
  3 均按 2 渲染（backing 2880×1800）。关闭 `bgFx` 后 `#vx-bg` 与 canvas 消失，
  `body` 回到 `rgb(233,235,238)`，全页与渲染器落地前基线逐像素差 0。
- ASCII 六档预设在同一隔离 0.2.1-rc.5 活体宿主（1440×900，DPR 1，浅色）逐套实测
  （每套 POST 配置后 reload，空闲 10 秒 + 6 秒合成滚动）：`flow` 23.98 fps、
  p95 48.6 ms、每帧 7,490 blit；`rain` 23.98 fps、p95 42.8 ms、3,490 blit；
  `ocean` 20.58 fps、p95 49.7 ms、3,009 blit；`starfield` 14.41 fps、p95 70.5 ms、
  280 blit；`ripple` 20.58 fps、p95 55.7 ms、7,824 blit。全部 0 掉帧
  （>100 ms / >150 ms 均为 0）、0 long task；`ocean`/`starfield`/`ripple` 的低帧率
  是预设自定的节奏（20/15/20 fps），p95 与目标帧间隔一致，不是性能受限。
  浅色/深色与各色板截图逐套留存；像素亮度 min 202–206、max 235，墨色随 surface
  派生，无高饱和撞色。
- Shader 两套风格在同一隔离 0.2.1-rc.5 活体宿主（1440×900，DPR 1，有会话）逐套
  实测（POST 配置后 reload，空闲 10 秒 + 6 秒合成滚动）：`liquid` 空闲 240 帧
  （23.98 fps），帧间隔 p50 41.7 ms / p95 42.7 ms / max 48.6 ms；滚动 144 帧
  （23.98 fps）、p95 42.1 ms / max 49.0 ms；两项 0 掉帧（>100 ms / >150 ms 均为
  0）、0 long task。`grain` 声明 `animated:false`：挂载后空闲 10 秒 0 次
  `drawArrays`，6 秒滚动同样 0 次（首帧即停）；`liquid` 配
  `prefers-reduced-motion` 时 `data-vx-bg-motion="static"`，6 秒 0 次绘制。
  DPR 1 下 backing 1440×900，实际后端由 `WEBGL_debug_renderer_info` 读到
  `ANGLE (NVIDIA GeForce RTX 5070 Laptop GPU, Direct3D11 vs_5_0 ps_5_0)`（只取
  后端名，不报占用率）。像素亮度：`liquid` min 219 / max 235 / std 5.2（ASCII
  `flow` 为 std 5.48），`grain` min 215 / max 235 / std 4.4；浅色/深色截图逐套留存。
- 无 WebGL 回退实测（同一宿主，页面脚本执行前把 `getContext('webgl')` 全部返回
  null）：`bgFx:'shader'` 下只创建 1 个 ASCII canvas、0 个 shader canvas，toast
  显示“当前环境无法创建 WebGL 背景，已回退到字符动效。”，ASCII 的 `fillRect`
  1.2 秒内 44→73（约 24 fps），`body` 透明但有画，无空背景。运行中上下文丢失
  实测：对真实 context 调 `loseContext()`，120 ms 内 shader canvas 0、ASCII
  canvas 1、toast 出现，随后持续绘制；旧 handle 的 destroy 再调一次
  `loseContext` 完成回收（计数 1→2，未重复丢失同一 context）。
- `pnpm check:readme`、`pnpm typecheck`、`pnpm test`（243）、`pnpm build`、
  `pnpm smoke` 全绿。
- Phase 3a 后：`pnpm typecheck`、`pnpm test`（251，29 个文件，`bg-ascii` 23 项）、
  `pnpm build`（`lib/client.js` 240.98 kB）、`pnpm check:readme`、`pnpm smoke`
  全绿。
- Phase 3b 后：`pnpm check:readme`、`pnpm typecheck`、`pnpm test`（280，30 个文件，
  新增 `bg-shader` 20 项、`bg-layer` 档位判定与先建后拆 8 项、`state` 跨档收窄）、
  `pnpm build`（`lib/client.js` 264.65 kB / gzip 69.75 kB）、`pnpm smoke` 全绿。
- Round 2（无感融入，Desktop 0.2.2-rc.1 / 1280×822 / DPR 1.5 实测）：
  - 面板几何：新 build 下 `774..1204 × 74..692`，composer 文本 top=702 →
    `overlapH = −10`；拖到 (1250,700) 被夹成 `bottom ≤ composerTop − 9`；窄窗
    (420) 收成 396 宽。`Escape` 关闭后 `activeElement` 是 `.vx-header-btn`；点
    (320,400) 空白处关闭后同样回到触发按钮；Tab 连按 18 次焦点未离开面板。
  - 切换中间帧（CDP screencast 逐帧采样）：关→字符 `232.6→231.5`（单帧 1.1）、
    字符→光影 `231.5→232.1`（单帧 1.0，切换帧 diff 3.71 后回落 0.02/帧）、
    光影→关 diff 全 0；色板 天青灰→淡金 单帧 4.9；主题 浅→深 单帧 209.3→32.4、
    无中间值帧。所有帧 `mainStd ≥ 10.2`，没有空白帧、没有"深色底 + 浅色画布"
    残留帧。
  - 采样 20 组色板（浅色 6 组 ΔL .110–.126，深色 6 组 .174–.185，浅色 meanSat
    .004–.068）。现有 20 组色板全部低饱和，没有真正的高对比极端色板，该极端项
    无从抽样——结论如实记为"不存在"，不用人工高饱和组合去补数。
  - 原生确认框（临时工作区 `删除工作区` → 取消，用户工作区未删）与 `vx-confirm`
    叠在背景上的像素采样：遮罩前后亮度比 0.764（原生）/ 0.762（插件）；遮罩下
    背景纹理保留 `range 66` vs `65.1`（差 2.7%）；原生对话框面 211.2、正文最低
    16.9，插件玻璃框面 226.2、正文最低 35.9。临时文件夹已删净。
  - `pnpm check:readme`、`pnpm typecheck`、`pnpm test`、`pnpm build`、
    `pnpm smoke` 全绿。

## 0.9.3 — 2026-10-26

### Changed

- **浮层/文件夹节点订阅收窄**：`OverlayRoot` 只选它渲染的 14 个字段（overlay/config/
  theme/session），`FolderNode` 只选 `folderAdd` / `folderWsPick` / `dropHint`；
  整店 `useS()` 从 19 降到 17。流式/用量/toast 写入不再重渲染整个浮层树或每个文件夹
  节点。

### Verified

- 0.9.3 tarball 装进隔离的 dsh 0.2.1-rc.3 profile（无兼容豁免）并冷启动；活体探针
  全部通过，1 项因无会话跳过（时间线/导出/搜索，由单测覆盖）。
- `pnpm check:readme`、`pnpm typecheck`、`pnpm test`（214）、`pnpm build`、`pnpm smoke`
  全绿。

## 0.9.2 — 2026-10-26

### Changed

- **无障碍与电池**：天气特效尊重 `prefers-reduced-motion`（减少动态时不启动
 动画帧），装饰画布加 `aria-hidden`；余额 60 秒轮询在页面隐藏时暂停、回到前台
  立即刷新；6 个浮层补齐 `role="dialog"` / `aria-modal`、焦点进入、Tab 陷阱、
  Escape 关闭与关闭后的焦点恢复；余额入口改为可键盘操作的 `role="button"` 并带
  `aria-expanded` / `aria-haspopup`，关键图标按钮补 `aria-label`。
- **顶栏重渲染**：`HeaderBalance` 从整店订阅改为只选余额、今日用量行与面板开关，
  并对今日次数/费用做 `useMemo`；流式回合的 store 写入不再重渲染顶栏或重算台账。
- **常驻组件订阅收窄**：`MermaidInPlace`、`QuoteDock`、`QuoteButton`、`Toasts`
  同样改为 `useSSelector`；它们大多时候渲染 null 或很小，不再被流式/用量写入唤醒。
  剩余 19 个 `useS()` 多为打开时才挂载的面板，待逐项 profile。

### Tests

- Mermaid 渲染从 `src/client/custom.tsx` 抽到独立的 `src/client/mermaid-render.ts`；
  `pnpm smoke` 现在用真实 Mermaid 引擎在无头 Edge 中覆盖失败路径（无效代码不残留
  `body > div#dvx-mmd-*`、有效图渲染、旧错误卡清理、引擎缺失干净失败），并新增
  `tests/mermaid-render.spec.ts` 9 个单测。反证：撤掉 `suppressErrorRendering` 与
  清理后 smoke 恰好红 2 项，还原后全绿。
- 扫描逻辑抽到 `src/client/mermaid-scan.ts`，smoke 增加 5 项 wrapper / 失败回退 /
  切换 / 主题翻转 / restore 断言；新增 `pnpm bench:mermaid` 合成长回合基准。
  结论：1000 块时 warm p95 ≈2.8 ms，扫描收窄收益可忽略；真实 Mermaid ≈10 ms/图，
  懒渲染只在单回合大量图时有意义，暂不引入。

### Verified

- 0.9.2 tarball 装进隔离的 dsh 0.2.1-rc.3 profile（无兼容豁免）并冷启动；活体探针
  全部通过，1 项因无会话跳过（时间线/导出/搜索，由单测覆盖）。
- `pnpm check:readme`、`pnpm typecheck`、`pnpm test`（214）、`pnpm build`、`pnpm smoke`
  全绿。

## 0.9.1 — 2026-10-25

### Fixed

- **Mermaid 解析失败不再在页面底部留下错误图**：Mermaid 默认会在
  `render()` 抛错前把一个全宽炸弹图追加到 `<body>`（`div#dvx-mmd-*`）并留在
  那里。现在 `mermaid.initialize` 打开 `suppressErrorRendering`，并在
  `finally` 中清理 `#id` / `#d<id>` / `#i<id>` 三个临时节点；扫描时也会移除
  旧版本遗留的同名节点。失败代码块按既有设计回退为原始代码，不再出现
  “Syntax error in text / mermaid version …” 卡片。

### Verified

- 无头 Edge 复现旧行为（`body > div#dvx-mmd-*` 残留 + “Syntax error in text”），
  并验证 `suppressErrorRendering` 与 `finally` 清理两条路径都能清除；合法
  flowchart 仍正常渲染。
- `pnpm check:readme`、`pnpm typecheck`、`pnpm test`（205）、`pnpm build`、
  `pnpm smoke` 全绿。

## 0.9.0 — 2026-10-25

兼容策略改为开放式下限：宿主不再因为 dsh 更新而把插件判为“不支持”。

### Changed

- **兼容范围改为 `>=0.1.7-rc.2`（无上界）**：`engines.dsh` 与
  `@deepseek-ai/dsh-tools` peer 同步放宽。dsh 0.2.1-alpha.4+ 优先读
  `engines.dsh`，旧宿主读 peer；两者都放行所有高于下限的版本，因此未来任何
  dsh 发版（包括 0.2.1-rc.3、0.2.1 正式版、0.3、1.0）都不必先等插件发版才能
  加载。实测过的版本改为证据记录（README 兼容表 / 本文件），不再是闸门。宿主
  的兼容门只有“放行/拒绝”两态、没有“仅警告”，这是不再把未实测版本挡在门外
  的唯一实现方式。
- **构建与测试队列切到 dsh 0.2.1-rc.3**：九个 `@deepseek-ai/dsh-*`
  devDependency 从 rc.2 升到 rc.3，锁文件同步。`pnpm smoke` 的兼容断言改为
  “下限必须拒绝 0.1.7-rc.1、无上界必须放行 99.0.0、`engines.dsh` 与 peer
  判定一致”，`tests/manifest.spec.ts` 的放行/拒绝清单同步改写。
- **新增定时兼容 canary**：`scripts/compat-canary.mjs` +
  `.github/workflows/compat-canary.yml`，每天取 npm `latest`/`next` 中较高的
  dsh，在临时 `DSH_HOME` 里安装**已发布**插件、冷启动并跑
  `scripts/live-dsh-check.sh`；失败时自动开 issue。可用 `pnpm canary` 或
  `node scripts/compat-canary.mjs <版本> --plugin <tgz>` 本地跑。

### Verified

- 0.9.0 产物在隔离的 dsh 0.2.1-rc.3 profile 中安装（无兼容豁免）并冷启动：
  boot 图 71 行、五个 inject 目标齐全、客户端 bundle 200,371 字节、Mermaid
  本地引擎 3,572,661 字节、state / usage / backup 路由、UTF-8 往返与三种信任
  围栏形状全部通过；活体探针 16 通过 / 1 跳过（无会话）。
- `node scripts/compat-canary.mjs 0.2.1-rc.3 --plugin <0.9.0 tgz>` 端到端通过。
- `pnpm check:readme`、`pnpm typecheck`、`pnpm test`（205 tests）、`pnpm build`、
  `pnpm smoke` 全绿。

## 0.8.0 — 2026-10-17

dsh 0.2.1-rc.2 兼容版：`engines.dsh` 取代 peer 范围成为 0.2.1-alpha.4+ 的首要兼容门，
旧范围把 0.2.1 全线拒之门外；本版补上新运行时线，并按 0.2.1 的客户端 seed 表与输入
动作签名完成适配。

### Changed

- **兼容范围新增 dsh 0.2.1-rc.2**：`engines.dsh` 与
  `@deepseek-ai/dsh-tools` peer 范围同为
  `>=0.1.7-rc.2 <0.2.0-0 || >=0.2.0-rc.2 <0.2.0-rc.3 || >=0.2.1-rc.2 <0.2.1-rc.3`。
  旧范围止于 `<0.2.0-rc.3`，而 dsh 0.2.1-alpha.4 起插件管理器优先读
  `engines.dsh`，因此桌面版升到 0.2.1-rc.2 后会把 0.7.1 判为不兼容并拒绝启用——
  这正是本次报错的根因。范围仍只收实际构建并实测过的预发布版：0.2.1-alpha.x、
  0.2.1-rc.3+ 与 0.2.1 正式版不在内。
- **构建与测试队列整体切到 0.2.1-rc.2**：九个 `@deepseek-ai/dsh-*`
  devDependency 与 `@deepseek-ai/cordis` 4.0.5 同步升级；`pnpm smoke` 新增
  「队列必须恰好一个版本」检查，`tests/manifest.spec.ts` 固化范围必须同时放行
  三条已验证运行时线、拒绝未验证版本。
- **客户端平台模块表对齐 0.2.1 shell**：`PLATFORM_MODULES` 补入 seed 表新增的
  `zod` 与 `@tanstack/react-virtual`；现有五个 inject 目标在 0.2.1 boot 图中
  全部存在。
- **输入动作类型对齐**：`setDraft(text)` 在 0.2.1 只接收文本（旧声明的可选
  `editRange` 参数从未使用），本地最小接口同步收窄。
- **兼容判定工具对齐新语义**：`scripts/desktop-runtime.mjs` 改为优先用
  `engines.dsh` 判定（与 dsh 0.2.1-alpha.4+ 一致），回退 peer 范围时才用 peer，
  两者判定不一致会单独告警；`scripts/smoke.mjs` 的说明与探测版本表同步更新。
- **对 0.2.0-rc.2 → 0.2.1-rc.2 的插件可感 API 做逐项核对**：本插件使用的
  `WebRoute`、`defineTool`、`AttachmentStore`、`SessionQueryEngine`、
  `SessionLogSnapshot`、`SessionEvent`、`theme.overrideTokens`、slots 注册与
  五个 inject 目标均无破坏性变化；0.2.1 的变更集中在新功能（session plugin
  record、字体设置、PTC 模式收窄、远程 Web/TLS、新 model-label 槽位），不影响
  本插件现有路径。

### Optimized

- **读档形状门**：`mergeState` 现在对 folders 走 `normalizeFolders`、对 stars 走
  `normalizeStars`、对 usage 走新的 `normalizeUsageMap`。此前一份 JSON 合法但
  文件夹深度超标（或 stars 形状错误）的文档会被直接采纳，随后每次保存的
  `JSON.stringify` 都抛 `RangeError`，插件永久无法保存；现在这类文档在加载时按
  「损坏」处理：原名改名 `.corrupt-<pid>` 保留现场，采用默认值并继续可写。
  usage 的畸形日期/模型行/字符串计数会被丢弃或归零，避免后续 fold 把字符串拼进
  计数器。
- **保存回滚不再深拷贝整份台账**：`applyEdit` 与备份导入只捕获被替换的 section
  引用做回滚点，不再 `JSON.parse(JSON.stringify(state))`。用量台账保留 90 天，
  此前每次切换开关的保存都要复制整份台账；现在回滚成本与编辑量成正比。
- **Mermaid 引擎一致性**：CDN 兜底不再硬编码 `mermaid@11.6.0`，改为读取实际安装
  的 `mermaid/package.json` 版本；本地引擎改用异步读取（3.5 MB 同步读会卡住宿主
  事件循环），字节数按 UTF-8 计。引擎脚本路由加 `ETag` + `Cache-Control:
  no-cache`：页面重载命中 304，不再每次重传 3.5 MB。
- **浏览器轮询与渲染热点**：流式期间的 timeline 轮询在页面隐藏时暂停、单次请求
  在飞时不叠加；`reuseTimelineItems` 复用未变化的 turn 对象，只有真正变化的行
  触发渲染。`TurnTailEntry`（每条消息一个）和 `FxCanvas` 改用
  `useSSelector` 选择器订阅，余额/用量/toast 等无关写入不再重渲染最多 400 个
  turn-tail。诊断节流表加上限，避免跨会话无限增长。
- **卸载回收补全**：anti-scroll 的滚动行为与 `data-vx-anti` 属性、就地 Mermaid
  包装节点、配置加载重试定时器、问候 toast 定时器都会在停用/卸载时还原；此前
  这些页级副作用会留在 GUI 中。
- **路由健壮性**：`POST /state` 上限从 256 KiB 提到 1 MiB（提示词库较大的用户
  此前会在保存时收到 413），并拒绝非对象 JSON；balance / usage-scan / mermaid
  的意外异常统一转成 JSON 错误包，而不是让 handler reject。
- **测试**：新增 `tests/timeline-diff.spec.ts`、读档形状隔离用例、usage 归一化
  用例、Mermaid 版本/UTF-8 计数用例、ETag 304 用例；总数 190 → 204。

### Verified

- 用桌面版自带 CLI 在隔离 profile 中安装本 tarball：**无兼容豁免、无
  `incompatible` 提示**（这正是用户此前遇到的拒绝路径）。
- 在同一 0.2.1-rc.2 运行时上冷启动真实 Host 并跑 `scripts/live-dsh-check.sh`：
  boot 图 70 个模块行、五个 inject 目标齐全、插件 bundle 已服务（约 200 KB）、
  Mermaid 本地引擎 3.57 MB、state/usage/backup 路由、UTF-8 往返、桌面转发形状与
  异源/跨站围栏全部通过；时间线/导出/搜索因临时 profile 无会话而跳过（该路径由
  单测覆盖，相关 API 在 0.2.1 仅新增可选 `formatStatus` 字段）。
- Mermaid 脚本路由实测：首次 200 / 3,572,661 字节，带 `If-None-Match` 的第二次
  请求 304 / 0 字节。
- `pnpm check:readme`、`pnpm typecheck`、`pnpm test`（204 tests）、`pnpm build`、
  `pnpm smoke` 全绿。

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
