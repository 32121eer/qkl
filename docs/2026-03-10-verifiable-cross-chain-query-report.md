# 面向异构联盟链跨链查询的可验证结果证明机制研究

## 摘要

跨链系统中的“消息转发”已经相对成熟，但“跨链查询”仍普遍停留在工程级 API 调用或中继器可信转述阶段。对于 Hyperledger Fabric 与 FISCO-BCOS 这类异构联盟链场景，目标链通常只能知道“查询结果被 relayer 带回来了”，却难以独立验证“该结果确实来源于源链某一已确认状态”。这使跨链查询在安全语义上弱于跨链转账与跨链消息验证，也限制了其在供应链、监管、审计与跨域协同中的可信使用。

本文面向 Fabric 与 FISCO-BCOS 异构联盟链环境，提出一种**可验证跨链查询结果证明机制**。该机制以“状态承诺绑定”为核心，不直接把查询结果视为普通业务消息，而是把其抽象为“源链在某一确认状态根下对查询对象的只读证明”。在此基础上，本文引入查询描述、结果值、状态根、区块高度与上下文摘要构成的查询结果承诺，并结合轻客户端维护的已确认区块头，实现目标链对查询结果真实性的独立校验。与仅依赖事件证明或中继器声明的方案相比，该机制更适合表达“结果是真的”这一跨链查询核心命题。

本文进一步结合当前项目中已有的 Lite Header 验证、跨链 Query Session 状态机与 Demo 可视化流程，分析该机制在现有代码基础上的落点、可实现边界与实验路径。研究表明，该方向比直接引入全量 zkBridge 更适合作为当前系统的算法主线，也比单纯的 optimistic query 更具可解释性与论文完整性。

**关键词：** 异构联盟链；跨链查询；状态证明；轻客户端；结果承诺；可信互操作

## Abstract

Cross-chain message relaying has become relatively mature, while cross-chain query remains largely implemented as an engineering-level API pattern or a relayer-trusted workflow. In heterogeneous consortium-chain settings such as Hyperledger Fabric and FISCO-BCOS, the target chain can often observe that a query result has been returned, yet it cannot independently verify that the result indeed originates from a confirmed state on the source chain. This gap weakens the security semantics of cross-chain query and limits its credibility in audit, supervision, and inter-organizational collaboration scenarios.

This paper proposes a **verifiable cross-chain query result proof mechanism** for heterogeneous consortium chains. Instead of modeling a query result as an ordinary business message, the proposed method treats it as a read-only projection over a confirmed source-chain state commitment. On top of this abstraction, we define a query object, a query result commitment, and a query proof bundle, and combine them with a light-client-maintained confirmed header chain so that the target side can independently verify result authenticity. Compared with event-based proof or relayer-declared query, the proposed approach is more suitable for expressing the core property that “the query result is true”.

By relating the mechanism to the current Fabric-FISCO prototype in this repository, the paper further shows that this direction is more practical than directly adopting a full zkBridge architecture at the current stage, while still offering stronger research value than a purely optimistic query path.

> 图示占位建议 1：研究问题与本文定位总览图
>
> 建议内容：对比“普通 relay 返回结果”与“可验证查询结果证明”的差异，突出本文主张的验证闭环。
>
> 绘图提示词：
> “绘制一张学术论文风格的跨链查询问题定义图。左侧是传统 relayer-based query：Source Chain -> Relayer -> Target Chain，Target Chain 只能接收 result，标注 trust relayer。右侧是 proposed verifiable query：Source Chain 提供 state root / proof / query commitment，经 Relayer 传输到 Target Chain，Target Chain 本地 light client 验证 result authenticity。整体风格简洁、蓝灰配色、适合中文论文插图。”

## 1. 研究背景与问题提出

在跨链互操作研究中，资产跨链与消息跨链长期占据主流，而跨链查询常被视为附属能力。实际工程里，跨链查询通常由以下流程完成：目标链或上层应用发起查询请求，中继器到源链读取状态或业务记录，再把结果发送回目标链或前端页面。该模式虽然实现简单，但其安全性通常停留在“信任中继器正确读取并正确返回”的层面。

