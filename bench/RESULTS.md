# ChatLuna 评测结果账本

本文件是持续更新的性能账本，也是本项目评测可观测性记录的承载。每轮
追加可复现的元数据、聚合指标和限制说明；不另设独立可观测性平台。

## Round 0 元数据

| 字段                    | 值                                               |
| ----------------------- | ------------------------------------------------ |
| 测试日期                | 2026-08-06                                       |
| 分支                    | `optimize/subagent-conversation-observability`   |
| 基线 revision           | `a3f25187e9d4b4f8a62f247ebf49e9868222a676`       |
| 本轮 candidate revision | `a3f25187e9d4b4f8a62f247ebf49e9868222a676-dirty` |
| 模型                    | `flymyd/deepseek-v4-flash`                       |
| Aider 数据集 commit     | `7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f`       |
| Aider run               | `9abef6f4-cc51-4160-bf0d-dc0da2da65f2`           |

### 运行环境

- runner 使用 local backend，artifact 中的 `sandboxMode` 为
  `workspace-write`，`approvalMode` 为 `never`，并启用了
  `dangerouslySkipPermissions`。
- Linux 的 sandbox backend 是 `bwrap`；macOS 的 sandbox backend 是
  `sandbox-exec`，网络策略为 deny/block。本轮实际 backend 为
  `sandbox-exec`，artifact 记录 `enforcement=production-sandbox`、
  `policy=block`、`blockedAttempts=0`。
- raw JSONL、report 和运行 artifacts 位于 `.tmp/agent-eval`；其中
  `summary.json` 与 `report.md` 是 `yarn bench:report` 生成的聚合输出。

## 可复现命令

以下命令来自当前 bench 入口和 README。context/report 命令不调用模型；
Aider 命令会调用配置的模型，本轮不重复运行付费模型。

```sh
yarn bench:context --iterations 3 --agents none --variant both
yarn bench:report
yarn bench:aider \
  --cases grade-school,queen-attack,two-bucket,wordy,grep \
  --attempts 1 \
  --max-turns 40 \
  --timeout 240 \
  --compare none
```

`bench:aider` 的固定数据目录由 `bench/agent-eval.json` 指向
`.tmp/agent-eval/datasets/polyglot`；运行前应确认该目录为上面记录的
数据集 commit。`yarn bench:report` 只读取已有 JSONL，不会启动模型。

## Context benchmark

这里有优化前后可比的 deterministic context benchmark。`score` 对应
`avgScore`，`tool valid`、`duplicate` 是报告中的 rate，`infra failures`
是失败记录数。变化百分比按 `(candidate - baseline) / baseline` 计算；
百分比为负表示该计数或耗时下降，零基线的百分比记为不适用。

| 指标           | baseline | candidate |               变化 | 方向     |
| -------------- | -------: | --------: | -----------------: | -------- |
| count          |        3 |         3 |              0.00% | 不变     |
| score          |      0.4 |       1.0 |           +150.00% | 越高越好 |
| pass@1         |      0.4 |       1.0 |           +150.00% | 越高越好 |
| total tokens   |    78765 |     78057 |             -0.90% | 越低越好 |
| p50 tokens     |    26255 |     26019 |             -0.90% | 越低越好 |
| p50 wall       |    65 ms |     31 ms |            -52.31% | 越低越好 |
| tokens/pass    |  65637.5 |     26019 |            -60.36% | 越低越好 |
| tool valid     |        1 |         1 |              0.00% | 越高越好 |
| duplicate      |        0 |         0 | 绝对变化 0；不适用 | 越低越好 |
| infra failures |        0 |         0 | 绝对变化 0；不适用 | 越低越好 |

context benchmark 的结论是：样本数保持为 3，score 和 pass@1 从 0.4
升至 1.0；total tokens、p50 tokens、p50 wall 和 tokens/pass 均下降，
tool valid 保持为 1，duplicate 和 infra failures 保持为 0。

## Aider 固定五题 pilot

本轮 Aider 只有优化后 candidate 的固定五题 pilot，均为单次 attempt，
runId 为 `9abef6f4-cc51-4160-bf0d-dc0da2da65f2`。它作为下一轮优化的
baseline；这里不虚构 `v1-dev` Aider 分数。

