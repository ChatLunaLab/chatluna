import { execFileSync, spawnSync } from 'node:child_process'
import {
    appendFileSync,
    mkdirSync,
    readFileSync,
    statSync,
    writeFileSync
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_PATH = join(ROOT, 'bench', 'agent-eval.json')
const DEFAULT_RESULTS = join(ROOT, '.tmp', 'agent-eval', 'results.jsonl')
const MIN_FREE_BYTES = 1024 * 1024 * 1024

export type Variant = 'baseline' | 'candidate'
export type ResultState = 'pass' | 'fail' | 'infra-failure'

export interface Result {
    runId: string
    variant: Variant
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
    wallMs: number
    graderMs: number
    gitRevision: string
    error: string
}

interface BenchConfig {
    model: string
    dataPaths: {
        terminal: string
        aider: string
    }
    contextFiles: string[]
    pilotCases: {
        id: string
        agent: string
        prompt: string
    }[]
}

interface Check {
    id: string
    pass: boolean
    detail: string
}

interface SourceSet {
    files: Map<string, string>
    revision: string
}

interface VariantEvaluation {
    result: Result
    checks: Check[]
}

interface CliOptions {
    command: 'doctor' | 'context' | 'report'
    iterations: number
    agents: string
    variant: 'both' | Variant
    results: string
}

interface DoctorCheck {
    available: boolean
    detail: string
}

interface DoctorOutput {
    command: 'doctor'
    available: string[]
    blocked: string[]
    checks: Record<string, DoctorCheck>
}

interface SummaryRow {
    benchmark: string
    variant: Variant
    agent: string
    count: number
    'pass@1': number
    avgScore: number
    totalTokens: number
    p50Tokens: number
    p50WallMs: number
    tokensPerPass: number
    toolValidRate: number
    duplicateRate: number
    infraFailures: number
}

function loadConfig() {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8')) as BenchConfig
}

function parseArgs(args: string[]): CliOptions {
    const command = args[0]
    if (command !== 'doctor' && command !== 'context' && command !== 'report') {
        throw new Error(
            'Usage: agent-eval.ts doctor|context|report [--iterations 1..5] [--agents none] [--variant both|baseline|candidate] [--results path]'
        )
    }

    let iterations = 1
    let agents = 'none'
    let variant: CliOptions['variant'] = 'both'
    let results = DEFAULT_RESULTS

    for (let index = 1; index < args.length; index += 1) {
        const arg = args[index]
        const equals = arg.indexOf('=')
        const key = equals < 0 ? arg : arg.slice(0, equals)
        let value = equals < 0 ? undefined : arg.slice(equals + 1)
        if (value === undefined) {
            value = args[index + 1]
            index += 1
        }
        if (!value || value.startsWith('--')) {
            throw new Error(`Missing value for ${key}`)
        }

        if (key === '--iterations') {
            const parsed = Number(value)
            if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
                throw new Error('--iterations must be an integer from 1 to 5')
            }
            iterations = parsed
            continue
        }
        if (key === '--agents') {
            if (value !== 'none') {
                throw new Error('--agents only accepts none in this stage')
            }
            agents = value
            continue
        }
        if (key === '--variant') {
            if (value === 'baseline' || value === 'v1-dev') {
                variant = 'baseline'
            } else if (value === 'candidate' || value === 'working-tree') {
                variant = 'candidate'
            } else if (value === 'both') {
                variant = value
            } else {
                throw new Error(
                    '--variant must be both, baseline, candidate, v1-dev, or working-tree'
                )
            }
            continue
        }
        if (key === '--results') {
            results = resolve(ROOT, value)
            continue
        }
        throw new Error(`Unknown option: ${key}`)
    }

    return { command, iterations, agents, variant, results }
}

function checkCommand(command: string, args: string[], timeout = 5000) {
    const result = spawnSync(command, args, {
        stdio: 'ignore',
        timeout
    })
    if (result.status === 0 && !result.error) {
        return { available: true, detail: 'command completed successfully' }
    }
    return {
        available: false,
        detail: 'command is missing, stopped, or returned a non-zero status'
    }
}