对于本项目而言，当前系统已经具备较好的跨链消息骨架：一方面，Fabric 侧已支持远端区块头顺序提交与基础哈希校验；另一方面，FISCO 与 Fabric 之间的双向 relay、Query Session 状态机、proof card 展示和 query workflow 已基本可跑通。然而，现有实现更偏向“可观测的跨链编排”，并未建立“可验证的跨链查询语义”。也就是说，系统可以告诉用户“查询请求已发出、响应已返回、两侧交易已落链”，但还不能强有力地说明“这个返回结果确实来自源链某个已确认状态”。

这正是本文要解决的问题：**在异构联盟链环境下，如何让目标链或目标侧应用独立验证跨链查询结果的真实性，而不必把 relayer 视为可信裁判。**

围绕该问题，本文聚焦最小而关键的目标：**只证明‘这个查询结果是真的’**，即不在第一阶段追求不存在性证明、范围查询完整性证明或复杂聚合查询证明，而是先为单条确定性查询建立严格的真实性验证机制。

### 1.1 本文贡献

相较于现有的 relay-based query 或 event-based query，本文的主要贡献可归纳为以下三点：

1. 提出一种面向异构联盟链场景的**可验证跨链查询结果证明模型**，把“查询结果真实性”形式化为“结果属于某个已确认状态”的验证问题。
2. 设计查询对象、查询结果承诺与查询证明三层结构，使跨链查询在语义上从“消息返回”提升为“状态绑定证明”。
3. 结合 Fabric 与 FISCO-BCOS 当前项目实现，给出从 Lite Header 验证到 Query Verifier 的渐进式原型映射路径，为后续工程验证与实验评估提供可执行基础。

### 1.2 论文结构

本文其余部分安排如下：第 2 节分析现有方法与不足；第 3 节给出问题定义与设计目标；第 4 节描述系统模型与威胁模型；第 5 节提出可验证跨链查询结果证明机制；第 6 节从正确性与安全性角度分析该机制；第 7 节讨论其与当前项目的映射关系；第 8 节给出原型实现与实验设计建议；第 9 至第 10 节总结研究价值与结论。

### 1.3 引言式贡献归纳

若按正式论文引言末尾的常见写法，本文贡献可以进一步浓缩为以下三点：

- 本文首次将当前项目中的异构联盟链跨链查询需求形式化为“已确认状态下的结果真实性证明”问题，而不是一般性的跨链消息转发问题。
- 本文提出 `Q - C_Q - \Pi_Q` 三层机制，把查询对象、结果承诺与证明包耦合起来，使目标侧验证具有明确的状态绑定语义。
- 本文给出一条介于 trusted relayer 与全量 zkBridge 之间的中间路线，并说明其如何在现有 Fabric-FISCO 原型上渐进式落地。

> 图示占位建议 2：项目现状与问题缺口图
>
> 建议内容：画出现有系统已具备的模块和缺失的“query proof verification”模块，突出算法缺口。
>
> 绘图提示词：
> “绘制一张系统能力缺口分析图。模块包括 Fabric、FISCO-BCOS、Relayer、Demo UI、LightClient-lite、Query Session。已具备部分用绿色表示：header continuity、relay orchestration、event tracking；缺失部分用橙红色表示：state proof、query result verification、proof-aware receive。图风格适合论文或课题申报书。”

## 2. 相关研究与现有方法不足

### 2.1 基于中继器声明的跨链查询

最常见的方法是由中继器读取源链状态，然后把查询结果直接返回给目标链或前端系统。该模式实现门槛低、兼容性强，适合做 demo 或业务联调，但结果真实性依赖于中继器行为，不具备独立可验证性。对于审计、监管和多方协同场景，这种方法缺乏足够的安全说服力。

### 2.2 基于事件或回执的查询结果证明

另一类方法把查询结果记录为链上事件、交易回执或日志，再由目标链验证“该事件确实被源链接纳”。这种方法比纯粹的中继器声明更强，因为它证明了“结果被源链发布过”。但它仍存在一个语义差距：**事件存在并不等于结果正确反映了某个状态值**。换言之，它更像“证明某个结果被宣布”，而不是“证明该结果对应某个真实状态”。

### 2.3 基于轻客户端与状态证明的跨链验证