逐题表中的 `total` 是该历史 pilot artifact 记录的 provider reported total，
不由 input 和 output 重新相加。它早于本轮逐 event token audit，不应与后文
v9 记录的 diagnostic upper estimate 混为同一口径。

| 题目         | 状态 | score | input | output | total | tools | turns | wall ms | grader ms |
| ------------ | ---- | ----: | ----: | -----: | ----: | ----: | ----: | ------: | --------: |
| grade-school | pass |     1 | 29907 |   3178 | 33043 |     9 |    20 |   74643 |       449 |
| queen-attack | pass |     1 | 40784 |  10967 | 51688 |    10 |    29 |   87954 |       462 |
| two-bucket   | pass |     1 | 38796 |  25136 | 63883 |    11 |    23 |  223962 |       477 |
| wordy        | pass |     1 | 35591 |   8347 | 43889 |    11 |    23 |  110626 |       484 |
| grep         | pass |     1 |  3958 |   1825 |  5783 |    24 |    56 |  215317 |       429 |

### Aider 汇总

| 指标                  |      合计 |        均值 |
| --------------------- | --------: | ----------: |
| pass                  |       5/5 |         1.0 |
| score                 |         5 |         1.0 |
| input tokens          |    149036 |     29807.2 |
| output tokens         |     49453 |      9890.6 |
| reported total tokens |    198286 |     39657.2 |
| tools                 |        65 |        13.0 |
| turns                 |       151 |        30.2 |
| wall                  | 712502 ms | 142500.4 ms |
| grader                |   2301 ms |    460.2 ms |

历史 aggregate 的 10 次结果为 0.9，其中包含 runner 开发期失败；它不作为
产品优化前后对比。当前 Aider 数据只说明固定 pilot 的 candidate 结果，
并不提供可与 context benchmark 直接配对的 Aider baseline。

## Sandbox 记录

runner 的 sandbox 选择为 Linux `bwrap` 或 macOS `sandbox-exec`；macOS
配置 deny network。本轮记录如下：

| 字段            | 值                     |
| --------------- | ---------------------- |
| backend         | `sandbox-exec`         |
| network policy  | `block` / deny network |
| enforcement     | `production-sandbox`   |
| blockedAttempts | `0`                    |

## 已知限制

- Aider 每道题只有单次 attempt，且当前样本很小。
- Aider 使用 dirty revision；本轮 candidate artifact 明确记录了
  `-dirty`。
- provider reported total 不必等于 input 加 output；账本保留 provider
  报告值，不自行改写。
- context benchmark 的 token 是近似 token，不能与 provider usage 混用。
- `grep` 超过传入的 `max-turns`；后续需要查清计数语义，不能把它直接
  当作另一种失败指标。
- zsh/gitstatus 噪声可能抬高 wall time，因此 wall 指标应结合 artifact
  和后续重复轮次解读。

## Aider JavaScript 完整对照

完整对照固定使用数据集 commit
`7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f` 的 49 个 eligible JavaScript
任务、单次 attempt、`flymyd/deepseek-v4-flash`、500 秒 timeout，以及相同的
workspace、任务 prompt、工具和 hidden grader。每轮分为 4 个独立 shard；
ChatLuna 经过真实 Koishi、ChatLuna、extension-agent 和
`subAgent.runTask()`，OpenCode 使用本地隔离 harness。

```sh
yarn tsx --tsconfig bench/tsconfig.json bench/aider-eval.ts \
  --all --suite-id aider-js-7e0611e-runtime-v12-500-full \
  --shard-index 0 --shard-count 4 --resume --timeout 500 \
  --compare opencode \
  --results .tmp/agent-eval/aider-runtime-v12-500-full-shard-0.jsonl

yarn bench:aider:report \
  --suite-id aider-js-7e0611e-runtime-v12-500-full \
  --results .tmp/agent-eval/aider-runtime-v12-500-full-shard-0.jsonl \
  --results .tmp/agent-eval/aider-runtime-v12-500-full-shard-1.jsonl \
  --results .tmp/agent-eval/aider-runtime-v12-500-full-shard-2.jsonl \
  --results .tmp/agent-eval/aider-runtime-v12-500-full-shard-3.jsonl
```

### Token audit 口径

