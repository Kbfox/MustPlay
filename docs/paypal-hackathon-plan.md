# Errand — PayPal AI Hackathon 产品定义与排期

> 工作名 **Errand**（跑腿）。一句话："Tell it what you need. It finds it, you approve, it pays."
> 赛事：PayPal AI Hackathon（https://paypalaihackathon.devpost.com），截止 **2026-11-12 12:00 PT = 北京 11-13 04:00**。
> 本文件先放在 MustPlay 仓库，项目启动后迁到新仓库 `Kbfox/errand`。

---

## 1. 为什么是这个方向

评委给的五类灵感里，第一类"AI Agents or Automation"原话是：**"not just recommend, but actually transact. Think: an AI agent that shops and checks out for you."** 这就是 Errand。奖项上它同时覆盖：

| 奖项 | 金额 | Errand 怎么打 |
|---|---|---|
| Grand Prize 1/2/3 | $12k / $8k / $5k | 完整产品体验 + 真实沙盒交易 |
| Best Use of Agentic Commerce | $5k | agent 在预算规则内自主下单，不只是推荐 |
| Best Use of PayPal + AI | $5k | Orders / Vault / Tracking 三个 API 被 agent 当工具调用 |
| Best Demo Delivery | $5k | 手机端 90 秒从"我要一个键盘"到"已付款、已发货" |
| Best Use of Channel3 | $1.5k | 商品发现全部走 Channel3 搜索 API |

规则允许一个项目拿 1 个大奖 + 1 个赞助商奖，或 1 个单项 + 1 个赞助商奖。

## 2. 产品定义

### 目标用户
不想逛电商、知道自己要什么但懒得比价的人。典型一句话需求："200 美元以内的机械键盘，青轴，要有线"。

### 核心流程（MVP，必须做到）
1. **说需求**：聊天框输入文字，或拍照 / 粘链接（Channel3 支持 text / image / URL 搜索）。
2. **agent 找货**：调用 Channel3 搜索 + 过滤（价格、品牌、属性），拿到跨零售商的结构化商品和当前价格。
3. **三选一**：agent 给 3 个候选，每个一句话说明取舍（为什么推、哪里妥协），显示价格和库存。
4. **一键付款**：用户选中 → agent 调 PayPal **Orders v2** 创建订单 → 应用内弹 PayPal 沙盒结账页（`ASWebAuthenticationSession`，buyer 用沙盒个人账号登录）→ 回调后 agent **capture**。
5. **订单卡片**：金额、商品、PayPal 交易号、状态时间线；agent 调 **Shipment Tracking API** 写入物流号，后续状态在卡片里更新。

### 让它"agentic"而不是"聊天版购物车"的两件事（第 3 周做）
- **消费规则**：用户设定"单件 ≤ $50 自动买，超过要我点头"、"本月上限 $300"。规则内 agent 直接下单，规则外推送让用户批准。规则引擎在后端，agent 每次下单前必须过规则校验，这是可演示的 guardrail。
- **盯价代买**：对一个候选说"低于 $150 就买"。后端定时重查 Channel3 价格，命中后用 **PayPal Vault**（已保存的付款方式，`payment_source.paypal.vault_id`）发起无人值守付款并推送通知。沙盒里 Vault 需要先走一次带 `vault.store_in_vault=ON_SUCCESS` 的结账，第 1 周先验证可行；不可行则降级为"命中后推送一键批准"。

### 明确不做
- 不做真实商户对接：沙盒里 Errand 自己就是商户（business 沙盒账号收款），描述里写清楚。
- 不做账号体系：单设备，Keychain 存一个匿名用户 ID。
- 不做 Android / Web。
- 不做退货、争议。

## 3. 技术架构

```
iOS (SwiftUI, iOS 17+)                     Cloudflare Worker (TypeScript)
┌──────────────────────┐   HTTPS/JSON     ┌──────────────────────────────┐
│ ChatView             │ ───────────────▶ │ POST /agent  (Claude tool loop)│
│ CandidateCards       │ ◀─── SSE ─────── │   tools:                      │
│ PayPal checkout sheet│                  │   channel3_search             │
│ OrderTimeline        │                  │   paypal_create_order         │
│ RulesView            │                  │   paypal_capture_order        │
│ Push (APNs)          │                  │   paypal_add_tracking         │
└──────────────────────┘                  │   rules_check                 │
                                          │ GET  /paypal/return  (capture)│
                                          │ POST /paypal/webhook          │
                                          │ cron: price-watch → vault pay │
                                          │ KV/D1: users, rules, orders   │
                                          └──────────────────────────────┘
                                             │            │            │
                                        Channel3 API  PayPal Sandbox  Claude API
```

