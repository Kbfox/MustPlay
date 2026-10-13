# MustPlay Scout — Qloo Agentic Hackathon 产品定义与排期

> 功能工作名 **Scout**（侦察兵）。一句话："An agent that knows your taste and picks your next game from the pile — or finds one you'd never search for."
> 赛事：Qloo Agentic Hackathon（https://qloo.devpost.com），截止 **2026-10-30 23:45 ET = 北京 10-31 11:45**。
> 决定（2026-10-12）：不另起项目，在已上架的 MustPlay 1.0 上加 agent 功能，作为 1.1 版本发布。

---

## 1. 为什么在 MustPlay 上做

- 命题原话："the agent should outperform generic LLM-only approaches because it has access to Qloo's taste graph… If your submission would work the same without Qloo, you're building the wrong thing."
- MustPlay 手里有评委没法凭空得到的东西：**用户自己打过分、通关过的游戏列表**。这就是 Qloo 的 signal。LLM 自己猜"你可能喜欢"是空谈，Qloo 用 250M 实体的共现数据算出来的是另一回事。
- 规则允许已有项目参赛，只要 Qloo 是 09-30 之后接入的，并在描述里说明改动。MustPlay 09-26 首提、10-12 上架，1.1 整个 Scout 都是新加的，天然满足。
- 四项评分怎么对：
  | 评分项 | Scout 怎么打 |
  |---|---|
  | Technological Implementation（Qloo 用得深不深） | `/search` 解析实体 → `/v2/insights` 同域推荐 + 跨域推荐 + Taste Analysis 标签画像，三种用法都上，agent 把它们当工具按需调用 |
  | Design（完整产品而非 demo） | 已上架 App，深色模式、付费墙、推送都在；Scout 嵌进现有的 What next? 流程 |
  | Potential Impact | 真实问题：backlog 太长不知道玩哪个（Steam 用户平均 ~50% 游戏没打开过）。Scout 用"你真正喜欢什么"来挑，而不是随机 |
  | Quality of the Idea | 非显而易见的点：① 推荐对象是**用户自己清单里的游戏**，不是全网；② 通关后的"片尾彩蛋"跨域配对（配一部电影/一张专辑），只有 Qloo 能做 |

## 2. 产品定义

### 目标用户
清单里积了十几个游戏、打开 App 就开始滚动、最后哪个都没点的人。

### 核心流程（MVP，必须做到）
Scout 是一个聊天式入口，放在列表顶部 What next? 卡片旁边。打开后有四个快捷问法，也可以自由输入。

1. **"Pick from my pile"**（主打场景）
   - agent 读取用户清单：已通关 / 评分 ≥4 的作为"喜欢"，Want 池作为候选。
   - 调 Qloo `/search` 把游戏名解析成实体 ID（缓存回 `BucketGame.qlooEntityID`）。
   - 调 `/v2/insights?filter.type=urn:entity:video_game&signal.interests.entities=<喜欢的>`，拿到带 affinity 的推荐，与 Want 池取交集排序。
   - 回答：一张游戏卡 + 一句理由，理由来自 Qloo 返回的共享标签（"Like Hades and Celeste: tight controls, roguelike, indie"），不是 LLM 编的。
   - 底部 "Start playing" 沿用现有逻辑（状态改 Playing、推进详情页）。
2. **"Find me something new"**
   - 同样的 signal，但不限制在清单内；可带自然语言约束（"short, cozy, on Switch"）→ agent 用 `/v2/tags` 把"cozy"解析成 Qloo 标签 ID 作为 `filter.tags`。
   - 结果去掉清单里已有的，用 IGDB 补封面 / 平台 / 发售日（Qloo 不管封面），给 3 张卡，每张一句理由，一键 "Add to list"。
3. **"What's my taste?"**
   - Taste Analysis：用喜欢的游戏作为 signal，取 `filter.type=urn:tag` 的标签分布，渲染成画像卡（前 6 个标签 + 一句总结），可分享（复用现有分享卡渲染）。
4. **"Post-credits pick"**（通关后的跨域配对）
   - 在通关庆祝 → 分享页之后，Scout 自动给一条："Just finished Hades? Qloo says people who love it also love *Everything Everywhere All at Once*."
   - `filter.type=urn:entity:movie` / `urn:entity:artist` / `urn:entity:book`，signal 是刚通关的游戏 + 其他喜欢的。
   - 这一条是"只有 Qloo 能做"的招牌，演示和描述里要放在显眼位置。