provider usage 是 Aider token 的唯一正式口径。新结果的 `tokens` 只累计
`estimated=false` event 的 provider reported 值；`reportedTotal` 和 suite
summary 的 `basis: reportedTotal` 只累计 provider 自己给出的 `total_tokens`，
不以 provider input 加 output 重算。

`estimated=true` 表示该 call 没有 provider usage。其消费量为 unknown；
`estimatedCalls` 记录缺失 call 数，`localInputEstimate`、
`localOutputEstimate`、`localTotalEstimate` 和
`missingProviderTotalEstimate` 仅保留模糊估算诊断，不回填正式 `tokens`，也
不进入 suite 统计、比较或结论。reporter 读取旧 JSONL 时同样只使用
`reportedTotal` / `reportedProvider*`，不会回退到旧 `tokens`、`rawMixedTotal`、
`audited*`、local 或 max-derived 字段。

下文 v9、v11、v12 中原以 `auditedTotal` 记录的历史数字不重写 JSONL，也不
冒充 provider total。它们只保留为当时按 provider/local 逐 event 取最大值的
diagnostic upper estimate。v9 的 provider subtotal 已由当前 reporter 从四个
JSONL 重算并在下文单列；v11/v12 未重算的 provider totals 不补造。

### 完整对照汇总

| suite / agent       | pass | fail | infra |           verifier |         state pass | recorded token basis                                                  | recorded figure |  recorded avg | recorded p50 | recorded p95 | tools avg | turns avg |      wall p50 |      wall p95 |
| ------------------- | ---: | ---: | ----: | -----------------: | -----------------: | --------------------------------------------------------------------- | --------------: | ------------: | -----------: | -----------: | --------: | --------: | ------------: | ------------: |
| v1 ChatLuna         |   31 |    8 |    10 |             75.51% |             63.27% | historical reported                                                   |         2686711 |             - |        48976 |       133713 |     11.35 |      8.63 |        103468 |        306226 |
| v1 OpenCode         |   38 |    7 |     4 |             79.59% |             77.55% | reported                                                              |        19125452 |             - |       253546 |       989124 |     10.80 |      9.45 |         85237 |        285449 |
| v2 ChatLuna         |   32 |    7 |    10 |             73.47% |             65.31% | **withdrawn completed-response/provider lower bound**                 |     **2468625** |             - |        49243 |       102698 |     11.06 |      8.18 |        137556 |        296098 |
| v2 OpenCode         |   36 |    6 |     7 |             75.51% |             73.47% | reported, cache included                                              |        16693370 |             - |       249395 |       805966 |     11.02 |      9.10 |        125795 |        299396 |
| v9 ChatLuna         |   34 |    7 |     8 | **35/49 = 71.43%** | **34/49 = 69.39%** | historical diagnostic upper estimate                                  |     **3498200** |  **71391.84** |    **54226** |   **140462** |  **8.71** |  **5.51** |  **80585 ms** | **270654 ms** |
| v11 ChatLuna        |   40 |    6 |     3 | **41/49 = 83.67%** | **40/49 = 81.63%** | historical diagnostic upper estimate                                  |     **6934496** |             - |            - |            - |         - |         - |             - |             - |
| v12 ChatLuna strict |   35 |   12 |     2 | **36/49 = 73.47%** | **35/49 = 71.43%** | historical diagnostic upper estimate                                  |     **6646828** | **135649.55** |   **123060** |   **337598** | **10.94** |  **8.43** | **146686 ms** | **438764 ms** |
| v12 OpenCode strict |   41 |    7 |     1 | **41/49 = 83.67%** | **41/49 = 83.67%** | historical diagnostic upper estimate; provider total not recalculated |    **11537425** | **235457.65** |   **182861** |   **561887** | **12.37** | **10.67** | **131144 ms** | **282864 ms** |
| v20 ChatLuna strict |   39 |    8 |     2 | **39/49 = 79.59%** | **39/49 = 79.59%** | `provider reportedTotal only`                                         |     **2702566** |  **55154.41** |    **52312** |   **104008** | **11.02** |  **8.47** | **172613 ms** | **409533 ms** |
| v22 ChatLuna SSE    |   39 |    5 |     5 | **42/49 = 85.71%** | **39/49 = 79.59%** | `provider reportedTotal only`                                         |     **3047571** |  **62195.33** |    **51001** |   **117437** | **11.92** |  **9.14** | **172055 ms** | **504616 ms** |