IBC 等跨链协议的核心思路是：目标链维护源链轻客户端状态，并对 packet、commitment 或状态对象进行 membership / non-membership proof 验证。这类方法的优势在于安全语义清晰，证明对象直接绑定到状态承诺或应用承诺，而不是绑定到单纯事件。对于“跨链查询”，这种方法更接近问题本质，因为查询本身就是对源链状态的一次只读验证。

### 2.4 基于 zk 证明的跨链查询

zkBridge 等工作展示了使用 succinct proof 压缩跨链验证成本的可能性，理论上也可用于可验证查询。但在当前项目阶段，若直接引入 zk 路线，会显著提高系统复杂度、证明生成成本与工程门槛，不利于形成第一阶段的完整研究闭环。

### 2.5 现有方法不足总结

综合来看，当前主流方法至少存在三点不足：

1. 中继器声明类方案缺乏独立验证能力。
2. 事件证明类方案难以严格表达“状态值真实性”。
3. zk 类方案虽强，但不适合作为当前项目的首阶段算法原型。

因此，本文主张采用一条更平衡的路径：**以轻客户端维护的已确认区块头为基础，以状态承诺绑定的结果证明为核心，构建面向异构联盟链的可验证跨链查询机制。**

> 图示占位建议 3：方法谱系对比图
>
> 建议内容：横向对比 relayer-trust、event-proof、state-proof、zk-proof 四类方法的安全性、复杂度和适用阶段。
>
> 绘图提示词：
> “绘制一张跨链查询方法对比矩阵图。横轴为方法类型：trusted relayer、event proof、state proof、zk proof；纵轴为安全性、复杂度、工程门槛、论文创新空间、适配当前项目程度。使用雷达图或分层柱状图，风格严谨，中文标签。”

## 3. 研究问题与设计目标

### 3.0 符号说明

为便于形式化描述，本文使用如下符号：

- `S`：源链（Source Chain）
- `T`：目标链（Target Chain）
- `R`：中继器（Relayer）
- `h`：源链区块高度
- `B_h`：源链在高度 `h` 的区块头
- `root_h`：与 `B_h` 绑定的状态承诺根
- `st_h`：由 `root_h` 唯一承诺的源链状态视图
- `Q`：规范化查询对象
- `v`：查询结果原始值
- `C_Q`：查询结果承诺
- `\Pi_Q`：查询结果证明
- `LC_S^T`：部署于目标链侧的源链轻客户端
- `VerifyQuery`：目标侧查询验证算法

其中，本文默认查询求值具有确定性，即对于给定的 `Q` 与 `st_h`，存在唯一结果 `v = Eval(Q, st_h)`。

本文研究的核心问题可形式化为：

给定源链 `S`、目标链 `T`、查询语句 `q` 以及由中继器返回的结果 `r`，如何使 `T` 在不直接执行 `q` 的前提下，验证 `r` 确实等价于 `S` 在某个已确认状态 `st_h` 下对 `q` 的求值结果？

进一步地，可将问题表述为：

\[
\text{Given } Q,\; v,\; \Pi_Q,\quad \text{determine whether } v = Eval(Q, st_h)
\]

其中 `st_h` 由某个已确认区块头 `B_h` 所承诺，且 `\Pi_Q` 为从源链传递到目标链的查询证明材料。

围绕这一问题，本文提出如下设计目标：

### 3.1 真实性

目标链应能验证查询结果与源链某一已确认状态之间存在确定绑定关系，而不是仅仅相信 relayer 返回的文本或 JSON。

### 3.2 已确认性

结果所绑定的状态根必须来自源链已确认区块，而不能来自尚未稳定的临时视图。

### 3.3 可移植性

机制应适用于 Fabric 与 FISCO-BCOS 这类异构联盟链，不依赖二者完全相同的数据结构或执行语义。

### 3.4 渐进可实现性

机制应能从当前项目已有的 Lite Header 验证与 Query Session 机制平滑演进，而不是推翻重写。

### 3.5 低阶段目标明确

第一阶段只解决**单条确定性查询结果真实性证明**，不直接扩展到：

- 不存在性证明
- 区间或分页查询完整性证明
- 聚合查询、联表查询或复杂计算结果证明

## 3.6 设计原则

为避免机制设计在理论上成立但在项目中难以落地，本文还遵循以下原则：

