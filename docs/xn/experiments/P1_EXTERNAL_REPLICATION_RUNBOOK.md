# P1 第二机器复现实验运行说明

## 目的与完成判据

该流程用于在独立机器上复现单钱包与四钱包锚定的并发曲线。只有第二机器实际生成结果后，论文才能把“外部有效性对照”标记为完成。

完成判据如下：

1. 第二机器不是当前实验主机，且 `environment.txt` 记录操作系统、Node、Docker 和 Git 提交；
2. 单钱包、四钱包均完成并发 1/2/4/8/16、每档 3 轮×20 个计量查询及 2 次预热；
3. 每档 `completed == expected == queries`，SQLite 审计数据库通过完整性和独立重构；
4. 报告吞吐、P95、锚定排队 P95 和饱和点，不把单机原型观测外推为 FISCO-BCOS 平台上限；
5. 提交原始 JSONL、SQLite、manifest、summary、comparison 和校验和，而不只提交汇总表。

## 独立机器执行

前置条件：Docker daemon 已启动，仓库已经检出到待复现提交，Node/npm 可用。首次部署可能需要访问 Docker Hub 和 npm registry。

```bash
cd /path/to/qkl
bash scripts/run-p1-external-replication.sh
```

脚本会启动并部署本地 Fabric/FISCO 双链、写入供应链夹具、运行全部 Jest 测试，然后依次执行单钱包和四钱包正式饱和实验。默认输出目录为：

```text
docs/xn/experiments/external-replication/<UTC时间戳>/
```

也可显式指定输出目录：

```bash
bash scripts/run-p1-external-replication.sh /absolute/output/path
```

脚本拒绝覆盖已有目录。额外钱包是实验进程内生成的临时签名者，私钥不会写入结果文件；若机器或钱包需要长期保留，应改用机构密钥管理系统，不能把该实验池直接当成生产方案。

## 回传与论文合并

回传整个时间戳目录。脚本会自动运行独立审计器并生成：

```text
docs/xn/experiments/external-replication/<UTC时间戳>/independent_verification.json
```

在此文件出现且全部数据库通过以前，不得把第二机器复现写成已完成。

跨机器比较至少报告各并发档吞吐与 P95 的相对差异，并说明 CPU 架构、内存、Docker/Fabric/FISCO 版本、运行日期及非随机先后顺序造成的边界。