表中 `recorded figure/avg/p50/p95` 沿用历史账本记录。凡 basis 标为
diagnostic 的数字都不是新 contract 下的正式 token 指标，不参与 provider
token 比较；账本未从原 JSONL 计算出的 provider totals 保持未提供。

### v11 / v12 已完成结果

v11 是旧的 240s Aider agent timeout 轮次；v12 是新的 500s Aider agent
timeout 轮次。完整对照表以 strict single sample 为主值。v12 中 OpenCode
state pass 为 41，strict ChatLuna 为 35，领先 6 题；verifier 分别为 41 和
36，领先 5 题。

相比旧 240s v11，ChatLuna 在 500s v12 strict sample 中下降，说明 timeout
不是唯一或主要解释，模型/provider 输出波动显著；单轮结果不表达因果关系。

| 版本                | agent timeout | state pass | fail | infra | verifier | historical diagnostic upper estimate | diagnostic avg | diagnostic p50 | diagnostic p95 | tools avg | turns avg |  wall p50 |  wall p95 |
| ------------------- | ------------: | ---------: | ---: | ----: | -------: | -----------------------------------: | -------------: | -------------: | -------------: | --------: | --------: | --------: | --------: |
| v11 ChatLuna        |          240s |         40 |    6 |     3 |    41/49 |                            6,934,496 |              - |              - |              - |         - |         - |         - |         - |
| v12 ChatLuna strict |          500s |         35 |   12 |     2 |    36/49 |                            6,646,828 |      135649.55 |         123060 |         337598 |     10.94 |      8.43 | 146686 ms | 438764 ms |
| v12 OpenCode strict |          500s |         41 |    7 |     1 |    41/49 |                           11,537,425 |      235457.65 |         182861 |         561887 |     12.37 |     10.67 | 131144 ms | 282864 ms |

OpenCode v12 的 `11,537,425` 是历史 report 中的诊断字段。这里未从原 JSONL
重新计算 provider `reportedTotal`，因此不把它改标为正式 provider total，也
不与 ChatLuna v12 的 `6,646,828` 作 token 或 billing 比较。

v11 的 runId 和逐项审计明细未在现有记录中提供，因此这里只记录上述聚合值，
不补列未提供的详细 totals。v12 suiteId 为
`aider-js-7e0611e-runtime-v12-500-full`。ChatLuna strict single sample 的四个
shard runId 为：

- shard 0: `8d51da66-ddb7-4633-972a-69024f8385b0`
- shard 1: `8a039e3e-0362-4937-a95e-15defde420c5`
- shard 2: `ee3397b2-b156-4122-a607-77b7f8997928`
- shard 3: `ab80f76f-3bb7-4978-93bd-40374347a86d`

OpenCode strict single run 的四个 shard runId 为：

- shard 0: `8dd29cb8-38c4-43ed-a87a-a2828adda6f1`
- shard 1: `65d02ebd-ea36-4357-aeda-d33871b76259`
- shard 2: `19f72b6e-88c6-45d6-bfcf-d083561dd0a8`
- shard 3: `545254e8-08a3-4cf2-93bc-cbcf039b04a8`

#### v12 latest / resume 视图

同一 `--resume --compare opencode` 补跑中，runner 自动重试了 ChatLuna 的旧
infra `forth`，且重试成功。latest report 与 strict single sample 的区别为：

| ChatLuna v12 视图    | pass | fail | infra | verifier | diagnostic upper estimate |
| -------------------- | ---: | ---: | ----: | -------: | ------------------------: |
| strict single sample |   35 |   12 |     2 |    36/49 |                 6,646,828 |
| latest / resume      |   36 |   12 |     1 |    36/49 |                 6,503,675 |

完整对照表继续使用 strict single sample；latest / resume 仅记录补跑后的当前
视图，不替换或混入主对照值。

### v18-v23 1M / SSE 追加轮次