1. **状态绑定优先于事件绑定**：优先证明状态值真实性，而不是仅证明事件存在。
2. **请求绑定优先于结果广播**：结果必须与具体查询对象及请求语义绑定。
3. **渐进增强优先于一次到位**：先形成可运行的状态证明框架，再考虑不存在性证明与 zk 化。
4. **异构抽象优先于链特定实现**：先抽象公共证明接口，再分别适配 Fabric 与 FISCO-BCOS。

## 4. 系统模型与威胁模型

### 4.1 系统模型

系统包含五类主体：

1. 源链 `S`：持有原始业务状态，如 orchard 记录、批次信息或监管数据。
2. 目标链 `T`：接收跨链查询结果并进行验证。
3. Relayer `R`：传输查询请求、查询结果与相关证明材料。
4. Light Client `LC_S^T`：目标链上维护的源链轻客户端状态。
5. Query Verifier `QV`：部署在目标链或其链上应用中的查询验证逻辑。

其中，`LC_S^T` 负责维护源链已确认区块头或状态根，`QV` 负责验证查询结果是否与某一已确认状态绑定。

### 4.2 威胁模型

本文默认：

- Relayer 可能作恶，可能伪造结果、替换结果、重放结果或选择性延迟结果。
- 通信通道不可信。
- 源链与目标链本身的底层共识机制不在本文攻击面内，即默认各自链在已确认区块之上是可信的。
- 轻客户端同步逻辑若未被破坏，则可视为目标链获取源链确认状态的可信基础。

本文暂不处理：

- 两条链底层共识同时失效
- 查询语义本身非确定性
- 复杂多键聚合查询的完整性

### 4.3 安全目标

在上述威胁模型下，本文机制力求满足以下安全目标：

- **真实性（Authenticity）**：通过验证的结果必须与源链已确认状态一致。
- **绑定性（Binding）**：查询结果不能脱离查询对象或绑定高度而单独重用。
- **不可伪造性（Unforgeability）**：攻击者不能在不破坏底层承诺结构的前提下伪造可通过验证的错误结果。
- **抗重放性（Replay Resistance）**：旧结果不能在不满足策略约束的前提下被重复接纳。

> 图示占位建议 4：系统模型与威胁模型图
>
> 建议内容：展示 S、T、R、LC、QV 之间的数据流，并明确 relayer 处于不可信位置。
>
> 绘图提示词：
> “绘制一张跨链查询系统模型图。元素包括 Source Chain、Target Chain、Relayer、Light Client、Query Verifier、Application。Relayer 使用虚线红框标记为 untrusted；Light Client 和 Query Verifier 在 Target Chain 内部。箭头显示 query request、result、proof、header update。风格为学术论文中的体系结构图。”

## 5. 可验证跨链查询结果证明机制设计

### 5.1 核心思想

本文的核心思想是：**不把跨链查询结果看成一条普通消息，而把它视为“源链状态在已确认状态根下的可证明投影”。**

基于这一思想，验证逻辑不再是：

“Relayer 告诉我结果是 `r`，我检查一下对应交易在不在链上。”

而是：

“Relayer 给我结果 `r`，同时给我证明 `pi`，使我可以验证：在源链某已确认状态根 `root_h` 对应的状态 `st_h` 中，查询对象 `k` 的值的确为 `v`，而 `r = Decode(v)`。”

这使“查询结果是真的”被还原为“查询结果绑定到已确认状态”的证明问题。

### 5.1.1 机制总览

本文机制由四个逻辑组件组成：

1. **Query Object Normalizer**：将业务查询转为统一的规范化对象 `Q`。
2. **State Commitment Binder**：把查询结果绑定到高度 `h` 的状态承诺根 `root_h`。
3. **Proof Constructor**：生成查询结果证明 `\Pi_Q`。
4. **Query Verifier**：在目标侧验证 `Q`、`v` 与 `\Pi_Q` 的一致性。

四者构成一个从“业务查询”到“密码学验证”的完整桥接层。

### 5.2 查询对象规范化

为了让异构链之间可以稳定表达查询语义，本文引入规范化查询对象：

\[
Q = (chainId, namespace, key, queryType, codec, context)
\]

其中：

