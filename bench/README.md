# Agent Evaluation Bench

This directory contains the deterministic execution-context stage, the full
Aider Polyglot JavaScript suite, and a small TypeScript Terminal-Bench pilot.

> 持续更新的性能账本见 [`RESULTS.md`](./RESULTS.md)。raw JSONL 与运行
> artifacts 保留在 `.tmp/agent-eval`；tracked 的汇总记录只维护在
> `RESULTS.md`。评测结果和账本本身承担可观测性记录，不设独立的
> observability platform。

## Stage Boundary

`bench:doctor` checks local command availability, model discovery, data
directories, and free disk space. It always exits successfully when an
optional tool is missing, and its JSON output contains only availability
status. Authentication and key material are never printed.

`bench:context` compares the `v1-dev` source snapshot with the working tree.
It checks the canonical `AgentRunContext`, the reduced `SubagentContext`, the
task and `asTool` conversation paths, the task schema, and the absence of
memory-trimming markers. It writes fixed-schema JSONL records to
`.tmp/agent-eval/results.jsonl`. This stage accepts only `--agents none` and
does not call a model. `--iterations` repeats the deterministic comparison
until the selected score stops improving.

`bench:report` reads the JSONL records and writes `summary.json` and
`report.md` beside the results file. It also prints the summary as JSON.

`yarn integration:scratchpad-compression` runs a focused deterministic probe for
successful scratchpad compression and empty/failure context retention. It and
the `model-context-token-probe` cover the 1M/850k and 100k/35k provider-usage
threshold boundaries for scratchpad and infinite-context compression.

## Frozen Evaluation Contract

The Aider evaluation contract is fixed at Polyglot dataset commit
`7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f`; the model is
`flymyd/deepseek-v4-flash`; attempts are `1`; `maxTurns` is `100`; and the
agent timeout is `500s`. The Round 0 prompt, `ALLOWED_TOOLS` set
(`file_read`, `file_write`, `file_edit`, `grep`, `glob`, `bash`), and the
separate-workspace official `npm test -- --runInBand` grader are also fixed.
Only runner bugs, measurement, and isolation fixes may change the bench.
Performance optimization must be implemented in production packages, not by
changing benchmark prompts, tools, or task conditions. `RESULTS.md` is updated
separately as the shared record.

Context budgets use one provider-independent contract. `hardContext` is
`model.getModelMaxContextSize()`, while the adapter sets `usableLimit` as
`invocation.maxTokenLimit = floor(hardContext * maxContextRatio)`. Cropping and
the send cap use `usableLimit`. Infinite-context compression uses
`floor(min(usableLimit, hardContext * infiniteContextThreshold))`; scratchpad
compression starts when provider-reported `usage_metadata.input_tokens` is at
least `usableLimit`, without applying another ratio. Local tokenizer values are
fuzzy pre-call estimates only and never trigger scratchpad compression.

The current benchmark model metadata declares a `1,000,000` token hard context
and explicitly configures `maxContextRatio: 0.85`, producing an `850,000` token
usable limit. The DeepSeek adapter carries the same 1M model metadata and a
default ratio of `0.85`; these are metadata/configuration, not a separate
execution path. Historical results retain their original `contextSize: 128000`
and adapter-default `maxContextRatio: 0.35` configuration.

The configured Terminal path and context pilot prompts remain data only. The
Aider suite uses the fixed Polyglot JavaScript snapshot referenced by commit
`7e0611e...` and runs the ChatLuna candidate through a real Koishi Context,
ConversationService, MockBot, and ChatLuna Agent.

The pilot reads provider credentials from the OpenCode JSONC model config with
`jsonc-parser`. `CHATLUNA_EVAL_API_KEY`, `CHATLUNA_EVAL_BASE_URL`,
`CHATLUNA_EVAL_MODEL`, and `CHATLUNA_EVAL_PLATFORM` take precedence. The
selected provider's non-secret `name` and `npm` fields are retained so the
comparison uses the same provider implementation. The key is passed only in
memory to ChatLuna, or through a temporary environment variable available only
to the external comparison child. Its OpenCode config contains an `{env:...}`
reference rather than the key. Keys are redacted from raw stdout/stderr,
artifacts, results, and logs; URLs may appear in diagnostics.

The local backend does not explicitly bypass permissions:
`dangerouslySkipPermissions` is `false`. It still enters the sandbox: Linux
uses bubblewrap and macOS uses the native `sandbox-exec` network profile when
bubblewrap is unavailable. The network policy diagnostic records which
production sandbox was selected. A Docker Terminal environment remains the
strongest isolation boundary for network enforcement.