统一 1M 语义为：`hardContext` 来自 model metadata；
`usableLimit = hardContext * maxContextRatio`；
`infinite threshold = min(usableLimit, hardContext * configuredThreshold)`；
agent scratchpad 在 `usableLimit` 触发。DeepSeek/model config 为
`1M * 0.85 = 850k`，没有 provider-name branch，也没有 double `.85`。
这些 live run 均未到 `850k` compression；边界由 `840k`/`850k` 和 `35k`
focused probes 验证。

#### v18 targeted

suite `aider-js-7e0611e-runtime-v18-1m-targeted` 共 12 题，
`6 pass / 6 fail / 0 infra`，verifier 6；provider
`reportedTotal=679148`，101 reported calls，1 missing usage call。
缺失 call 的消费为 unknown，missing estimate 仅 diagnostic。JSONL 计算的
agent latency（average/p50/p95）为 `139561.67/85681/463607 ms`，
wall latency 为 `163070.08/130800/514279 ms`。targeted 结果不能外推
full suite。

#### v19 partial

v19 命令漏了 `--all`，只选了 5 题，是 invalid partial run，不进入主表。

#### v20 full

suite `aider-js-7e0611e-runtime-v20-1m-full` 共 49 题，
`39 pass / 8 fail / 2 infra`，verifier 39；provider
`reportedTotal=2702566`，415 reported calls，4 missing usage calls。
缺失 call 的消费为 unknown，missing estimate 仅 diagnostic。配置为
`hardContext=1M`、`usableLimit/compression=850k`、500s、`maxTurns=100`、
frozen prompt、single attempt。strict state 39 比 v12 ChatLuna strict
35 多 4，仍比 v12 OpenCode strict 41 少 2。

#### v21 SSE targeted

v21 suite `aider-js-7e0611e-runtime-v21-sse-targeted` 共 6 题，
`4 pass / 2 fail / 0 infra`，verifier 4；provider `reportedTotal=537929`，
65 reported calls，0 missing。`connect` 从 v20 的 500s infra 恢复为 pass，
`agentMs=263381`。这只说明 targeted 行为，不宣称因果或正式 full 提升。

#### v22 SSE full

suite `aider-js-7e0611e-runtime-v22-sse-full` 共 49 题，
`39 pass / 5 fail / 5 infra`；provider `reportedTotal=3047571`，448
reported calls，8 missing usage calls。缺失 call 的消费为 unknown，missing
estimate 仅 diagnostic。

| v22 指标                 |      average |       p50 |       p95 |
| ------------------------ | -----------: | --------: | --------: |
| agentLatency (`agentMs`) | 194031.37 ms | 166028 ms | 500009 ms |
| wallLatency (`wallMs`)   | 204010.84 ms | 172055 ms | 504616 ms |
| provider `reportedTotal` |     62195.33 |     51001 |    117437 |

tools avg 为 11.92，turns avg 为 9.14。verifier score 为 42，其中
`react`/`grep`/`killer` 是 `score=1` 的 infra；因此 strict state 仍是
39，低于 OpenCode strict 41。verifier 42 高于 OpenCode verifier 41，
但不能把 verifier 与 strict state 混称为 strict 超过。

#### v23 provider failure probe

v23 suite `aider-js-7e0611e-runtime-v23-provider-failure-targeted` 的
targeted killer 为 1 pass；provider `reportedTotal=33236`，6 reported
calls，0 missing，`agentMs=63991`，`wallMs=90462`。live run 没有触发
103；`API_REQUEST_FAILED` graceful branch 由 deterministic
`sub-agent-plan-timeout` probe 覆盖，不能回填 v22。

SSE generic semantic idle 中，comment-only 不重置 idle，且已有 connect 修复。
v22 仍有 provider/deadline 波动；single attempt 不能形成稳定因果结论。
artifact 已清理到 `runs/` 约 36K，JSONL 保留。

#### v24/v25 output budget rejected

v24 targeted 6 题在临时 `32768` default cap 下 `6/6 pass`；`react`、
`grep`、`zipper`、`list-ops`、`state-of-tic-tac-toe`、`bowling` 的长尾明显
下降，但 targeted 结果不能外推。

v25 full suite 在同一临时 cap 下共 49 题，`36 pass / 8 fail / 5 infra`，
verifier 38；provider `reportedTotal=3022812`，441 reported calls，14
estimated unknown。相较 v22 strict 39、verifier 42 回归；代表性回归包括
`react` fail、`alphametics` timeout、`transpose` fail，以及 `word-search`、
`bowling` timeout。

