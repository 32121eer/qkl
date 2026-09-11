# 修订说明

## 输出

- 修订稿：`Electronics_异构联盟链可审计语义查询框架_完善实验修订版.docx`
- 原始实验结果：`experiments/semantic_query_framework_results.json`
- 可复现实验脚本：`experiments/semantic_query_framework_experiments.js`
- 分项CSV：`semantic_query_dag_results.csv`、`semantic_query_fault_results.csv`、`semantic_query_audit_results.csv`

## 主要修改

1. 删除15个“作者注释/实验证据缺口”单元格，保留统一证据对象字段表。
2. 将摘要、贡献、原型实现、实验、局限和结论从“待补实验”改为有证据边界的完成时表述。
3. 新增RQ1证据验证：200个正常样本与8类故障800例。
4. 新增RQ2 DAG调度微基准：8/16/32节点，3种策略，5次独立运行。
5. 新增RQ3受控故障注入：8类故障、无恢复/有界恢复两策略，共1,600次执行。
6. 新增RQ4审计实验：400份完整回执、1,600次篡改，报告回执大小和p50/p95重构时间。
7. 新增RQ5共享门控失败剪枝消融，并保留小规模双模型相关错误结果作为探索性证据。
8. 明确区分归档链上测量、受控离线实验和分析模型；未把本地定时器、模板化故障或7笔receiveLite样本外推为生产系统结论。

## 仍需作者核验

- 重新部署后确认Gateway.receiveLite与当前审计回执锚定字段完全一致，并扩大链上交易样本。
- 在真实Fabric/FISCO节点、远端语义服务和持久化审计存储上补测端到端p95/p99、吞吐、物理故障恢复和数据可用性。
- 用独立实现的审计器进行交叉验证，并将16案例双模型任务扩充至至少100–200个明确ground truth案例。
- 投稿前统一Electronics/MDPI参考文献格式并逐条核验访问日期、卷期和页码。