The agent workspace contains no tests, specs, `.meta`, or reference example.
Baseline and final grading use the exercise's official `npm test --
--runInBand` command in a separate grader workspace, with a 180 second limit.
Raw run artifacts are kept under `.tmp/agent-eval/runs/<runId>/<case>` and
fixed-schema JSONL results are appended to `.tmp/agent-eval/results.jsonl`.
The tracked ledger is [`RESULTS.md`](./RESULTS.md).

Each Aider JSONL row records `agentMs` and `wallMs` as separate metrics.
`agentMs` measures only the candidate runner invocation: the ChatLuna
foreground `runTask` call through its deadline/settle result, or the OpenCode
or Claude CLI child invocation. `wallMs` measures the complete attempt and
therefore also includes workspace preparation, install and baseline checks,
diff and artifact work, grader restoration, and grading. The fixed 500 second
agent timeout is the default and is independent from the grader's 180 second
timeout; an explicit `--timeout` still overrides only the agent deadline. Agent
state is determined only by the runner deadline/`timedOut` outcome; `wallMs`
does not turn a completed agent run into a timeout.

`agent: chatluna` and `benchmark: aider-js` identify candidate rows. An
optional local `opencode` or `claude` comparison uses fresh isolated
workspaces and fresh CLI sessions; those rows use the respective agent name.
The OpenCode comparison writes a minimal isolated config containing only the
selected provider/model, disabled sharing and autoupdate, and permissions for
the current workspace while denying external directories. Its raw JSON event
stream is saved separately from a redacted audit trace that records event
count, usage, unique tool calls, and turns. These results are not equivalent
to the official Aider leaderboard.

`yarn bench:aider:suite` is model-free. It verifies the dataset commit and a
clean JavaScript practice tree, scans every practice directory, and prints the
eligible list, fixed denominator, exclusion count, and each exclusion reason.
At the frozen commit the inventory is 49 eligible tasks and 0 exclusions.

Use `--all` for the complete suite or `--cases` for an explicit subset; the two
options are mutually exclusive. Cases are sorted before 0-based modulo
sharding. `--resume` skips only existing `pass` or `fail` rows with the same
suite, case, attempt, and agent. Infrastructure failures are retried. Each
shard should write a separate JSONL file because live runs are serial within a
process and parallelism is provided by independent processes.

```sh
yarn integration:build
yarn tsx --tsconfig bench/tsconfig.json bench/aider-eval.ts --all --suite-id aider-js-7e0611e-full-v1 --shard-index 0 --shard-count 4 --resume --timeout 500 --results .tmp/agent-eval/aider-shard-0.jsonl &
yarn tsx --tsconfig bench/tsconfig.json bench/aider-eval.ts --all --suite-id aider-js-7e0611e-full-v1 --shard-index 1 --shard-count 4 --resume --timeout 500 --results .tmp/agent-eval/aider-shard-1.jsonl &
yarn tsx --tsconfig bench/tsconfig.json bench/aider-eval.ts --all --suite-id aider-js-7e0611e-full-v1 --shard-index 2 --shard-count 4 --resume --timeout 500 --results .tmp/agent-eval/aider-shard-2.jsonl &
yarn tsx --tsconfig bench/tsconfig.json bench/aider-eval.ts --all --suite-id aider-js-7e0611e-full-v1 --shard-index 3 --shard-count 4 --resume --timeout 500 --results .tmp/agent-eval/aider-shard-3.jsonl &
wait
```

Aggregate all shard files by `suiteId`, not `runId`:

```sh
yarn bench:aider:report --suite-id aider-js-7e0611e-full-v1 \
  --results .tmp/agent-eval/aider-shard-0.jsonl \
  --results .tmp/agent-eval/aider-shard-1.jsonl \
  --results .tmp/agent-eval/aider-shard-2.jsonl \
  --results .tmp/agent-eval/aider-shard-3.jsonl
```

The report includes eligible, attempted, pass, fail, infrastructure failure,
fixed-denominator verifier and state-pass percentages, provider-reported token
totals and average/p50/p95, tool/turn/wall average/p50/p95, and incomplete
task-attempts. `agentLatency` reports average/p50/p95 with `basis: agentMs`;
the existing `wallMs` aggregate remains the complete-attempt latency and uses
`basis: wallMs`.

## Token Audit Contract

Provider-reported usage is the only authoritative Aider token source. For each
`callType: llm` event, `estimated=false` means provider usage was reported and
`estimated=true` means it was not. The result contract is:

- `tokens.input`, `tokens.output`, `tokens.reasoning`, and `tokens.cache` sum
  only the corresponding provider-reported values.
- `tokens.total` and `reportedTotal` sum only the provider's `total_tokens`.
  The runner never replaces provider total with input plus output, so
  `reportedInputOutputDelta` may be non-zero.
- `reportedProviderInputTotal` and `reportedProviderOutputTotal` preserve the
  provider's reported input and output values. `reportedCalls` counts calls
  with provider usage.
- `localInputEstimate`, `localOutputEstimate`, `localTotalEstimate`, and
  `missingProviderTotalEstimate` are approximate tokenizer diagnostics only.
  They never contribute to `tokens`, `reportedTotal`, suite statistics,
  comparisons, or conclusions.
- `estimatedCalls` counts calls without provider usage. Their token consumption
  is unknown; local estimates do not fill the missing provider value.

The Aider report's token statistics have `basis: reportedTotal`. When the
reporter reads historical JSONL rows, it also uses only `reportedTotal` and the
`reportedProvider*` fields; historical `tokens`, `rawMixedTotal`, `audited*`,
local, or max-derived fields are never fallback sources. A suite containing
estimated calls therefore reports the known provider subtotal, not an estimate
of actual consumption or billing.

The model-free deterministic probe verifies this contract, including a legacy
row whose mixed `tokens.total` differs from `reportedTotal`:

```sh
yarn tsx --tsconfig bench/tsconfig.json bench/aider-eval.ts probe-timeout
```

## Terminal-Bench

`bench:terminal` resolves the exact task subset from `registry.json`. For
`terminal-bench-core==0.1.1`, it uses commit
`91e10457b5410f16c44364da1a34cb6de8c488a5` and materializes the pinned task
source. Use `--dataset-path` to select the clone containing `registry.json`.
`--all`, `--resume`, `--dry-run`, and `--same-shell-smoke` are valueless flags;
value options accept either `--key=value` or `--key value`.

```sh
yarn tsx --tsconfig bench/tsconfig.json bench/terminal-bench-eval.ts \
  --all --dataset-name terminal-bench-core --dataset-version 0.1.1 \
  --dataset-path /path/to/terminal-bench --suite-id terminal-core-v1 \
  --shard-index 0 --shard-count 2 --dry-run

