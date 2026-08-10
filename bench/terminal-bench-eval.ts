import { spawn, spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync as readTextFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
    access,
    appendFile,
    mkdir,
    readdir,
    readFile,
    rename,
    rm,
    writeFile
} from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { StructuredTool } from '@langchain/core/tools'
import { parse, type ParseError } from 'jsonc-parser'
import { load } from 'js-yaml'
import type { Session } from 'koishi'
import { z } from 'zod'
import type {
    AgentRunContext,
    AgentTaskRun,
    AgentTaskSession
} from 'koishi-plugin-chatluna/llm-core/agent'
import type { ModelUsagePayload } from 'koishi-plugin-chatluna/llm-core/platform/usage'
import type { ChatLunaToolRunnable } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type {} from 'koishi-plugin-chatluna-agent'

const require = createRequire(import.meta.url)
const { Context: KoishiContext } = require('koishi') as typeof import('koishi')
const MockBot = require('@koishijs/plugin-mock')
    .default as typeof import('@koishijs/plugin-mock').default
const MessageClient = require('@koishijs/plugin-mock')
    .MessageClient as typeof import('@koishijs/plugin-mock').MessageClient
const memory = require('@koishijs/plugin-database-memory').default
const Console = require('@koishijs/plugin-console').default
const server = require('@koishijs/plugin-server').default
const chatluna = require('koishi-plugin-chatluna')
const agent = require('koishi-plugin-chatluna-agent')
const adapter = require('koishi-plugin-chatluna-openai-like-adapter')

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(ROOT, 'bench', 'agent-eval.json')
const DEFAULT_RESULTS = join(ROOT, '.tmp', 'agent-eval', 'results.jsonl')
const DEFAULT_CASES = [
    'hello-world',
    'fix-permissions',
    'grid-pattern-transform'
]
const TOOL_NAME = 'tb_bash'
const PARSER_NAMES = [
    'pytest',
    'swebench',
    'swelancer',
    'mlebench',
    'sweperf'
] as const

type ResultState = 'pass' | 'fail' | 'infra-failure'
type TestStatus = 'passed' | 'failed'
type ParserName = (typeof PARSER_NAMES)[number]

interface Result {
    runId: string
    suiteId: string
    suiteAttempts: number
    datasetName: string
    datasetVersion: string
    datasetCommit: string
    taskSourceHash: string
    variant: 'candidate'
    benchmark: 'terminal-bench'
    caseId: string
    taskId: string
    attempt: number
    agent: string
    model: string
    sessionId: string
    conversationId: string
    state: ResultState
    score: number
    toolCalls: number
    turns: number
    duplicateCalls: number
    invalidCalls: number
    tokens: TokenTotals
    wallMs: number
    graderMs: number
    gitRevision: string
    finishedAt: string
    error: string
}

interface BenchConfig {
    model: string
    modelConfigPath: string
    modelProvider: string
    modelName: string
    dataPaths: {
        terminal: string
    }
}

interface CliOptions {
    command: 'run' | 'aggregate'
    cases?: string[]
    all: boolean
    dryRun: boolean
    attempts: number
    timeoutMs?: number
    results: string[]
    usageFixture?: string
    expectTurns?: number
    expectTotal?: number
    datasetPath?: string
    model?: string
    provider?: string
    baseUrl?: string
    apiKey?: string
    proxy?: string
    sameShellSmoke: boolean
    datasetName: string
    datasetVersion: string
    suiteId: string
    suiteIdExplicit: boolean
    shardIndex: number
    shardCount: number
    resume: boolean
    aggregateOutput?: string
}

interface ModelConfig {
    provider: string
    model: string
    fullName: string
    baseUrl: string
    apiKey: string
}

interface CommandResult {
    code: number | null
    signal: string | null
    stdout: string
    stderr: string
    timedOut: boolean
    aborted: boolean
    error?: string
}

interface CommandOptions {
    cwd?: string
    env?: NodeJS.ProcessEnv
    timeoutMs?: number
    signal?: AbortSignal
    secret?: string
}

interface TokenTotals {
    input: number
    output: number
    reasoning: number
    cache: number
    total: number
}

interface TimingTotals {
    ttftMs: number
    totalMs: number
}

interface UsageAudit {
    scope: 'case'
    callType: 'llm'
    includesCompression: boolean
    providerCalls: number
    mainAgentCalls: number
    compressionCalls: number
}

interface TraceStats {
    toolCalls: number
    turns: number
    duplicateCalls: number
    invalidCalls: number
    trace: unknown[]
}

interface CandidateEvidence {
    output: string
    sessionId: string
    conversationId: string
    subagentConversationId: string
    taskRunId: string
    runState: string
    runs: unknown[]
    tasks: unknown[]
    usage: TokenTotals
    timing: TimingTotals
    usageAudit: UsageAudit
    usageEvents: unknown[]
    trace: TraceStats
    error: string
    infraFailure: boolean
}

interface TaskData {
    id: string
    dir: string
    instruction: string
    parserName: ParserName
    maxAgentTimeoutMs: number
    maxTestTimeoutMs: number
    runTestsInSameShell: boolean
    compose: string
    runTests: string
    sourceFiles: string[]
    sourceHash: string
    testFiles: string[]
    testDirExists: boolean
    requiresAmd64: boolean
}

interface ParserResult {
    results: Record<string, TestStatus>
    passed: boolean
}

interface RegistryEntry {
    name: string
    version: string
    terminal_bench_version: string
    dataset_path: string
    commit_hash: string
    task_id_subset: string[]
}

interface ExcludedTask {
    taskId: string
    category: 'runner' | 'infra'
    reason: string
}

interface Inventory {
    datasetName: string
    datasetVersion: string
    datasetCommit: string
    registryPath: string
    officialTotal: number
    checkoutDirectoriesPresent: number
    sourceDirectoriesPresent: number
    parserDistribution: Record<string, number>
    runTestsInSameShellDistribution: Record<string, number>
    eligible: TaskData[]
    excluded: ExcludedTask[]
    amd64Tasks: string[]
}

interface ComposeInfo {
    command: string[]
    version: string
}

interface LifecycleStages {
    build: string
    up: string
    agent: string
    network: string
    copyVerifier: string
    verifier: string
    down: string
}

interface IsolationCheck {
    checked: boolean
    present: boolean | null
    exitCode: number | null
}

class PersistentDockerShell {
    private readonly child: ReturnType<typeof spawn>
    private stdout = ''
    private stderr = ''
    private pid = 0
    private lastChildren: number[] = []
    private lastProcessSnapshot = ''
    private lastInterrupt = ''
    private closeReason = ''
    private closed = false
    private readonly ready: Promise<void>

    constructor(
        private readonly container: string,
        private readonly cwd: string,
        private readonly secret: string,
        private readonly dockerHost: string
    ) {
        this.child = spawn(
            'docker',
            [
                'exec',
                '-i',
                '-w',
                cwd,
                container,
                'bash',
                '--noprofile',
                '--norc'
            ],
            {
                cwd: ROOT,
                env: childEnv(secret, {
                    ...process.env,
                    DOCKER_HOST: dockerHost
                }),
                stdio: ['pipe', 'pipe', 'pipe']
            }
        )
        this.child.stdout?.on('data', (chunk: Buffer) => {
            this.stdout += chunk.toString('utf8')
        })
        this.child.stderr?.on('data', (chunk: Buffer) => {
            this.stderr += chunk.toString('utf8')
        })
        this.child.on('error', (err) => {
            this.closeReason = err.message
            this.closed = true
        })
        this.child.on('close', (code, signal) => {
            this.closeReason = `code=${code};signal=${signal}`
            this.closed = true
        })
        this.ready = this.initialize()
    }

    private async initialize() {
        await this.write(
            'exec 3>&1 4>&2; printf \'__TB_READY__:%s\\n\' "$$" >&3; printf \'__TB_READY__:%s\\n\' "$$" >&4\n'
        )
        const started = Date.now()
        while (!this.closed && !this.stdout.includes('__TB_READY__:')) {
            if (Date.now() - started > 30000) {
                throw new Error('persistent docker shell readiness timeout')
            }
            await new Promise((resolve) => setTimeout(resolve, 20))
        }
        const match = /__TB_READY__:(\d+)/.exec(this.stdout)
        if (!match) throw new Error('persistent docker shell did not start')
        this.pid = Number(match[1])
        const stdoutEnd = this.stdout.indexOf('\n', match.index) + 1
        this.stdout = this.stdout.slice(stdoutEnd)
        const stderrEnd = this.stderr.indexOf('__TB_READY__:')
        if (stderrEnd >= 0) {
            const lineEnd = this.stderr.indexOf('\n', stderrEnd) + 1
            this.stderr = this.stderr.slice(lineEnd)
        }
    }

    private async write(value: string) {
        if (this.closed || !this.child.stdin) {
            throw new Error(
                `persistent docker shell is closed (${this.closeReason})`
            )
        }
        if (!this.child.stdin.write(value)) {
            await new Promise<void>((resolve, reject) => {
                this.child.stdin?.once('drain', resolve)
                this.child.stdin?.once('error', reject)
            })
        }
    }

    private async childPids() {
        if (!this.pid || this.closed) return []
        const pgrep = await runProcess(
            'docker',
            ['exec', this.container, 'pgrep', '-P', String(this.pid)],
            {
                cwd: ROOT,
                env: { ...process.env, DOCKER_HOST: this.dockerHost },
                timeoutMs: 10000,
                secret: this.secret
            }
        )
        if (pgrep.code === 0) {
            this.lastChildren = pgrep.stdout
                .split(/\r?\n/)
                .map((value) => Number(value.trim()))
                .filter((value) => Number.isInteger(value) && value > 0)
            if (this.lastChildren.length > 0) return this.lastChildren
        }
        const proc = await runProcess(
            'docker',
            [
                'exec',
                this.container,
                'sh',
                '-c',
                'for path in /proc/[0-9]*/stat; do ' +
                    'read pid comm state ppid rest < "$path"; ' +
                    'if [ "$ppid" = "$1" ]; then ' +
                    'printf "%s %s %s %s\\n" "$pid" "$ppid" "$comm" "$state"; ' +
                    'fi; done',
                '--',
                String(this.pid)
            ],
            {
                cwd: ROOT,
                env: { ...process.env, DOCKER_HOST: this.dockerHost },
                timeoutMs: 10000,
                secret: this.secret
            }
        )
        this.lastProcessSnapshot = proc.stdout
        this.lastChildren = proc.stdout
            .split(/\r?\n/)
            .map((value) => Number(value.trim().split(/\s+/, 1)[0]))
            .filter((value) => Number.isInteger(value) && value > 0)
        return this.lastChildren
    }

    private async interrupt(
        signal: 'INT' | 'TERM' | 'KILL' = 'INT',
        keep: number[] = []
    ) {
        const pids = (await this.childPids()).filter(
            (pid) => !keep.includes(pid)
        )
        for (const pid of pids) {
            const result = await runProcess(
                'docker',
                [
                    'exec',
                    this.container,
                    'sh',
                    '-c',
                    'kill "-$1" "$2"',
                    '--',
                    signal,
                    String(pid)
                ],
                {
                    cwd: ROOT,
                    env: { ...process.env, DOCKER_HOST: this.dockerHost },
                    timeoutMs: 10000,
                    secret: this.secret
                }
            )
            this.lastInterrupt += `${signal}:${pid}:${result.code}:${result.stderr}`
        }
        return pids.length > 0
    }

    async run(
        command: string,
        workdir: string,
        timeoutMs?: number,
        signal?: AbortSignal,
        env: Record<string, string> = {}
    ): Promise<CommandResult> {
        try {
            await this.ready
        } catch (err) {
            return {
                code: null,
                signal: null,
                stdout: '',
                stderr: '',
                timedOut: false,
                aborted: false,
                error: err instanceof Error ? err.message : String(err)
            }
        }
        if (this.closed) {
            return {
                code: null,
                signal: null,
                stdout: '',
                stderr: '',
                timedOut: false,
                aborted: false,
                error: `persistent docker shell is closed (${this.closeReason})`
            }
        }

        const id = randomUUID()
        const baseline = await this.childPids()
        const begin = `__TB_BEGIN_${id}__`
        const end = `__TB_END_${id}:`
        const encodedCommand = Buffer.from(command, 'utf8').toString('base64')
        const encodedWorkdir = Buffer.from(workdir, 'utf8').toString('base64')
        const assignments = Object.entries(env)
            .map(
                ([key, value]) =>
                    `${key}="$(printf '%s' '${Buffer.from(value, 'utf8').toString('base64')}' | base64 -d)"`
            )
            .join(' ')
        const wrapper =
            `set +e; __tb_b64='${encodedCommand}'; ` +
            `__tb_cmd="$(printf '%s' "$__tb_b64" | base64 -d)"; ` +
            `printf '%s\\n' '${begin}' >&3; ` +
            `printf '%s\\n' '${begin}' >&4; ` +
            `eval "${
                workdir.length > 0
                    ? `cd -- \"$(printf '%s' '${encodedWorkdir}' | base64 -d)\"; `
                    : ''
            }${assignments}${assignments.length > 0 ? ' ' : ''}$__tb_cmd"; ` +
            `__tb_status=$?; ` +
            `printf '%s%s\\n' '${end}' "$__tb_status" >&3; ` +
            `printf '%s%s\\n' '${end}' "$__tb_status" >&4; ` +
            'unset __tb_b64 __tb_cmd __tb_status\n'
        await this.write(wrapper)

