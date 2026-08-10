import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync as readTextFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import {
    appendFile,
    cp,
    mkdir,
    readdir,
    readFile,
    rm,
    writeFile
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, type ParseError } from 'jsonc-parser'
import type { Session } from 'koishi'
import type {
    AgentRunContext,
    AgentTaskRun,
    AgentTaskSession
} from 'koishi-plugin-chatluna/llm-core/agent'
import type { ModelUsagePayload } from 'koishi-plugin-chatluna/llm-core/platform/usage'
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
const AGENT_TIMEOUT = 500000
const GRADER_TIMEOUT = 180000
const TASK_SETTLE_TIMEOUT = 10000
const DATASET_COMMIT = '7e0611e77b54e2dea774cdc0aa00cf9f7ed6144f'
const ALLOWED_TOOLS = new Set([
    'file_read',
    'file_write',
    'file_edit',
    'grep',
    'glob',
    'bash'
])

type ResultState = 'pass' | 'fail' | 'infra-failure'
type CompareAgent = 'opencode' | 'claude'

interface Result {
    runId: string
    suiteId: string
    datasetCommit: string
    suiteAttempts: number
    variant: 'candidate'
    benchmark: string
    caseId: string
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
    tokens: {
        input: number
        output: number
        reasoning: number
        cache: number
        total: number
    }
    localInputEstimate: number
    localOutputEstimate: number
    localTotalEstimate: number
    llmCalls: number
    reportedCalls: number
    reportedTotal: number
    reportedProviderInputTotal: number
    reportedProviderOutputTotal: number
    estimatedCalls: number
    missingProviderTotalEstimate: number
    reportedInputOutputDelta: number
    agentMs: number
    wallMs: number
    graderMs: number
    gitRevision: string
    error: string
}

interface BenchConfig {
    model: string
    modelConfigPath: string
    modelProvider: string
    modelName: string
    dataPaths: {
        terminal: string
        aider: string
    }
    aiderCases: string[]
}

interface ExerciseMeta {
    blurb: string
    files: {
        solution: string[]
        test: string[]
        example: string[]
    }
}

interface Exercise {
    id: string
    source: string
    meta: ExerciseMeta
    instructions: string
}

interface CliOptions {
    command: 'run' | 'suite' | 'report' | 'probe-timeout'
    cases?: string[]
    all: boolean
    dryRun: boolean
    attempts: number
    maxTurns: number
    timeoutMs: number
    compare: CompareAgent[]
    claudeModel?: string
    results: string[]
    suiteId: string
    suiteIdExplicit: boolean
    shardIndex: number
    shardCount: number
    resume: boolean
}

interface Inventory {
    datasetCommit: string
    scanned: number
    eligible: Exercise[]
    excluded: { id: string; reasons: string[] }[]
}

interface SuiteSummary {
    suiteId: string
    datasetCommit: string
    agent: string
    attempts: number
    eligible: number
    attempted: number
    pass: number
    fail: number
    infra: number
    verifierScorePercent: number
    statePassPercent: number
    tokens: {
        basis: 'reportedTotal'
        total: number
        average: number
        p50: number
        p95: number
    }
    tools: { average: number; p50: number; p95: number }
    turns: { average: number; p50: number; p95: number }
    agentLatency: {
        basis: 'agentMs'
        average: number
        p50: number
        p95: number
    }
    wallMs: {
        basis: 'wallMs'
        average: number
        p50: number
        p95: number
    }
    incomplete: string[]
}

interface ModelConfig {
    platform: string
    model: string
    fullName: string
    providerName: string
    providerNpm: string
    baseUrl: string
    apiKey: string
}

interface CommandResult {
    code: number | null
    signal: string | null
    stdout: string
    stderr: string
    timedOut: boolean
    error?: string
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
    includesScratchpadCompression: boolean
    llmCalls: number
    reportedCalls: number
    estimatedCalls: number
    mainAgentCalls: number
    compressionCalls: number
}

interface TraceStats {
    toolCalls: number
    turns: number
    duplicateCalls: number
    invalidCalls: number
    toolErrors: number
    networkBlocked: number
    trace: unknown[]
}

interface NetworkPolicyDiagnostic {
    policy: 'block'
    enforcement: 'production-sandbox'
    backend: 'bwrap' | 'sandbox-exec'
    blockedAttempts: number
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
    localInputEstimate: number
    localOutputEstimate: number
    localTotalEstimate: number
    llmCalls: number
    reportedCalls: number
    reportedTotal: number
    reportedProviderInputTotal: number
    reportedProviderOutputTotal: number
    estimatedCalls: number
    missingProviderTotalEstimate: number
    reportedInputOutputDelta: number
    usageEvents: unknown[]
    trace: TraceStats
    networkPolicy: NetworkPolicyDiagnostic
    agentMs: number
    error: string
    infraFailure: boolean
}

interface ExternalEvidence {
    output: string
    sessionId: string
    conversationId: string
    usage: TokenTotals
    timing: TimingTotals
    reportedCalls: number
    estimatedCalls: number
    missingProviderTotalEstimate: number
    reportedInputOutputDelta: number
    eventCount: number
    toolCalls: number
    turns: number
    audit: unknown[]
    error: string
    infraFailure: boolean
}

function readConfig(): BenchConfig {
    return JSON.parse(readTextFileSync(CONFIG_PATH, 'utf8')) as BenchConfig
}