- `chainId`：源链标识
- `namespace`：业务命名空间或链码/合约域
- `key`：被查询对象的主键或状态键
- `queryType`：查询类型，第一阶段限定为确定性单键查询
- `codec`：结果值编码方式
- `context`：必要上下文，如版本号、数据模型标识

规范化查询对象的目的是避免“同一业务查询在不同实现路径下有不同解释”的问题。

### 5.3 查询结果承诺

本文定义查询结果承诺：

\[
C_Q = H(Q \parallel root_h \parallel value \parallel height \parallel meta)
\]

其中：

- `Q` 为规范化查询对象
- `root_h` 为源链在高度 `h` 的已确认状态根或可承诺根
- `value` 为查询结果原始值
- `height` 为绑定高度
- `meta` 为附加上下文，如时间戳、版本号、链上业务域信息

`C_Q` 的作用不是替代状态证明，而是把“查询对象”和“查询结果”绑定成一个可传递、可落链、可审计的统一承诺单位。这样既便于论文表达，也便于后续在 Demo UI 中展示 proof card。

### 5.4 查询结果证明

本文定义查询结果证明为：

\[
\Pi_Q = (header_h, \pi_{lc}, \pi_{state}, Q, value, meta)
\]

其中：

- `header_h`：源链高度 `h` 的区块头
- `\pi_{lc}`：证明 `header_h` 已被目标链轻客户端接受或可由其验证
- `\pi_{state}`：证明查询对象 `Q` 对应的状态值 `value` 属于 `root_h`
- `Q, value, meta`：查询描述、值及附加信息

目标链验证步骤为：

1. 验证 `header_h` 对应的区块头已被轻客户端接受。
2. 提取其中的状态承诺根 `root_h`。
3. 验证状态证明 `\pi_{state}` 说明 `Q.key -> value` 属于 `root_h`。
4. 验证 `Q` 与请求的查询语义一致。
5. 计算 `C_Q` 并生成或记录查询证明结果。

### 5.4.1 证明生成算法

本文将源链侧或 relayer 侧的证明生成过程抽象为：

\[
GenProof(Q, h) \rightarrow (v, \Pi_Q)
\]

其语义为：在源链已确认高度 `h` 对应的状态 `st_h` 上，对查询对象 `Q` 求值得到 `v`，并生成能证明 `v = Eval(Q, st_h)` 的证明材料 `\Pi_Q`。

第一阶段中，`GenProof` 的实现可以是“读取链上对象状态 + 组织 membership proof + 绑定已确认 header”，而不要求必须采用统一的 zk 电路或递归证明。

### 5.5 验证算法

可把目标链上的验证算法记为：

\[
VerifyQuery(Q, value, \Pi_Q) \rightarrow \{0,1\}
\]

其逻辑可描述为：

1. 若 `header_h` 未被 `LC_S^T` 接受，则返回失败。
2. 若 `pi_state` 不能证明 `value` 属于 `root_h`，则返回失败。
3. 若 `Q` 与原始查询请求不一致，则返回失败。
4. 否则返回成功，并输出 `verified(height=h, commitment=C_Q)`。

更形式化地，可将验证算法写为：

\[
VerifyQuery(Q, v, \Pi_Q)=
\begin{cases}
1,& \text{if } VerifyLC(B_h,\pi_{lc})=1 \land VerifyState(Q,v,root_h,\pi_{state})=1 \\
0,& \text{otherwise}
\end{cases}
\]

其中 `VerifyLC` 表示轻客户端验证逻辑，`VerifyState` 表示状态成员关系验证逻辑。

### 5.6 机制特征

该机制相较于现有方案有四个特征：

1. 结果证明绑定的是**状态根**而非单纯事件。
2. 查询对象 `Q` 被纳入承诺，减少结果与请求错配。
3. 可与现有轻客户端模块组合，不要求一步到位 zk 化。
4. 适合逐步扩展到不存在性证明和批量查询证明。

### 5.7 与事件型方案的理论差异

若将事件型方案记为“证明某交易 `tx` 曾发布结果 `v`”，则其验证对象可抽象为：

\[
VerifyEvent(tx, v)
\]

而本文方案验证对象是：

\[
VerifyState(Q, v, root_h, \pi_{state})
\]