        let aborted = signal?.aborted ?? false
        let timedOut = false
        let interrupted = false
        const interrupt = () => {
            if (interrupted) return
            interrupted = true
            this.interrupt('KILL', baseline).catch(() => undefined)
        }
        const onAbort = () => {
            aborted = true
            interrupt()
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        const started = Date.now()
        let endIndex = -1
        try {
            while (!this.closed) {
                endIndex = this.stdout.indexOf(end)
                if (endIndex >= 0 && this.stdout.indexOf('\n', endIndex) >= 0) {
                    break
                }
                if (
                    aborted ||
                    (timeoutMs && Date.now() - started >= timeoutMs)
                ) {
                    timedOut = !aborted
                    const interruptedChild = await this.interrupt(
                        'KILL',
                        baseline
                    )
                    const grace = Date.now()
                    while (
                        !this.closed &&
                        (this.stdout.indexOf(end) < 0 ||
                            this.stdout.indexOf(
                                '\n',
                                this.stdout.indexOf(end)
                            ) < 0) &&
                        Date.now() - grace < 2000
                    ) {
                        if (Date.now() - grace >= 1000 && interruptedChild) {
                            await this.interrupt('KILL', baseline)
                        }
                        await new Promise((resolve) => setTimeout(resolve, 20))
                    }
                    endIndex = this.stdout.indexOf(end)
                    break
                }
                await new Promise((resolve) => setTimeout(resolve, 20))
            }
            if (endIndex < 0) {
                await this.close()
                return {
                    code: null,
                    signal: 'SIGTERM',
                    stdout: this.stdout,
                    stderr: this.stderr,
                    timedOut,
                    aborted,
                    error:
                        `persistent docker shell command did not emit an end marker; ` +
                        `pid=${this.pid}; children=${this.lastChildren.join(',')}; ` +
                        `processes=${this.lastProcessSnapshot.replace(/\s+/g, ' ').trim()}; ` +
                        `signals=${this.lastInterrupt.replace(/\s+/g, ' ').trim()}`
                }
            }
            const stderrWait = Date.now()
            while (
                !this.closed &&
                this.stderr.indexOf(end) < 0 &&
                Date.now() - stderrWait < 5000
            ) {
                await new Promise((resolve) => setTimeout(resolve, 20))
            }
            const lineEnd = this.stdout.indexOf('\n', endIndex)
            const code = Number(
                this.stdout.slice(endIndex + end.length, lineEnd)
            )
            const beginIndex = this.stdout.indexOf(begin)
            const stderrBegin = this.stderr.indexOf(begin)
            const stderrEnd = this.stderr.indexOf(end)
            const stdout = this.stdout.slice(
                beginIndex + begin.length + 1,
                endIndex
            )
            const stderr =
                stderrBegin >= 0 && stderrEnd >= 0
                    ? this.stderr.slice(
                          stderrBegin + begin.length + 1,
                          stderrEnd
                      )
                    : this.stderr
            this.stdout = this.stdout.slice(lineEnd + 1)
            if (stderrEnd >= 0) {
                this.stderr = this.stderr.slice(
                    this.stderr.indexOf('\n', stderrEnd) + 1
                )
            }
            return {
                code,
                signal: null,
                stdout,
                stderr,
                timedOut,
                aborted
            }
        } finally {
            signal?.removeEventListener('abort', onAbort)
        }
    }

    async close() {
        if (this.closed) return
        await this.interrupt('TERM')
        this.child.stdin?.end()
        this.child.kill('SIGTERM')
        this.closed = true
    }
}

function readConfig() {
    return JSON.parse(readTextFileSync(CONFIG_PATH, 'utf8')) as BenchConfig
}

function parseArgs(args: string[]): CliOptions {
    if (args[0] === '--help' || args[0] === 'help') {
        console.log(
            'Usage: yarn bench:terminal [aggregate|inventory] ' +
                '[--all | --cases id,... | --task-id id] [--attempts N] ' +
                '[--dataset-name name] [--dataset-version version] ' +
                '[--dataset-path clone] [--suite-id id] ' +
                '[--shard-index N --shard-count N] [--resume] [--dry-run] ' +
                '[--same-shell-smoke] ' +
                '[--results path ...] [--aggregate-output path] ' +
                '[--timeout seconds] [--model model] [--provider provider] ' +
                '[--base-url url] [--key key] [--proxy url]'
        )
        process.exit(0)
    }

    const command: CliOptions['command'] =
        args[0] === 'aggregate' || args[0] === 'report' ? 'aggregate' : 'run'
    const inventory = args[0] === 'inventory'
    const start =
        args[0] === 'aggregate' ||
        args[0] === 'report' ||
        args[0] === 'inventory'
            ? 1
            : 0
    let cases: string[] | undefined
    let all = false
    let dryRun = inventory
    let attempts = 1
    let timeoutMs: number | undefined
    const results: string[] = []
    let usageFixture: string | undefined
    let expectTurns: number | undefined
    let expectTotal: number | undefined
    let datasetPath: string | undefined
    let model: string | undefined
    let provider: string | undefined
    let baseUrl: string | undefined
    let apiKey: string | undefined
    let proxy: string | undefined
    let sameShellSmoke = false
    let datasetName = 'terminal-bench-core'
    let datasetVersion = '0.1.1'
    let suiteId = ''
    let suiteIdExplicit = false
    let shardIndex = 0
    let shardCount = 1
    let resume = false
    let aggregateOutput: string | undefined

    const noValueFlags = new Set([
        '--all',
        '--resume',
        '--dry-run',
        '--same-shell-smoke',
        '--help'
    ])
    for (let idx = start; idx < args.length; idx += 1) {
        const arg = args[idx]
        const equal = arg.indexOf('=')
        const key = equal < 0 ? arg : arg.slice(0, equal)
        if (key === '--help') {
            console.log(
                'Usage: yarn bench:terminal [aggregate|inventory] ' +
                    '[--all | --cases id,... | --task-id id] [--attempts N] ' +
                    '[--dataset-name name] [--dataset-version version] ' +
                    '[--dataset-path clone] [--suite-id id] ' +
                    '[--shard-index N --shard-count N] [--resume] [--dry-run] ' +
                    '[--same-shell-smoke] [--results path ...] ' +
                    '[--aggregate-output path] [--timeout seconds] ' +
                    '[--model model] [--provider provider] [--base-url url] ' +
                    '[--key key] [--proxy url]'
            )
            process.exit(0)
        }
        if (noValueFlags.has(key)) {
            if (equal >= 0) throw new Error(`${key} does not accept a value`)
            if (key === '--all') all = true
            if (key === '--resume') resume = true
            if (key === '--dry-run') dryRun = true
            if (key === '--same-shell-smoke') sameShellSmoke = true
            continue
        }
        let value = equal < 0 ? undefined : arg.slice(equal + 1)
        if (value === undefined) {
            const next = args[idx + 1]
            if (!next || next.startsWith('--')) {
                throw new Error(`Missing value for ${key}`)
            }
            value = next
            idx += 1
        }
        if (!value) {
            throw new Error(`Missing value for ${key}`)
        }

        if (key === '--cases' || key === '--task-id') {
            cases = value
                .split(',')
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
            if (cases.length < 1) {
                throw new Error(`${key} cannot be empty`)
            }
            continue
        }
        if (key === '--attempts') {
            const parsed = Number(value)
            if (!Number.isInteger(parsed) || parsed < 1) {
                throw new Error('--attempts must be a positive integer')
            }
            attempts = parsed
            continue
        }
        if (key === '--timeout') {
            const parsed = Number(value)
            if (!Number.isFinite(parsed) || parsed <= 0) {
                throw new Error(
                    '--timeout must be a positive number of seconds'
                )
            }
            timeoutMs = Math.round(parsed * 1000)
            continue
        }
        if (key === '--dataset-path') {
            datasetPath = expandPath(value)
            continue
        }
        if (key === '--results') {
            results.push(
                ...value
                    .split(',')
                    .map((path) => path.trim())
                    .filter((path) => path.length > 0)
                    .map((path) => resolve(ROOT, path))
            )
            continue
        }
        if (key === '--aggregate-output') {
            aggregateOutput = resolve(ROOT, value)
            continue
        }
        if (key === '--usage-fixture') {
            usageFixture = expandPath(value)
            continue
        }
        if (key === '--expect-turns' || key === '--expect-total') {
            const parsed = Number(value)
            if (!Number.isInteger(parsed) || parsed < 0) {
                throw new Error(`${key} must be a non-negative integer`)
            }
            if (key === '--expect-turns') expectTurns = parsed
            else expectTotal = parsed
            continue
        }
        if (key === '--model') {
            model = value
            continue
        }
        if (key === '--provider' || key === '--platform') {
            provider = value
            continue
        }
        if (key === '--base-url' || key === '--baseUrl') {
            baseUrl = value
            continue
        }
        if (key === '--key' || key === '--api-key') {
            apiKey = value
            continue
        }
        if (key === '--proxy') {
            proxy = value
            continue
        }
        if (key === '--dataset-name') {
            datasetName = value
            continue
        }
        if (key === '--dataset-version') {
            datasetVersion = value
            continue
        }
        if (key === '--suite-id') {
            suiteId = value
            suiteIdExplicit = true
            continue
        }
        if (key === '--shard-index' || key === '--shard-count') {
            const parsed = Number(value)
            if (
                !Number.isInteger(parsed) ||
                parsed < (key === '--shard-index' ? 0 : 1)
            ) {
                throw new Error(
                    `${key} must be ${key === '--shard-index' ? 'a non-negative' : 'a positive'} integer`
                )
            }
            if (key === '--shard-index') shardIndex = parsed
            else shardCount = parsed
            continue
        }
        throw new Error(`Unknown option: ${key}`)
    }

    if (all && cases)
        throw new Error('--all and --cases are mutually exclusive')
    if (shardIndex >= shardCount) {
        throw new Error('--shard-index must be less than --shard-count')
    }
    if (shardCount > 1 && !suiteIdExplicit) {
        throw new Error(
            '--suite-id is required when --shard-count is greater than 1'
        )
    }
    if (!suiteIdExplicit) suiteId = `${datasetName}-${datasetVersion}`
    if (!suiteId.trim()) throw new Error('--suite-id cannot be empty')
    if (command === 'run' && results.length > 1) {
        throw new Error('A run accepts only one --results path')
    }

    return {
        command,
        cases,
        all,
        dryRun,
        attempts,
        timeoutMs,
        results,
        usageFixture,
        expectTurns,
        expectTotal,
        datasetPath,
        model,
        provider,
        baseUrl,
        apiKey,
        proxy,
        sameShellSmoke,
        datasetName,
        datasetVersion,
        suiteId,
        suiteIdExplicit,
        shardIndex,
        shardCount,
        resume,
        aggregateOutput
    }
}

function expandPath(path: string) {
    if (path.startsWith('~/')) return join(homedir(), path.slice(2))
    return resolve(ROOT, path)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, name: string) {
    if (typeof value !== 'string' || value.length < 1) {
        throw new Error(`${name} is missing from the selected model config`)
    }
    return value
}