`32768` cap 已删除，最终语义仍是显式 input `maxToken` > preset
`maxOutputToken` > `undefined`。v24/v25 不加入主表，也不据此改变正式 full
结论。artifacts 已清理，JSONL 保留。

#### v26 SSE timer cleanup

`sseIterable` 只保留外层 semantic idle timer；它调用
`rawSeeAsIterable` 时不再同时为每个底层 stream chunk 创建 transport idle
timer。直接调用 `rawSeeAsIterable` 的路径仍保留原有 transport idle 语义，
parent abort reason、reader cancellation 和 data event reset 行为不变。

deterministic `stream-idle` probe 中，连续 comment-only stream 每 15ms 发送
一次 ping，仍在约 77ms 触发 75ms semantic idle；真实 data event 在约 64ms
到达并刷新 timer，之后约 77ms 超时。两条路径均取消 reader，abort listener
和 timer resource 归零。v26 未运行 live full，不加入主表，也不改变 v22 的
正式 full 结论。

#### v26 full ChatLuna/OpenCode comparison

suite `aider-js-7e0611e-runtime-v26-sse-full-compare` 使用同一 49 题数据集、
prompt、tools、grader、单次 attempt、`maxTurns=100` 和 500s timeout，同时
记录 ChatLuna 与 OpenCode。初次四 shard 因 runner shell 上限中断后，只恢复
了没有结果的 case；已有 pass/fail 没有重跑。最终每个 agent 每题各有一条
结果，reporter 的 `latest` selection 无重复或缺项。

| agent | strict pass | verifier | fail | infra | reportedTotal | avg turns | avg tools | agent p50 | wall p50 |
| ----- | ----------: | -------: | ---: | ----: | -------------: | ---------: | ---------: | --------: | -------: |
| ChatLuna | 38/49 | 40/49 | 6 | 5 | 2,575,585 | 8.14 | 10.76 | 133,730 ms | 184,603 ms |
| OpenCode | 36/49 | 42/49 | 6 | 7 | 30,194,600 | 12.57 | 14.86 | 153,125 ms | 165,075 ms |

provider audit：ChatLuna 为 `410 LLM calls = 399 reported + 11 estimated`；
OpenCode 为 `616 = 614 reported + 2 estimated`。OpenCode 的 reported total
包含 `14,339,328` cache tokens，另有 provider input `15,438,886` 和 output
`416,386`；ChatLuna cache 为 0，input `1,965,942`、output `612,135`。
reportedTotal 仍只按 provider 自报值统计，不用 input/output 重新计算。

按 strict state 配对：两者都 pass 32 题，ChatLuna only 6 题
(`book-store`, `promises`, `meetup`, `sum-of-multiples`, `ocr-numbers`,
`simple-linked-list`)，OpenCode only 4 题
(`transpose`, `alphametics`, `food-chain`, `state-of-tic-tac-toe`)，两者都
未 pass 7 题。v26 是新的一次 single-attempt sample，不能与 v22 单次 full
结果做因果归因；它只作为当前完整对照记录。

#### v13 targeted forth

`v13` 使用 suite `aider-js-7e0611e-runtime-v13-compression-targeted`，runId
为 `15971595-6559-4965-9835-7a48167e0876`。该轮 state/verifier pass，wall
为 `216873 ms`，当时的 diagnostic upper estimate 为 `215181`，包含
`10 reported` 和 `0 estimated` calls。该数不是本账本重新计算的 provider
total。其 trace 的 `includesScratchpadCompression=false`，因此只验证了常规
路径，不能作为 compression branch 的 live 证明；compression branch 由
deterministic focused probe 覆盖。该 targeted 结果不加入完整对照表。

v2 ChatLuna 的 `2,468,625` 现明确撤回作为真实总量的结论，仅标记为
completed-response/provider lower bound，即已完成 response 中 provider
reported usage 所能提供的下界。相应的“比 OpenCode 少 85.2%”也一并撤回，
不得作为 ChatLuna 总量或 billing 优化结论。