function parseArgs(args: string[]): CliOptions {
    if (args[0] === '--help' || args[0] === 'help') {
        console.log(
            'Usage: aider-eval.ts [run|suite|report|probe-timeout] [--all | --cases grade-school,...] ' +
                '[--attempts N] [--max-turns N] [--timeout seconds] ' +
                '[--compare none|opencode|claude|opencode,claude] ' +
                '[--claude-model model] [--suite-id id] ' +
                '[--shard-index N --shard-count N] [--resume] ' +
                '[--dry-run] [--results path ...]'
        )
        process.exit(0)
    }

    const command: CliOptions['command'] =
        args[0] === 'probe-timeout'
            ? 'probe-timeout'
            : args[0] === 'suite' || args[0] === 'inventory'
              ? 'suite'
              : args[0] === 'report'
                ? 'report'
                : 'run'
    const start =
        args[0] === 'run' ||
        args[0] === 'suite' ||
        args[0] === 'inventory' ||
        args[0] === 'report' ||
        args[0] === 'probe-timeout'
            ? 1
            : 0
    let cases: string[] | undefined
    let all = false
    let dryRun = false
    let attempts = 1
    let maxTurns = 100
    let timeoutMs = AGENT_TIMEOUT
    let compare: CompareAgent[] = []
    let claudeModel: string | undefined
    const results: string[] = []
    let suiteId = `aider-js-${DATASET_COMMIT.slice(0, 12)}`
    let suiteIdExplicit = false
    let shardIndex = 0
    let shardCount = 1
    let resume = false

    for (let idx = start; idx < args.length; idx += 1) {
        const arg = args[idx]
        const equal = arg.indexOf('=')
        const key = equal < 0 ? arg : arg.slice(0, equal)
        if (key === '--all' || key === '--dry-run' || key === '--resume') {
            if (equal >= 0) throw new Error(`${key} does not accept a value`)
            if (key === '--all') all = true
            if (key === '--dry-run') dryRun = true
            if (key === '--resume') resume = true
            continue
        }
        let value = equal < 0 ? undefined : arg.slice(equal + 1)
        if (value === undefined) {
            value = args[idx + 1]
            idx += 1
        }
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for ${key}`)
        }

        if (key === '--cases') {
            cases = value
                .split(',')
                .map((item) => item.trim())
                .filter((item) => item.length > 0)
            if (cases.length < 1) throw new Error('--cases cannot be empty')
            continue
        }
        if (key === '--attempts' || key === '--max-turns') {
            const parsed = Number(value)
            if (!Number.isInteger(parsed) || parsed < 1) {
                throw new Error(`${key} must be a positive integer`)
            }
            if (key === '--attempts') attempts = parsed
            else maxTurns = parsed
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
        if (key === '--compare') {
            if (value === 'none') {
                compare = []
                continue
            }
            const selected = value.split(',')
            if (
                selected.some(
                    (item) => item !== 'opencode' && item !== 'claude'
                )
            ) {
                throw new Error(
                    '--compare must be none, opencode, claude, or opencode,claude'
                )
            }
            compare = [...new Set(selected)] as CompareAgent[]
            continue
        }
        if (key === '--claude-model') {
            claudeModel = value
            continue
        }
        if (key === '--results') {
            results.push(resolve(ROOT, value))
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
    if (!suiteId.trim()) throw new Error('--suite-id cannot be empty')
    if (command !== 'report' && results.length > 1) {
        throw new Error('run and suite accept only one --results path')
    }

    return {
        command,
        cases,
        all,
        dryRun,
        attempts,
        maxTurns,
        timeoutMs,
        compare,
        claudeModel,
        results: results.length > 0 ? results : [DEFAULT_RESULTS],
        suiteId,
        suiteIdExplicit,
        shardIndex,
        shardCount,
        resume
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
        throw new Error(`${name} is missing from the selected OpenCode config`)
    }
    return value
}

function readModelConfig(config: BenchConfig): ModelConfig {
    const path = expandPath(config.modelConfigPath)
    const text = readTextFileSync(path, 'utf8')
    const errors: ParseError[] = []
    const document = parse(text, errors, { allowTrailingComma: true })
    if (errors.length > 0) {
        throw new Error(`OpenCode JSONC has ${errors.length} parse error(s)`)
    }

    const providers = isRecord(document) ? document.provider : undefined
    if (!isRecord(providers)) {
        throw new Error('OpenCode JSONC provider object is missing')
    }

    const platform = process.env.CHATLUNA_EVAL_PLATFORM ?? config.modelProvider
    const model = process.env.CHATLUNA_EVAL_MODEL ?? config.modelName
    const selected = providers[platform]
    if (!isRecord(selected)) {
        throw new Error(`OpenCode provider is not configured: ${platform}`)
    }

    const options = selected.options
    if (!isRecord(options)) {
        throw new Error(`OpenCode provider options are missing: ${platform}`)
    }

    const models = selected.models
    const configuredModel = isRecord(models) && model in models
    if (!configuredModel && !process.env.CHATLUNA_EVAL_MODEL) {
        throw new Error(
            `OpenCode model is not configured: ${platform}/${model}`
        )
    }

    const baseUrl = stringValue(
        process.env.CHATLUNA_EVAL_BASE_URL ?? options.baseURL,
        'baseURL'
    )
    const apiKey = stringValue(
        process.env.CHATLUNA_EVAL_API_KEY ?? options.apiKey,
        'apiKey'
    )

    return {
        platform,
        model,
        fullName: `${platform}/${model}`,
        providerName: stringValue(selected.name, 'provider name'),
        providerNpm: stringValue(selected.npm, 'provider npm'),
        baseUrl,
        apiKey
    }
}

function redact(text: string, apiKey: string) {
    return apiKey.length > 0 ? text.split(apiKey).join('[REDACTED]') : text
}

async function saveText(path: string, text: string, apiKey: string) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, redact(text, apiKey), 'utf8')
}

async function runCommand(
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv }
): Promise<CommandResult> {
    return await new Promise((resolve) => {
        const env = { ...(options.env ?? process.env) }
        delete env.CHATLUNA_EVAL_API_KEY
        if (!options.env) delete env.CHATLUNA_COMPARE_API_KEY
        const child = spawn(command, args, {
            cwd: options.cwd,
            env,
            stdio: ['ignore', 'pipe', 'pipe']
        })
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        let timedOut = false
        let timer: NodeJS.Timeout | undefined

        child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
        child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
        if (options.timeoutMs > 0) {
            timer = setTimeout(() => {
                timedOut = true
                child.kill('SIGTERM')
            }, options.timeoutMs)
        }

        child.on('error', (error) => {
            if (timer) clearTimeout(timer)
            resolve({
                code: null,
                signal: null,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
                timedOut,
                error: error.message
            })
        })
        child.on('close', (code, signal) => {
            if (timer) clearTimeout(timer)
            resolve({
                code,
                signal,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8'),
                timedOut
            })
        })
    })
}

async function loadExercise(id: string, dataRoot: string): Promise<Exercise> {
    const source = join(dataRoot, 'javascript', 'exercises', 'practice', id)
    const meta = JSON.parse(
        await readFile(join(source, '.meta', 'config.json'), 'utf8')
    ) as ExerciseMeta
    const instructions = await readFile(
        join(source, '.docs', 'instructions.md'),
        'utf8'
    ).catch(() => '')
    return { id, source, meta, instructions }
}

async function loadInventory(dataRoot: string): Promise<Inventory> {
    const revision = await runCommand('git', ['rev-parse', 'HEAD'], {
        cwd: dataRoot,
        timeoutMs: 10000
    })
    if (revision.code !== 0 || revision.stdout.trim() !== DATASET_COMMIT) {
        throw new Error(
            `Aider dataset must be checked out at ${DATASET_COMMIT}; found ${revision.stdout.trim() || 'unknown'}`
        )
    }
    const status = await runCommand(
        'git',
        ['status', '--porcelain', '--', 'javascript/exercises/practice'],
        { cwd: dataRoot, timeoutMs: 10000 }
    )
    if (status.code !== 0 || status.stdout.trim()) {
        throw new Error('Aider JavaScript practice dataset has local changes')
    }

    const root = join(dataRoot, 'javascript', 'exercises', 'practice')
    const ids = (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
    const eligible: Exercise[] = []
    const excluded: Inventory['excluded'] = []

    for (const id of ids) {
        let exercise: Exercise
        try {
            exercise = await loadExercise(id, dataRoot)
        } catch (err) {
            excluded.push({
                id,
                reasons: [
                    `loadExercise failed: ${err instanceof Error ? err.message : String(err)}`
                ]
            })
            continue
        }

        const reasons: string[] = []
        if (!exercise.instructions.trim()) reasons.push('missing instructions')
        if (exercise.meta.files.solution.length === 0) {
            reasons.push('missing solution files')
        }
        if (exercise.meta.files.test.length === 0) {
            reasons.push('missing official grader/spec')
        }
        for (const file of [
            ...exercise.meta.files.solution,
            ...exercise.meta.files.test
        ]) {
            try {
                await readFile(join(exercise.source, file))
            } catch {
                reasons.push(`missing declared file: ${file}`)
            }
        }
        try {
            const pkg = JSON.parse(
                await readFile(join(exercise.source, 'package.json'), 'utf8')
            ) as { scripts?: { test?: string } }
            if (!pkg.scripts?.test) reasons.push('missing official test script')
        } catch (err) {
            reasons.push(
                `package grader failed to load: ${err instanceof Error ? err.message : String(err)}`
            )
        }

        if (reasons.length > 0) {
            excluded.push({ id, reasons })
            continue
        }
        eligible.push(exercise)
    }

    return {
        datasetCommit: DATASET_COMMIT,
        scanned: ids.length,
        eligible,
        excluded
    }
}

function selectExercises(
    inventory: Inventory,
    options: CliOptions,
    config: BenchConfig
) {
    const selected =
        options.all || (options.command === 'suite' && !options.cases)
            ? inventory.eligible
            : [...new Set(options.cases ?? config.aiderCases)]
                  .map((id) => {
                      const exercise = inventory.eligible.find(
                          (item) => item.id === id
                      )
                      if (!exercise) {
                          const excluded = inventory.excluded.find(
                              (item) => item.id === id
                          )
                          throw new Error(
                              excluded
                                  ? `Ineligible Aider case ${id}: ${excluded.reasons.join('; ')}`
                                  : `Unknown Aider case: ${id}`
                          )
                      }
                      return exercise
                  })
                  .sort((left, right) =>
                      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
                  )
    return selected.filter(
        (_exercise, idx) => idx % options.shardCount === options.shardIndex
    )
}

function inventoryOutput(
    inventory: Inventory,
    selected: Exercise[],
    options: CliOptions
) {
    return {
        command: 'suite',
        suiteId: options.suiteId,
        datasetCommit: inventory.datasetCommit,
        scanned: inventory.scanned,
        eligible: inventory.eligible.length,
        excluded: inventory.excluded.length,
        eligibleTasks: inventory.eligible.map((exercise) => exercise.id),
        exclusions: inventory.excluded,
        shardIndex: options.shardIndex,
        shardCount: options.shardCount,
        selected: selected.length,
        selectedTasks: selected.map((exercise) => exercise.id)
    }
}

function relativeName(path: string) {
    return path.split(sep).join('/')
}

function excludedFromAgent(path: string, exercise: Exercise) {
    const name = relativeName(path)
    const forbidden = new Set([
        ...exercise.meta.files.test,
        ...exercise.meta.files.example
    ])
    if (name === '.meta' || name.startsWith('.meta/')) return true
    if (forbidden.has(name)) return true
    return (
        name.endsWith('.spec.js') ||
        name.includes('/test/') ||
        name.includes('/tests/') ||
        name.includes('/spec/') ||
        name.includes('/specs/')
    )
}

async function copyAgentWorkspace(exercise: Exercise, target: string) {
    await rm(target, { recursive: true, force: true })
    await mkdir(target, { recursive: true })
    await cp(exercise.source, target, {
        recursive: true,
        filter: (source) => {
            const name = relativeName(relative(exercise.source, source))
            return name.length === 0 || !excludedFromAgent(name, exercise)
        }
    })
}

async function copyGraderWorkspace(exercise: Exercise, target: string) {
    await rm(target, { recursive: true, force: true })
    await cp(exercise.source, target, { recursive: true })
}

async function hideGraderFiles(exercise: Exercise, graderDir: string) {
    await rm(join(graderDir, '.meta'), { recursive: true, force: true })
    for (const file of [
        ...exercise.meta.files.test,
        ...exercise.meta.files.example
    ]) {
        await rm(join(graderDir, file), { recursive: true, force: true })
    }
}

async function copySolutions(exercise: Exercise, from: string, to: string) {
    for (const file of exercise.meta.files.solution) {
        const source = join(from, file)
        const target = join(to, file)
        await mkdir(dirname(target), { recursive: true })
        await cp(source, target, { recursive: true })
    }
}

function emptyTokens(): TokenTotals {
    return { input: 0, output: 0, reasoning: 0, cache: 0, total: 0 }
}

function emptyTiming(): TimingTotals {
    return { ttftMs: 0, totalMs: 0 }
}

export function aggregateUsage(
    events: ModelUsagePayload[],
    compressionConversationId: string
) {
    const usage = emptyTokens()
    const timing = emptyTiming()
    let llmCalls = 0
    let reportedCalls = 0
    let localInputEstimate = 0
    let localOutputEstimate = 0
    let estimatedCalls = 0
    let missingProviderTotalEstimate = 0
    let mainAgentCalls = 0
    let compressionCalls = 0

    for (const item of events) {
        if (item.callType !== 'llm') continue

        timing.ttftMs += item.timing?.ttftMs ?? 0
        timing.totalMs += item.timing?.totalMs ?? 0
        localInputEstimate += item.localInputTokens ?? 0
        localOutputEstimate += item.localOutputTokens ?? 0
        llmCalls += 1
        if (item.estimated) {
            estimatedCalls += 1
            missingProviderTotalEstimate += item.usageMetadata.total_tokens
        } else {
            usage.input += item.usageMetadata.input_tokens
            usage.output += item.usageMetadata.output_tokens
            usage.reasoning +=
                item.usageMetadata.output_token_details?.reasoning ?? 0
            usage.cache +=
                item.usageMetadata.input_token_details?.cache_read ?? 0
            usage.total += item.usageMetadata.total_tokens
            reportedCalls += 1
        }

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
        localInputEstimate,
        localOutputEstimate,
        localTotalEstimate: localInputEstimate + localOutputEstimate,
        llmCalls,
        reportedCalls,
        reportedTotal: usage.total,
        reportedProviderInputTotal: usage.input,
        reportedProviderOutputTotal: usage.output,
        estimatedCalls,
        missingProviderTotalEstimate,
        reportedInputOutputDelta: usage.input + usage.output - usage.total,
        audit: {
            scope: 'case' as const,
            callType: 'llm' as const,
            includesScratchpadCompression: compressionCalls > 0,
            llmCalls,
            reportedCalls,
            estimatedCalls,
            mainAgentCalls,
            compressionCalls
        } satisfies UsageAudit
    }
}

function taskTrace(runs: AgentTaskRun[]): TraceStats {
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
        if (!call.tool || !ALLOWED_TOOLS.has(call.tool)) invalidCalls += 1
    }

    for (const result of trace.filter((item) => item.type === 'tool-result')) {
        if (result.callId && !callIds.has(result.callId)) invalidCalls += 1
    }

    const toolErrors = trace.filter(
        (item) =>
            item.type === 'tool-result' &&
            [
                'command exited with code',
                'command execution failed',
                'permission denied',
                'permission-denied',
                'not valid',
                'error:',
                'chatluna_eval_network_blocked',
                'network access blocked'
            ].some((marker) => item.text.toLowerCase().includes(marker))
    ).length
    const networkBlocked = trace.filter(
        (item) =>
            item.type === 'tool-result' &&
            item.text.toLowerCase().includes('chatluna_eval_network_blocked')
    ).length

    return {
        toolCalls: runs.reduce((sum, run) => sum + run.toolCount, 0),
        turns: runs.reduce((sum, run) => sum + run.turnCount, 0),
        duplicateCalls,
        invalidCalls,
        toolErrors,
        networkBlocked,
        trace
    }
}

function snapshotRun(run: AgentTaskRun) {
    return {
        ...run,
        trace: run.trace.map((item) => ({ ...item }))
    }
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

function emptyCandidateEvidence(
    error: string,
    infraFailure = true
): CandidateEvidence {
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
            includesScratchpadCompression: false,
            llmCalls: 0,
            reportedCalls: 0,
            estimatedCalls: 0,
            mainAgentCalls: 0,
            compressionCalls: 0
        },
        localInputEstimate: 0,
        localOutputEstimate: 0,
        localTotalEstimate: 0,
        llmCalls: 0,
        reportedCalls: 0,
        reportedTotal: 0,
        reportedProviderInputTotal: 0,
        reportedProviderOutputTotal: 0,
        estimatedCalls: 0,
        missingProviderTotalEstimate: 0,
        reportedInputOutputDelta: 0,
        usageEvents: [],
        trace: {
            toolCalls: 0,
            turns: 0,
            duplicateCalls: 0,
            invalidCalls: 0,
            toolErrors: 0,
            networkBlocked: 0,
            trace: []
        },
        networkPolicy: {
            policy: 'block',
            enforcement: 'production-sandbox',
            backend: process.platform === 'darwin' ? 'sandbox-exec' : 'bwrap',
            blockedAttempts: 0
        },
        agentMs: 0,
        error,
        infraFailure
    }
}

async function waitTask(
    task: Promise<string>,
    controller: AbortController,
    timeoutMs: number,
    settleMs = TASK_SETTLE_TIMEOUT
) {
    const message = `agent timeout after ${timeoutMs}ms`
    let timer: NodeJS.Timeout | undefined
    let timedOut = false
    const timeout = new Promise<string>((_resolve, reject) => {
        timer = setTimeout(() => {
            timedOut = true
            controller.abort(new Error(message))
            reject(new Error(message))
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

    let settled = true
    if (timedOut) {
        let settleTimer: NodeJS.Timeout | undefined
        settled = await Promise.race([
            task.then(
                () => true,
                () => true
            ),
            new Promise<boolean>((resolve) => {
                settleTimer = setTimeout(() => resolve(false), settleMs)
            })
        ])
        if (settleTimer) clearTimeout(settleTimer)
        error = message
        if (!settled) {
            error += `; agent task did not settle within ${settleMs}ms after abort`
        }
    }

    return { output, error, timedOut, settled }
}

async function timeoutProbe() {
    const controller = new AbortController()
    const events: ModelUsagePayload[] = []
    const startedAt = Date.now()
    const run: AgentTaskRun = {
        runId: 'probe-run',
        taskId: 'probe-task',
        agentId: 'probe-agent',
        agentName: 'probe-agent',
        conversationId: 'probe-conversation',
        parentConversationId: 'probe-parent',
        depth: 1,
        state: 'running',
        startedAt,
        toolCount: 0,
        turnCount: 2,
        trace: []
    }
    let abortAt = 0
    let usageAt = 0
    let listening = true
    const task = new Promise<string>((_resolve, reject) => {
        controller.signal.addEventListener(
            'abort',
            () => {
                abortAt = Date.now()
                setTimeout(() => {
                    usageAt = Date.now()
                    if (listening) {
                        events.push({
                            source: 'chatluna-agent',
                            callType: 'llm',
                            platform: 'probe',
                            model: 'probe',
                            usageMetadata: {
                                input_tokens: 11,
                                output_tokens: 7,
                                total_tokens: 17
                            },
                            localInputTokens: 13,
                            localOutputTokens: 5,
                            estimated: false,
                            success: true,
                            createdAt: new Date(),
                            context: {
                                conversationId: run.conversationId
                            }
                        })
                        events.push({
                            source: 'chatluna-agent',
                            callType: 'llm',
                            platform: 'probe',
                            model: 'probe',
                            usageMetadata: {
                                input_tokens: 5,
                                output_tokens: 3,
                                total_tokens: 8
                            },
                            localInputTokens: 5,
                            localOutputTokens: 3,
                            estimated: true,
                            success: false,
                            createdAt: new Date(),
                            context: {
                                conversationId: run.conversationId
                            }
                        })
                    }
                    run.state = 'aborted'
                    run.error = 'probe aborted'
                    run.endedAt = Date.now()
                    reject(controller.signal.reason)
                }, 20)
            },
            { once: true }
        )
    })
    const outcome = await waitTask(task, controller, 5, 100)
    listening = false
    const usage = aggregateUsage(events, 'probe-compression')
    const trace = taskTrace([run])
    const result = {
        command: 'probe-timeout',
        defaultAgentTimeoutMs: parseArgs([]).timeoutMs,
        explicitAgentTimeoutMs: parseArgs(['run', '--timeout', '123'])
            .timeoutMs,
        timedOut: outcome.timedOut,
        settled: outcome.settled,
        runState: run.state,
        infraFailure: outcome.timedOut || outcome.error.length > 0,
        lateUsageCaptured: usageAt >= abortAt && events.length === 2,
        tokens: usage.usage,
        localInputEstimate: usage.localInputEstimate,
        localOutputEstimate: usage.localOutputEstimate,
        localTotalEstimate: usage.localTotalEstimate,
        llmCalls: usage.llmCalls,
        reportedCalls: usage.reportedCalls,
        reportedTotal: usage.reportedTotal,
        reportedProviderInputTotal: usage.reportedProviderInputTotal,
        reportedProviderOutputTotal: usage.reportedProviderOutputTotal,
        estimatedCalls: usage.estimatedCalls,
        missingProviderTotalEstimate: usage.missingProviderTotalEstimate,
        reportedInputOutputDelta: usage.reportedInputOutputDelta,
        turns: trace.turns
    }
    const legacy = baseResult(
        'probe-run',
        'probe-case',
        1,
        'chatluna',
        { suiteId: 'probe-suite', attempts: 1 } as CliOptions,
        { fullName: 'probe' } as ModelConfig,
        'probe'
    )
    legacy.tokens.total = 25
    legacy.reportedTotal = result.reportedTotal
    legacy.agentMs = 137
    legacy.wallMs = 311
    const summary = summarizeSuite('probe-suite', 'chatluna', [legacy], {
        datasetCommit: DATASET_COMMIT,
        scanned: 1,
        eligible: [{ id: 'probe-case' } as Exercise],
        excluded: []
    })
    const notStarted = {
        ...legacy,
        caseId: 'probe-not-started',
        agentMs: 0
    }
    const mixedLatency = summarizeSuite(
        'probe-suite',
        'chatluna',
        [legacy, notStarted],
        {
            datasetCommit: DATASET_COMMIT,
            scanned: 2,
            eligible: [
                { id: 'probe-case' } as Exercise,
                { id: 'probe-not-started' } as Exercise
            ],
            excluded: []
        }
    ).agentLatency
    const emptyLatency = summarizeSuite(
        'probe-suite',
        'chatluna',
        [notStarted],
        {
            datasetCommit: DATASET_COMMIT,
            scanned: 1,
            eligible: [{ id: 'probe-not-started' } as Exercise],
            excluded: []
        }
    ).agentLatency
    const external = parseExternal(
        [
            {
                type: 'step_start',
                part: { type: 'step-start', id: 'turn-1' }
            },
            {
                type: 'step_finish',
                part: {
                    type: 'step-finish',
                    id: 'turn-1',
                    tokens: { input: 7, output: 3, total: 10 }
                }
            },
            {
                type: 'step_start',
                part: { type: 'step-start', id: 'turn-2' }
            },
            {
                type: 'step_start',
                part: { type: 'step-start', id: 'turn-3' }
            }
        ]
            .map((item) => JSON.stringify(item))
            .join('\n'),
        '',
        0,
        false,
        Date.now(),
        ''
    )
    const unknownTurns = parseExternal(
        JSON.stringify({
            type: 'message',
            usage: { input: 2, output: 1, total: 3 }
        }),
        '',
        0,
        false,
        Date.now(),
        ''
    )

    if (
        result.defaultAgentTimeoutMs !== 500000 ||
        result.explicitAgentTimeoutMs !== 123000 ||
        !result.timedOut ||
        !result.settled ||
        result.runState !== 'aborted' ||
        !result.infraFailure ||
        !result.lateUsageCaptured ||
        result.tokens.input !== 11 ||
        result.tokens.output !== 7 ||
        result.tokens.total !== 17 ||
        result.localInputEstimate !== 18 ||
        result.localOutputEstimate !== 8 ||
        result.localTotalEstimate !== 26 ||
        result.llmCalls !== 2 ||
        result.reportedCalls !== 1 ||
        result.reportedTotal !== 17 ||
        result.reportedProviderInputTotal !== 11 ||
        result.reportedProviderOutputTotal !== 7 ||
        result.estimatedCalls !== 1 ||
        result.missingProviderTotalEstimate !== 8 ||
        result.reportedInputOutputDelta !== 1 ||
        result.reportedCalls + result.estimatedCalls !== result.llmCalls ||
        result.turns !== 2 ||
        summary.tokens.basis !== 'reportedTotal' ||
        summary.tokens.total !== 17 ||
        summary.tokens.average !== 17 ||
        summary.tokens.p50 !== 17 ||
        summary.tokens.p95 !== 17 ||
        summary.agentLatency.basis !== 'agentMs' ||
        summary.agentLatency.average !== 137 ||
        summary.agentLatency.p50 !== 137 ||
        summary.agentLatency.p95 !== 137 ||
        mixedLatency.average !== 137 ||
        mixedLatency.p50 !== 137 ||
        mixedLatency.p95 !== 137 ||
        emptyLatency.average !== 0 ||
        emptyLatency.p50 !== 0 ||
        emptyLatency.p95 !== 0 ||
        external.turns !== 3 ||
        external.reportedCalls !== 1 ||
        external.estimatedCalls !== 2 ||
        external.usage.total !== 10 ||
        external.missingProviderTotalEstimate !== 0 ||
        unknownTurns.turns !== 0 ||
        unknownTurns.reportedCalls !== 1 ||
        unknownTurns.estimatedCalls !== 0 ||
        unknownTurns.usage.total !== 3 ||
        unknownTurns.missingProviderTotalEstimate !== 0 ||
        summary.wallMs.basis !== 'wallMs' ||
        summary.wallMs.average !== 311 ||
        summary.wallMs.p50 !== 311 ||
        summary.wallMs.p95 !== 311
    ) {
        throw new Error(
            `Synthetic timeout probe failed: ${JSON.stringify(result)}`
        )
    }
    console.log(
        JSON.stringify({
            ...result,
            summaryTokens: summary.tokens,
            summaryAgentLatency: summary.agentLatency,
            mixedAgentLatency: mixedLatency,
            emptyAgentLatency: emptyLatency,
            externalUsage: {
                turns: external.turns,
                reportedCalls: external.reportedCalls,
                estimatedCalls: external.estimatedCalls,
                reportedTotal: external.usage.total,
                missingProviderTotalEstimate:
                    external.missingProviderTotalEstimate
            },
            unknownTurnUsage: {
                turns: unknownTurns.turns,
                reportedCalls: unknownTurns.reportedCalls,
                estimatedCalls: unknownTurns.estimatedCalls,
                reportedTotal: unknownTurns.usage.total,
                missingProviderTotalEstimate:
                    unknownTurns.missingProviderTotalEstimate
            },
            summaryWallMs: summary.wallMs
        })
    )
}

async function runChatluna(
    exercise: Exercise,
    runId: string,
    agentDir: string,
    baseDir: string,
    options: CliOptions,
    model: ModelConfig
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
                    local: {
                        enabled: true,
                        sandboxMode: 'workspace-write',
                        approvalMode: 'never',
                        dangerouslySkipPermissions: false,
                        scopePath: agentDir,
                        networkPolicy: 'block'
                    }
                }
            },
            null,
            4
        ) + '\n',
        'utf8'
    )

    const savedHome = process.env.HOME
    const savedXdg = process.env.XDG_CONFIG_HOME
    const savedEvalKey = process.env.CHATLUNA_EVAL_API_KEY
    const isolatedHome = join(baseDir, 'agent-home')
    await mkdir(isolatedHome, { recursive: true })
    const networkPolicy: NetworkPolicyDiagnostic = {
        policy: 'block',
        enforcement: 'production-sandbox',
        backend: process.platform === 'darwin' ? 'sandbox-exec' : 'bwrap',
        blockedAttempts: 0
    }
    process.env.HOME = isolatedHome
    process.env.XDG_CONFIG_HOME = join(isolatedHome, '.config')
    delete process.env.CHATLUNA_EVAL_API_KEY

    const app = new KoishiContext()
    app.baseDir = baseDir
    const forks = []
    let registration: { dispose: () => Promise<void> } | undefined
    let offUsage: (() => void) | undefined
    const usageEvents: ModelUsagePayload[] = []
    let session: Session | undefined
    let agentMs = 0

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
                platform: model.platform,
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
        const userId = `aider-eval-${randomUUID()}`
        await app.mock.initUser(userId, 4)
        const client = app.mock.client(userId)
        if (!(client instanceof MessageClient)) {
            throw new Error('MockBot did not return an official MessageClient')
        }
        if (!(app.bots[0] instanceof MockBot)) {
            throw new Error('MockBot was not registered as the active bot')
        }
        await client.receive(`aider evaluation session ${randomUUID()}`)
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
        if (!llm)
            throw new Error(`ChatLuna model is unavailable: ${model.fullName}`)
        const toolMask = await app.chatluna.resolveToolMask({
            session,
            conversation,
            bindingKey: conversation.bindingKey
        })
        const requestId = randomUUID()
        const preset = app.chatluna.preset.getPreset(conversation.preset).value
        const agentContext: AgentRunContext = {
            kind: 'main',
            agentId: conversation.id,
            agentName: preset.triggerKeyword[0] ?? conversation.id,
            conversationId: conversation.id,
            requestId,
            source: 'chatluna',
            userId: session.userId,
            guildId: session.guildId,
            channelId: session.channelId,
            toolMask
        }

        registration = await app.chatluna_agent.subAgent.registerManualAgent({
            id: 'aider-coder',
            name: 'aider-coder',
            description: 'Aider Polyglot JavaScript coding agent',
            promptContent: [
                'Work as a coding agent in the current workspace.',
                'Implement the exercise in the listed solution files.',
                'Read .docs/instructions.md for the exercise requirements.',
                'Do not look for, access, recreate, or infer hidden tests, spec files, .meta files, or reference examples.',
                'Use only the registered file and local computer tools, and keep all changes inside the workspace.',
                'Finish with the implementation in the workspace.'
            ].join('\n'),
            enabled: true,
            format: 'chatluna',
            maxTurns: options.maxTurns,
            allowKoishiMessageTransform: false,
            permissions: {
                skills: { mode: 'deny', allow: [], deny: [] },
                mcp: { mode: 'deny', allow: [], deny: [] },
                tools: {
                    mode: 'allow',
                    allow: [...ALLOWED_TOOLS],
                    deny: []
                },
                computer: { mode: 'allow', allow: ['local'], deny: [] }
            }
        })

        const prompt = [
            `Exercise: ${exercise.id}`,
            `Goal: ${exercise.meta.blurb}`,
            `Solution files: ${exercise.meta.files.solution.join(', ')}`,
            exercise.instructions,
            'Implement the complete solution now. Do not modify or create tests.'
        ]
            .filter((item) => item.length > 0)
            .join('\n\n')
        const controller = new AbortController()
        const startedAt = Date.now()
        const task = app.chatluna_agent.subAgent.runTask(
            {
                action: 'run',
                agent: 'aider-coder',
                prompt,
                goal: exercise.meta.blurb,
                background: false
            },
            {
                signal: controller.signal,
                configurable: { model: llm, session, agentContext }
            }
        )
        const outcome = await waitTask(
            task,
            controller,
            options.timeoutMs
        ).finally(() => {
            agentMs = Date.now() - startedAt
        })

        const runs = app.chatluna_agent.subAgent.getRuns()
        const tasks = app.chatluna_agent.subAgent.getTasks()
        const selectedRuns = runs.filter(
            (run) =>
                run.parentConversationId === conversation.id &&
                run.agentName === 'aider-coder' &&
                run.startedAt >= startedAt - 1
        )
        if (outcome.timedOut && !outcome.settled) {
            for (const run of selectedRuns) {
                if (run.state !== 'running') continue
                run.state = 'aborted'
                run.error = outcome.error
                run.endedAt = Date.now()
                run.trace.push({
                    id: `${run.runId}:error`,
                    type: 'error',
                    at: run.endedAt,
                    title: '运行中止等待超时',
                    text: outcome.error
                })
            }
        }
        const selectedTasks = tasks.filter(
            (item) => item.parentConversationId === conversation.id
        )
        const latest = [...selectedRuns].sort(
            (left, right) => right.startedAt - left.startedAt
        )[0]
        const subagentConversationId =
            latest?.conversationId ?? selectedTasks[0]?.conversationId ?? ''
        const aggregate = aggregateUsage(usageEvents, subagentConversationId)
        const trace = taskTrace(selectedRuns)
        networkPolicy.blockedAttempts = trace.networkBlocked
        const runState =
            latest?.state ?? (outcome.error ? 'failed' : 'completed')
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
                localInputTokens: item.localInputTokens,
                localOutputTokens: item.localOutputTokens,
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
        offUsage?.()
        offUsage = undefined

        return {
            output: outcome.output,
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
            localInputEstimate: aggregate.localInputEstimate,
            localOutputEstimate: aggregate.localOutputEstimate,
            localTotalEstimate: aggregate.localTotalEstimate,
            llmCalls: aggregate.llmCalls,
            reportedCalls: aggregate.reportedCalls,
            reportedTotal: aggregate.reportedTotal,
            reportedProviderInputTotal: aggregate.reportedProviderInputTotal,
            reportedProviderOutputTotal: aggregate.reportedProviderOutputTotal,
            estimatedCalls: aggregate.estimatedCalls,
            missingProviderTotalEstimate:
                aggregate.missingProviderTotalEstimate,
            reportedInputOutputDelta: aggregate.reportedInputOutputDelta,
            usageEvents: usageSnapshot,
            trace,
            networkPolicy,
            agentMs,
            error: outcome.error,
            infraFailure:
                outcome.timedOut ||
                outcome.error.length > 0 ||
                runState !== 'completed'
        }
    } catch (err) {
        const failure = emptyCandidateEvidence(
            err instanceof Error ? err.message : String(err)
        )
        failure.networkPolicy = networkPolicy
        failure.agentMs = agentMs
        return failure
    } finally {
        offUsage?.()
        try {
            await registration?.dispose()
        } finally {
            for (const fork of forks.reverse()) fork.dispose()
            await app.lifecycle.flush()
            await app.stop()
            if (savedHome === undefined) delete process.env.HOME
            else process.env.HOME = savedHome
            if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME
            else process.env.XDG_CONFIG_HOME = savedXdg
            if (savedEvalKey === undefined) {
                delete process.env.CHATLUNA_EVAL_API_KEY
            } else {
                process.env.CHATLUNA_EVAL_API_KEY = savedEvalKey
            }
        }
    }
}

function addNumber(value: unknown) {
    return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function readExternalJson(text: string) {
    const values = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .flatMap((line) => {
            try {
                return [JSON.parse(line) as unknown]
            } catch {
                return []
            }
        })
    if (values.length > 0) return values
    try {
        const value = JSON.parse(text) as unknown
        return Array.isArray(value) ? value : [value]
    } catch {
        return []
    }
}

function externalTokens(value: unknown): TokenTotals | undefined {
    if (!isRecord(value)) return
    const input = addNumber(
        value.input ??
            value.input_tokens ??
            value.inputTokens ??
            value.prompt_tokens ??
            value.promptTokens
    )
    const output = addNumber(
        value.output ??
            value.output_tokens ??
            value.outputTokens ??
            value.completion_tokens ??
            value.completionTokens
    )
    const inputDetails = isRecord(value.input_token_details)
        ? value.input_token_details
        : isRecord(value.inputTokenDetails)
          ? value.inputTokenDetails
          : undefined
    const outputDetails = isRecord(value.output_token_details)
        ? value.output_token_details
        : isRecord(value.outputTokenDetails)
          ? value.outputTokenDetails
          : undefined
    const cache = isRecord(value.cache) ? value.cache : undefined
    const cacheRead = addNumber(
        value.cache_read ??
            value.cacheRead ??
            value.cache_read_tokens ??
            cache?.read ??
            cache?.cache_read ??
            inputDetails?.cached_tokens ??
            inputDetails?.cacheRead
    )
    const reasoning = addNumber(
        value.reasoning ??
            value.reasoning_tokens ??
            value.reasoningTokens ??
            outputDetails?.reasoning ??
            outputDetails?.reasoning_tokens ??
            outputDetails?.reasoningTokens
    )
    const hasTokens = [
        'input',
        'input_tokens',
        'inputTokens',
        'prompt_tokens',
        'promptTokens',
        'output',
        'output_tokens',
        'outputTokens',
        'completion_tokens',
        'completionTokens',
        'total',
        'total_tokens',
        'totalTokens',
        'cache_read',
        'cacheRead',
        'cache',
        'reasoning',
        'reasoning_tokens',
        'reasoningTokens'
    ].some((key) => key in value)
    if (!hasTokens) return
    return {
        input,
        output,
        reasoning,
        cache: cacheRead,
        total: addNumber(value.total ?? value.total_tokens ?? value.totalTokens)
    }
}

function parseExternal(
    stdout: string,
    stderr: string,
    code: number | null,
    timedOut: boolean,
    startedAt: number,
    apiKey: string
): ExternalEvidence {
    const tokens = emptyTokens()
    const timing = emptyTiming()
    const ids = { sessionId: '' }
    const values = readExternalJson(stdout)
    const audit: unknown[] = []
    const toolIds = new Set<string>()
    const turnIds = new Set<string>()
    const finishIds = new Set<string>()
    const usageIds = new Set<string>()
    let toolCalls = 0
    let turns = 0

    for (const [index, value] of values.entries()) {
        if (!isRecord(value)) continue
        for (const key of ['sessionID', 'session_id', 'sessionId']) {
            if (!ids.sessionId && typeof value[key] === 'string') {
                ids.sessionId = value[key]
            }
        }

        const type = typeof value.type === 'string' ? value.type : 'unknown'
        const typeKey = type.replace(/[-_]/g, '').toLowerCase()
        const part = isRecord(value.part) ? value.part : undefined
        const partType =
            part && typeof part.type === 'string' ? part.type : undefined
        const info = isRecord(value.info) ? value.info : undefined
        const properties = isRecord(value.properties)
            ? value.properties
            : undefined
        const propertyInfo =
            properties && isRecord(properties.info)
                ? properties.info
                : undefined
        const state = part && isRecord(part.state) ? part.state : undefined
        const tool =
            (part && typeof part.tool === 'string' && part.tool) ||
            (typeof value.tool === 'string' && value.tool) ||
            undefined
        const callId =
            (part && typeof part.callID === 'string' && part.callID) ||
            (part && typeof part.callId === 'string' && part.callId) ||
            (typeof value.callID === 'string' && value.callID) ||
            (typeof value.callId === 'string' && value.callId) ||
            undefined
        const stepId =
            (part && typeof part.id === 'string' && part.id) ||
            (part && typeof part.messageID === 'string' && part.messageID) ||
            (typeof value.messageID === 'string' && value.messageID) ||
            undefined
        const isStepStart = typeKey === 'stepstart' || partType === 'step-start'
        const isStepFinish =
            typeKey === 'stepfinish' || partType === 'step-finish'
        const isTool =
            partType === 'tool' ||
            typeKey === 'tooluse' ||
            typeKey === 'toolcall' ||
            typeKey === 'toolstart' ||
            typeKey === 'toolfinish'
        if (isStepStart) {
            const id = stepId ?? `event:${index}`
            if (!turnIds.has(id)) {
                turnIds.add(id)
                turns += 1
            }
        }
        if (isStepFinish) {
            finishIds.add(stepId ?? `event:${index}`)
        }
        if (isTool) {
            const id = callId ?? `event:${index}`
            if (!toolIds.has(id)) {
                toolIds.add(id)
                toolCalls += 1
            }
        }

        let parsed: TokenTotals | undefined
        for (const candidate of [
            part?.tokens,
            value.tokens,
            part?.usage,
            value.usage,
            info?.tokens,
            info?.usage,
            propertyInfo?.tokens,
            propertyInfo?.usage
        ]) {
            parsed = externalTokens(candidate)
            if (parsed) break
        }
        if (parsed) {
            const id = stepId ?? `${ids.sessionId}:${index}`
            if (!usageIds.has(id)) {
                usageIds.add(id)
                tokens.input += parsed.input
                tokens.output += parsed.output
                tokens.reasoning += parsed.reasoning
                tokens.cache += parsed.cache
                tokens.total += parsed.total
            }
        }

        const timingValue = isRecord(value.timing)
            ? value.timing
            : part && isRecord(part.timing)
              ? part.timing
              : undefined
        if (timingValue) {
            timing.ttftMs += addNumber(
                timingValue.ttftMs ?? timingValue.ttft_ms
            )
            timing.totalMs += addNumber(
                timingValue.totalMs ?? timingValue.total_ms
            )
        }

        const item: Record<string, unknown> = {
            index,
            type,
            sessionId: ids.sessionId
        }
        if (partType) item.partType = partType
        if (tool) item.tool = tool
        if (callId) item.callId = callId
        const status =
            (state && typeof state.status === 'string' && state.status) ||
            (part && typeof part.status === 'string' && part.status) ||
            (typeof value.status === 'string' && value.status) ||
            undefined
        if (status) item.status = status
        const reason =
            (part && typeof part.reason === 'string' && part.reason) ||
            (typeof value.reason === 'string' && value.reason) ||
            undefined
        if (reason) item.reason = reason
        if (parsed) item.usage = parsed
        audit.push(item)
    }

    if (turns === 0) turns = finishIds.size
    const estimatedCalls = Math.max(0, turns - usageIds.size)
    if (timing.totalMs === 0) timing.totalMs = Date.now() - startedAt
    const eventError = values
        .flatMap((value) => {
            if (!isRecord(value) || value.type !== 'error') return []
            const error = value.error
            if (typeof error === 'string') return [error]
            if (!isRecord(error)) return []
            if (typeof error.message === 'string') return [error.message]
            if (
                isRecord(error.data) &&
                typeof error.data.message === 'string'
            ) {
                return [error.data.message]
            }
            return []
        })
        .join('; ')
    const failed =
        code !== 0 || timedOut || code == null || eventError.length > 0
    return {
        output: redact(stdout, apiKey),
        sessionId: ids.sessionId,
        conversationId: ids.sessionId,
        usage: tokens,
        timing,
        reportedCalls: usageIds.size,
        estimatedCalls,
        missingProviderTotalEstimate: 0,
        reportedInputOutputDelta: tokens.input + tokens.output - tokens.total,
        eventCount: values.length,
        toolCalls,
        turns,
        audit,
        error: failed
            ? redact(
                  stderr ||
                      eventError ||
                      `exit=${code} signal=${timedOut ? 'timeout' : 'unknown'}`,
                  apiKey
              )
            : '',
        infraFailure: failed
    }
}

async function makeDiff(exercise: Exercise, source: string, agentDir: string) {
    const output: string[] = []
    for (const file of exercise.meta.files.solution) {
        const result = await runCommand(
            'diff',
            ['-u', join(source, file), join(agentDir, file)],
            { cwd: agentDir, timeoutMs: 10000 }
        )
        if (result.stdout || result.stderr) {
            output.push(`--- ${file}\n${result.stdout}${result.stderr}`)
        }
    }
    return output.join('\n')
}

async function prepareCase(exercise: Exercise, root: string, apiKey: string) {
    const agentDir = join(root, 'agent')
    const graderDir = join(root, 'grader')
    const artifacts = join(root, 'artifacts')
    await mkdir(artifacts, { recursive: true })
    await copyAgentWorkspace(exercise, agentDir)
    await copyGraderWorkspace(exercise, graderDir)
    const install = await runCommand(
        'npm',
        ['install', '--no-audit', '--no-fund'],
        { cwd: graderDir, timeoutMs: GRADER_TIMEOUT }
    )
    await saveText(join(artifacts, 'install.stdout'), install.stdout, apiKey)
    await saveText(
        join(artifacts, 'install.stderr'),
        install.stderr || install.error || '',
        apiKey
    )
    if (install.code !== 0 || install.timedOut) {
        throw new Error(
            `npm install failed with exit ${install.code ?? 'unknown'}${install.timedOut ? ' (timeout)' : ''}`
        )
    }

    const baseline = await runCommand('npm', ['test', '--', '--runInBand'], {
        cwd: graderDir,
        timeoutMs: GRADER_TIMEOUT
    })
    await saveText(join(artifacts, 'baseline.stdout'), baseline.stdout, apiKey)
    await saveText(
        join(artifacts, 'baseline.stderr'),
        baseline.stderr || baseline.error || '',
        apiKey
    )
    if (baseline.code === 0 && !baseline.timedOut) {
        throw new Error('baseline test unexpectedly passed')
    }
    await hideGraderFiles(exercise, graderDir)
    return { agentDir, graderDir, artifacts }
}

async function restoreGrader(
    exercise: Exercise,
    graderDir: string,
    agentDir: string
) {
    await cp(exercise.source, graderDir, { recursive: true })
    await copySolutions(exercise, agentDir, graderDir)
}

async function writeEvidence(
    artifacts: string,
    evidence: CandidateEvidence,
    apiKey: string
) {
    await saveText(join(artifacts, 'stdout'), evidence.output, apiKey)
    await saveText(join(artifacts, 'stderr'), evidence.error, apiKey)
    await saveText(
        join(artifacts, 'trace.json'),
        JSON.stringify(
            {
                runs: evidence.runs,
                tasks: evidence.tasks,
                usage: evidence.usage,
                timing: evidence.timing,
                usageAudit: evidence.usageAudit,
                localInputEstimate: evidence.localInputEstimate,
                localOutputEstimate: evidence.localOutputEstimate,
                localTotalEstimate: evidence.localTotalEstimate,
                llmCalls: evidence.llmCalls,
                reportedCalls: evidence.reportedCalls,
                reportedTotal: evidence.reportedTotal,
                reportedProviderInputTotal: evidence.reportedProviderInputTotal,
                reportedProviderOutputTotal:
                    evidence.reportedProviderOutputTotal,
                estimatedCalls: evidence.estimatedCalls,
                missingProviderTotalEstimate:
                    evidence.missingProviderTotalEstimate,
                reportedInputOutputDelta: evidence.reportedInputOutputDelta,
                usageEvents: evidence.usageEvents,
                trace: evidence.trace,
                agentMs: evidence.agentMs
            },
            null,
            4
        ) + '\n',
        apiKey
    )
    await saveText(
        join(artifacts, 'network-policy.json'),
        JSON.stringify(evidence.networkPolicy, null, 4) + '\n',
        apiKey
    )
}

function baseResult(
    runId: string,
    caseId: string,
    attempt: number,
    agentName: string,
    options: CliOptions,
    model: ModelConfig,
    revision: string,
    modelName = model.fullName
): Result {
    return {
        runId,
        suiteId: options.suiteId,
        datasetCommit: DATASET_COMMIT,
        suiteAttempts: options.attempts,
        variant: 'candidate',
        benchmark: 'aider-js',
        caseId,
        attempt,
        agent: agentName,
        model: modelName,
        sessionId: '',
        conversationId: '',
        state: 'infra-failure',
        score: 0,
        toolCalls: 0,
        turns: 0,
        duplicateCalls: 0,
        invalidCalls: 0,
        tokens: emptyTokens(),
        localInputEstimate: 0,
        localOutputEstimate: 0,
        localTotalEstimate: 0,
        llmCalls: 0,
        reportedCalls: 0,
        reportedTotal: 0,
        reportedProviderInputTotal: 0,
        reportedProviderOutputTotal: 0,
        estimatedCalls: 0,
        missingProviderTotalEstimate: 0,
        reportedInputOutputDelta: 0,
        agentMs: 0,
        wallMs: 0,
        graderMs: 0,
        gitRevision: revision,
        error: ''
    }
}

async function runCandidateAttempt(
    exercise: Exercise,
    runId: string,
    attempt: number,
    options: CliOptions,
    model: ModelConfig,
    revision: string
): Promise<Result> {
    const root = join(
        ROOT,
        '.tmp',
        'agent-eval',
        'runs',
        runId,
        exercise.id,
        `attempt-${attempt}`
    )
    const artifacts = join(root, 'artifacts')
    const result = baseResult(
        runId,
        exercise.id,
        attempt,
        'chatluna',
        options,
        model,
        revision
    )
    const startedAt = Date.now()
    let workspaces:
        { agentDir: string; graderDir: string; artifacts: string } | undefined
    let evidence = emptyCandidateEvidence('')

    try {
        workspaces = await prepareCase(exercise, root, model.apiKey)
        const baseDir = join(root, 'koishi-base')
        await mkdir(baseDir, { recursive: true })
        evidence = await runChatluna(
            exercise,
            runId,
            workspaces.agentDir,
            baseDir,
            options,
            model
        )
        await writeEvidence(workspaces.artifacts, evidence, model.apiKey)
        const diff = await makeDiff(
            exercise,
            exercise.source,
            workspaces.agentDir
        )
        await saveText(join(workspaces.artifacts, 'diff'), diff, model.apiKey)

        const graderStart = Date.now()
        await restoreGrader(exercise, workspaces.graderDir, workspaces.agentDir)
        const graded = await runCommand('npm', ['test', '--', '--runInBand'], {
            cwd: workspaces.graderDir,
            timeoutMs: GRADER_TIMEOUT
        })
        result.graderMs = Date.now() - graderStart
        await saveText(
            join(workspaces.artifacts, 'grader.stdout'),
            graded.stdout,
            model.apiKey
        )
        await saveText(
            join(workspaces.artifacts, 'grader.stderr'),
            graded.stderr || graded.error || '',
            model.apiKey
        )
        result.sessionId = evidence.sessionId
        result.conversationId =
            evidence.subagentConversationId || evidence.conversationId
        result.toolCalls = evidence.trace.toolCalls
        result.turns = evidence.trace.turns
        result.duplicateCalls = evidence.trace.duplicateCalls
        result.invalidCalls = evidence.trace.invalidCalls
        result.tokens = evidence.usage
        result.localInputEstimate = evidence.localInputEstimate
        result.localOutputEstimate = evidence.localOutputEstimate
        result.localTotalEstimate = evidence.localTotalEstimate
        result.llmCalls = evidence.llmCalls
        result.reportedCalls = evidence.reportedCalls
        result.reportedTotal = evidence.reportedTotal
        result.reportedProviderInputTotal = evidence.reportedProviderInputTotal
        result.reportedProviderOutputTotal =
            evidence.reportedProviderOutputTotal
        result.estimatedCalls = evidence.estimatedCalls
        result.missingProviderTotalEstimate =
            evidence.missingProviderTotalEstimate
        result.reportedInputOutputDelta = evidence.reportedInputOutputDelta
        result.agentMs = evidence.agentMs
        result.wallMs = Date.now() - startedAt
        result.score = graded.code === 0 && !graded.timedOut ? 1 : 0
        result.state =
            evidence.infraFailure || graded.timedOut
                ? 'infra-failure'
                : result.score === 1
                  ? 'pass'
                  : 'fail'
        result.error = redact(evidence.error, model.apiKey)
        if (graded.timedOut) {
            result.error = `${result.error}${result.error ? '; ' : ''}grader timeout after 180s`
        }
    } catch (err) {
        result.wallMs = Date.now() - startedAt
        result.error = redact(
            err instanceof Error ? err.message : String(err),
            model.apiKey
        )
        result.tokens = evidence.usage
        result.localInputEstimate = evidence.localInputEstimate
        result.localOutputEstimate = evidence.localOutputEstimate
        result.localTotalEstimate = evidence.localTotalEstimate
        result.llmCalls = evidence.llmCalls
        result.reportedCalls = evidence.reportedCalls
        result.reportedTotal = evidence.reportedTotal
        result.reportedProviderInputTotal = evidence.reportedProviderInputTotal
        result.reportedProviderOutputTotal =
            evidence.reportedProviderOutputTotal
        result.estimatedCalls = evidence.estimatedCalls
        result.missingProviderTotalEstimate =
            evidence.missingProviderTotalEstimate
        result.reportedInputOutputDelta = evidence.reportedInputOutputDelta
        result.agentMs = evidence.agentMs
        result.sessionId = evidence.sessionId
        result.conversationId =
            evidence.subagentConversationId || evidence.conversationId
        await saveText(join(artifacts, 'stderr'), result.error, model.apiKey)
    } finally {
        if (workspaces) {
            await saveText(
                join(workspaces.artifacts, 'result.json'),
                JSON.stringify(result, null, 4) + '\n',
                model.apiKey
            )
        }
    }
    return result
}

async function runExternalAttempt(
    kind: CompareAgent,
    exercise: Exercise,
    runId: string,
    attempt: number,
    options: CliOptions,
    model: ModelConfig,
    revision: string
): Promise<Result> {
    const root = join(
        ROOT,
        '.tmp',
        'agent-eval',
        'runs',
        runId,
        exercise.id,
        `compare-${kind}`,
        `attempt-${attempt}`
    )
    const result = baseResult(
        runId,
        exercise.id,
        attempt,
        kind,
        options,
        model,
        revision,
        kind === 'claude'
            ? options.claudeModel
                ? `claude/${options.claudeModel}`
                : 'claude/default'
            : model.fullName
    )
    const startedAt = Date.now()
    let workspaces:
        { agentDir: string; graderDir: string; artifacts: string } | undefined
    let evidence: ExternalEvidence = {
        output: '',
        sessionId: '',
        conversationId: '',
        usage: emptyTokens(),
        timing: emptyTiming(),
        reportedCalls: 0,
        estimatedCalls: 0,
        missingProviderTotalEstimate: 0,
        reportedInputOutputDelta: 0,
        eventCount: 0,
        toolCalls: 0,
        turns: 0,
        audit: [],
        error: '',
        infraFailure: true
    }

    try {
        workspaces = await prepareCase(exercise, root, model.apiKey)
        const externalHome = join(root, 'external-home')
        await mkdir(externalHome, { recursive: true })
        const configPath = join(
            externalHome,
            '.config',
            'opencode',
            'opencode.jsonc'
        )
        if (kind === 'opencode') {
            await mkdir(dirname(configPath), { recursive: true })
            await writeFile(
                configPath,
                JSON.stringify(
                    {
                        $schema: 'https://opencode.ai/config.json',
                        model: model.fullName,
                        share: 'disabled',
                        autoupdate: false,
                        enabled_providers: [model.platform],
                        permission: {
                            '*': 'allow',
                            external_directory: 'deny'
                        },
                        provider: {
                            [model.platform]: {
                                name: model.providerName,
                                npm: model.providerNpm,
                                options: {
                                    baseURL: model.baseUrl,
                                    apiKey: '{env:CHATLUNA_COMPARE_API_KEY}'
                                },
                                models: {
                                    [model.model]: {
                                        id: model.model
                                    }
                                }
                            }
                        }
                    },
                    null,
                    4
                ) + '\n',
                'utf8'
            )
        }
        const childEnv: NodeJS.ProcessEnv = {
            ...process.env,
            HOME: externalHome,
            XDG_CONFIG_HOME: join(externalHome, '.config')
        }
        delete childEnv.CHATLUNA_EVAL_API_KEY
        delete childEnv.CHATLUNA_COMPARE_API_KEY
        delete childEnv.OPENCODE_CONFIG_CONTENT
        delete childEnv.OPENCODE_CONFIG_DIR
        delete childEnv.OPENCODE_PERMISSION
        delete childEnv.OPENCODE_TUI_CONFIG
        if (kind === 'opencode') {
            childEnv.OPENCODE_CONFIG = configPath
            childEnv.CHATLUNA_COMPARE_API_KEY = model.apiKey
        }
        const prompt = [
            `Exercise: ${exercise.id}`,
            `Goal: ${exercise.meta.blurb}`,
            `Solution files: ${exercise.meta.files.solution.join(', ')}`,
            exercise.instructions,
            'Implement the complete solution now. Do not modify or create tests.'
        ]
            .filter((item) => item.length > 0)
            .join('\n\n')
        const args =
            kind === 'opencode'
                ? [
                      'run',
                      '--format',
                      'json',
                      '--model',
                      model.fullName,
                      '--dir',
                      workspaces.agentDir,
                      '--auto',
                      prompt
                  ]
                : [
                      '--print',
                      '--output-format',
                      'json',
                      ...(options.claudeModel
                          ? ['--model', options.claudeModel]
                          : []),
                      '--permission-mode',
                      'bypassPermissions',
                      '--allow-dangerously-skip-permissions',
                      '--no-session-persistence',
                      prompt
                  ]
        const agentStart = Date.now()
        const external = await runCommand(kind, args, {
            cwd: workspaces.agentDir,
            timeoutMs: options.timeoutMs,
            env: childEnv
        }).finally(() => {
            result.agentMs = Date.now() - agentStart
        })
        evidence = parseExternal(
            external.stdout,
            external.stderr || external.error || '',
            external.code,
            external.timedOut,
            startedAt,
            model.apiKey
        )
        delete childEnv.CHATLUNA_COMPARE_API_KEY
        await saveText(
            join(workspaces.artifacts, 'stdout'),
            evidence.output,
            model.apiKey
        )
        await saveText(
            join(workspaces.artifacts, 'stderr'),
            evidence.error,
            model.apiKey
        )
        await saveText(
            join(workspaces.artifacts, 'trace.json'),
            JSON.stringify(
                {
                    eventCount: evidence.eventCount,
                    toolCalls: evidence.toolCalls,
                    turns: evidence.turns,
                    usage: evidence.usage,
                    timing: evidence.timing,
                    llmCalls: evidence.reportedCalls + evidence.estimatedCalls,
                    reportedCalls: evidence.reportedCalls,
                    reportedTotal: evidence.usage.total,
                    reportedProviderInputTotal: evidence.usage.input,
                    reportedProviderOutputTotal: evidence.usage.output,
                    estimatedCalls: evidence.estimatedCalls,
                    missingProviderTotalEstimate:
                        evidence.missingProviderTotalEstimate,
                    reportedInputOutputDelta: evidence.reportedInputOutputDelta,
                    audit: evidence.audit
                },
                null,
                4
            ) + '\n',
            model.apiKey
        )
        const diff = await makeDiff(
            exercise,
            exercise.source,
            workspaces.agentDir
        )
        await saveText(join(workspaces.artifacts, 'diff'), diff, model.apiKey)

        const graderStart = Date.now()
        await restoreGrader(exercise, workspaces.graderDir, workspaces.agentDir)
        const graded = await runCommand('npm', ['test', '--', '--runInBand'], {
            cwd: workspaces.graderDir,
            timeoutMs: GRADER_TIMEOUT
        })
        result.graderMs = Date.now() - graderStart
        await saveText(
            join(workspaces.artifacts, 'grader.stdout'),
            graded.stdout,
            model.apiKey
        )
        await saveText(
            join(workspaces.artifacts, 'grader.stderr'),
            graded.stderr || graded.error || '',
            model.apiKey
        )
        result.sessionId = evidence.sessionId
        result.conversationId = evidence.conversationId
        result.toolCalls = evidence.toolCalls
        result.turns = evidence.turns
        result.tokens = evidence.usage
        result.llmCalls = evidence.reportedCalls + evidence.estimatedCalls
        result.reportedCalls = evidence.reportedCalls
        result.reportedTotal = evidence.usage.total
        result.reportedProviderInputTotal = evidence.usage.input
        result.reportedProviderOutputTotal = evidence.usage.output
        result.estimatedCalls = evidence.estimatedCalls
        result.missingProviderTotalEstimate =
            evidence.missingProviderTotalEstimate
        result.reportedInputOutputDelta = evidence.reportedInputOutputDelta
        result.wallMs = Date.now() - startedAt
        result.score = graded.code === 0 && !graded.timedOut ? 1 : 0
        result.state =
            evidence.infraFailure || graded.timedOut
                ? 'infra-failure'
                : result.score === 1
                  ? 'pass'
                  : 'fail'
        result.error = evidence.error
        if (graded.timedOut) {
            result.error = `${result.error}${result.error ? '; ' : ''}grader timeout after 180s`
        }
    } catch (err) {
        result.wallMs = Date.now() - startedAt
        result.error = redact(
            err instanceof Error ? err.message : String(err),
            model.apiKey
        )
        result.tokens = evidence.usage
        result.llmCalls = evidence.reportedCalls + evidence.estimatedCalls
        result.reportedCalls = evidence.reportedCalls
        result.reportedTotal = evidence.usage.total
        result.reportedProviderInputTotal = evidence.usage.input
        result.reportedProviderOutputTotal = evidence.usage.output
        result.estimatedCalls = evidence.estimatedCalls
        result.missingProviderTotalEstimate =
            evidence.missingProviderTotalEstimate
        result.reportedInputOutputDelta = evidence.reportedInputOutputDelta
        result.sessionId = evidence.sessionId
        result.conversationId = evidence.conversationId
    } finally {
        if (workspaces) {
            await saveText(
                join(workspaces.artifacts, 'result.json'),
                JSON.stringify(result, null, 4) + '\n',
                model.apiKey
            )
        }
    }
    return result
}

async function appendResult(path: string, result: Result, apiKey: string) {
    await mkdir(dirname(path), { recursive: true })
    await appendFile(
        path,
        redact(JSON.stringify(result) + '\n', apiKey),
        'utf8'
    )
}

function readResults(paths: string[], missing = false) {
    return paths.flatMap((path) => {
        let text: string
        try {
            text = readTextFileSync(path, 'utf8')
        } catch (err) {
            if (missing && (err as NodeJS.ErrnoException).code === 'ENOENT') {
                return []
            }
            throw err
        }
        return text
            .split(/\r?\n/)
            .filter((line) => line.length > 0)
            .map((line) => JSON.parse(line) as Result)
    })
}

function completedResults(options: CliOptions) {
    const completed = new Set<string>()
    if (!options.resume) return completed
    for (const result of readResults(options.results, true)) {
        if (
            result.suiteId === options.suiteId &&
            (result.state === 'pass' || result.state === 'fail')
        ) {
            completed.add(
                `${result.caseId}\u0000${result.attempt}\u0000${result.agent}`
            )
        }
    }
    return completed
}

function percentile(values: number[], ratio: number) {
    if (values.length === 0) return 0
    const sorted = [...values].sort((left, right) => left - right)
    return sorted[Math.ceil(sorted.length * ratio) - 1]
}

function average(values: number[]) {
    if (values.length === 0) return 0
    return (
        Math.round(
            (values.reduce((sum, value) => sum + value, 0) / values.length) *
                100
        ) / 100
    )
}

function summarizeSuite(
    suiteId: string,
    agentName: string,
    rows: Result[],
    inventory: Inventory
): SuiteSummary {
    const commits = new Set(rows.map((row) => row.datasetCommit))
    if (commits.size !== 1 || !commits.has(DATASET_COMMIT)) {
        throw new Error(`Suite ${suiteId} contains a different dataset commit`)
    }
    const attempts = new Set(rows.map((row) => row.suiteAttempts))
    if (attempts.size !== 1) {
        throw new Error(`Suite ${suiteId} has inconsistent attempt counts`)
    }
    const count = rows[0].suiteAttempts
    const ids = new Set(inventory.eligible.map((exercise) => exercise.id))
    const latest = new Map<string, Result>()
    for (const row of rows) {
        if (!ids.has(row.caseId) || row.attempt < 1 || row.attempt > count) {
            throw new Error(
                `Suite ${suiteId} contains an ineligible result: ${row.caseId}#${row.attempt}`
            )
        }
        latest.set(`${row.caseId}\u0000${row.attempt}`, row)
    }
    const selected = [...latest.values()]
    const eligible = inventory.eligible.length * count
    const pass = selected.filter((row) => row.state === 'pass').length
    const fail = selected.filter((row) => row.state === 'fail').length
    const infra = selected.filter((row) => row.state === 'infra-failure').length
    const tokens = selected.map((row) => row.reportedTotal)
    const tools = selected.map((row) => row.toolCalls)
    const turns = selected.map((row) => row.turns)
    const agent = selected
        .filter((row) => row.agentMs > 0)
        .map((row) => row.agentMs)
    const wall = selected.map((row) => row.wallMs)
    const incomplete: string[] = []
    for (let attempt = 1; attempt <= count; attempt += 1) {
        for (const exercise of inventory.eligible) {
            if (!latest.has(`${exercise.id}\u0000${attempt}`)) {
                incomplete.push(`${exercise.id}#${attempt}`)
            }
        }
    }

    return {
        suiteId,
        datasetCommit: DATASET_COMMIT,
        agent: agentName,
        attempts: count,
        eligible,
        attempted: selected.length,
        pass,
        fail,
        infra,
        verifierScorePercent:
            Math.round(
                (selected.reduce((sum, row) => sum + row.score, 0) / eligible) *
                    10000
            ) / 100,
        statePassPercent: Math.round((pass / eligible) * 10000) / 100,
        tokens: {
            basis: 'reportedTotal',
            total: tokens.reduce((sum, value) => sum + value, 0),
            average: average(tokens),
            p50: percentile(tokens, 0.5),
            p95: percentile(tokens, 0.95)
        },
        tools: {
            average: average(tools),
            p50: percentile(tools, 0.5),
            p95: percentile(tools, 0.95)
        },
        turns: {
            average: average(turns),
            p50: percentile(turns, 0.5),
            p95: percentile(turns, 0.95)
        },
        agentLatency: {
            basis: 'agentMs',
            average: average(agent),
            p50: percentile(agent, 0.5),
            p95: percentile(agent, 0.95)
        },
        wallMs: {
            basis: 'wallMs',
            average: average(wall),
            p50: percentile(wall, 0.5),
            p95: percentile(wall, 0.95)
        },
        incomplete
    }
}