function readModelConfig(
    config: BenchConfig,
    options: CliOptions
): ModelConfig {
    const env = process.env
    const envProvider = env.CHATLUNA_EVAL_PROVIDER ?? env.CHATLUNA_EVAL_PLATFORM
    const selectedProvider = options.provider ?? envProvider
    const selectedModel = options.model ?? env.CHATLUNA_EVAL_MODEL
    const selectedBaseUrl = options.baseUrl ?? env.CHATLUNA_EVAL_BASE_URL
    const path = expandPath(config.modelConfigPath)
    let document: unknown = {}
    try {
        const errors: ParseError[] = []
        document = parse(readTextFileSync(path, 'utf8'), errors, {
            allowTrailingComma: true
        })
        if (errors.length > 0) {
            throw new Error(`Model JSONC has ${errors.length} parse error(s)`)
        }
    } catch (error) {
        if (!selectedProvider || !selectedModel || !selectedBaseUrl) {
            throw error
        }
    }

    const providers = isRecord(document) ? document.provider : undefined
    const provider =
        options.provider ?? envProvider ?? config.modelProvider ?? ''
    const model = options.model ?? env.CHATLUNA_EVAL_MODEL ?? config.modelName
    const selected = isRecord(providers) ? providers[provider] : undefined
    const providerOptions = isRecord(selected) ? selected.options : undefined
    const baseUrl =
        options.baseUrl ??
        env.CHATLUNA_EVAL_BASE_URL ??
        (isRecord(providerOptions) ? providerOptions.baseURL : undefined)
    const apiKey =
        options.apiKey ??
        env.CHATLUNA_EVAL_API_KEY ??
        (isRecord(providerOptions) ? providerOptions.apiKey : undefined)

    return {
        provider: stringValue(provider, 'provider'),
        model: stringValue(model, 'model'),
        fullName: `${stringValue(provider, 'provider')}/${stringValue(model, 'model')}`,
        baseUrl: stringValue(baseUrl, 'baseUrl'),
        apiKey: stringValue(apiKey, 'apiKey')
    }
}

function redact(text: string, ...secrets: string[]) {
    return secrets
        .filter((secret) => secret.length > 0)
        .reduce((value, secret) => value.split(secret).join('[REDACTED]'), text)
}

function childEnv(secret?: string, source: NodeJS.ProcessEnv = process.env) {
    const env = { ...source }
    for (const name of Object.keys(env)) {
        if (
            name === 'CHATLUNA_EVAL_API_KEY' ||
            name.endsWith('_API_KEY') ||
            (secret && env[name] === secret)
        ) {
            delete env[name]
        }
    }
    return env
}

function runProcess(
    command: string,
    args: string[],
    options: CommandOptions = {}
): Promise<CommandResult> {
    return new Promise((resolve) => {
        const env = childEnv(options.secret, options.env)
        const child = spawn(command, args, {
            cwd: options.cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        let timedOut = false
        let aborted = false
        let timer: NodeJS.Timeout | undefined
        let settled = false

        const abort = () => {
            aborted = true
            child.kill('SIGTERM')
        }
        const finish = (result: CommandResult) => {
            if (settled) return
            settled = true
            if (timer) clearTimeout(timer)
            options.signal?.removeEventListener('abort', abort)
            resolve(result)
        }

        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
        if (options.timeoutMs && options.timeoutMs > 0) {
            timer = setTimeout(() => {
                timedOut = true
                child.kill('SIGTERM')
            }, options.timeoutMs)
        }
        if (options.signal?.aborted) abort()
        else options.signal?.addEventListener('abort', abort, { once: true })

        child.on('error', (error) => {
            finish({
                code: null,
                signal: null,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
                timedOut,
                aborted,
                error: error.message
            })
        })
        child.on('close', (code, signal) => {
            finish({
                code,
                signal,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
                timedOut,
                aborted
            })
        })
    })
}

function commandError(name: string, result: CommandResult) {
    return `${name} failed with exit ${result.code ?? 'unknown'}${
        result.timedOut ? ' (timeout)' : ''
    }${result.error ? `: ${result.error}` : ''}`
}

function detectCompose(): ComposeInfo {
    for (const command of [['docker', 'compose'], ['docker-compose']]) {
        const probe = spawnSync(command[0], [...command.slice(1), 'version'], {
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8'
        })
        if (probe.status === 0) {
            return {
                command,
                version: String(probe.stdout).trim()
            }
        }
    }
    throw new Error('Neither docker compose nor docker-compose is available')
}

async function listFiles(dir: string, base = dir): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true })
    const files: string[] = []
    for (const entry of entries) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) files.push(...(await listFiles(path, base)))
        else if (entry.isFile() || entry.isSymbolicLink())
            files.push(relative(base, path).split(sep).join('/'))
    }
    return files.sort()
}