### 让它是 agent 而不是"调一次 API"
- Worker 端跑**工具循环**（直接复用 Errand 的 `llm.ts` + `agent.ts`，Workers AI Llama 3.3 70B，不需要任何 LLM key）。
- 工具：`qloo_resolve(names)`、`qloo_recommend(seed_ids, type, tag_ids?, take)`、`qloo_tags(query)`、`qloo_taste(seed_ids)`、`igdb_lookup(name)`。
- agent 自己决定调用顺序：用户说"something like Hollow Knight but shorter"，它会先 resolve Hollow Knight → tags 找 "short"/"metroidvania" → recommend 带 filter → igdb 补信息。
- 系统提示写死两条规则：理由必须引用工具返回的标签或实体，不得自创；清单里的游戏优先于全网。
- SSE 流式把每一步工具调用推到手机上显示（"Looking up your 5-star games on Qloo…"），评委能看到 agent 在干什么。

### 明确不做
- 不做多轮长对话记忆：每次提问带当前清单快照，Worker 不存用户数据（隐私问卷不用大改）。
- 不做账号体系、不做 Web 版。
- 不做 Steam 导入（和之前的决定一致）。
- Scout **免费不限次**：规则要求评委能免费无限制测试；Pro 仍然只管清单上限和分享卡样式。

## 3. 技术架构

```
iOS (SwiftUI, iOS 17+)                         Cloudflare Worker (mustplay-igdb, 扩展)
┌────────────────────────┐    POST /agent     ┌─────────────────────────────────┐
│ ScoutView (chat + 卡片) │ ────────────────▶ │ 工具循环 (Workers AI, 复用 Errand) │
│ TasteProfileCard        │ ◀─── SSE ──────── │   qloo_resolve   → /search       │
│ PostCreditsRow          │                   │   qloo_recommend → /v2/insights  │
│ WhatNextSheet (入口)    │                   │   qloo_tags      → /v2/tags      │
│ BucketGame.qlooEntityID │                   │   qloo_taste     → /v2/insights  │
└────────────────────────┘                   │   igdb_lookup    → 现有 /v4 代理  │
                                              │ secret: QLOO_API_KEY             │
                                              └─────────────────────────────────┘
                                                  │                 │
                                      hackathon.api.qloo.com    api.igdb.com
```

- **Qloo 调用要点**（docs 已核对）：base URL 只能用 `https://hackathon.api.qloo.com`；header `X-Api-Key`；`/v2/insights` 是 GET 带 query string；不用 `/recs`；无效参数会被静默忽略，空结果先查 Entity Type Parameter Guide。
- **Qloo 结果缓存**在 Worker 边缘缓存（允许私有缓存），**不入公开仓库**（规则明说）。
- **iOS 侧**：`ScoutClient` 走 `URLSession.bytes` 读 SSE；请求体 = 用户问题 + 清单快照（名称、状态、评分、平台、年份，≤100 条）。
- **SwiftData**：`BucketGame` 加可选字段 `qlooEntityID: String?`，轻量迁移自动完成。
- **版本**：`project.yml` MARKETING_VERSION 1.1.0、CURRENT_PROJECT_VERSION 2。

## 4. 排期（今天 2026-10-12 周一，共 18 天，10-28 提交，留 2 天余量）

### 10-12 → 10-14：没 key 也能做的部分
- [ ] 仓库加 `LICENSE`（MIT），GitHub About 里确认能看到
- [ ] Worker：`/agent` 路由 + 工具循环（从 Errand 拷 `llm.ts` / `agent.ts`，改成 JS 或把 Worker 转 TS），`wrangler.toml` 加 `[ai]` binding，Qloo 工具先用 docs 示例响应 mock
- [ ] iOS：`ScoutView` 聊天 UI、四个快捷问法、SSE 客户端、游戏卡 / 画像卡组件；`BucketGame.qlooEntityID`
- [ ] 入口：列表顶部 What next? 卡片旁加 "Ask Scout"
- 检查点：模拟器里能对 mock 数据走完 "Pick from my pile"

### 10-15 → 10-18：key 到了接真数据（key 通常几个工作日，最晚 10-16 没到就去 Discord #api-help 催）
- [ ] curl 验证四个端点：`/search` 游戏名→ID；`/v2/insights` video_game 同域；跨域 movie/artist/book；`filter.type=urn:tag` 画像。记录 Qloo 对游戏的覆盖率（抽 20 个清单常见游戏，看命中几个）
- [ ] 覆盖率不足的兜底：解析不到的游戏跳过；喜欢的游戏一个都解析不到时退回现有 mood 逻辑并明说
- [ ] 四个场景全部接真数据，理由文案只用工具返回的标签
- 检查点：真机 TestFlight 内部组装一版，自己用一天