OpenCode v2 保留 `37/49` verifier、`36/49` state pass 和 `16,693,370`
reported total（含 cache）。另有不含 cache 的 `input + output = 8,948,730`
参考值。此前将它与 ChatLuna v9 diagnostic upper estimate 比较得出的约
60.9% 差异现一并撤回：local/max-derived estimate 不参与 provider token
比较或结论。

v9 的四个 shard runId 为：

- shard 0: `2ee672db-c35a-486a-b78e-78f8e8cf6cb8`
- shard 1: `d21961e3-765f-47fa-a005-3020734af92a`
- shard 2: `c1616c54-423e-4c29-b2cf-eaaf029496d4`
- shard 3: `93613e2e-e0a3-4c6a-857b-cccebafb4d0a`

suiteId 为 `aider-js-7e0611e-runtime-v9-audited-full`，固定 49 题。token audit
汇总如下：

| audit 字段                        |        值 |
| --------------------------------- | --------: |
| historical mixed diagnostic       | 1,822,297 |
| diagnostic upper input estimate   | 3,186,991 |
| diagnostic upper output estimate  |   311,209 |
| diagnostic upper total estimate   | 3,498,200 |
| LLM events                        |       306 |
| reported calls                    |       270 |
| estimated calls                   |        36 |
| successful calls provider input   | 1,146,300 |
| same successful calls local input | 2,803,220 |

即 `306 LLM events = 270 reported + 36 estimated`。同一批 successful call
的 local input estimate 与 provider reported input 差异较大，只能说明本地
模糊 tokenizer 不适合替代 provider 计量；正式 token 仍以 provider reported
usage 为唯一权威。

当前 reporter 读取上述四个旧 JSONL 后得到以下正式 provider reported
subtotal。36 个 estimated calls 的消费仍为 unknown，不包含在这些统计中：

| basis           |     total |  average |    p50 |    p95 |
| --------------- | --------: | -------: | -----: | -----: |
| `reportedTotal` | 1,455,633 | 29,706.8 | 28,670 | 55,180 |

v1 的 suiteId 是 `aider-js-7e0611e-full-compare-v1`。该轮在 runner 验证期间
对 infra 行执行过 `--resume`，表中取每个 case/agent 最后追加的终态；因此
它适合记录当时结果，但不能作为严格的一次采样前后对照。v2 的 suiteId 是
`aider-js-7e0611e-full-compare-v2`，49 题双方均只有一次实际 attempt，没有
通过 resume 重试 infra，保留为历史 outcome 记录；其 token 总量口径已按上文
撤回。v9 是本轮新增的带历史 token diagnostics 的 ChatLuna 运行。

v2 中 ChatLuna 的 verifier 为 36/49，OpenCode 为 37/49，只差 1 题；state
pass 分别为 32/49 和 36/49。v2 的 outcome 差异仍可记录，但不再从
`2,468,625` 推导 token 百分比。ChatLuna 的 10 个 infra 中，`bowling`、`forth`、
`palindrome-products` 和 `word-search`
已经通过 grader，但 agent 未在 timeout 前结束。`ledger` 在双方 agent 启动前
都因 baseline test unexpectedly passed 记为共享 infra。

v2 使用的 ChatLuna shard runId 为：

- shard 0: `2b55d922-e019-4e71-8b4d-79e58578ff70`
- shard 1: `93b25261-090e-4a08-9ef4-e7576f074aed`
- shard 2: `33855c72-553a-4b0e-867e-f8ab9ee62f47`
- shard 3: `a9f4de01-3336-4857-9823-c1bb4205f6df`

### Production runtime 改动

- usage reporter 记录 failed、retry 和 partial response 的 LLM event；没有
  provider usage 或只有部分响应时，local input/output 只作为 approximate
  diagnostic，正式消费量保持 unknown。
- 增加 local tokenizer 旁路，在保留 provider usage 的同时记录每个 call 的
  `localInputTokens` / `localOutputTokens`，只用于观察本地模糊估算与 provider
  reported usage 的偏差，不替代 provider 字段。
- streaming 增加 60s idle timeout；首个 chunk 前的 idle failure 可 retry，已经
  产生 chunk 的 partial failure 不重复伪装成成功完成。
- `StreamMetricsTracker` 对 reasoning、output/total tokens、timing 和 tps
  metadata 做 snapshot，并在最终 chunk merge，避免流式 metadata 只出现在
  中间 chunk 时丢失。
