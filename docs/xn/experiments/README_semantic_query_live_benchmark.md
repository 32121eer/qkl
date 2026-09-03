# 可审计语义查询实时双链基准

该基准用于补充论文 6.3 节缺少的真实执行证据。Fabric Gateway 读取、FISCO-BCOS 合约读取、SQLite 审计持久化和 FISCO 回执根锚定均运行在本地真实双链环境；故障场景采用 DAG 调度边界上的确定性注入，因此不能表述为物理主机或真实网络断连实验。

## 前置条件

1. 保持 Docker Desktop 运行。
2. 在仓库根目录执行 `bash start-all.sh`，或确认现有 Fabric/FISCO 容器仍在运行。
3. 首次运行或更换测试标识后写入供应链证据：

```bash
cd fabric-chaincode/Relayer
npm run exp:semantic-query:seed -- \
  --batch BATCH-FINANCE-001 \
  --supplier SUPPLIER-001 \
  --order ORDER-001
```

## 快速验证

快速模式对六个场景各执行一次，不做预热：

```bash
npm run exp:semantic-query:live-benchmark -- --quick
```

六个场景分别为：

- `normal`：无故障的真实双链查询；
- `fabric_endpoint_retry`：Fabric 首选端点受控失败，切换到替代端点；
- `fisco_endpoint_retry`：FISCO 首选端点受控失败，切换到替代端点；
- `semantic_service_timeout`：首个语义服务超时，追加第二个服务；
- `fabric_endpoint_exhausted`：两个 Fabric 候选端点均失败，查询以 `FAILED` 终止；
- `semantic_disagreement`：两个语义服务均返回冲突标记，查询以 `INSUFFICIENT_EVIDENCE` 终止。

所有终态（包括失败和证据不足）都会生成审计回执并锚定到 FISCO，以证明系统没有把异常终止静默丢弃。

## 正式采样

建议先进行 3 次预热，再对每个场景执行 5 轮、每轮 20 个查询：

```bash
npm run exp:semantic-query:live-benchmark -- \
  --warmup 3 \
  --runs 5 \
  --queries 20
```

也可以限定场景：

```bash
npm run exp:semantic-query:live-benchmark -- \
  --scenarios normal,fabric_endpoint_retry,semantic_service_timeout \
  --warmup 3 \
  --runs 5 \
  --queries 20
```

正式数据默认写入 `docs/xn/experiments/semantic-query-live-runs/<时间戳>/`：

- `manifest.json`：软硬件环境、链配置、参数和证据边界；
- `raw.jsonl`：逐查询原始数据；
- `results.csv`：用于统计软件和论文制表的数据；
- `summary.json`：各场景延迟分位数、重试开销、终态和审计通过率；
- `audit.db`：证据包、DAG 节点、执行事件、服务输出和链上锚点。

## 论文报告口径

快速模式仅验证实现正确性，不能作为论文统计结论。正式结果至少报告每个场景的样本量、端到端延迟 P50/P95/P99、执行阶段延迟、锚定与持久化开销、平均重试次数、审计验证率和终态分布。吞吐量字段是当前串行提交模式的观测吞吐，不应表述为系统最大吞吐。

受控注入结果不能单独用于声称真实节点故障容错，因此实现另提供容器级实验，并与受控故障结果分表报告。该实验会依次暂停 Fabric Org1 peer 和 FISCO node0，候选适配器分别切换到 Org2 peer 和 FISCO node1，并在 `finally` 清理路径中恢复目标：

```bash
npm run exp:semantic-query:physical-faults -- --repetitions 1
```

结果写入 `docs/xn/experiments/semantic-query-physical-fault-runs/<时间戳>/`。运行前应确认 Fabric Org2 peer、FISCO node1 和负责锚定的 FISCO node3 均健康。物理实验不能与其他正在使用这些容器的任务并行执行。

## 单钱包与多钱包锚定对照

单钱包基准会为同一签名账户串行化交易，以避免 nonce 竞争。多钱包模式把交易轮询分配到若干签名账户，并保持每个账户内部串行：

```bash
npm run exp:semantic-query:live-saturation -- \
  --levels 1,2,4,8,16 --runs 3 --queries 20 --warmup 2 \
  --anchor-wallets 4
```

正式四钱包结果位于 `semantic-query-live-multiwallet-runs/2026-09-02-formal-w4/`。300/300 个计量查询完成；并发 4 吞吐由单钱包的 1.882 提高至 7.150 query/s，p95 由 2,236.398 降至 571.765 ms，饱和点由并发 2 移至并发 8。310 份含预热回执均通过独立审计。两组实验在同一主机但不同日期运行，未随机交错；额外钱包为实验临时签名者，不能直接解释为生产密钥方案。

## P1 模型扩展与第二机器复现

120 条模型输出无关的规则标签案例、人类双标模板以及校准、误放/误拒、跨模型错误相关性运行器位于 `semantic-model-benchmark-120/` 与 `demo/experiments/model_benchmark/`。只有至少两个真实模型完成全部案例后，`summary.json` 才能作为论文结果；后端不可用时运行器会失败，不会回退到模拟输出。

第二机器复现参见 `P1_EXTERNAL_REPLICATION_RUNBOOK.md`，并执行仓库脚本：

```bash
cd /path/to/qkl
bash scripts/run-p1-external-replication.sh
```

脚本固定正式参数，自动记录环境、执行单/四钱包实验、独立审计和校验和。没有第二主机生成的完整结果目录时，不应在论文中声称跨机器复现已完成。

## 本地扩展实验

不依赖双链服务的第二业务负载、DAG 形态/规模/证据体积、本地并发、缓存、重试和探索性服务调度统一通过下列命令执行：

```bash
npm run exp:semantic-query:extended -- --runs 5 --queries 20
```

结果写入 `docs/xn/experiments/semantic-query-extended-evaluation/`。这些测量使用确定性本地夹具或固定种子的故障模型，不能与真实双链端到端时延或容量合并报告。

## 独立审计与回执格式版本

历史 603 份双链回执和 40 份物理故障回执可使用独立 Python 实现复核：

```bash
python3 tools/independent_audit_verify.py
```

历史回执的整体根与链上锚点均可验证，但其叶级记录存在格式限制：本地文档证据没有全部进入 `audit_evidence`，证据与服务输出缺少显式 `nodeId`。因此历史数据只能支持整体完整性和现有记录的篡改定位，不能声称全部成功叶节点都能显式归因。

当前执行器已为所有证据和服务输出写入显式节点绑定。正式本地 v2 结果位于 `semantic-query-receipt-v2-evaluation/`，独立复核结果位于 `semantic-query-receipt-v2-independent-verification.json`。历史数据库和链上锚点保持不变，不进行追溯改写。