### 10-19 → 10-22：打磨成产品
- [ ] Post-credits 接进通关流程（庆祝 → 分享 → Scout 一条跨域配对）
- [ ] 画像卡可分享（复用 `ShareCardView` 渲染管线）
- [ ] 空状态（清单不足 3 个喜欢的游戏时引导先打分）、错误态、离线态、深色模式
- [ ] 隐私政策加一段"游戏标题会发送给 Qloo 用于推荐"，同步 mustplay-site 仓库；ASC 隐私问卷确认不用改（无新标识符）
- 检查点：录一段 60 秒粗剪，看四个场景是否都"一眼看懂"

### 10-23：发布
- [ ] 版本 1.1.0 (2) 归档上传（命令见 CLAUDE.md）
- [ ] TestFlight 外部组 "Public"（已存在）挂构建、提交 Beta 审核、开公开链接 —— 这是给评委的 demo 链接
- [ ] 同时提交 App Store 1.1 审核（审核备注写明 Scout 免费、Qloo 数据用途）
- [ ] Devpost 新建项目 "MustPlay Scout"（不复用 Shipaton 那个，描述要以 Qloo 为中心），填仓库 / TestFlight 链接 / 描述草稿

### 10-24 → 10-27：收尾
- [ ] README：架构图、Qloo 四种用法各一段、本地跑起来的步骤（wrangler secrets 清单）、TestFlight 链接
- [ ] 描述里单独一节 "What changed since Sept 30"（规则要求）
- [ ] 1179×2556 截图 5 张：Scout 对话、Pick 结果、Find new 三卡、画像卡、Post-credits
- [ ] 审核 / Beta 审核被拒当天修
- [ ] **10-28 提交 Devpost**，10-29、10-30 只改提交页

### 与 PayPal 赛事的时间冲突
PayPal（Errand）截止 11-12，第 1 周的 API 验证已经完成（沙盒下单 + capture、Channel3 搜索都跑通）。建议 **10-12 → 10-28 全力 Qloo，10-29 → 11-10 全力 Errand**，两边不并行。Errand 第 2 周起的任务顺延两周，仍有 13 天，够做"端到端一单 + 规则引擎"，盯价代买和物流跟踪视情况砍。

## 5. 风险与对策
| 风险 | 对策 |
|---|---|
| Qloo 对游戏实体覆盖薄（冷门 / 新游戏解析不到） | 10-15 抽样测覆盖率；解析不到的跳过；全部解析不到退回 mood 逻辑；演示清单用主流游戏 |
| API key 发放慢 | 10-12 → 10-14 的工作不依赖 key；10-16 未到去 Discord 催；表单可重复提交 |
| Workers AI 免费额度（每天 10k neurons）演示期间用完 | 每次提问限工具调用 ≤6 轮；缓存 Qloo 结果；`LLM_PROVIDER=openai-compatible` 已留口子，有 DeepSeek/OpenAI key 随时切 |
| Llama 工具调用不稳定（参数格式错） | Errand 里已验证过；Worker 端对参数做校验与纠正，失败重试一次后降级为固定流程（resolve → recommend） |
| App Store 1.1 审核赶不上 10-30 | TestFlight 公开链接就满足"hosted build"要求，不依赖 App Store 过审；10-23 必须上传 |
| TestFlight Beta 审核被拒 | 外部组首次需 Beta App Review，一般 1–2 天；10-23 提交留 7 天 |
| 评委没有 iPhone | 描述里放 60 秒视频（不强制但有益）+ 截图；README 给 Worker `/agent` 的 curl 示例，评委可直接看 agent 输出 |

## 6. 现在需要你本人做的
1. 收到 Qloo 的 key 邮件（zengyx83@gmail.com，查垃圾箱）后告诉我，我用 `wrangler secret put QLOO_API_KEY` 放进 Worker，不需要在对话里贴值。
2. 10-23 上传构建后，TestFlight 外部组的 Beta 审核提交和"启用公开链接"需要你在 ASC 面板点（内置浏览器能做大部分，到时候我先试）。
3. 确认两点：① Scout 免费不限次；② Devpost 新建项目而不是复用 Shipaton 的。不反对就按这个做。