function checkModelList() {
    const result = spawnSync('opencode', ['models'], {
        encoding: 'utf8',
        timeout: 10000
    })
    if (result.status !== 0 || result.error) {
        return {
            available: false,
            detail: 'opencode model listing did not complete successfully'
        }
    }
    const models = String(result.stdout ?? '').toLowerCase()
    if (!models.includes('deepseek')) {
        return {
            available: false,
            detail: 'opencode model list does not contain deepseek'
        }
    }
    return { available: true, detail: 'opencode model list contains deepseek' }
}

function expandPath(path: string) {
    return path.startsWith('~/')
        ? join(homedir(), path.slice(2))
        : resolve(ROOT, path)
}

function checkDirectory(path: string): DoctorCheck {
    try {
        if (statSync(expandPath(path)).isDirectory()) {
            return { available: true, detail: 'directory exists' }
        }
    } catch {
        return { available: false, detail: 'directory is missing' }
    }
    return { available: false, detail: 'path is not a directory' }
}

function checkDisk(): DoctorCheck {
    try {
        const output = execFileSync('df', ['-Pk', ROOT], {
            encoding: 'utf8'
        })
        const lines = output.trim().split(/\r?\n/)
        const fields = lines[lines.length - 1].trim().split(/\s+/)
        const freeBytes = Number(fields[3]) * 1024
        if (Number.isFinite(freeBytes) && freeBytes >= MIN_FREE_BYTES) {
            return {
                available: true,
                detail: `disk has ${Math.floor(freeBytes / 1024 ** 3)} GiB free`
            }
        }
        return { available: false, detail: 'disk has less than 1 GiB free' }
    } catch {
        return {
            available: false,
            detail: 'df could not inspect the workspace disk'
        }
    }
}

function runDoctor(config: BenchConfig): DoctorOutput {
    const checks: Record<string, DoctorCheck> = {
        git: checkCommand('git', ['--version']),
        node: checkCommand('node', ['--version']),
        yarn: checkCommand('yarn', ['--version']),
        opencode: checkCommand('opencode', ['--version']),
        'opencode-model-deepseek': checkModelList(),
        claude: checkCommand('claude', ['--version']),
        docker: checkCommand('docker', ['--version']),
        colima: checkCommand('colima', ['status']),
        harbor: checkCommand('harbor', ['--version']),
        tb: checkCommand('tb', ['--version']),
        Terminal: checkDirectory(config.dataPaths.terminal),
        Aider: checkDirectory(config.dataPaths.aider),
        disk: checkDisk()
    }
    const available = Object.entries(checks)
        .filter(([, check]) => check.available)
        .map(([name]) => name)
    const blocked = Object.entries(checks)
        .filter(([, check]) => !check.available)
        .map(([name]) => name)
    return { command: 'doctor', available, blocked, checks }
}

function gitRevision(ref: string) {
    return execFileSync('git', ['rev-parse', ref], {
        cwd: ROOT,
        encoding: 'utf8'
    }).trim()
}

function workingTreeRevision() {
    const revision = gitRevision('HEAD')
    const dirty =
        spawnSync('git', ['diff', '--quiet', 'HEAD'], {
            cwd: ROOT,
            stdio: 'ignore'
        }).status !== 0
    return dirty ? `${revision}-dirty` : revision
}

function sourceAt(config: BenchConfig, variant: Variant): SourceSet {
    const files = new Map<string, string>()
    const revision =
        variant === 'baseline' ? gitRevision('v1-dev') : workingTreeRevision()
    for (const file of config.contextFiles) {
        const content =
            variant === 'baseline'
                ? execFileSync('git', ['show', `v1-dev:${file}`], {
                      cwd: ROOT,
                      encoding: 'utf8'
                  })
                : readFileSync(join(ROOT, file), 'utf8')
        files.set(file, content)
    }
    return { files, revision }
}