- **agent**：Claude API tool-use 循环，模型 `claude-sonnet-5-5`（快、便宜，够用）。系统提示里写死"先 rules_check 再 create_order"。
- **PayPal**：直接用 REST（OAuth client_credentials 拿 token 缓存在 KV），不引 Agent Toolkit 也行；但 README 和提交描述里要提到工具定义与 PayPal Agent Toolkit 的 orders.create / orders.capture 对齐，评委看得懂。
- **复用 MustPlay 的东西**：Worker 部署流程（wrangler + secrets）、XcodeGen 项目骨架、APNs（OneSignal 可以继续用，也可以直接 APNs）、Secrets.xcconfig 规范。
- **不需要** RevenueCat。

## 4. 排期（今天 2026-10-13，共 30 天，11-10 提交，留 2 天余量）

### 第 1 周 10-13 → 10-19：打通三方 API
- [ ] 用户：PayPal 开发者后台建沙盒 App，拿 Client ID / Secret；记下自动生成的 business / personal 沙盒账号
- [ ] 用户：Channel3 注册拿 API key；Devpost 点 Join PayPal 赛事；Qloo 赛事 Join + 填 API key 表单
- [ ] 新仓库 `errand`，Worker 骨架，secrets 入 wrangler
- [ ] curl 级验证：PayPal 沙盒 create order → 浏览器 approve → capture 成功；Vault 存卡一次并用 vault_id 再付一次（决定盯价代买走哪条路）
- [ ] curl 级验证：Channel3 文本搜索 + 价格过滤返回结构化结果
- [ ] iOS 工程：聊天页 + 候选卡片静态 UI
- 周末检查点：三方 API 各有一条成功日志

### 第 2 周 10-20 → 10-26：端到端跑通一单
- [ ] `/agent` 工具循环 + SSE 流式返回
- [ ] 手机上：输入需求 → 3 个候选 → 选中 → PayPal 结账页 → 回 App → 订单卡片显示 capture 成功
- [ ] 订单持久化（D1）+ 历史列表
- [ ] **Qloo 支线（key 到了就插进来，≤3 天）**：MustPlay "What next?" 接 Qloo insights，加 LICENSE，10-29 前提交
- 周末检查点：录一段 60 秒粗剪视频，能看到真实沙盒交易号

### 第 3 周 10-27 → 11-02：让它像 agent
- [ ] 规则引擎 + RulesView；规则外下单走推送批准
- [ ] 盯价代买：Worker cron 重查价格 → Vault 付款 → 推送（或降级方案）
- [ ] Shipment Tracking 写入 + 卡片时间线
- [ ] 图片 / 链接搜索入口
- [ ] TestFlight 首个构建给评委
- 周末检查点：一次"无人值守"交易在视频里可复现

### 第 4 周 11-03 → 11-10：交付
- [ ] 视觉打磨、空状态、错误态、深色模式
- [ ] 演示视频 ≤3 分钟：需求 → 候选 → 付款 → 规则内自动买 → 物流更新
- [ ] README：一键跑起来的步骤（wrangler secrets 清单、沙盒账号说明、TestFlight 链接）
- [ ] Devpost 提交：描述、视频、仓库、TestFlight；勾 Agentic Commerce / Channel3
- [ ] **11-10 提交**，11-11、11-12 只修提交页问题

## 5. 风险与对策
| 风险 | 对策 |
|---|---|
| 中国区 PayPal 账号登录开发者后台受限 | 第 1 天就试；不行就注册一个新的 PayPal 个人账号专门做开发者账号 |
| Vault 在沙盒里走不通 | 第 1 周验证；降级为"推送一键批准"，仍符合"agent transacts" |
| Channel3 免费额度 / 地区限制 | 第 1 周看配额；演示用美区商品，缓存搜索结果防止演示时打空 |
| 评委跑不起来 | TestFlight 公开链接 + 后端已部署，README 里给沙盒 buyer 账号密码 |
| Qloo 支线挤占时间 | 严格限 3 天，10-29 没做完就放弃 Qloo |

## 6. 现在需要你本人做的（内置浏览器做不了登录和付款相关操作）
1. https://developer.paypal.com → 登录 → Apps & Credentials → Sandbox → Create App，把 Client ID / Secret 填进新仓库的 `.dev.vars`（不要贴到对话里）
2. https://trychannel3.com 注册，拿 API key
3. https://paypalaihackathon.devpost.com 点 Join hackathon
4. https://qloo.devpost.com 点 Join，并填 API key 申请表（人工发放，几个工作日）
5. 告诉我你想用的 Anthropic API key 放在哪（Worker secret），我不需要看到值