yarn tsx --tsconfig bench/tsconfig.json bench/terminal-bench-eval.ts \
  --cases hello-world --attempts=1 --timeout 900
```

The core inventory is 80 eligible tasks with no exclusions. The runner supports
the official Terminal-Bench 0.2.18 parser set. During the agent phase the
container receives no task tests or solution files, and the real ChatLuna
subagent receives only the task instruction plus one `tb_bash` tool.
That tool invokes `docker exec` with Node spawn arguments and never a host
shell. After the agent finishes, the official `run-tests.sh` and `tests/` are
copied to `/tests`, and the verifier runs exactly `bash /tests/run-tests.sh`.
Before the agent starts, every compose network is disconnected from the task
container and the container is checked for leaked `/tests` or common solution
files. After the agent stops, the original networks are connected again before
DNS setup and verification. Metadata records the network names and the
`disconnected` / `compose network restored` states. Compose `down` is executed
in a `finally` block. API keys are held in memory, passed to the adapter only,
removed from child-process environments, and never written to results or
artifacts.

Verifier preparation writes `http1.1` plus curl retries for transient transfer
errors to the task container root user's `$HOME/.curlrc` after the agent phase.
This avoids intermittent HTTP/2 stream failures while the official script
downloads uv and lets curl retry an incomplete release transfer. The setting
exists only in the disposable task container: it does not read or change the
host curl configuration and contains no credentials. The runner does not
prefetch or cache uv, leaves the official `run-tests.sh` unchanged, and still
executes it as `bash /tests/run-tests.sh`.

When the host needs an outbound proxy, set `CHATLUNA_EVAL_PROXY` (or pass
`--proxy`) to a URL. With Colima, a proxy listening on the host at
`127.0.0.1:7890` is reachable from containers through the Colima host address
`http://192.168.5.2:7890`; `127.0.0.1` inside the verifier is the container
itself. The runner injects `HTTP_PROXY`, `HTTPS_PROXY`, and `ALL_PROXY` only
into the official verifier process; the agent process never receives them.

`tokens` count every provider `callType: llm` event in the case window,
including scratchpad compression. `turns` count only main-agent LLM calls;
the artifact `usage-audit.json` records provider, main-agent, and compression
call counts. The statistics can be checked without a model using an existing
artifact fixture:

```sh
yarn tsx --tsconfig bench/tsconfig.json bench/terminal-bench-eval.ts \
  --usage-fixture .tmp/agent-eval/runs/<run-id>/<case>/attempt-1/artifacts/tool-trace.json \
  --expect-turns 2 --expect-total 886
```

Model values can come from `--model`, `--provider`, `--base-url`, and `--key`,
or from `CHATLUNA_EVAL_MODEL`, `CHATLUNA_EVAL_PROVIDER`/
`CHATLUNA_EVAL_PLATFORM`, `CHATLUNA_EVAL_BASE_URL`, and
`CHATLUNA_EVAL_API_KEY`. Results append to `.tmp/agent-eval/results.jsonl` by
default; per-attempt artifacts are stored beside the run.

## Commands

```sh
yarn bench:doctor
yarn bench:context --iterations 3 --agents none --variant both
yarn bench:report
yarn bench:aider:suite
yarn bench:aider --cases grade-school --attempts 1 --compare none
yarn bench:aider:report --suite-id aider-js-7e0611e-full-v1 --results results.jsonl
```

`--timeout` is specified in seconds. The default command is one live
attempt for the configured five pilot cases. Use `--max-turns` to bound the registered coding
sub-agent, `--claude-model` to select an independent Claude model, and
`--compare opencode,claude` to run optional local comparisons. OpenCode keeps
the configured `flymyd/deepseek-v4-flash` model; Claude does not receive that
model argument and uses its local default unless `--claude-model` is supplied.

Supported variants are `baseline`, `candidate`, and `both`. `v1-dev` and
`working-tree` are accepted aliases. Use `--results path` to select another
JSONL file; report artifacts are written in that file's directory.