function interfaceBlock(source: string, name: string, next: string) {
    const start = source.indexOf(`interface ${name} {`)
    const end = source.indexOf(next, start)
    if (start < 0 || end < 0) return ''
    return source.slice(start, end)
}

function fieldIsRequired(block: string, name: string) {
    return (
        new RegExp(`\\b${name}:`).test(block) &&
        !new RegExp(`\\b${name}\\?:`).test(block)
    )
}

function compact(source: string) {
    return source.replace(/\s+/g, ' ').trim()
}

function schemaBlock(source: string) {
    const start = source.indexOf('schema = z')
    const end = source.indexOf('    constructor(', start)
    if (start < 0 || end < 0) return ''
    return source.slice(start, end)
}

function addedDiff(config: BenchConfig) {
    return execFileSync(
        'git',
        ['diff', '--no-color', 'v1-dev', '--', ...config.contextFiles],
        { cwd: ROOT, encoding: 'utf8' }
    )
        .split(/\r?\n/)
        .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
        .join('\n')
}

function gradeContext(config: BenchConfig, source: SourceSet): Check[] {
    const types = source.files.get('packages/core/src/llm-core/agent/types.ts')
    const agent = source.files.get('packages/core/src/llm-core/agent/agent.ts')
    const task = source.files.get(
        'packages/core/src/llm-core/agent/sub-agent/executor.ts'
    )
    const tool = source.files.get(
        'packages/core/src/llm-core/agent/sub-agent/tool.ts'
    )
    const context = interfaceBlock(
        types,
        'AgentRunContext',
        'export interface SubagentContext'
    )
    const generate = interfaceBlock(
        agent,
        'AgentGenerateOptions',
        'export interface AgentStream'
    )
    const declarations = [...source.files.values()].reduce(
        (count, file) =>
            count +
            [...file.matchAll(/interface AgentRunContext\s*\{/g)].length,
        0
    )
    const required = [
        'kind',
        'agentId',
        'agentName',
        'conversationId',
        'requestId',
        'source'
    ].every((field) => fieldIsRequired(context, field))
    const canonical =
        declarations === 1 &&
        required &&
        !context.includes('parentConversationId') &&
        generate.includes('agentContext: AgentRunContext') &&
        !generate.includes('conversationId?:') &&
        !generate.includes('subagentContext?:')

    const subagent = interfaceBlock(
        types,
        'SubagentContext',
        'export type AgentStep'
    )
    const legacyFields = ['agentId', 'agentName', 'toolMask'].filter((field) =>
        new RegExp(`\\b${field}\\s*\\??:`).test(subagent)
    )

    const asToolConversation =
        /conversationId:\s*`subagent:\$\{runId\}`/.test(agent) &&
        /kind:\s*'subagent'/.test(agent) &&
        /subagentContext/.test(agent)
    const taskConversation =
        /conversationId:\s*options\.task\.conversationId/.test(task) &&
        /kind:\s*'subagent'/.test(task) &&
        /subagentContext/.test(task)

    const baselineTool = schemaBlock(
        execFileSync(
            'git',
            [
                'show',
                'v1-dev:packages/core/src/llm-core/agent/sub-agent/tool.ts'
            ],
            { cwd: ROOT, encoding: 'utf8' }
        )
    )
    const currentTool = schemaBlock(tool)
    const schemaMatches =
        compact(baselineTool) === compact(currentTool) &&
        baselineTool.length > 0

    const banned = [
        'trimTaskHistory',
        'MAX_TRACE_TEXT_LENGTH',
        'maxTraceTextLength'
    ]
    const sourceText = [...source.files.values()].join('\n')
    const added = addedDiff(config)
    const memoryChanges = banned.filter(
        (term) => sourceText.includes(term) || added.includes(term)
    )

    return [
        {
            id: 'canonical-agent-run-context',
            pass: canonical,
            detail: canonical
                ? 'AgentRunContext has one canonical required declaration and is the generate input'
                : 'AgentRunContext still has legacy optional fields or a non-canonical generate input'
        },
        {
            id: 'subagent-context-shape',
            pass: legacyFields.length === 0,
            detail:
                legacyFields.length === 0
                    ? 'SubagentContext contains no agent identity or tool mask fields'
                    : `SubagentContext contains legacy fields: ${legacyFields.join(', ')}`
        },
        {
            id: 'subagent-conversation-ids',
            pass: asToolConversation && taskConversation,
            detail: `asTool=${asToolConversation}; task=${taskConversation}; both use subagent context`
        },
        {
            id: 'task-tool-schema',
            pass: schemaMatches,
            detail: schemaMatches
                ? 'task tool schema matches the v1-dev schema'
                : 'task tool schema differs from the v1-dev schema'
        },
        {
            id: 'no-memory-trimming',
            pass: memoryChanges.length === 0,
            detail:
                memoryChanges.length === 0
                    ? 'No trimTaskHistory or MAX_TRACE_TEXT_LENGTH memory change is present'
                    : `Memory change markers found: ${memoryChanges.join(', ')}`
        }
    ]
}

function evaluateVariant(
    config: BenchConfig,
    variant: Variant,
    runId: string,
    attempt: number
): VariantEvaluation {
    const started = Date.now()
    const source = sourceAt(config, variant)
    const graderStarted = Date.now()
    const checks = gradeContext(config, source)
    const graderMs = Date.now() - graderStarted
    const passed = checks.filter((check) => check.pass).length
    const score = passed / checks.length
    const input = Math.ceil(
        [...source.files.values()].reduce(
            (total, file) => total + file.length,
            0
        ) / 4
    )
    const failed = checks
        .filter((check) => !check.pass)
        .map((check) => `${check.id}: ${check.detail}`)
        .join(' | ')
    return {
        checks,
        result: {
            runId,
            variant,
            benchmark: 'context',
            caseId: 'execution-context-contract',
            attempt,
            agent: 'none',
            model: config.model,
            sessionId: `${runId}:${variant}:session`,
            conversationId: `${runId}:${variant}:conversation`,
            state: score === 1 ? 'pass' : 'fail',
            score,
            toolCalls: 0,
            turns: 0,
            duplicateCalls: 0,
            invalidCalls: 0,
            tokens: {
                input,
                output: 0,
                reasoning: 0,
                cache: 0,
                total: input
            },
            wallMs: Date.now() - started,
            graderMs,
            gitRevision: source.revision,
            error: failed
        }
    }
}

function writeResults(path: string, results: Result[]) {
    mkdirSync(dirname(path), { recursive: true })
    appendFileSync(
        path,
        results.map((result) => JSON.stringify(result)).join('\n') + '\n',
        'utf8'
    )
}

function runContext(options: CliOptions, config: BenchConfig) {
    const runId = randomUUID()
    let previousScore: number | undefined
    let attempts = 0
    let stopped = false
    const evaluations: {
        attempt: number
        variants: Record<string, { score: number; checks: Check[] }>
    }[] = []

    for (let attempt = 1; attempt <= options.iterations; attempt += 1) {
        const current: VariantEvaluation[] = []
        if (options.variant === 'both' || options.variant === 'baseline') {
            current.push(evaluateVariant(config, 'baseline', runId, attempt))
        }
        if (options.variant === 'both' || options.variant === 'candidate') {
            current.push(evaluateVariant(config, 'candidate', runId, attempt))
        }
        writeResults(
            options.results,
            current.map((item) => item.result)
        )
        attempts = attempt
        evaluations.push({
            attempt,
            variants: Object.fromEntries(
                current.map((item) => [
                    item.result.variant,
                    { score: item.result.score, checks: item.checks }
                ])
            )
        })
        const selected =
            current.find((item) =>
                options.variant === 'baseline'
                    ? item.result.variant === 'baseline'
                    : item.result.variant === 'candidate'
            ) ?? current[0]
        if (
            previousScore !== undefined &&
            selected.result.score <= previousScore
        ) {
            stopped = true
            break
        }
        previousScore = selected.result.score
    }

    console.log(
        JSON.stringify({
            command: 'context',
            runId,
            agents: options.agents,
            results: options.results,
            attempts,
            stoppedBecause: stopped ? 'score-no-improvement' : '',
            evaluations
        })
    )
}

function readResults(path: string) {
    return readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Result)
}