async function loadTask(id: string, datasetPath: string): Promise<TaskData> {
    const dir = join(datasetPath, id)
    const taskText = await readFile(join(dir, 'task.yaml'), 'utf8')
    const data = load(taskText) as {
        instruction: string
        parser_name?: string
        max_agent_timeout_sec?: number
        max_test_timeout_sec?: number
        run_tests_in_same_shell?: boolean
    }
    const parserName = data.parser_name ?? 'pytest'
    if (!PARSER_NAMES.includes(parserName as ParserName)) {
        throw new Error(
            `Unsupported parser_name for ${id}: ${parserName}. Supported parsers: ${PARSER_NAMES.join(', ')}.`
        )
    }

    const testDir = join(dir, 'tests')
    let testDirExists = true
    try {
        await access(testDir)
    } catch {
        testDirExists = false
    }
    const [compose, runTests, sourceFiles, testFiles] = await Promise.all([
        readFile(join(dir, 'docker-compose.yaml'), 'utf8'),
        readFile(join(dir, 'run-tests.sh'), 'utf8'),
        listFiles(dir),
        testDirExists ? listFiles(testDir) : Promise.resolve([])
    ])
    const hash = createHash('sha256')
    for (const file of sourceFiles) {
        hash.update(file)
        hash.update('\0')
        hash.update(await readFile(join(dir, file)))
        hash.update('\0')
    }
    const docker = sourceFiles
        .filter(
            (file) =>
                file.endsWith('Dockerfile') ||
                /(^|\/)docker-compose\.ya?ml$/.test(file)
        )
        .map((file) => readTextFileSync(join(dir, file), 'utf8'))
        .join('\n')
    return {
        id,
        dir,
        instruction: data.instruction,
        parserName: parserName as ParserName,
        maxAgentTimeoutMs: Math.round(
            (data.max_agent_timeout_sec ?? 360) * 1000
        ),
        maxTestTimeoutMs: Math.round((data.max_test_timeout_sec ?? 60) * 1000),
        runTestsInSameShell: data.run_tests_in_same_shell ?? false,
        compose,
        runTests,
        sourceFiles,
        sourceHash: hash.digest('hex'),
        testFiles,
        testDirExists,
        requiresAmd64: /platform\s*(?:=|:)\s*["']?linux\/amd64/i.test(docker)
    }
}

async function findDatasetClone(config: BenchConfig, path?: string) {
    const candidates = [
        ...(path ? [path, dirname(path)] : []),
        join(tmpdir(), 'opencode', 'terminal-bench'),
        join(tmpdir(), 'terminal-bench'),
        expandPath(config.dataPaths.terminal),
        dirname(expandPath(config.dataPaths.terminal))
    ]
    for (const candidate of candidates) {
        try {
            await readFile(join(candidate, 'registry.json'))
            return candidate
        } catch {}
    }
    throw new Error(
        `Terminal-Bench clone was not found. Use --dataset-path (checked ${candidates.join(', ')})`
    )
}

async function readRegistry(
    clone: string,
    name: string,
    version: string
): Promise<RegistryEntry> {
    const path = join(clone, 'registry.json')
    const entries = JSON.parse(await readFile(path, 'utf8')) as RegistryEntry[]
    const selected = entries.filter(
        (entry) => entry.name === name && entry.version === version
    )
    if (selected.length !== 1) {
        throw new Error(
            `registry.json has ${selected.length} entries for ${name}==${version}`
        )
    }
    const entry = selected[0]
    if (
        !entry.commit_hash ||
        !entry.dataset_path ||
        !Array.isArray(entry.task_id_subset) ||
        entry.task_id_subset.length < 1
    ) {
        throw new Error(`${name}==${version} has an invalid registry entry`)
    }
    if (new Set(entry.task_id_subset).size !== entry.task_id_subset.length) {
        throw new Error(`${name}==${version} contains duplicate task IDs`)
    }
    return entry
}

async function prepareDataset(clone: string, entry: RegistryEntry) {
    const cache = join(
        ROOT,
        '.tmp',
        'agent-eval',
        'datasets',
        `${entry.name.replace(/[^a-zA-Z0-9_.-]/g, '-')}-${entry.version.replace(/[^a-zA-Z0-9_.-]/g, '-')}-${entry.commit_hash.slice(0, 12)}`
    )
    const manifest = join(cache, 'source.json')
    try {
        const value = JSON.parse(await readFile(manifest, 'utf8')) as {
            commit: string
            tasks: string[]
        }
        if (
            value.commit === entry.commit_hash &&
            JSON.stringify(value.tasks) === JSON.stringify(entry.task_id_subset)
        ) {
            return join(cache, entry.dataset_path.replace(/^\.\//, ''))
        }
        throw new Error(`Dataset cache has invalid metadata: ${cache}`)
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }

    await mkdir(dirname(cache), { recursive: true })
    const temp = `${cache}-${process.pid}-${randomUUID()}`
    const archive = join(temp, 'tasks.tar')
    await mkdir(temp, { recursive: true })
    try {
        const base = entry.dataset_path.replace(/^\.\//, '').replace(/\/$/, '')
        const archived = await runProcess(
            'git',
            [
                'archive',
                '--format=tar',
                '--output',
                archive,
                entry.commit_hash,
                ...entry.task_id_subset.map((id) => `${base}/${id}`)
            ],
            { cwd: clone, timeoutMs: 300000 }
        )
        if (archived.code !== 0 || archived.timedOut) {
            throw new Error(commandError('git archive', archived))
        }
        const extracted = await runProcess(
            'tar',
            ['-xf', archive, '-C', temp],
            {
                cwd: clone,
                timeoutMs: 300000
            }
        )
        if (extracted.code !== 0 || extracted.timedOut) {
            throw new Error(commandError('tar extract', extracted))
        }
        await rm(archive)
        await writeFile(
            join(temp, 'source.json'),
            JSON.stringify(
                {
                    name: entry.name,
                    version: entry.version,
                    commit: entry.commit_hash,
                    tasks: entry.task_id_subset
                },
                null,
                4
            ) + '\n',
            'utf8'
        )
        try {
            await rename(temp, cache)
        } catch (err) {
            if (
                !['EEXIST', 'ENOTEMPTY'].includes(
                    (err as NodeJS.ErrnoException).code ?? ''
                )
            ) {
                throw err
            }
        }
    } finally {
        await rm(temp, { recursive: true, force: true })
    }
    return join(cache, entry.dataset_path.replace(/^\.\//, ''))
}

async function inventoryDataset(
    clone: string,
    path: string,
    entry: RegistryEntry
): Promise<Inventory> {
    const eligible: TaskData[] = []
    const excluded: ExcludedTask[] = []
    const parserDistribution: Record<string, number> = {}
    const runTestsInSameShellDistribution: Record<string, number> = {}
    let checkoutDirectoriesPresent = 0
    let sourceDirectoriesPresent = 0

    for (const id of [...entry.task_id_subset].sort()) {
        try {
            await access(join(clone, 'original-tasks', id))
            checkoutDirectoriesPresent += 1
        } catch {}
        try {
            await access(join(path, id))
            sourceDirectoriesPresent += 1
        } catch {
            excluded.push({
                taskId: id,
                category: 'infra',
                reason: 'task directory is missing from the pinned dataset snapshot'
            })
            continue
        }

        try {
            const task = await loadTask(id, path)
            parserDistribution[task.parserName] =
                (parserDistribution[task.parserName] ?? 0) + 1
            const shell = String(task.runTestsInSameShell)
            runTestsInSameShellDistribution[shell] =
                (runTestsInSameShellDistribution[shell] ?? 0) + 1
            eligible.push(task)
        } catch (err) {
            excluded.push({
                taskId: id,
                category: 'runner',
                reason: err instanceof Error ? err.message : String(err)
            })
        }
    }

    return {
        datasetName: entry.name,
        datasetVersion: entry.version,
        datasetCommit: entry.commit_hash,
        registryPath: join(clone, 'registry.json'),
        officialTotal: entry.task_id_subset.length,
        checkoutDirectoriesPresent,
        sourceDirectoriesPresent,
        parserDistribution,
        runTestsInSameShellDistribution,
        eligible,
        excluded,
        amd64Tasks: eligible
            .filter((task) => task.requiresAmd64)
            .map((task) => task.id)
    }
}

function emptyTokens(): TokenTotals {
    return { input: 0, output: 0, reasoning: 0, cache: 0, total: 0 }
}

function emptyTiming(): TimingTotals {
    return { ttftMs: 0, totalMs: 0 }
}

function addUsage(
    tokens: TokenTotals,
    timing: TimingTotals,
    payload: ModelUsagePayload
) {
    const usage = payload.usageMetadata
    tokens.input += usage.input_tokens
    tokens.output += usage.output_tokens
    tokens.reasoning += usage.output_token_details?.reasoning ?? 0
    tokens.cache += usage.input_token_details?.cache_read ?? 0
    tokens.total += usage.total_tokens
    timing.ttftMs += payload.timing?.ttftMs ?? 0
    timing.totalMs += payload.timing?.totalMs ?? 0
}

function aggregateUsage(
    events: ModelUsagePayload[],
    compressionConversationId: string
) {
    const usage = emptyTokens()
    const timing = emptyTiming()
    let providerCalls = 0
    let mainAgentCalls = 0
    let compressionCalls = 0

    for (const item of events) {
        if (item.callType !== 'llm') continue

        addUsage(usage, timing, item)
        providerCalls += 1
        if (
            item.source === 'chatluna-agent' &&
            item.context?.conversationId === compressionConversationId
        ) {
            compressionCalls += 1
        } else {
            mainAgentCalls += 1
        }
    }

    return {
        usage,
        timing,
        audit: {
            scope: 'case' as const,
            callType: 'llm' as const,
            includesCompression: compressionCalls > 0,
            providerCalls,
            mainAgentCalls,
            compressionCalls
        } satisfies UsageAudit
    }
}

function taskTrace(runs: AgentTaskRun[], turns: number): TraceStats {
    const trace = runs.flatMap((run) => run.trace)
    const calls = trace.filter((item) => item.type === 'tool-call')
    const callIds = new Set(
        calls
            .map((item) => item.callId)
            .filter((item): item is string => !!item)
    )
    const seen = new Set<string>()
    let duplicateCalls = 0
    let invalidCalls = 0
    for (const call of calls) {
        const signature = `${call.tool ?? ''}\u0000${call.text}`
        if (seen.has(signature)) duplicateCalls += 1
        seen.add(signature)
        if (call.tool !== TOOL_NAME) invalidCalls += 1
    }
    for (const result of trace.filter((item) => item.type === 'tool-result')) {
        if (result.callId && !callIds.has(result.callId)) invalidCalls += 1
    }
    return {
        toolCalls: runs.reduce((sum, run) => sum + run.toolCount, 0),
        turns,
        duplicateCalls,
        invalidCalls,
        trace
    }
}

function snapshotRun(run: AgentTaskRun) {
    return { ...run, trace: run.trace.map((item) => ({ ...item })) }
}

function snapshotTask(task: AgentTaskSession) {
    return {
        id: task.id,
        agentId: task.agentId,
        agentName: task.agentName,
        conversationId: task.conversationId,
        parentConversationId: task.parentConversationId,
        routing: task.routing,
        depth: task.depth,
        maxDepth: task.maxDepth,
        parentAgent: task.parentAgent,
        activeRunId: task.activeRunId,
        startedAt: task.startedAt,
        updatedAt: task.updatedAt,
        messageCount: task.messages.length
    }
}

function emptyEvidence(error: string, infraFailure = true): CandidateEvidence {
    return {
        output: '',
        sessionId: '',
        conversationId: '',
        subagentConversationId: '',
        taskRunId: '',
        runState: 'failed',
        runs: [],
        tasks: [],
        usage: emptyTokens(),
        timing: emptyTiming(),
        usageAudit: {
            scope: 'case',
            callType: 'llm',
            includesCompression: false,
            providerCalls: 0,
            mainAgentCalls: 0,
            compressionCalls: 0
        },
        usageEvents: [],
        trace: {
            toolCalls: 0,
            turns: 0,
            duplicateCalls: 0,
            invalidCalls: 0,
            trace: []
        },
        error,
        infraFailure
    }
}

class TerminalBashTool extends StructuredTool {
    name = TOOL_NAME

    description =
        'Execute one shell command inside the isolated Terminal-Bench task ' +
        'container. Use workdir for a container directory. Returns JSON with ' +
        'stdout, stderr, exitCode, signal, and timedOut.'

    schema = z.object({
        command: z
            .string()
            .describe('Shell command to run in the task container.'),
        workdir: z
            .string()
            .optional()
            .describe('Optional working directory inside the task container.')
    })

    constructor(
        private readonly container: string,
        private readonly cwd: string,
        private readonly secret: string,
        private readonly dockerHost: string,
        private readonly shell?: PersistentDockerShell
    ) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        config?: ChatLunaToolRunnable
    ) {
        const result = this.shell
            ? await this.shell.run(
                  input.command,
                  input.workdir ?? '',
                  undefined,
                  config?.signal
              )
            : await runProcess(
                  'docker',
                  [
                      'exec',
                      '-w',
                      input.workdir ?? this.cwd,
                      this.container,
                      'bash',
                      '-lc',
                      input.command
                  ],
                  {
                      cwd: ROOT,
                      env: { ...process.env, DOCKER_HOST: this.dockerHost },
                      signal: config?.signal,
                      secret: this.secret
                  }
              )
        return JSON.stringify({
            stdout: redact(result.stdout, this.secret, this.container),
            stderr: redact(result.stderr, this.secret, this.container),
            exitCode: result.code,
            signal: result.signal,
            timedOut: result.timedOut,
            error: result.error
        })
    }
}

async function runChatluna(
    instruction: string,
    runId: string,
    container: string,
    cwd: string,
    baseDir: string,
    timeoutMs: number,
    model: ModelConfig,
    dockerHost: string,
    shell?: PersistentDockerShell
): Promise<CandidateEvidence> {
    const configPath = join(
        baseDir,
        'data',
        'chatluna',
        'agents',
        'config.json'
    )
    await mkdir(dirname(configPath), { recursive: true })
    await writeFile(
        configPath,
        JSON.stringify(
            {
                version: 4,
                computer: {
                    defaultProvider: 'local',
                    local: { enabled: false },
                    e2b: { enabled: false },
                    openTerminal: { enabled: false }
                }
            },
            null,
            4
        ) + '\n',
        'utf8'
    )

    const app = new KoishiContext()
    app.baseDir = baseDir
    const forks = []
    let registration: { dispose: () => Promise<void> } | undefined
    let disposeTool: (() => void) | undefined
    let offUsage: (() => void) | undefined
    const usageEvents: ModelUsagePayload[] = []
    let session: Session | undefined

    try {
        forks.push(app.plugin(memory))
        forks.push(app.plugin(server, { host: '127.0.0.1', port: 0 }))
        forks.push(app.plugin(Console as never, { open: false }))
        forks.push(
            app.plugin(chatluna as never, {
                defaultModel: model.fullName,
                defaultEmbeddings: '无',
                privateChatWithoutCommand: false
            })
        )
        forks.push(app.plugin(agent as never))
        forks.push(
            app.plugin(adapter as never, {
                platform: model.provider,
                apiKeys: [[model.apiKey, model.baseUrl, true]],
                pullModels: false,
                additionalModels: [
                    {
                        model: model.model,
                        modelType: 'LLM 大语言模型',
                        modelCapabilities: ['text_input', 'tool_call'],
                        contextSize: 1_000_000
                    }
                ],
                maxContextRatio: 0.85
            })
        )
        forks.push(app.plugin(MockBot as never))

        app.middleware((current, next) => {
            session = current
            return next()
        }, true)
        offUsage = app.on('chatluna/model-usage', async (payload) => {
            usageEvents.push(payload)
        })

        await app.start()
        disposeTool = app.chatluna.platform.registerTool(TOOL_NAME, {
            description:
                'Run a command in the isolated Terminal-Bench task container.',
            selector: () => true,
            createTool: () =>
                new TerminalBashTool(
                    container,
                    cwd,
                    model.apiKey,
                    dockerHost,
                    shell
                ),
            meta: {
                source: 'extension',
                group: 'terminal-bench',
                tags: ['terminal-bench'],
                defaultAvailability: {
                    enabled: true,
                    main: false,
                    chatluna: true,
                    characterScope: 'none'
                }
            }
        })

        const userId = `terminal-bench-${randomUUID()}`
        await app.mock.initUser(userId, 4)
        const client = app.mock.client(userId)
        if (!(client instanceof MessageClient)) {
            throw new Error('MockBot did not return an official MessageClient')
        }
        if (!(app.bots[0] instanceof MockBot)) {
            throw new Error('MockBot was not registered as the active bot')
        }
        await client.receive(`terminal bench session ${randomUUID()}`)
        if (!session) throw new Error('MockBot did not produce a Session')

        const resolved = await app.chatluna.conversation.resolveConversation(
            session,
            { mode: 'active' }
        )
        if (!resolved.conversation) {
            throw new Error(
                'ConversationService did not create a parent conversation'
            )
        }
        const conversation = resolved.conversation
        const modelRef = await app.chatluna.createChatModel(model.fullName)
        const llm = modelRef.value
        if (!llm) {
            throw new Error(`ChatLuna model is unavailable: ${model.fullName}`)
        }
        const toolMask = await app.chatluna.resolveToolMask({
            session,
            conversation,
            bindingKey: conversation.bindingKey
        })
        const agentContext: AgentRunContext = {
            kind: 'main',
            agentId: conversation.id,
            agentName: conversation.id,
            conversationId: conversation.id,
            requestId: randomUUID(),
            source: 'chatluna',
            userId: session.userId,
            guildId: session.guildId,
            channelId: session.channelId,
            toolMask
        }

        registration = await app.chatluna_agent.subAgent.registerManualAgent({
            id: 'terminal-bench-coder',
            name: 'terminal-bench-coder',
            description: 'Terminal-Bench coding agent with one container tool.',
            promptContent: [
                'Work only through the tb_bash tool in the current task container.',
                'The tool accepts command and an optional workdir inside the container.',
                'Do not use or assume any local computer, file, browser, MCP, or host tool.',
                'Complete the task and leave the requested files in the container.'
            ].join('\n'),
            enabled: true,
            format: 'chatluna',
            maxTurns: 100,
            allowKoishiMessageTransform: false,
            permissions: {
                skills: { mode: 'deny', allow: [], deny: [] },
                mcp: { mode: 'deny', allow: [], deny: [] },
                tools: { mode: 'allow', allow: [TOOL_NAME], deny: [] },
                computer: { mode: 'deny', allow: [], deny: [] }
            }
        })

        const controller = new AbortController()
        let timer: NodeJS.Timeout | undefined
        const startedAt = Date.now()
        const task = app.chatluna_agent.subAgent.runTask(
            {
                action: 'run',
                agent: 'terminal-bench-coder',
                prompt: instruction,
                background: false
            },
            {
                signal: controller.signal,
                configurable: { model: llm, session, agentContext }
            }
        )
        task.catch(() => undefined)
        const timeout = new Promise<string>((_resolve, reject) => {
            timer = setTimeout(() => {
                controller.abort(
                    new Error(`agent timeout after ${timeoutMs}ms`)
                )
                reject(new Error(`agent timeout after ${timeoutMs}ms`))
            }, timeoutMs)
        })
        let output = ''
        let error = ''
        try {
            output = await Promise.race([task, timeout])
        } catch (err) {
            error = err instanceof Error ? err.message : String(err)
        } finally {
            if (timer) clearTimeout(timer)
        }

        const runs = app.chatluna_agent.subAgent.getRuns()
        const tasks = app.chatluna_agent.subAgent.getTasks()
        offUsage?.()
        offUsage = undefined
        const selectedRuns = runs.filter(
            (run) =>
                run.parentConversationId === conversation.id &&
                run.agentName === 'terminal-bench-coder' &&
                run.startedAt >= startedAt - 1
        )
        const selectedTasks = tasks.filter(
            (item) => item.parentConversationId === conversation.id
        )
        const latest = [...selectedRuns].sort(
            (left, right) => right.startedAt - left.startedAt
        )[0]
        const subagentConversationId =
            latest?.conversationId ?? selectedTasks[0]?.conversationId ?? ''
        const aggregate = aggregateUsage(usageEvents, subagentConversationId)
        const trace = taskTrace(selectedRuns, aggregate.audit.mainAgentCalls)
        const runState = latest?.state ?? (error ? 'failed' : 'completed')
        const usageSnapshot = usageEvents.map((item) => {
            const compression =
                item.callType === 'llm' &&
                item.source === 'chatluna-agent' &&
                item.context?.conversationId === subagentConversationId
            return {
                source: item.source,
                callType: item.callType,
                platform: item.platform,
                model: item.model,
                usageMetadata: item.usageMetadata,
                estimated: item.estimated,
                success: item.success,
                timing: item.timing,
                context: item.context,
                createdAt: item.createdAt,
                usageKind:
                    item.callType !== 'llm'
                        ? 'other'
                        : compression
                          ? 'scratchpad-compression'
                          : 'main-agent',
                countedAsTurn: item.callType === 'llm' && !compression
            }
        })

        return {
            output,
            sessionId: `${runId}:${String(session.id)}`,
            conversationId: conversation.id,
            subagentConversationId,
            taskRunId: latest?.runId ?? '',
            runState,
            runs: selectedRuns.map(snapshotRun),
            tasks: selectedTasks.map(snapshotTask),
            usage: aggregate.usage,
            timing: aggregate.timing,
            usageAudit: aggregate.audit,
            usageEvents: usageSnapshot,
            trace,
            error,
            infraFailure: error.length > 0 || runState !== 'completed'
        }
    } catch (err) {
        return emptyEvidence(err instanceof Error ? err.message : String(err))
    } finally {
        offUsage?.()
        disposeTool?.()
        try {
            await registration?.dispose()
        } finally {
            for (const fork of forks.reverse()) fork.dispose()
            await app.lifecycle.flush()
            await app.stop()
        }
    }
}

function parseVerifier(parserName: ParserName, content: string): ParserResult {
    if (parserName === 'swebench' || parserName === 'sweperf') {
        const label = parserName === 'swebench' ? 'SWEBench' : 'SWE-Perf'
        const start = `${label} results starts here`
        const end = `${label} results ends here`
        if (!content.includes(start) || !content.includes(end)) {
            throw new Error(
                `Couldn't find ${label} results between the start/end markers. Skipping this task as it is an issue from the server end.`
            )
        }
        const after = content.slice(content.indexOf(start) + start.length)
        const block = after.slice(0, after.lastIndexOf(end)).trim()
        const passed = block === 'PASSED'
        return { results: { tests: passed ? 'passed' : 'failed' }, passed }
    }
    if (parserName === 'mlebench') {
        const start = 'MLEBench results starts here'
        const end = 'MLEBench results ends here'
        const startIndex = content.indexOf(start)
        const after =
            startIndex < 0 ? content : content.slice(startIndex + start.length)
        const endIndex = after.lastIndexOf(end)
        const block = (endIndex < 0 ? after : after.slice(0, endIndex)).trim()
        const passed = block === 'ALL TESTS PASSED'
        return { results: { tests: passed ? 'passed' : 'failed' }, passed }
    }
    if (parserName === 'swelancer') {
        const value = content.toLowerCase()
        const passed = value.includes('swe lancer success')
            ? true
            : value.includes('swe lancer failure')
              ? false
              : value.includes('user_tool') && value.includes('completed')
        return {
            results: { swelancer_task: passed ? 'passed' : 'failed' },
            passed
        }
    }

    const marker = /=+\s*short test summary info\s*=+/i
    const match = marker.exec(content)
    if (!match) {
        throw new Error(
            'No short test summary info found in the provided content.'
        )
    }

    const results: Record<string, TestStatus> = {}
    for (const line of content
        .slice(match.index + match[0].length)
        .split(/\r?\n/)) {
        let cleaned = line
        if (cleaned.startsWith('FAILED')) {
            const failedParts = cleaned.split(' - ')
            if (failedParts.length > 1) {
                cleaned = failedParts.slice(0, -1).join(' - ')
            }
        }
        const value = cleaned.trim()
        const whitespace = value.search(/\s/)
        if (whitespace < 0) continue
        const status = value.slice(0, whitespace).replace(/^:+|:+$/g, '')
        if (
            ![
                'PASSED',
                'FAILED',
                'SKIPPED',
                'XFAIL',
                'XPASS',
                'ERROR'
            ].includes(status)
        ) {
            continue
        }
        const path = value.slice(whitespace).trim()
        const delimiter = path.indexOf('::')
        const testName = delimiter < 0 ? path : path.slice(delimiter + 2)
        if (!testName) continue
        results[testName] =
            status === 'PASSED' || status === 'SKIPPED' || status === 'XFAIL'
                ? 'passed'
                : 'failed'
    }
    return {
        results,
        passed: !Object.values(results).some((status) => status === 'failed')
    }
}

async function saveText(path: string, text: string, secret: string) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, redact(text, secret), 'utf8')
}

async function saveJson(
    path: string,
    value: unknown,
    secret: string,
    container = ''
) {
    await saveText(path, JSON.stringify(value, null, 4) + '\n', secret)
    if (container.length > 0) {
        const text = await readFile(path, 'utf8')
        await writeFile(path, redact(text, container), 'utf8')
    }
}

function baseResult(
    runId: string,
    task: TaskData,
    attempt: number,
    options: CliOptions,
    entry: RegistryEntry,
    model: ModelConfig,
    revision: string
): Result {
    return {
        runId,
        suiteId: options.suiteId,
        suiteAttempts: options.attempts,
        datasetName: entry.name,
        datasetVersion: entry.version,
        datasetCommit: entry.commit_hash,
        taskSourceHash: task.sourceHash,
        variant: 'candidate',
        benchmark: 'terminal-bench',
        caseId: task.id,
        taskId: task.id,
        attempt,
        agent: 'chatluna',
        model: model.fullName,
        sessionId: '',
        conversationId: '',
        state: 'infra-failure',
        score: 0,
        toolCalls: 0,
        turns: 0,
        duplicateCalls: 0,
        invalidCalls: 0,
        tokens: emptyTokens(),
        wallMs: 0,
        graderMs: 0,
        gitRevision: revision,
        finishedAt: '',
        error: ''
    }
}

async function runAttempt(
    task: TaskData,
    runId: string,
    attempt: number,
    options: CliOptions,
    entry: RegistryEntry,
    model: ModelConfig,
    revision: string,
    composeInfo: ComposeInfo,
    dockerHost: string,
    dockerArchitecture: string,
    proxy: string | undefined
): Promise<Result> {
    const root = join(
        ROOT,
        '.tmp',
        'agent-eval',
        'runs',
        runId,
        task.id,
        `attempt-${attempt}`
    )
    const artifacts = join(root, 'artifacts')
    await mkdir(artifacts, { recursive: true })
    const result = baseResult(
        runId,
        task,
        attempt,
        options,
        entry,
        model,
        revision
    )
    const startedAt = Date.now()
    const timeoutMs = options.timeoutMs ?? task.maxAgentTimeoutMs
    const project = `tb-${runId.slice(0, 8)}-${task.id}-${attempt}`
    const container = `${project}-client`
    const image = `${project}-client-image`
    const logs = join(root, 'logs')
    const agentLogs = join(root, 'agent-logs')
    const composeEnv = childEnv(model.apiKey)
    composeEnv.DOCKER_HOST = dockerHost
    if (dockerArchitecture === 'aarch64' && task.requiresAmd64) {
        composeEnv.DOCKER_DEFAULT_PLATFORM = 'linux/amd64'
    }
    Object.assign(composeEnv, {
        T_BENCH_TASK_DOCKER_CLIENT_IMAGE_NAME: image,
        T_BENCH_TASK_DOCKER_CLIENT_CONTAINER_NAME: container,
        T_BENCH_TASK_LOGS_PATH: logs,
        T_BENCH_CONTAINER_LOGS_PATH: '/logs',
        T_BENCH_TASK_AGENT_LOGS_PATH: agentLogs,
        T_BENCH_CONTAINER_AGENT_LOGS_PATH: '/agent-logs',
        T_BENCH_TEST_DIR: '/tests'
    })
    await mkdir(logs, { recursive: true })
    await mkdir(agentLogs, { recursive: true })

    const stages: LifecycleStages = {
        build: 'pending',
        up: 'pending',
        agent: 'pending',
        network: 'pending',
        copyVerifier: 'pending',
        verifier: 'pending',
        down: 'pending'
    }
    let evidence = emptyEvidence('')
    let verifier: CommandResult = {
        code: null,
        signal: null,
        stdout: '',
        stderr: '',
        timedOut: false,
        aborted: false
    }
    let verifierParse: ParserResult | undefined
    let cwd = '/app'
    let networkNames: string[] = []
    let networkAliases: Record<string, string[]> = {}
    let agentNetworkState = 'not started'
    let verifierNetworkState = 'not restored'
    let testsIsolation: IsolationCheck = {
        checked: false,
        present: null,
        exitCode: null
    }
    let solutionIsolation: IsolationCheck = {
        checked: false,
        present: null,
        exitCode: null
    }
    let persistentShell: PersistentDockerShell | undefined
    await saveText(
        join(artifacts, 'instruction.txt'),
        task.instruction,
        model.apiKey
    )
    await saveText(join(artifacts, 'agent-result.txt'), '', model.apiKey)
    await saveText(join(artifacts, 'agent-error.txt'), '', model.apiKey)
    await saveJson(
        join(artifacts, 'tool-trace.json'),
        {
            runs: [],
            tasks: [],
            usage: emptyTokens(),
            timing: emptyTiming(),
            usageAudit: emptyEvidence('').usageAudit,
            usageEvents: [],
            trace: emptyEvidence('').trace
        },
        model.apiKey,
        container
    )
    await saveJson(
        join(artifacts, 'usage-audit.json'),
        emptyEvidence('').usageAudit,
        model.apiKey
    )
    await saveText(join(artifacts, 'verifier.stdout'), '', model.apiKey)
    await saveText(join(artifacts, 'verifier.stderr'), '', model.apiKey)

    const compose = (args: string[], timeout: number) =>
        runProcess(
            composeInfo.command[0],
            [
                ...composeInfo.command.slice(1),
                '--project-name',
                project,
                '--file',
                join(task.dir, 'docker-compose.yaml'),
                ...args
            ],
            {
                cwd: task.dir,
                env: composeEnv,
                timeoutMs: timeout,
                secret: model.apiKey
            }
        )
    const docker = (args: string[], timeout: number) =>
        runProcess('docker', args, {
            cwd: ROOT,
            env: composeEnv,
            timeoutMs: timeout,
            secret: model.apiKey
        })
    let restoreError: Error | undefined

    try {
        const build = await compose(['build'], timeoutMs)
        stages.build =
            build.code === 0 && !build.timedOut ? 'completed' : 'failed'
        await saveText(
            join(artifacts, 'docker-build.stdout'),
            build.stdout,
            model.apiKey
        )
        await saveText(
            join(artifacts, 'docker-build.stderr'),
            build.stderr || build.error || '',
            model.apiKey
        )
        if (build.code !== 0 || build.timedOut) {
            throw new Error(commandError('docker compose build', build))
        }

        const up = await compose(['up', '-d'], timeoutMs)
        stages.up = up.code === 0 && !up.timedOut ? 'completed' : 'failed'
        await saveText(
            join(artifacts, 'docker-up.stdout'),
            up.stdout,
            model.apiKey
        )
        await saveText(
            join(artifacts, 'docker-up.stderr'),
            up.stderr || up.error || '',
            model.apiKey
        )
        if (up.code !== 0 || up.timedOut) {
            throw new Error(commandError('docker compose up', up))
        }

        const inspect = await docker(
            ['inspect', '--format', '{{.Config.WorkingDir}}', container],
            30000
        )
        if (inspect.code !== 0) {
            throw new Error(commandError('docker inspect', inspect))
        }
        cwd = inspect.stdout.trim() || '/app'

        const networkInspect = await docker(
            [
                'inspect',
                '--format',
                '{{range $name, $network := .NetworkSettings.Networks}}{{$name}}\n{{end}}',
                container
            ],
            30000
        )
        if (networkInspect.code !== 0) {
            throw new Error(
                commandError('docker network inspect', networkInspect)
            )
        }
        networkNames = networkInspect.stdout
            .split(/\r?\n/)
            .map((name) => name.trim())
            .filter((name) => name.length > 0)
        if (networkNames.length < 1) {
            throw new Error('Container has no attached Docker networks')
        }
        if (task.runTestsInSameShell) {
            const details = await docker(
                [
                    'inspect',
                    '--format',
                    '{{json .NetworkSettings.Networks}}',
                    container
                ],
                30000
            )
            if (details.code !== 0) {
                throw new Error(commandError('docker network details', details))
            }
            const values = JSON.parse(details.stdout) as Record<
                string,
                { Aliases?: string[] }
            >
            networkAliases = Object.fromEntries(
                Object.entries(values).map(([name, value]) => [
                    name,
                    value.Aliases ?? []
                ])
            )
        }

        const disconnected: string[] = []
        try {
            agentNetworkState = 'disconnecting'
            for (const name of networkNames) {
                const disconnectedResult = await docker(
                    ['network', 'disconnect', '-f', name, container],
                    30000
                )
                if (disconnectedResult.code !== 0) {
                    throw new Error(
                        commandError(
                            `docker network disconnect ${name}`,
                            disconnectedResult
                        )
                    )
                }
                disconnected.push(name)
            }
            agentNetworkState = 'disconnected'
            stages.network = 'disconnected'

            const testsCheck = await docker(
                [
                    'exec',
                    container,
                    'sh',
                    '-c',
                    'if [ -e /tests ]; then ' +
                        'if [ ! -d /tests ]; then exit 1; fi; ' +
                        'command -v find >/dev/null 2>&1 || exit 2; ' +
                        'if [ -n "$(find /tests -mindepth 1 -print -quit)" ]; then exit 1; fi; ' +
                        'fi'
                ],
                30000
            )
            testsIsolation = {
                checked: true,
                present:
                    testsCheck.code === 0
                        ? false
                        : testsCheck.code === 1
                          ? true
                          : null,
                exitCode: testsCheck.code
            }
            const solutionCheck = await docker(
                [
                    'exec',
                    container,
                    'sh',
                    '-c',
                    'for path in /solution.sh /solution.yaml /app/solution.sh /app/solution.yaml; do if [ -e "$path" ]; then exit 1; fi; done'
                ],
                30000
            )
            solutionIsolation = {
                checked: true,
                present:
                    solutionCheck.code === 0
                        ? false
                        : solutionCheck.code === 1
                          ? true
                          : null,
                exitCode: solutionCheck.code
            }
            if (testsCheck.code !== 0 || solutionCheck.code !== 0) {
                throw new Error(
                    `Agent container input leak check failed: tests=${testsCheck.code}, solution=${solutionCheck.code}`
                )
            }

            stages.agent = 'running'
            const baseDir = join(root, 'koishi-base')
            await mkdir(baseDir, { recursive: true })
            if (task.runTestsInSameShell) {
                persistentShell = new PersistentDockerShell(
                    container,
                    cwd,
                    model.apiKey,
                    dockerHost
                )
            }
            evidence = await runChatluna(
                task.instruction,
                runId,
                container,
                cwd,
                baseDir,
                timeoutMs,
                model,
                dockerHost,
                persistentShell
            )
            stages.agent = evidence.infraFailure ? 'failed' : 'completed'
        } finally {
            for (const name of disconnected) {
                const connectArgs = ['network', 'connect']
                if (task.runTestsInSameShell) {
                    connectArgs.push(
                        ...networkAliases[name].flatMap((alias) => [
                            '--alias',
                            alias
                        ])
                    )
                }
                connectArgs.push(name, container)
                const connectedResult = await docker(connectArgs, 30000)
                if (connectedResult.code !== 0) {
                    restoreError ??= new Error(
                        commandError(
                            `docker network connect ${name}`,
                            connectedResult
                        )
                    )
                }
            }
            if (restoreError) {
                verifierNetworkState = 'network restore failed'
                stages.network = 'restore-failed'
            } else if (disconnected.length > 0) {
                verifierNetworkState = 'compose network restored'
                stages.network = 'restored'
            }
        }
        if (restoreError) throw restoreError

        await saveText(
            join(artifacts, 'agent-result.txt'),
            evidence.output,
            model.apiKey
        )
        await saveText(
            join(artifacts, 'agent-error.txt'),
            evidence.error,
            model.apiKey
        )
        await saveJson(
            join(artifacts, 'tool-trace.json'),
            {
                runs: evidence.runs,
                tasks: evidence.tasks,
                usage: evidence.usage,
                timing: evidence.timing,
                usageAudit: evidence.usageAudit,
                usageEvents: evidence.usageEvents,
                trace: evidence.trace
            },
            model.apiKey,
            container
        )
        await saveJson(
            join(artifacts, 'usage-audit.json'),
            evidence.usageAudit,
            model.apiKey
        )

        const dns = await docker(
            [
                'exec',
                container,
                'sh',
                '-c',
                'printf "nameserver 8.8.8.8\\nnameserver 8.8.4.4\\n" > /etc/resolv.conf'
            ],
            30000
        )
        if (dns.code !== 0) {
            throw new Error(commandError('docker DNS setup', dns))
        }
        stages.network = 'completed'

        const curlConfig = await docker(
            [
                'exec',
                container,
                'sh',
                '-c',
                'printf "http1.1\\nretry 5\\nretry-all-errors\\nretry-delay 2\\n" > "$HOME/.curlrc"'
            ],
            30000
        )
        if (curlConfig.code !== 0) {
            throw new Error(commandError('docker curl setup', curlConfig))
        }

        stages.copyVerifier = 'running'
        const makeTestsDir = await docker(
            ['exec', container, 'mkdir', '-p', '/tests'],
            30000
        )
        const copyRunTests = await docker(
            [
                'cp',
                join(task.dir, 'run-tests.sh'),
                `${container}:/tests/run-tests.sh`
            ],
            30000
        )
        const copyTests = task.testDirExists
            ? await docker(
                  [
                      'cp',
                      `${join(task.dir, 'tests')}${sep}.`,
                      `${container}:/tests`
                  ],
                  30000
              )
            : undefined
        if (
            makeTestsDir.code !== 0 ||
            copyRunTests.code !== 0 ||
            (copyTests && copyTests.code !== 0)
        ) {
            throw new Error(
                [makeTestsDir, copyRunTests, copyTests]
                    .filter(
                        (item): item is CommandResult =>
                            !!item && item.code !== 0
                    )
                    .map(
                        (item) =>
                            item.stderr || item.error || 'docker cp failed'
                    )
                    .join('; ')
            )
        }
        stages.copyVerifier = 'completed'

        stages.verifier = 'running'
        const graderStart = Date.now()
        verifier = persistentShell
            ? await persistentShell.run(
                  'bash /tests/run-tests.sh',
                  '',
                  task.maxTestTimeoutMs,
                  undefined,
                  proxy
                      ? {
                            HTTP_PROXY: proxy,
                            HTTPS_PROXY: proxy,
                            ALL_PROXY: proxy
                        }
                      : {}
              )
            : await docker(
                  [
                      'exec',
                      ...(proxy
                          ? [
                                '-e',
                                `HTTP_PROXY=${proxy}`,
                                '-e',
                                `HTTPS_PROXY=${proxy}`,
                                '-e',
                                `ALL_PROXY=${proxy}`
                            ]
                          : []),
                      '-w',
                      cwd,
                      container,
                      'bash',
                      '/tests/run-tests.sh'
                  ],
                  task.maxTestTimeoutMs
              )
        result.graderMs = Date.now() - graderStart
        stages.verifier = verifier.timedOut ? 'timeout' : 'completed'
        await saveText(
            join(artifacts, 'verifier.stdout'),
            verifier.stdout,
            model.apiKey
        )
        await saveText(
            join(artifacts, 'verifier.stderr'),
            verifier.stderr || verifier.error || '',
            model.apiKey
        )
        if (verifier.timedOut) {
            throw new Error(`verifier timeout after ${task.maxTestTimeoutMs}ms`)
        }
        verifierParse = parseVerifier(
            task.parserName,
            `${verifier.stdout}\n${verifier.stderr}`
        )
        result.sessionId = evidence.sessionId
        result.conversationId =
            evidence.subagentConversationId || evidence.conversationId
        result.toolCalls = evidence.trace.toolCalls
        result.turns = evidence.trace.turns
        result.duplicateCalls = evidence.trace.duplicateCalls
        result.invalidCalls = evidence.trace.invalidCalls
        result.tokens = evidence.usage
        result.wallMs = Date.now() - startedAt
        result.score = verifierParse.passed ? 1 : 0
        result.state = evidence.infraFailure
            ? 'infra-failure'
            : result.score === 1
              ? 'pass'
              : 'fail'
        result.error = redact(evidence.error, model.apiKey)
        if (!verifierParse.passed) {
            result.error = `${result.error}${result.error ? '; ' : ''}${task.parserName} reported a failing test`
        }
    } catch (err) {
        result.wallMs = Date.now() - startedAt
        result.tokens = evidence.usage
        result.sessionId = evidence.sessionId
        result.conversationId =
            evidence.subagentConversationId || evidence.conversationId
        result.toolCalls = evidence.trace.toolCalls
        result.turns = evidence.trace.turns
        result.duplicateCalls = evidence.trace.duplicateCalls
        result.invalidCalls = evidence.trace.invalidCalls
        result.error = redact(
            err instanceof Error ? err.message : String(err),
            model.apiKey
        )
        if (verifier.code !== 0 && verifier.stderr) {
            result.error = `${result.error}; verifier exit=${verifier.code}`
        }
    } finally {
        await persistentShell?.close()
        stages.down = 'running'
        const down = await compose(['down'], 120000)
        stages.down = down.code === 0 && !down.timedOut ? 'completed' : 'failed'
        if (down.code !== 0 || down.timedOut) {
            result.error = `${result.error}${result.error ? '; ' : ''}${commandError(
                'docker compose down',
                down
            )}`
        }
        result.wallMs = result.wallMs || Date.now() - startedAt
        result.finishedAt = new Date().toISOString()
        await saveText(
            join(artifacts, 'agent-result.txt'),
            evidence.output,
            model.apiKey
        )
        await saveText(
            join(artifacts, 'agent-error.txt'),
            evidence.error,
            model.apiKey
        )
        await saveJson(
            join(artifacts, 'tool-trace.json'),
            {
                runs: evidence.runs,
                tasks: evidence.tasks,
                usage: evidence.usage,
                timing: evidence.timing,
                usageAudit: evidence.usageAudit,
                usageEvents: evidence.usageEvents,
                trace: evidence.trace
            },
            model.apiKey,
            container
        )
        await saveJson(
            join(artifacts, 'usage-audit.json'),
            evidence.usageAudit,
            model.apiKey
        )
        await saveText(
            join(artifacts, 'verifier.stdout'),
            verifier.stdout,
            model.apiKey
        )
        await saveText(
            join(artifacts, 'verifier.stderr'),
            verifier.stderr || verifier.error || '',
            model.apiKey
        )
        await saveJson(
            join(artifacts, 'metadata.json'),
            {
                benchmark: 'terminal-bench',
                taskId: task.id,
                parserName: task.parserName,
                timeoutMs,
                maxAgentTimeoutMs: task.maxAgentTimeoutMs,
                maxTestTimeoutMs: task.maxTestTimeoutMs,
                runTestsInSameShell: task.runTestsInSameShell,
                testFiles: task.testFiles,
                sourceHashes: {
                    taskYaml: createHash('sha256')
                        .update(await readFile(join(task.dir, 'task.yaml')))
                        .digest('hex'),
                    taskSources: task.sourceHash
                },
                model: model.fullName,
                compose: {
                    executable: composeInfo.command.join(' '),
                    version: composeInfo.version,
                    lifecycle: ['build', 'up -d', 'down']
                },
                agentPolicy: {
                    tools: [TOOL_NAME],
                    hostShell: false,
                    testsPresentBeforeAgent: testsIsolation.present,
                    solutionPresentBeforeAgent: solutionIsolation.present,
                    isolationChecks: {
                        tests: testsIsolation,
                        solution: solutionIsolation
                    },
                    keyPassedToChild: false
                },
                networkPolicy: {
                    isolation: 'official-docker-compose',
                    names: networkNames,
                    agent: agentNetworkState,
                    verifier: verifierNetworkState,
                    outboundNetwork:
                        'not blocked; official verifier may install dependencies',
                    dns: ['8.8.8.8', '8.8.4.4']
                },
                verifierSetup: {
                    curlConfig: '$HOME/.curlrc',
                    httpVersion: '1.1',
                    retry: 5,
                    retryAllErrors: true,
                    proxy: proxy ? 'configured' : 'none',
                    uvCache: false
                },
                verifier: {
                    command: 'bash /tests/run-tests.sh',
                    workdir: cwd,
                    parser: task.parserName,
                    exitCode: verifier.code,
                    timedOut: verifier.timedOut,
                    parsed: verifierParse?.results ?? null
                },
                dockerPlatform: {
                    daemonArchitecture: dockerArchitecture,
                    requested:
                        dockerArchitecture === 'aarch64' && task.requiresAmd64
                            ? 'linux/amd64'
                            : 'native'
                },
                stages
            },
            model.apiKey,
            container
        )
        await saveJson(join(artifacts, 'result.json'), result, model.apiKey)
    }
    return result
}

async function appendResult(path: string, result: Result, secret: string) {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(
        path,
        redact(JSON.stringify(result) + '\n', secret),
        'utf8'
    )
}

async function gitRevision() {
    const revision = await runProcess('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        timeoutMs: 10000
    })
    const dirty = await runProcess('git', ['diff', '--quiet', 'HEAD'], {
        cwd: ROOT,
        timeoutMs: 10000
    })
    return dirty.code === 0
        ? revision.stdout.trim()
        : `${revision.stdout.trim()}-dirty`
}

async function readResults(paths: string[], missing = false) {
    const rows: Result[] = []
    for (const path of paths) {
        let content: string
        try {
            content = await readFile(path, 'utf8')
        } catch (err) {
            if (missing && (err as NodeJS.ErrnoException).code === 'ENOENT') {
                continue
            }
            throw err
        }
        for (const [idx, line] of content.split(/\r?\n/).entries()) {
            if (!line.trim()) continue
            try {
                rows.push(JSON.parse(line) as Result)
            } catch {
                throw new Error(`Invalid JSONL at ${path}:${idx + 1}`)
            }
        }
    }
    return rows
}

function percentile(values: number[], ratio: number) {
    if (values.length === 0) return 0
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.ceil(sorted.length * ratio) - 1]
}

function metric(values: number[]) {
    const total = values.reduce((sum, value) => sum + value, 0)
    return {
        total,
        average:
            values.length === 0
                ? 0
                : Math.round((total / values.length) * 100) / 100,
        p50: percentile(values, 0.5),
        p95: percentile(values, 0.95)
    }
}

function inventoryReport(
    inventory: Inventory,
    architecture: string,
    selected: TaskData[],
    options: CliOptions
) {
    return {
        command: 'inventory',
        suiteId: options.suiteId,
        datasetName: inventory.datasetName,
        datasetVersion: inventory.datasetVersion,
        datasetCommit: inventory.datasetCommit,
        registryPath: inventory.registryPath,
        terminalBenchVersion: '0.2.18',
        officialTotal: inventory.officialTotal,
        checkoutDirectoriesPresent: inventory.checkoutDirectoriesPresent,
        pinnedSourceDirectoriesPresent: inventory.sourceDirectoriesPresent,
        runnerSupportedEligible: inventory.eligible.length,
        excluded: inventory.excluded.length,
        runnerExclusions: inventory.excluded.filter(
            (item) => item.category === 'runner'
        ).length,
        infraExclusions: inventory.excluded.filter(
            (item) => item.category === 'infra'
        ).length,
        coveragePercentage:
            Math.round(
                (inventory.eligible.length / inventory.officialTotal) * 10000
            ) / 100,
        parserDistribution: inventory.parserDistribution,
        runTestsInSameShellDistribution:
            inventory.runTestsInSameShellDistribution,
        architecture: {
            dockerDaemon: architecture,
            amd64Strategy:
                architecture === 'aarch64'
                    ? 'DOCKER_DEFAULT_PLATFORM=linux/amd64 per affected task'
                    : 'native',
            amd64Tasks: inventory.amd64Tasks,
            incompatibleTasks: []
        },
        eligible: inventory.eligible.map((task) => task.id),
        exclusions: inventory.excluded,
        shard: {
            index: options.shardIndex,
            count: options.shardCount,
            selected: selected.map((task) => task.id)
        }
    }
}

function aggregateSuite(
    rows: Result[],
    inventory: Inventory,
    options: CliOptions
) {
    const filtered = rows.filter(
        (row) =>
            row.benchmark === 'terminal-bench' &&
            row.suiteId === options.suiteId
    )
    const counts = new Set(filtered.map((row) => row.suiteAttempts))
    if (counts.size > 1) {
        throw new Error(
            `Suite ${options.suiteId} has inconsistent attempt counts`
        )
    }
    const attempts = filtered[0]?.suiteAttempts ?? options.attempts
    const tasks = new Map(inventory.eligible.map((task) => [task.id, task]))
    const latest = new Map<string, Result>()
    for (const row of filtered) {
        const task = tasks.get(row.taskId)
        if (!task || row.attempt < 1 || row.attempt > attempts) {
            throw new Error(
                `Suite ${options.suiteId} contains an ineligible result: ${row.taskId}#${row.attempt}`
            )
        }
        if (
            row.datasetName !== inventory.datasetName ||
            row.datasetVersion !== inventory.datasetVersion ||
            row.datasetCommit !== inventory.datasetCommit ||
            row.taskSourceHash !== task.sourceHash
        ) {
            throw new Error(
                `Suite ${options.suiteId} contains a dataset mismatch: ${row.taskId}#${row.attempt}`
            )
        }
        latest.set(`${row.taskId}\u0000${row.attempt}`, row)
    }
    const selected = [...latest.values()]
    const eligibleAttempts = inventory.eligible.length * attempts
    const pass = selected.filter((row) => row.state === 'pass').length
    const fail = selected.filter((row) => row.state === 'fail').length
    const infra = selected.filter((row) => row.state === 'infra-failure').length
    const unfinished: string[] = []
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
        for (const task of inventory.eligible) {
            const row = latest.get(`${task.id}\u0000${attempt}`)
            if (!row || row.state === 'infra-failure') {
                unfinished.push(`${task.id}#${attempt}`)
            }
        }
    }

    return {
        command: 'aggregate',
        suiteId: options.suiteId,
        datasetName: inventory.datasetName,
        datasetVersion: inventory.datasetVersion,
        datasetCommit: inventory.datasetCommit,
        official: inventory.officialTotal,
        eligible: inventory.eligible.length,
        eligibleAttempts,
        excluded: inventory.excluded.length,
        runnerExclusions: inventory.excluded.filter(
            (item) => item.category === 'runner'
        ).length,
        infraExclusions: inventory.excluded.filter(
            (item) => item.category === 'infra'
        ).length,
        exclusions: inventory.excluded,
        attempts,
        attempted: selected.length,
        pass,
        fail,
        infra,
        scoreNumerator: pass,
        scoreDenominator: eligibleAttempts,
        scorePercentage:
            eligibleAttempts === 0
                ? 0
                : Math.round((pass / eligibleAttempts) * 10000) / 100,
        coverageNumerator: inventory.eligible.length,
        coverageDenominator: inventory.officialTotal,
        coveragePercentage:
            Math.round(
                (inventory.eligible.length / inventory.officialTotal) * 10000
            ) / 100,
        statePassPercentage:
            selected.length === 0
                ? 0
                : Math.round((pass / selected.length) * 10000) / 100,
        statePassDenominator: selected.length,
        tokens: metric(selected.map((row) => row.tokens.total)),
        tools: metric(selected.map((row) => row.toolCalls)),
        turns: metric(selected.map((row) => row.turns)),
        wallMs: metric(selected.map((row) => row.wallMs)),
        graderMs: metric(selected.map((row) => row.graderMs)),
        unfinished
    }
}