- local shell 使用 session-scoped `TMPPREFIX`，并将 `TMP`、`TEMP`、`TMPDIR`
  和 zsh 临时文件路径限制在运行临时目录。
- delegated sub-agent 增加 `turnCount`，只统计带明确 `canContinue` 的
  round-decision；真实实现文件写入或编辑后，若 clean verification 给出明确
  成功且没有失败、异常、非零退出、timeout 或权限错误，则直接完成，避免为
  总结再发起一次可能挂起的 LLM 请求。
- scratchpad compression 不再将多 tool-call action batch 任意截断为 keep-last-3，
  避免留下孤立 `ToolMessage`；成功压缩后清空完整 scratchpad，空摘要或失败时
  保留原上下文。
- `yarn integration:scratchpad-compression` focused probe 验证 success 时
  `scratchpad=[]` 且写入 summary，empty/failure 时保留完整 `ai + 4 tool` x2
  sequence。
- 该完成判定不作用于 main agent；明显的 scratch、check、test、verify 和
  temp 文件本身不算实现变更。
- local backend 在权限错误输出中提示使用 session-scoped `$TMPDIR`，但没有
  放宽 macOS `sandbox-exec`、scope、deny root、symlink 或 network 边界。
- `yarn integration` 与 `yarn integration:scope` 均通过；scope probe 继续阻止
  grader、dataset、外部临时目录、symlink、cwd escape 和 network。

## 后续每轮必记字段

- 版本与数据：日期、分支、baseline revision、candidate revision 和 dirty
  状态、模型、provider、数据集 commit。
- 命令与运行：完整命令、runId、attempt、max-turns、timeout、平台、
  backend、sandbox、network policy、blockedAttempts。
- Context 聚合：variant、count、score/avgScore、pass@1、total tokens、
  p50 tokens、p50 wall、tokens/pass、tool valid、duplicate、infra failures。
- Aider 逐题：case、attempt、state、score、provider `tokens` / `reportedTotal`、
  `reportedProviderInputTotal` / `reportedProviderOutputTotal`、`reportedCalls`、
  `estimatedCalls`、明确标记为 estimate 的 local diagnostics、reasoning/cache
  （若 provider 有报告）、tools、turns、wall、grader、duplicate、invalid、error。
- 产物与结论：raw JSONL 路径、artifact 路径、report 路径、可比范围、
  样本限制和异常计数语义。

## Iteration

| Round   | 日期       | revision | Context          | Aider                                                                  | 备注                                                 |
| ------- | ---------- | -------- | ---------------- | ---------------------------------------------------------------------- | ---------------------------------------------------- |
| Round 0 | 2026-08-06 | dirty    | pass@1 0.4 → 1.0 | fixed pilot 5/5                                                        | Aider pilot baseline                                 |
| Round 1 | 2026-08-07 | dirty    | 未复跑           | v1 ChatLuna 31 / OpenCode 38                                           | infra 曾 resume，非严格单次采样                      |
| Round 2 | 2026-08-07 | dirty    | 未复跑           | v2 ChatLuna 32 / OpenCode 36                                           | outcome 保留；token lower bound/85.2% 说法撤回       |
| Round 3 | 2026-08-08 | dirty    | 未复跑           | v9 ChatLuna 34 / 49；verifier 35/49；diagnostic upper estimate 3498200 | runtime + token diagnostics；provider 波动不可归因   |
| v11     | 未提供     | 未提供   | 未复跑           | ChatLuna 40 / 49；verifier 41/49；diagnostic upper estimate 6934496    | 旧 240s 轮次；非 provider total                      |
| v12     | 未提供     | 未提供   | 未复跑           | ChatLuna 35 / OpenCode 41（verifier 36/41）                            | ChatLuna strict sample；500s；模型/provider 波动显著 |

不同轮次不是 provider-controlled 的配对采样，provider 的负载、路由和输出均可
波动，且 v1/v2 与 v9 的 usage completeness 和历史诊断口径不同。因此跨轮
观察到的 pass 或 wall 变化不能归因于某项 production runtime 改动；历史 local
或 max-derived token estimate 不参与跨轮比较，迭代表只记录观测结果，不表达
因果结论。