二者的根本区别在于：

- 前者证明“该结果被写出过”；
- 后者证明“该结果对应一个已确认状态下的真实取值”。

因此，本文方案在理论上更接近“可验证查询”，而不仅是“可验证结果公告”。

> 图示占位建议 5：机制流程图
>
> 建议内容：从 query request 到 source execution，再到 state proof、header verification、target acceptance 的全流程。
>
> 绘图提示词：
> “绘制一张 proposed verifiable cross-chain query workflow 图。步骤包括 Query Request、Source State Snapshot、Query Result Extraction、State Proof Generation、Header / Light Client Verification、Target Verification、Result Acceptance。每一步用编号标记，箭头清晰，适合论文插图。”

> 图示占位建议 6：查询结果承诺结构图
>
> 建议内容：展示 `Q`、`root_h`、`value`、`height`、`meta` 如何组合成 `C_Q`。
>
> 绘图提示词：
> “绘制一张 commitment structure 图。输入字段包括 query object Q、state root root_h、value、height、meta，经过 hash 函数输出 commitment C_Q。图风格简洁、带数学符号、适合学术论文。”

## 6. 正确性与安全性分析

### 6.1 正确性

若满足以下条件：

- 目标链轻客户端正确维护源链已确认区块头；
- 状态证明 `pi_state` 正确反映 `root_h` 下的状态成员关系；
- 查询对象 `Q` 的规范化过程确定且无歧义；

则当 `VerifyQuery(Q, value, \Pi_Q) = 1` 时，可推出 `value` 的确是源链在确认高度 `h` 对查询 `Q` 的真实结果。

可进一步表述为如下命题。

**命题 1（正确性）**  
若 `VerifyLC(B_h,\pi_{lc})=1`，且 `VerifyState(Q,v,root_h,\pi_{state})=1`，并且 `root_h` 正确承诺状态 `st_h`，则 `VerifyQuery(Q,v,\Pi_Q)=1` 蕴含 `v = Eval(Q, st_h)`。

该命题说明：只要轻客户端验证与状态证明验证都成立，则目标侧接受的结果必然与源链某个已确认状态一致。

### 6.2 抗伪造性

Relayer 若伪造结果 `value'`，则必须同时伪造与之匹配的状态证明 `pi_state'`。若状态承诺与轻客户端安全性成立，则伪造成功概率可忽略。

**命题 2（不可伪造性）**  
若底层状态承诺结构满足抗碰撞与成员关系不可伪造性，且轻客户端不会接受错误区块头，则任意多项式时间攻击者生成 `v' \neq Eval(Q, st_h)` 且 `VerifyQuery(Q,v',\Pi'_Q)=1` 的成功概率可忽略。

### 6.3 抗替换性

Relayer 若试图把查询 `Q1` 的结果替换为查询 `Q2` 的结果，由于承诺 `C_Q` 包含 `Q` 本身，且目标链会验证 `Q` 与原始请求匹配，因此替换攻击无法成立。

**命题 3（绑定性）**  
若承诺函数 `H` 抗碰撞，则攻击者无法在保持同一 `C_Q` 有效的同时，把查询对象 `Q` 替换为 `Q' \neq Q` 而不被检测。

### 6.4 抗重放性

若旧查询结果被重复提交，目标链可通过 `(Q, height, commitment)` 或 `(requestId, commitment)` 做去重记录。若业务要求只接受最新结果，还可增加高度下界或版本策略。

**命题 4（抗重放性）**  
若目标侧维护 `(requestId, commitment)` 或 `(Q, height, commitment)` 的唯一性索引，则旧证明包在新的查询上下文中无法被无条件重复接纳。

### 6.5 与事件证明的区别

事件证明能说明“源链发布过这个结果”，状态证明能说明“这个结果对应源链状态”。前者偏公告真实性，后者偏值真实性。本文认为后者更贴合跨链查询的本质。

> 图示占位建议 7：安全性分析图
>
> 建议内容：用攻击树或对照图展示伪造、替换、重放三类攻击如何被机制阻断。
>
> 绘图提示词：
> “绘制一张 verifiable query security analysis 图。攻击类型包括 forged result、replaced result、replayed result；防护机制分别对应 state proof、query commitment binding、request/height deduplication。风格偏论文安全分析图。”