async function runSameShellSmokeTask(
    task: TaskData,
    composeInfo: ComposeInfo,
    dockerHost: string,
    dockerArchitecture: string,
    proxy?: string
) {
    const id = randomUUID()
    const project = `tb-smoke-${id.slice(0, 8)}-${task.id}`
    const container = `${project}-client`
    const root = join(
        ROOT,
        '.tmp',
        'agent-eval',
        'same-shell-smoke',
        id,
        task.id
    )
    const env = childEnv()
    env.DOCKER_HOST = dockerHost
    if (dockerArchitecture === 'aarch64' && task.requiresAmd64) {
        env.DOCKER_DEFAULT_PLATFORM = 'linux/amd64'
    }
    Object.assign(env, {
        T_BENCH_TASK_DOCKER_CLIENT_IMAGE_NAME: `${project}-client-image`,
        T_BENCH_TASK_DOCKER_CLIENT_CONTAINER_NAME: container,
        T_BENCH_TASK_LOGS_PATH: join(root, 'logs'),
        T_BENCH_CONTAINER_LOGS_PATH: '/logs',
        T_BENCH_TASK_AGENT_LOGS_PATH: join(root, 'agent-logs'),
        T_BENCH_CONTAINER_AGENT_LOGS_PATH: '/agent-logs',
        T_BENCH_TEST_DIR: '/tests'
    })
    await mkdir(join(root, 'logs'), { recursive: true })
    await mkdir(join(root, 'agent-logs'), { recursive: true })
    const compose = (args: string[], timeoutMs: number) =>
        runProcess(
            composeInfo.command[0],
            [
                ...composeInfo.command.slice(1),
                '--project-name',
                project,
                '--file',
                join(task.dir, 'docker-compose.yaml'),
                ...args
            ],
            { cwd: task.dir, env, timeoutMs }
        )
    const docker = (args: string[], timeoutMs: number) =>
        runProcess('docker', args, { cwd: ROOT, env, timeoutMs })
    let shell: PersistentDockerShell | undefined
    let networks: Record<string, { Aliases?: string[] }> = {}
    const disconnected: string[] = []
    let cwd = '/app'
    let setup: CommandResult | undefined
    let state: CommandResult | undefined
    let timeout: CommandResult | undefined
    let afterTimeout: CommandResult | undefined
    let abort: CommandResult | undefined
    let afterAbort: CommandResult | undefined
    let verifier: CommandResult | undefined
    let error = ''
    let down: CommandResult | undefined

    try {
        const build = await compose(['build'], task.maxAgentTimeoutMs)
        if (build.code !== 0 || build.timedOut) {
            throw new Error(commandError('docker compose build', build))
        }
        const up = await compose(['up', '-d'], task.maxAgentTimeoutMs)
        if (up.code !== 0 || up.timedOut) {
            throw new Error(commandError('docker compose up', up))
        }
        const inspect = await docker(
            ['inspect', '--format', '{{.Config.WorkingDir}}', container],
            30000
        )
        if (inspect.code !== 0) {
            throw new Error(commandError('docker inspect', inspect))
        }
        cwd = inspect.stdout.trim() || '/app'
        const networkInspect = await docker(
            [
                'inspect',
                '--format',
                '{{json .NetworkSettings.Networks}}',
                container
            ],
            30000
        )
        if (networkInspect.code !== 0) {
            throw new Error(
                commandError('docker network inspect', networkInspect)
            )
        }
        networks = JSON.parse(networkInspect.stdout) as Record<
            string,
            { Aliases?: string[] }
        >
        for (const name of Object.keys(networks)) {
            const result = await docker(
                ['network', 'disconnect', '-f', name, container],
                30000
            )
            if (result.code !== 0) {
                throw new Error(
                    commandError(`docker network disconnect ${name}`, result)
                )
            }
            disconnected.push(name)
        }
        const testsCheck = await docker(
            [
                'exec',
                container,
                'sh',
                '-c',
                'if [ -e /tests ]; then if [ ! -d /tests ]; then exit 1; fi; if [ -n "$(find /tests -mindepth 1 -print -quit)" ]; then exit 1; fi; fi'
            ],
            30000
        )
        if (testsCheck.code !== 0) {
            throw new Error(
                'smoke found tests before the simulated agent phase'
            )
        }

        shell = new PersistentDockerShell(container, cwd, '', dockerHost)
        setup = await shell.run(
            'export TB_SAME_SHELL_SMOKE=ready; cd /app; sleep 120 & printf \'%s\' "$!" > /tmp/tb-same-shell-smoke.pid',
            cwd,
            30000
        )
        state = await shell.run(
            'test "$TB_SAME_SHELL_SMOKE" = ready && ' +
                'test "$(pwd)" = /app && ' +
                'test -s /tmp/tb-same-shell-smoke.pid && ' +
                'kill -0 "$(cat /tmp/tb-same-shell-smoke.pid)" && ' +
                'printf state-visible',
            '',
            30000
        )
        timeout = await shell.run('sleep 30', '', 500)
        afterTimeout = await shell.run('printf timeout-recovered', '', 30000)
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 500)
        try {
            abort = await shell.run(
                'sleep 30',
                '',
                undefined,
                controller.signal
            )
        } finally {
            clearTimeout(timer)
        }
        afterAbort = await shell.run('printf abort-recovered', '', 30000)
        if (
            setup.code !== 0 ||
            state.code !== 0 ||
            state.stdout !== 'state-visible' ||
            !timeout.timedOut ||
            afterTimeout.code !== 0 ||
            afterTimeout.stdout !== 'timeout-recovered' ||
            !abort.aborted ||
            afterAbort.code !== 0 ||
            afterAbort.stdout !== 'abort-recovered'
        ) {
            throw new Error(
                'persistent shell state or interruption smoke failed'
            )
        }

        for (const name of disconnected.splice(0)) {
            const aliases = networks[name].Aliases ?? []
            const result = await docker(
                [
                    'network',
                    'connect',
                    ...aliases.flatMap((alias) => ['--alias', alias]),
                    name,
                    container
                ],
                30000
            )
            if (result.code !== 0) {
                throw new Error(
                    commandError(`docker network connect ${name}`, result)
                )
            }
        }
        const dns = await docker(
            [
                'exec',
                container,
                'sh',
                '-c',
                'printf "nameserver 8.8.8.8\\nnameserver 8.8.4.4\\n" > /etc/resolv.conf'
            ],
            30000
        )
        if (dns.code !== 0)
            throw new Error(commandError('docker DNS setup', dns))
        const curl = await docker(
            [
                'exec',
                container,
                'sh',
                '-c',
                'printf "http1.1\\nretry 5\\nretry-all-errors\\nretry-delay 2\\n" > "$HOME/.curlrc"'
            ],
            30000
        )
        if (curl.code !== 0) {
            throw new Error(commandError('docker curl setup', curl))
        }
        const makeTestsDir = await docker(
            ['exec', container, 'mkdir', '-p', '/tests'],
            30000
        )
        const copyRunTests = await docker(
            [
                'cp',
                join(task.dir, 'run-tests.sh'),
                `${container}:/tests/run-tests.sh`
            ],
            30000
        )
        const copyTests = task.testDirExists
            ? await docker(
                  [
                      'cp',
                      `${join(task.dir, 'tests')}${sep}.`,
                      `${container}:/tests`
                  ],
                  30000
              )
            : undefined
        if (
            makeTestsDir.code !== 0 ||
            copyRunTests.code !== 0 ||
            (copyTests && copyTests.code !== 0)
        ) {
            throw new Error('smoke could not copy the official verifier')
        }
        verifier = await shell.run(
            'bash /tests/run-tests.sh',
            '',
            task.maxTestTimeoutMs,
            undefined,
            proxy
                ? {
                      HTTP_PROXY: proxy,
                      HTTPS_PROXY: proxy,
                      ALL_PROXY: proxy
                  }
                : {}
        )
        await shell.run(
            'kill "$(cat /tmp/tb-same-shell-smoke.pid)" 2>/dev/null || true',
            '',
            30000
        )
    } catch (err) {
        error = err instanceof Error ? err.message : String(err)
    } finally {
        for (const name of disconnected) {
            await docker(
                [
                    'network',
                    'connect',
                    ...(networks[name]?.Aliases ?? []).flatMap((alias) => [
                        '--alias',
                        alias
                    ]),
                    name,
                    container
                ],
                30000
            )
        }
        await shell?.close()
        down = await compose(['down'], 120000)
    }
    const residual = await docker(
        ['ps', '-aq', '--filter', `name=^${container}$`],
        30000
    )
    return {
        taskId: task.id,
        setup,
        state,
        timeout,
        afterTimeout,
        abort,
        afterAbort,
        verifier: verifier
            ? {
                  exitCode: verifier.code,
                  timedOut: verifier.timedOut,
                  stdout: verifier.stdout,
                  stderr: verifier.stderr
              }
            : null,
        down: down ? { exitCode: down.code, timedOut: down.timedOut } : null,
        residualContainers: residual.stdout
            .split(/\r?\n/)
            .filter((value) => value.length > 0),
        passed:
            !error &&
            down?.code === 0 &&
            !down.timedOut &&
            !residual.stdout.trim(),
        error
    }
}

