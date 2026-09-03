# GitHub 提交清单

本次提交仅包含可审计语义查询论文的实现、复现实验、必要原始证据和最终文稿。

## 必须提交

1. `fabric-chaincode/Relayer/demo/semantic_query/`：DAG、证据适配、审计回执、SQLite、锚定及正式实验驱动。
2. `fabric-chaincode/Relayer/demo/experiments/model_benchmark/`：120 条扩展模型案例的真实后端运行器和统计逻辑。
3. 对应 Jest 测试、`package.json` 命令、两个 FISCO 合约源码/ABI及部署脚本。
4. `tools/independent_audit_verify.py`、结果图生成器和 DOCX 修订生成器。
5. 论文正文实际引用的实验目录：真实功能、物理故障、单钱包并发、监管披露、韧性、四钱包并发、v2 本地回执及扩展本地实验。
6. 120 条模型案例与标注模板、独立核验 JSON、完成度/验收/边界报告和第二机器复现脚本。
7. 最终 DOCX、修订说明及其可再生成的 PNG/SVG 图。

## 明确排除

- `fabric-chaincode/Relayer/config.json`：包含机器相关路径和运行时配置；仅提交无密钥的 `config.example.json`。
- `node_modules/`、`.fabric-runtime/`、FISCO 节点账本、编译缓存、部署日志和容器临时文件。
- FISCO `.compiled/group0/` 下带部署地址的产物；提交 Solidity 源码和无私钥 ABI 即可。
- 与本论文无关的 NDSS 文稿、旧图、旧 PDF/HTML、其他论文备份及工作区已有改动。
- 模型推理 `summary.json`：当前没有完整真实模型运行，因此只提交案例、模板和运行器，不提交伪造结果。

## 证据边界

四钱包正式实验已经完成；120 条模型扩展与第二机器复现目前只有可执行材料，真实模型推理、人类双标和第二主机数据仍待完成。GitHub 中的状态文档和论文正文保持同一表述。