## 7. 与现有项目的映射分析

### 7.1 当前项目中可复用的基础

当前仓库已经提供三块对本机制非常关键的基础能力：

第一，Fabric 侧已有 `SubmitBlockHeader` 与 `Receive`，说明系统已具备“目标侧保存并校验源链 header”的雏形。

第二，Relayer 已经形成 query request / response 的完整编排流程，QueryBroker 也具备会话状态管理和超时恢复能力。

第三，Demo UI 已有 proof card、explorer、query page，这意味着新机制一旦形成，可以较自然地可视化展示。

从论文原型视角看，这意味着项目已经具备“系统承载层”，当前研究真正缺的是“查询证明层”。

### 7.2 当前项目的算法缺口

然而，和本文机制相比，当前项目至少还缺四个关键点：

1. 缺少可表达源链状态承诺的统一接口。
2. 缺少 `state proof` 生成与验证逻辑。
3. 缺少“查询对象规范化”层。
4. 缺少独立的 `VerifyQuery` 语义输出。

### 7.3 建议的模块映射

在不改动整体 Demo 交互方式的前提下，可将本文机制映射为：

- `LightClient-lite` 继续负责 header continuity，后续扩展 finality-aware rule。
- 在 relayer 侧增加 `query proof builder`，负责构造 `Q`、提取 `value`、组织 `pi_state`。
- 在目标链侧增加 `query verifier`，负责验证 `Q`、`value` 与 `proof bundle`。
- 在前端 proof card 中新增 `query commitment`、`state root`、`proof verified` 等展示项。

### 7.4 可能的论文实现章节写法

如果后续把本文扩展成正式论文，实现章节可以按以下方式组织：

1. **链间模型适配**：说明 Fabric 与 FISCO-BCOS 的状态表示差异。
2. **查询对象标准化**：定义 orchard 查询如何映射到 `Q`。
3. **证明包结构设计**：定义 `\Pi_Q` 的编码格式与传输格式。
4. **目标侧验证流程**：描述 Query Verifier 在链码或合约中的执行过程。
5. **UI 证明可视化**：展示如何把 proof bundle 映射为用户可理解的 proof card。

> 图示占位建议 8：现有代码到目标机制的映射图
>
> 建议内容：左边放当前模块，右边放新增算法模块，用箭头显示升级关系。
>
> 绘图提示词：
> “绘制一张 code-to-research mapping 图。左侧是当前模块：gateway.js、fabric_monitor.js、message_handler.js、query_broker.js、demo UI；右侧是目标模块：query object normalizer、query proof builder、state proof verifier、query commitment recorder。用箭头表示演进路径，风格专业。”

## 8. 原型实现与实验设计建议

### 8.1 原型范围

第一版原型只做一个典型查询：

- 查询对象：`orchardBatchId`
- 查询语义：单键确定性查询
- 返回值：对应 orchard record 的结构化 JSON

这样可避免复杂查询语义干扰，专注证明“结果是真的”。

### 8.2 原型步骤

建议原型按以下顺序推进：

1. 定义 `Q` 的标准表示。
2. 确定源链可导出的状态承诺根或近似承诺结构。
3. 为 orchard record 构造状态证明或可验证 membership 证明。
4. 在目标侧实现 `VerifyQuery(Q, value, proof)`。
5. 在 UI proof card 展示验证结果与承诺摘要。

### 8.3 实验指标

报告中建议设置以下实验指标：

- 查询证明生成时间
- 目标侧验证时间
- proof 大小
- 相比普通 relay query 的额外开销
- 在错误结果、替换结果、重放结果下的拒绝效果

如果按论文写法，可以把指标进一步分为：

- **效率指标**：proof generation latency、verification latency、storage overhead、network overhead
- **安全指标**：forgery rejection、replacement rejection、replay rejection
- **适配指标**：不同链侧对象编码方式对 proof 大小与验证耗时的影响

### 8.4 对照实验

建议至少设计两组对照：

1. 普通 relayer query vs verifiable query
2. event-proof query vs state-proof query

这样可以在论文里清楚说明：本文方法的增量成本换来了什么样的安全收益。

### 8.5 论文式实验假设