function median(values: number[]) {
    if (values.length === 0) return 0
    const sorted = [...values].sort((left, right) => left - right)
    const middle = Math.floor(sorted.length / 2)
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle]
}

function summarize(rows: Result[]): SummaryRow {
    const totalTokens = rows.reduce((sum, row) => sum + row.tokens.total, 0)
    const scoreTotal = rows.reduce((sum, row) => sum + row.score, 0)
    const first = rows.filter((row) => row.attempt === 1)
    const toolCalls = rows.reduce((sum, row) => sum + row.toolCalls, 0)
    const invalidCalls = rows.reduce((sum, row) => sum + row.invalidCalls, 0)
    const duplicateCalls = rows.reduce(
        (sum, row) => sum + row.duplicateCalls,
        0
    )
    return {
        benchmark: rows[0].benchmark,
        variant: rows[0].variant,
        agent: rows[0].agent,
        count: rows.length,
        'pass@1':
            first.length === 0
                ? 0
                : Math.round(
                      (first.reduce((sum, row) => sum + row.score, 0) /
                          first.length) *
                          10000
                  ) / 10000,
        avgScore: Math.round((scoreTotal / rows.length) * 10000) / 10000,
        totalTokens,
        p50Tokens: median(rows.map((row) => row.tokens.total)),
        p50WallMs: median(rows.map((row) => row.wallMs)),
        tokensPerPass:
            scoreTotal === 0
                ? 0
                : Math.round((totalTokens / scoreTotal) * 100) / 100,
        toolValidRate:
            toolCalls === 0 ? 1 : (toolCalls - invalidCalls) / toolCalls,
        duplicateRate: toolCalls === 0 ? 0 : duplicateCalls / toolCalls,
        infraFailures: rows.filter((row) => row.state === 'infra-failure')
            .length
    }
}