function report(options: CliOptions, inventory: Inventory) {
    const rows = readResults(options.results).filter(
        (row) =>
            row.benchmark === 'aider-js' &&
            !!row.suiteId &&
            (!options.suiteIdExplicit || row.suiteId === options.suiteId)
    )
    const groups = new Map<string, Result[]>()
    for (const row of rows) {
        const key = `${row.suiteId}\u0000${row.agent}`
        const group = groups.get(key) ?? []
        group.push(row)
        groups.set(key, group)
    }
    if (groups.size === 0) throw new Error('No matching Aider suite results')
    const suites = [...groups.values()]
        .map((group) =>
            summarizeSuite(group[0].suiteId, group[0].agent, group, inventory)
        )
        .sort((left, right) => {
            const leftKey = `${left.suiteId}\u0000${left.agent}`
            const rightKey = `${right.suiteId}\u0000${right.agent}`
            return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
        })
    console.log(
        JSON.stringify({
            command: 'report',
            results: options.results,
            suites
        })
    )
}

async function gitRevision() {
    const result = await runCommand('git', ['rev-parse', 'HEAD'], {
        cwd: ROOT,
        timeoutMs: 10000
    })
    const revision = result.stdout.trim() || 'unknown'
    const dirty = await runCommand('git', ['diff', '--quiet', 'HEAD'], {
        cwd: ROOT,
        timeoutMs: 10000
    })
    return dirty.code === 0 ? revision : `${revision}-dirty`
}