async function runSameShellSmoke(
    inventory: Inventory,
    proxy: string | undefined,
    taskIds?: string[]
) {
    const composeInfo = detectCompose()
    const dockerHost = await getDockerHost()
    const architecture = await getDockerArchitecture(true)
    const tasks = inventory.eligible.filter(
        (task) =>
            task.runTestsInSameShell && (!taskIds || taskIds.includes(task.id))
    )
    const rows = []
    for (const task of tasks) {
        rows.push(
            await runSameShellSmokeTask(
                task,
                composeInfo,
                dockerHost,
                architecture,
                proxy
            )
        )
    }
    return {
        command: 'same-shell-smoke',
        datasetName: inventory.datasetName,
        datasetVersion: inventory.datasetVersion,
        modelCalled: false,
        tasks: rows,
        passed: rows.length === 2 && rows.every((row) => row.passed)
    }
}

async function getDockerHost() {
    if (process.env.DOCKER_HOST) return process.env.DOCKER_HOST
    const context = await runProcess('docker', ['context', 'show'], {
        cwd: ROOT,
        timeoutMs: 10000
    })
    if (context.code !== 0) {
        throw new Error(commandError('docker context show', context))
    }
    const inspected = await runProcess(
        'docker',
        [
            'context',
            'inspect',
            '--format',
            '{{(index .Endpoints "docker").Host}}',
            context.stdout.trim()
        ],
        { cwd: ROOT, timeoutMs: 10000 }
    )
    if (inspected.code !== 0 || !inspected.stdout.trim()) {
        throw new Error(commandError('docker context inspect', inspected))
    }
    return inspected.stdout.trim()
}

