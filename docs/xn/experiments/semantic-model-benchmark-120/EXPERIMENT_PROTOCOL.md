# 120 条语义模型扩展基准执行规程

## 数据与证据边界

- `cases.json` 固定包含 120 条案例：6 类业务规则各 20 条，`ACCEPT`/`REJECT` 各 60 条。
- 标签由显式日期、额度、容差、区间和汇率规则生成，与被测模型输出无关。
- 该基准只测模型能否执行给定规则，不能代表任意真实业务语义的总体正确率。
- 模型给出的 `confidence` 是自报值，不是提供方 log probability。

## 双模型推理

在 `qkl/fabric-chaincode/Relayer` 下运行。结果必须写入新的 `runs/<run-id>` 目录；运行器默认拒绝覆盖已有 `summary.json`。

本地 Ollama 示例：

```bash
MODEL_BACKEND=ollama \
OLLAMA=http://127.0.0.1:11434 \
MODELS='llama3.2:1b,qwen2.5:1.5b' \
REPEATS=1 \
MODEL_CONCURRENCY=2 \
OUTPUT_DIR='/absolute/path/to/semantic-model-benchmark-120/runs/ollama-<run-id>' \
npm run exp:model-benchmark:extended
```

OpenAI Responses 兼容接口示例：

```bash
MODEL_BACKEND=openai \
MODELS='<model-a>,<model-b>' \
REPEATS=1 \
MODEL_CONCURRENCY=2 \
OUTPUT_DIR='/absolute/path/to/semantic-model-benchmark-120/runs/openai-<run-id>' \
npm run exp:model-benchmark:extended
```

OpenAI 路径从环境读取 `OPENAI_API_KEY` 和 `OPENAI_BASE_URL`。若 `OPENAI_BASE_URL` 不是官方域名，必须先确认端点归属和凭据发送授权；不得把密钥写入命令、日志或结果文件。

完整运行应满足：

- `caseCount = 120`；
- 两个模型、一次重复时 `inferenceCount = 240`；
- 每个模型 `requested = completed = 120` 且 `errors = 0`；
- `raw_samples.json` 与 `summary.json` 均存在；
- 汇总包含准确率及 Wilson 95% 区间、误放率、误拒率、Brier 分数、ECE、延迟分位数、token 数和跨模型错误相关性。

## 两人独立盲标

`annotation/annotator_a_blind.csv` 与 `annotation/annotator_b_blind.csv` 使用不同随机顺序和各自的匿名编号，不包含规则标签、案例族或原始案例编号。管理员必须只把对应的单个CSV副本交给每位标注者；标注者不得获得仓库、`cases.json`、另一人的文件或 `admin_crosswalk.csv` 的访问权。仅仅把这些文件放在同一仓库中并不自动构成盲法，盲法依赖上述分发隔离。

两人分别填写全部 `label` 后执行：

```bash
npm run exp:model-benchmark:annotations -- \
  '/absolute/path/to/semantic-model-benchmark-120/annotation'
```

工具会校验 120 项是否完整，计算一致率与 Cohen's kappa，并为分歧项生成不含规则标签的 `disagreements_blind.csv`。第三位裁决者填写后，以 `ADJUDICATION_FILE` 指定该文件并再次执行。人工标签为空时不得报告人机一致性或把规则标签称为人工 ground truth。

## 当前状态

案例、双后端运行器、统计代码、盲标包和一致性工具已经实现并通过单元测试。模型推理结果与人工标签只有在相应结果文件完整生成后才能进入论文结果表。