async function main() {
    const options = parseArgs(process.argv.slice(2))
    if (options.command === 'probe-timeout') {
        await timeoutProbe()
        return
    }
    const config = readConfig()
    const dataRoot = expandPath(config.dataPaths.aider)
    const inventory = await loadInventory(dataRoot)
    if (options.command === 'report') {
        report(options, inventory)
        return
    }
    const exercises = selectExercises(inventory, options, config)
    if (options.command === 'suite' || options.dryRun) {
        console.log(
            JSON.stringify(inventoryOutput(inventory, exercises, options))
        )
        return
    }

    const completed = completedResults(options)
    const agents = ['chatluna', ...options.compare]
    const pending = exercises.reduce(
        (count, exercise) =>
            count +
            agents.reduce(
                (agentCount, agentName) =>
                    agentCount +
                    Array.from(
                        { length: options.attempts },
                        (_value, idx) => idx + 1
                    ).filter(
                        (attempt) =>
                            !completed.has(
                                `${exercise.id}\u0000${attempt}\u0000${agentName}`
                            )
                    ).length,
                0
            ),
        0
    )
    const runId = randomUUID()
    if (pending === 0) {
        console.log(
            JSON.stringify({
                command: 'aider',
                runId,
                suiteId: options.suiteId,
                datasetCommit: DATASET_COMMIT,
                benchmark: 'aider-js',
                eligible: inventory.eligible.length,
                cases: exercises.map((exercise) => exercise.id),
                attempts: options.attempts,
                shardIndex: options.shardIndex,
                shardCount: options.shardCount,
                results: options.results[0],
                resumed: completed.size,
                rows: []
            })
        )
        return
    }

    const model = readModelConfig(config)
    const revision = await gitRevision()

    delete process.env.CHATLUNA_EVAL_API_KEY
    const results: Result[] = []
    const skipped: { caseId: string; attempt: number; agent: string }[] = []
    for (const exercise of exercises) {
        for (let attempt = 1; attempt <= options.attempts; attempt += 1) {
            const candidateKey = `${exercise.id}\u0000${attempt}\u0000chatluna`
            if (completed.has(candidateKey)) {
                skipped.push({
                    caseId: exercise.id,
                    attempt,
                    agent: 'chatluna'
                })
            } else {
                const candidate = await runCandidateAttempt(
                    exercise,
                    runId,
                    attempt,
                    options,
                    model,
                    revision
                )
                await appendResult(options.results[0], candidate, model.apiKey)
                results.push(candidate)
            }
            for (const kind of options.compare) {
                const key = `${exercise.id}\u0000${attempt}\u0000${kind}`
                if (completed.has(key)) {
                    skipped.push({ caseId: exercise.id, attempt, agent: kind })
                    continue
                }
                const comparison = await runExternalAttempt(
                    kind,
                    exercise,
                    runId,
                    attempt,
                    options,
                    model,
                    revision
                )
                await appendResult(options.results[0], comparison, model.apiKey)
                results.push(comparison)
            }
        }
    }

    console.log(
        JSON.stringify({
            command: 'aider',
            runId,
            suiteId: options.suiteId,
            datasetCommit: DATASET_COMMIT,
            benchmark: 'aider-js',
            eligible: inventory.eligible.length,
            cases: exercises.map((exercise) => exercise.id),
            attempts: options.attempts,
            shardIndex: options.shardIndex,
            shardCount: options.shardCount,
            compare: options.compare,
            model: model.fullName,
            results: options.results[0],
            resumed: skipped,
            rows: results.map((item) => ({
                caseId: item.caseId,
                attempt: item.attempt,
                agent: item.agent,
                state: item.state,
                score: item.score,
                tokens: item.tokens,
                localInputEstimate: item.localInputEstimate,
                localOutputEstimate: item.localOutputEstimate,
                localTotalEstimate: item.localTotalEstimate,
                llmCalls: item.llmCalls,
                reportedCalls: item.reportedCalls,
                reportedTotal: item.reportedTotal,
                reportedProviderInputTotal: item.reportedProviderInputTotal,
                reportedProviderOutputTotal: item.reportedProviderOutputTotal,
                estimatedCalls: item.estimatedCalls,
                missingProviderTotalEstimate: item.missingProviderTotalEstimate,
                reportedInputOutputDelta: item.reportedInputOutputDelta,
                toolCalls: item.toolCalls,
                turns: item.turns,
                agentMs: item.agentMs,
                wallMs: item.wallMs,
                graderMs: item.graderMs,
                error: redact(item.error, model.apiKey)
            }))
        })
    )
}

if (
    process.argv[1] &&
    resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
    try {
        await main()
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error))
        process.exitCode = 1
    }
}