async function getDockerArchitecture(required: boolean) {
    const info = await runProcess(
        'docker',
        ['info', '--format', '{{.Architecture}}'],
        { cwd: ROOT, timeoutMs: 30000 }
    )
    if (info.code === 0 && info.stdout.trim()) return info.stdout.trim()
    if (required) throw new Error(commandError('docker info', info))
    return 'unavailable'
}

async function auditUsageFixture(path: string, options: CliOptions) {
    const value = JSON.parse(await readFile(path, 'utf8')) as {
        runs: AgentTaskRun[]
        usageEvents: ModelUsagePayload[]
    }
    const conversationId = value.runs[0]?.conversationId ?? ''
    const aggregate = aggregateUsage(value.usageEvents, conversationId)
    const trace = taskTrace(value.runs, aggregate.audit.mainAgentCalls)
    if (options.expectTurns != null && trace.turns !== options.expectTurns) {
        throw new Error(
            `Usage fixture turns=${trace.turns}, expected ${options.expectTurns}`
        )
    }
    if (
        options.expectTotal != null &&
        aggregate.usage.total !== options.expectTotal
    ) {
        throw new Error(
            `Usage fixture total=${aggregate.usage.total}, expected ${options.expectTotal}`
        )
    }
    console.log(
        JSON.stringify({
            fixture: path,
            tokens: aggregate.usage,
            usageAudit: aggregate.audit,
            turns: trace.turns
        })
    )
}