为增强论文表达完整性，可在实验章节显式提出如下假设：

- **H1**：相较于 trusted relayer query，本文方法可显著提升结果真实性保障。
- **H2**：相较于 event-proof query，本文方法在“状态值真实性”表达上更强。
- **H3**：本文方法虽引入额外 proof 开销，但在联盟链场景下仍具备可接受的验证延迟。

> 图示占位建议 9：实验设计图
>
> 建议内容：展示实验输入、变量、对照组、指标。
>
> 绘图提示词：
> “绘制一张实验设计框架图。包含 baseline trusted query、event-proof query、proposed state-proof query 三组；指标包括 proof generation time、verification latency、proof size、security guarantees。风格适合论文实验章节。”

## 9. 研究价值与后续扩展

本文路线的研究价值在于，它没有停留在“把现有跨链消息流程包装成查询接口”，而是试图把跨链查询本身提升为一个可证明对象。其潜在价值主要体现在三点：

第一，它把跨链查询从“可信工程调用”提升为“可验证协议行为”。

第二，它为异构联盟链场景提供了较现实的中间路线：既不完全依赖 trusted relayer，也不要求第一阶段就承担全量 zk proof 的工程负担。

第三，它为后续扩展打开了清晰空间，包括：

- 不存在性证明
- 批量查询证明
- 范围查询与完整性证明
- zk 化与 proof aggregation

若按课题或论文创新点表述，还可以进一步概括为：

1. **问题创新**：将异构联盟链跨链查询真实性作为独立研究问题提出。
2. **机制创新**：提出查询对象、结果承诺与状态证明三层耦合结构。
3. **路线创新**：在 trusted relay 与全量 zk 之间给出一条更适合现阶段项目的中间技术路线。

## 10. 局限性与未来工作

尽管本文提出的机制在问题定义与算法表达上较为完整，但仍存在若干局限。

首先，本文第一阶段仅处理**单键确定性查询**，尚未覆盖不存在性证明、区间查询、分页查询和聚合查询，因此对复杂业务查询场景的支持仍有限。

其次，本文默认源链可以提供可验证的状态承诺根与相应的成员证明接口。在真正的异构联盟链环境中，这一点往往依赖链底层数据结构、SDK 能力与链码/合约暴露方式，因而仍需额外工程化适配。

再次，本文暂未把最终性验证、状态证明与结果证明统一压缩为 succinct proof，因此在 proof 大小、链上验证成本和跨链延迟方面仍可能高于更激进的 zk 方案。

未来工作可以沿三条路线展开：

1. 扩展到不存在性证明与范围查询完整性证明。
2. 引入 proof batching 与 aggregation，降低验证成本。
3. 将本文机制进一步与 finality-aware light client 或 zk proof 系统结合，形成更完整的跨链查询验证框架。

## 11. 结论

针对当前 Fabric 与 FISCO-BCOS 异构跨链项目，本文认为最具算法机制创新空间的方向，不是继续强化 relay 编排本身，也不是直接引入全量 zk 桥，而是构建**面向跨链查询的可验证结果证明机制**。该机制以轻客户端维护的已确认区块头为基础，以状态承诺绑定的查询结果证明为核心，将“结果是真的”还原为“结果属于某个已确认状态”的可验证命题。

这一方向既与当前仓库的技术积累高度衔接，也具备较完整的论文表达结构。若后续按本文建议推进，项目可以从“可演示的跨链查询平台”进一步升级为“具备可验证查询语义的异构跨链研究原型”。

## 参考文献与资料

1. Cosmos IBC Introduction: https://docs.cosmos.network/ibc/v10.1.x/intro
2. IBC Proofs: https://ibc.cosmos.network/v10/ibc/light-clients/proofs/
3. ICS-23 Vector Commitments / Proofs: https://github.com/cosmos/ics23
4. Cosmos IBC Standards Repository: https://github.com/cosmos/ibc
5. Nomad Optimistic Verification: https://docs.nomad.xyz/the-nomad-protocol/verification-mechanisms/optimistic-verification
6. Hyperproofs, IACR ePrint 2021/599: https://eprint.iacr.org/2021/599
7. zkBridge: Trustless Cross-chain Bridges Made Practical, arXiv: https://arxiv.org/abs/2210.00264