function runReport(options: CliOptions) {
    const results = readResults(options.results)
    const groups = new Map<string, Result[]>()
    for (const result of results) {
        const key = `${result.benchmark}\t${result.variant}\t${result.agent}`
        const group = groups.get(key) ?? []
        group.push(result)
        groups.set(key, group)
    }
    const rows = [...groups.values()].map(summarize)
    const outputDir = dirname(options.results)
    mkdirSync(outputDir, { recursive: true })
    const summaryPath = join(outputDir, 'summary.json')
    const reportPath = join(outputDir, 'report.md')
    writeFileSync(summaryPath, JSON.stringify({ rows }, null, 4) + '\n', 'utf8')
    const header = [
        'benchmark',
        'variant',
        'agent',
        'count',
        'pass@1',
        'avgScore',
        'totalTokens',
        'p50Tokens',
        'p50WallMs',
        'tokensPerPass',
        'toolValidRate',
        'duplicateRate',
        'infraFailures'
    ]
    const markdown = [
        '# Agent Evaluation Report',
        '',
        `Results: ${options.results}`,
        '',
        `| ${header.join(' | ')} |`,
        `| ${header.map(() => '---').join(' | ')} |`,
        ...rows.map(
            (row) =>
                `| ${header.map((name) => String(row[name as keyof SummaryRow])).join(' | ')} |`
        ),
        ''
    ].join('\n')
    writeFileSync(reportPath, markdown, 'utf8')
    console.log(
        JSON.stringify({
            command: 'report',
            results: options.results,
            summary: summaryPath,
            report: reportPath,
            rows
        })
    )
}

function main() {
    const options = parseArgs(process.argv.slice(2))
    const config = loadConfig()
    if (options.command === 'doctor') {
        console.log(JSON.stringify(runDoctor(config)))
        return
    }
    if (options.command === 'context') {
        runContext(options, config)
        return
    }
    runReport(options)
}

try {
    main()
} catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
}