async function main() {
    const options = parseArgs(process.argv.slice(2))
    if (options.usageFixture) {
        await auditUsageFixture(options.usageFixture, options)
        return
    }
    const config = readConfig()
    const clone = await findDatasetClone(config, options.datasetPath)
    const entry = await readRegistry(
        clone,
        options.datasetName,
        options.datasetVersion
    )
    const datasetPath = await prepareDataset(clone, entry)
    const inventory = await inventoryDataset(clone, datasetPath, entry)
    if (options.sameShellSmoke) {
        console.log(
            JSON.stringify(
                await runSameShellSmoke(
                    inventory,
                    options.proxy ?? process.env.CHATLUNA_EVAL_PROXY,
                    options.cases
                ),
                null,
                4
            )
        )
        return
    }
    const eligible = new Map(
        inventory.eligible.map((task) => [task.id, task] as const)
    )
    const requested = options.all
        ? inventory.eligible.map((task) => task.id)
        : (options.cases ?? DEFAULT_CASES)
    if (new Set(requested).size !== requested.length) {
        throw new Error('Task selection contains duplicate IDs')
    }
    const tasks = requested
        .map((id) => {
            const task = eligible.get(id)
            if (task) return task
            const excluded = inventory.excluded.find(
                (item) => item.taskId === id
            )
            if (excluded) {
                throw new Error(`Task ${id} is excluded: ${excluded.reason}`)
            }
            throw new Error(
                `Task ${id} is not in ${entry.name}==${entry.version}`
            )
        })
        .sort((left, right) =>
            left.id < right.id ? -1 : left.id > right.id ? 1 : 0
        )
        .filter((_, idx) => idx % options.shardCount === options.shardIndex)
    const paths =
        options.results.length > 0
            ? options.results
            : [
                  options.shardCount > 1
                      ? join(
                            ROOT,
                            '.tmp',
                            'agent-eval',
                            'results',
                            options.suiteId,
                            `shard-${options.shardIndex}.jsonl`
                        )
                      : DEFAULT_RESULTS
              ]

    if (options.command === 'aggregate') {
        const summary = aggregateSuite(
            await readResults(paths),
            inventory,
            options
        )
        const text = JSON.stringify(summary, null, 4) + '\n'
        if (options.aggregateOutput) {
            await mkdir(dirname(options.aggregateOutput), { recursive: true })
            await writeFile(options.aggregateOutput, text, 'utf8')
        }
        console.log(text.trimEnd())
        return
    }

    if (options.dryRun) {
        console.log(
            JSON.stringify(
                inventoryReport(
                    inventory,
                    await getDockerArchitecture(false),
                    tasks,
                    options
                ),
                null,
                4
            )
        )
        return
    }

    const completed = new Set(
        options.resume
            ? (await readResults([paths[0]], true))
                  .filter(
                      (row) =>
                          row.suiteId === options.suiteId &&
                          (row.state === 'pass' || row.state === 'fail')
                  )
                  .map((row) => `${row.taskId}\u0000${row.attempt}`)
            : []
    )
    if (
        options.resume &&
        tasks.every((task) =>
            Array.from({ length: options.attempts }, (_, idx) => idx + 1).every(
                (attempt) => completed.has(`${task.id}\u0000${attempt}`)
            )
        )
    ) {
        console.log(
            JSON.stringify({
                command: 'terminal',
                benchmark: 'terminal-bench',
                suiteId: options.suiteId,
                resumed: true,
                skipped: tasks.length * options.attempts,
                results: paths[0]
            })
        )
        return
    }

    const model = readModelConfig(config, options)
    const composeInfo = detectCompose()
    const dockerHost = await getDockerHost()
    const dockerArchitecture = await getDockerArchitecture(true)
    const proxy = options.proxy ?? process.env.CHATLUNA_EVAL_PROXY
    const runId = randomUUID()
    const revision = await gitRevision()
    const results: Result[] = []
    for (const task of tasks) {
        for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
            if (completed.has(`${task.id}\u0000${attempt}`)) {
                console.log(
                    JSON.stringify({
                        benchmark: 'terminal-bench',
                        suiteId: options.suiteId,
                        caseId: task.id,
                        attempt,
                        state: 'resume-skipped'
                    })
                )
                continue
            }
            const result = await runAttempt(
                task,
                runId,
                attempt,
                options,
                entry,
                model,
                revision,
                composeInfo,
                dockerHost,
                dockerArchitecture,
                proxy
            )
            await appendResult(paths[0], result, model.apiKey)
            results.push(result)
            console.log(
                JSON.stringify({
                    benchmark: 'terminal-bench',
                    runId,
                    suiteId: options.suiteId,
                    caseId: result.caseId,
                    attempt: result.attempt,
                    state: result.state,
                    score: result.score,
                    tokens: result.tokens,
                    toolCalls: result.toolCalls,
                    turns: result.turns,
                    wallMs: result.wallMs,
                    graderMs: result.graderMs,
                    error: result.error
                })
            )
        }
    }

    console.log(
        JSON.stringify({
            command: 'terminal',
            benchmark: 'terminal-bench',
            runId,
            suiteId: options.suiteId,
            datasetName: entry.name,
            datasetVersion: entry.version,
            datasetCommit: entry.commit_hash,
            datasetPath,
            officialTotal: inventory.officialTotal,
            eligible: inventory.eligible.length,
            excluded: inventory.excluded.length,
            cases: tasks.map((task) => task.id),
            attempts: options.attempts,
            model: model.fullName,
            results: paths[0],
            rows: results.map((item) => ({
                caseId: item.caseId,
                attempt: item.attempt,
                state: item.state,
                score: item.score,
                tokens: item.tokens,
                toolCalls: item.toolCalls,
                turns: item.turns,
                wallMs: item.wallMs,
                graderMs: item.graderMs,
                error: item.error
            }))
        })
    )
}

try {
    await main()
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
