import { StructuredTool, ToolParams } from '@langchain/core/tools'
import shell from 'shelljs'
import fs from 'fs/promises'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import {
    fuzzyQuery,
    getMessageContent
} from 'koishi-plugin-chatluna/utils/string'
import path from 'path'
import { Config } from '..'
import micromatch from 'micromatch'
import z from 'zod'
import {
    ChatLunaTool,
    ChatLunaToolRunnable
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { randomString } from './command'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.fs !== true) {
        return
    }

    const store = new FileStore(
        config.fsScopePath ?? '',
        config.fsIgnores ?? []
    )

    const fsSelector: ChatLunaTool['selector'] = (history) => {
        if (config.fsSelector.length === 0) {
            return true
        }
        return history.some(
            (message) =>
                message.content != null &&
                fuzzyQuery(
                    getMessageContent(message.content),
                    config.fsSelector
                )
        )
    }

    plugin.registerTool('file_read', {
        selector: fsSelector,
        createTool: () => new ReadFileTool({ store })
    })

    plugin.registerTool('file_write', {
        selector: fsSelector,
        createTool: () => new WriteFileTool({ store })
    })

    plugin.registerTool('file_edit', {
        selector: fsSelector,
        createTool: () => new EditFileTool({ store })
    })

    plugin.registerTool('grep', {
        selector: fsSelector,
        createTool: () => new GrepTool({ store })
    })

    plugin.registerTool('glob', {
        selector: fsSelector,
        createTool: () => new GlobTool({ store })
    })

    plugin.registerTool('bash', {
        selector: fsSelector,
        createTool: () =>
            new BashTool({
                store,
                scopePath: config.fsScopePath ?? '',
                allowedCommands: config.bashAllowedCommands ?? [],
                blockedCommands: config.bashBlockedCommands ?? [],
                timeout: config.bashTimeout ?? 30000,
                autoExecute: config.bashAutoExecute ?? false
            })
    })
}

// ---------------------------------------------------------------------------
// FileStore
// ---------------------------------------------------------------------------

interface BaseFileStore {
    readFile(filePath: string, offset?: number, limit?: number): Promise<string>
    writeFile(writePath: string, contents: string): Promise<void>
    editFile(
        filePath: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ): Promise<{ success: boolean; context: string; replacements: number }>
    grep(
        pattern: string,
        searchPath?: string,
        include?: string
    ): Promise<string[]>
    glob(pattern: string, searchPath?: string): Promise<string[]>
    readonly scope: string
    isInScope(filePath: string): boolean
}

export class FileStore implements BaseFileStore {
    constructor(
        private _scope: string,
        private _ignores: string[] = []
    ) {}

    get scope(): string {
        return this._scope
    }

    isInScope(filePath: string): boolean {
        if (!this._scope) return true
        return filePath.startsWith(this._scope)
    }

    async readFile(
        filePath: string,
        offset?: number,
        limit?: number
    ): Promise<string> {
        if (this._scope && !filePath.startsWith(this._scope)) {
            throw new Error(
                `path "${filePath}" is not in scope "${this._scope}"`
            )
        }

        const stat = await fs.stat(filePath)

        // Directory: list entries
        if (stat.isDirectory()) {
            const entries = await fs.readdir(filePath, { withFileTypes: true })
            const lines = entries
                .filter((e) => !this._shouldIgnore(path.join(filePath, e.name)))
                .map((e) =>
                    e.isDirectory()
                        ? `${path.join(filePath, e.name)}/`
                        : path.join(filePath, e.name)
                )
            return lines.join('\n')
        }

        // File: read with optional offset/limit, prefix each line with line number
        const raw = await fs.readFile(filePath, 'utf-8')
        const allLines = raw.split('\n')
        const totalLines = allLines.length

        const startLine = offset != null ? Math.max(0, offset - 1) : 0
        const endLine =
            limit != null ? Math.min(totalLines, startLine + limit) : totalLines

        const selectedLines = allLines.slice(startLine, endLine)
        const numbered = selectedLines.map(
            (line, i) =>
                `${startLine + i + 1}: ${line.length > 2000 ? line.slice(0, 2000) : line}`
        )

        const result = numbered.join('\n')
        const footer =
            endLine < totalLines
                ? `\n\n(Showing lines ${startLine + 1}-${endLine} of ${totalLines}. Use offset=${endLine + 1} to continue.)`
                : ''

        return result + footer
    }

    async writeFile(writePath: string, contents: string): Promise<void> {
        if (this._scope && !writePath.startsWith(this._scope)) {
            throw new Error(
                `path "${writePath}" is not in scope "${this._scope}"`
            )
        }

        const dir = path.dirname(writePath)
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(writePath, contents)
    }

    async editFile(
        filePath: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ): Promise<{ success: boolean; context: string; replacements: number }> {
        if (this._scope && !filePath.startsWith(this._scope)) {
            throw new Error(
                `path "${filePath}" is not in scope "${this._scope}"`
            )
        }

        const content = await fs.readFile(filePath, 'utf-8')
        const lines = content.split('\n')

        if (!content.includes(oldString)) {
            return { success: false, context: '', replacements: 0 }
        }

        let replacements = 0
        const modifiedLines: number[] = []
        const newLines = [...lines]

        for (let i = 0; i < newLines.length; i++) {
            if (newLines[i].includes(oldString)) {
                if (replaceCount === undefined || replacements < replaceCount) {
                    newLines[i] = newLines[i].replaceAll(oldString, newString)
                    modifiedLines.push(i)
                    replacements++
                }
            }
        }

        await fs.writeFile(filePath, newLines.join('\n'))

        const contextLines: string[] = []
        const contextSet = new Set<number>()

        for (const lineNum of modifiedLines) {
            const start = Math.max(0, lineNum - 10)
            const end = Math.min(newLines.length - 1, lineNum + 10)
            for (let i = start; i <= end; i++) contextSet.add(i)
        }

        for (const lineNum of Array.from(contextSet).sort((a, b) => a - b)) {
            const marker = modifiedLines.includes(lineNum) ? '>' : ' '
            contextLines.push(`${marker} ${lineNum + 1}: ${newLines[lineNum]}`)
        }

        return {
            success: true,
            context: contextLines.join('\n'),
            replacements
        }
    }

    async grep(
        pattern: string,
        searchPath?: string,
        include?: string
    ): Promise<string[]> {
        const searchDir = searchPath || this._scope || process.cwd()

        if (this._scope && !searchDir.startsWith(this._scope)) {
            throw new Error(
                `path "${searchDir}" is not in scope "${this._scope}"`
            )
        }

        const stat = await fs.stat(searchDir).catch(() => null)
        const targets: string[] = stat?.isDirectory()
            ? await this._findFiles(searchDir, include)
            : include == null || this._matchPattern(searchDir, include)
              ? [searchDir]
              : []

        const regex = new RegExp(pattern, 'gm')
        const results: { file: string; mtime: number; lines: string[] }[] = []

        for (const file of targets) {
            if (this._shouldIgnore(file)) continue
            try {
                const fileStat = await fs.stat(file)
                if (!fileStat.isFile()) continue
                const content = await fs.readFile(file, 'utf-8')
                const lines = content.split('\n')
                const matched: string[] = []
                for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                        matched.push(`${file}:${i + 1}:${lines[i]}`)
                    }
                    regex.lastIndex = 0
                }
                if (matched.length > 0) {
                    results.push({
                        file,
                        mtime: fileStat.mtimeMs,
                        lines: matched
                    })
                }
            } catch {
                continue
            }
        }

        // Sort by modification time descending (most recently modified first)
        results.sort((a, b) => b.mtime - a.mtime)
        return results.flatMap((r) => r.lines)
    }

    async glob(pattern: string, searchPath?: string): Promise<string[]> {
        const searchDir = searchPath || this._scope || process.cwd()

        if (this._scope && !searchDir.startsWith(this._scope)) {
            throw new Error(
                `path "${searchDir}" is not in scope "${this._scope}"`
            )
        }

        const stat = await fs.stat(searchDir).catch(() => null)
        if (!stat?.isDirectory()) {
            return this._matchPattern(searchDir, pattern) ? [searchDir] : []
        }

        const files = await this._findFiles(searchDir, pattern)

        // Sort by modification time descending
        const withMtime = await Promise.all(
            files.map(async (f) => {
                const s = await fs.stat(f).catch(() => null)
                return { path: f, mtime: s?.mtimeMs ?? 0 }
            })
        )
        withMtime.sort((a, b) => b.mtime - a.mtime)
        return withMtime.map((f) => f.path)
    }

    private async _findFiles(
        dirPath: string,
        pattern?: string
    ): Promise<string[]> {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true })
            const results: string[] = []
            const subdirPromises: Promise<string[]>[] = []

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name)
                if (this._shouldIgnore(fullPath)) continue

                if (entry.isDirectory()) {
                    subdirPromises.push(this._findFiles(fullPath, pattern))
                } else if (entry.isFile()) {
                    if (!pattern || this._matchPattern(fullPath, pattern)) {
                        results.push(fullPath)
                    }
                } else if (entry.isSymbolicLink()) {
                    try {
                        const s = await fs.stat(fullPath)
                        if (s.isFile()) {
                            if (
                                !pattern ||
                                this._matchPattern(fullPath, pattern)
                            ) {
                                results.push(fullPath)
                            }
                        } else if (s.isDirectory()) {
                            subdirPromises.push(
                                this._findFiles(fullPath, pattern)
                            )
                        }
                    } catch {
                        // skip broken symlinks
                    }
                }
            }

            const sub = await Promise.all(subdirPromises)
            return results.concat(...sub)
        } catch {
            return []
        }
    }

    private _matchPattern(filePath: string, pattern: string): boolean {
        const base = this._scope || process.cwd()
        const relativePath = path.relative(base, filePath)
        const fileName = path.basename(filePath)
        return (
            micromatch.isMatch(relativePath, pattern, { dot: true }) ||
            micromatch.isMatch(filePath, pattern, { dot: true }) ||
            micromatch.isMatch(fileName, pattern, { dot: true }) ||
            micromatch.isMatch(relativePath.replace(/\\/g, '/'), pattern, {
                dot: true
            })
        )
    }

    private _shouldIgnore(filePath: string): boolean {
        if (this._ignores.length === 0) return false
        const base = this._scope || process.cwd()
        const relativePath = path.relative(base, filePath).replace(/\\/g, '/')
        return micromatch.isMatch(relativePath, this._ignores, { dot: true })
    }
}

// ---------------------------------------------------------------------------
// High-risk command detection
// ---------------------------------------------------------------------------

/**
 * Patterns that are considered high-risk and require user confirmation.
 * These are checked against the raw command string.
 */
const HIGH_RISK_PATTERNS: RegExp[] = [
    // destructive file operations
    /\brm\b/,
    /\brmdir\b/,
    /\bdel\b/i,
    /\brd\b/,
    /\bformat\b/i,
    /\bshred\b/,
    // privilege escalation
    /\bsudo\b/,
    /\bsu\b(?:\s|$)/,
    /\brunas\b/i,
    /\bchmod\b/,
    /\bchown\b/,
    // network/download execution
    /\bcurl\b.*\|\s*(?:ba)?sh/,
    /\bwget\b.*\|\s*(?:ba)?sh/,
    // process kill
    /\bkill\b/,
    /\btaskkill\b/i,
    // package managers with install/uninstall (potential side effects)
    /\bnpm\s+(?:install|uninstall|publish)\b/,
    /\bpnpm\s+(?:install|uninstall|publish)\b/,
    /\byarn\s+(?:add|remove)\b/,
    /\bpip\s+(?:install|uninstall)\b/,
    // registry / system config
    /\breg\s+(?:add|delete|import|export)\b/i,
    /\bsysctl\b/,
    // disk operations
    /\bdd\b/,
    /\bmkfs\b/,
    /\bfdisk\b/,
    /\bdiskpart\b/i
]

function isHighRisk(command: string): boolean {
    return HIGH_RISK_PATTERNS.some((re) => re.test(command))
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

interface ReadFileParams extends ToolParams {
    store: BaseFileStore
}

export class ReadFileTool extends StructuredTool {
    name = 'file_read'

    description = `Read a file or directory from the local filesystem. If the path does not exist, an error is returned.

Usage:
- By default returns up to 2000 lines from the start of the file
- Use offset (1-indexed line number) to read later sections
- Use limit to control how many lines to return
- For directories, lists entries one per line with trailing / for subdirectories
- File content is returned with each line prefixed by its line number as \`<line>: <content>\``

    schema = z.object({
        filePath: z
            .string()
            .describe('The absolute path to the file or directory to read.'),
        offset: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('The line number to start reading from (1-indexed).'),
        limit: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('The maximum number of lines to read (defaults to 2000).')
    })

    store: BaseFileStore

    constructor({ store }: ReadFileParams) {
        super()
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { filePath, offset, limit } = input
        try {
            return await this.store.readFile(filePath, offset, limit ?? 2000)
        } catch (e) {
            return 'File read failed: ' + e.message
        }
    }
}

interface WriteFileParams extends ToolParams {
    store: BaseFileStore
}

export class WriteFileTool extends StructuredTool {
    name = 'file_write'

    description =
        "Write text content to one or more files on disk. Creates files (and parent directories) if they don't exist, overwrites if they do."

    schema = z.object({
        files: z
            .array(
                z.object({
                    filePath: z
                        .string()
                        .describe('The absolute path to write the file.'),
                    text: z
                        .string()
                        .describe('The content to write to the file.')
                })
            )
            .min(1)
            .describe('One or more files to write.')
    })

    store: BaseFileStore

    constructor({ store, ...rest }: WriteFileParams) {
        super(rest)
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { files } = input
        const results: string[] = []
        for (const { filePath, text } of files) {
            try {
                await this.store.writeFile(filePath, text)
                results.push(`✓ ${filePath}`)
            } catch (e) {
                results.push(`✗ ${filePath}: ${e.message}`)
            }
        }
        return results.join('\n')
    }
}

interface EditFileParams extends ToolParams {
    store: BaseFileStore
}

export class EditFileTool extends StructuredTool {
    name = 'file_edit'

    description =
        'Replace text in a file with an optional replacement count limit. Returns context showing 10 lines before and after each change. Fails clearly when the old string is not found.'

    schema = z.object({
        filePath: z.string().describe('The absolute path to the file to edit.'),
        oldString: z.string().describe('The exact text to find and replace.'),
        newString: z.string().describe('The replacement text.'),
        replaceCount: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
                'Maximum replacements to make. Replaces all occurrences when omitted.'
            )
    })

    store: BaseFileStore

    constructor({ store, ...rest }: EditFileParams) {
        super(rest)
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { filePath, oldString, newString, replaceCount } = input
        try {
            const result = await this.store.editFile(
                filePath,
                oldString,
                newString,
                replaceCount
            )

            if (!result.success) {
                return `No occurrences of the specified string found in ${filePath}`
            }

            return `Replaced ${result.replacements} occurrence(s) in ${filePath}\n\nContext (> marks modified lines):\n${result.context}`
        } catch (e) {
            return 'File edit failed: ' + e.message
        }
    }
}

interface GrepParams extends ToolParams {
    store: BaseFileStore
}

export class GrepTool extends StructuredTool {
    name = 'grep'

    description = `Fast content search tool that works with any codebase size.
- Searches file contents using regular expressions
- Supports full regex syntax (eg. "log.*Error", "function\\s+\\w+", etc.)
- Filter files by glob pattern with the include parameter (eg. "*.js", "*.{ts,tsx}")
- Returns file paths and line numbers with at least one match, sorted by modification time`

    schema = z.object({
        pattern: z
            .string()
            .describe('The regex pattern to search for in file contents.'),
        path: z
            .string()
            .optional()
            .describe(
                'The directory to search in. Defaults to the scope path.'
            ),
        include: z
            .string()
            .optional()
            .describe(
                'File glob pattern to include in the search (e.g. "*.js", "*.{ts,tsx}").'
            )
    })

    store: BaseFileStore

    constructor({ store, ...rest }: GrepParams) {
        super(rest)
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { pattern, path: searchPath, include } = input
        try {
            const results = await this.store.grep(pattern, searchPath, include)
            if (results.length === 0) {
                return 'No matches found.'
            }
            return results.join('\n')
        } catch (e) {
            return 'Grep failed: ' + e.message
        }
    }
}

interface GlobParams extends ToolParams {
    store: BaseFileStore
}

export class GlobTool extends StructuredTool {
    name = 'glob'

    description = `Fast file pattern matching tool that works with any codebase size.
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time`

    schema = z.object({
        pattern: z
            .string()
            .describe('The glob pattern to match files against.'),
        path: z
            .string()
            .optional()
            .describe('The directory to search in. Defaults to the scope path.')
    })

    store: BaseFileStore

    constructor({ store, ...rest }: GlobParams) {
        super(rest)
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { pattern, path: searchPath } = input
        try {
            const files = await this.store.glob(pattern, searchPath)
            if (files.length === 0) {
                return 'No files matched.'
            }
            return files.join('\n')
        } catch (e) {
            return 'Glob failed: ' + e.message
        }
    }
}

// ---------------------------------------------------------------------------
// BashTool
// ---------------------------------------------------------------------------

interface BashToolParams extends ToolParams {
    store: BaseFileStore
    scopePath: string
    allowedCommands: string[]
    blockedCommands: string[]
    timeout: number
    autoExecute: boolean
}

export class BashTool extends StructuredTool {
    name = 'bash'

    description = `Execute a shell command. Automatically uses the correct shell for the current platform (cmd/PowerShell on Windows, sh/bash on Unix).

Rules:
- Working directory defaults to the configured scope path
- Absolute paths outside the scope path are blocked
- Certain high-risk commands require explicit user confirmation
- Commands in the blocked list are always rejected
- Output is capped at 8000 characters

When to use:
- File listing, searching (ls, find, grep, rg, fd)
- Running build tools, tests, scripts
- Renaming, moving, copying files
- Any shell operation not covered by the dedicated file tools`

    schema = z.object({
        command: z.string().describe('The shell command to execute.'),
        workdir: z
            .string()
            .optional()
            .describe(
                'Working directory for the command. Defaults to the scope path. Must be within the scope path when scope is set.'
            ),
        timeout: z
            .number()
            .int()
            .positive()
            .optional()
            .describe(
                'Timeout in milliseconds. Defaults to the configured timeout.'
            )
    })

    constructor(private params: BashToolParams) {
        super()
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        config: ChatLunaToolRunnable
    ): Promise<string> {
        const { command, workdir, timeout } = input
        const {
            store,
            scopePath,
            blockedCommands,
            allowedCommands,
            autoExecute
        } = this.params

        // --- 1. Blocked commands check ---
        const baseCmd = command.trim().split(/\s+/)[0].toLowerCase()
        if (blockedCommands.some((b) => baseCmd === b.toLowerCase())) {
            return `Command "${baseCmd}" is blocked by configuration.`
        }

        // --- 2. Allowed list check (when non-empty, acts as whitelist) ---
        if (
            allowedCommands.length > 0 &&
            !allowedCommands.some((a) => baseCmd === a.toLowerCase())
        ) {
            return `Command "${baseCmd}" is not in the allowed commands list.`
        }

        // --- 3. Working directory scope check ---
        const effectiveWorkdir = workdir || scopePath || process.cwd()
        if (scopePath) {
            const resolvedWorkdir = path.resolve(effectiveWorkdir)
            const resolvedScope = path.resolve(scopePath)
            if (!resolvedWorkdir.startsWith(resolvedScope)) {
                return `Working directory "${effectiveWorkdir}" is outside the configured scope path "${scopePath}".`
            }
        }

        // --- 4. Scope path reference check in the command itself ---
        if (scopePath) {
            // Detect absolute paths in the command that escape scope
            const absolutePathPattern = /(?:^|\s)(\/[^\s]+|[A-Za-z]:[^\s]+)/g
            const matches = command.matchAll(absolutePathPattern)
            for (const match of matches) {
                const p = match[1]
                if (!store.isInScope(path.resolve(p))) {
                    return `Command references path "${p}" which is outside the scope path "${scopePath}".`
                }
            }
        }

        // --- 5. High-risk command confirmation ---
        if (!autoExecute && isHighRisk(command)) {
            const session = config?.configurable?.session
            if (session) {
                const token = randomString(8)
                await session.send(
                    `模型请求执行高危命令：\n\`${command}\`\n如需同意，请输入以下字符：${token}`
                )
                const reply = await session.prompt()
                if (reply?.trim() !== token) {
                    return `Command execution cancelled: user did not confirm the high-risk operation.`
                }
            }
        }

        // --- 6. Execute ---
        const effectiveTimeout = timeout ?? this.params.timeout

        // shelljs.exec with async:true + silent:true, wrapped in a Promise with timeout
        const execWithTimeout = (): Promise<{
            code: number
            stdout: string
            stderr: string
        }> =>
            new Promise((resolve, reject) => {
                const prevDir = shell.pwd().stdout
                shell.cd(effectiveWorkdir)

                let settled = false
                const timer = setTimeout(() => {
                    if (!settled) {
                        settled = true
                        shell.cd(prevDir)
                        reject(new Error(`__timeout__`))
                    }
                }, effectiveTimeout)

                shell.exec(
                    command,
                    { async: true, silent: true },
                    (code, stdout, stderr) => {
                        if (!settled) {
                            settled = true
                            clearTimeout(timer)
                            shell.cd(prevDir)
                            resolve({ code, stdout, stderr })
                        }
                    }
                )
            })

        try {
            const { code, stdout, stderr } = await execWithTimeout()

            const outputParts: string[] = []

            if (stdout) {
                const truncated =
                    stdout.length > 8000
                        ? stdout.slice(0, 8000) + '\n...[output truncated]'
                        : stdout
                outputParts.push(truncated)
            }

            if (stderr) {
                const truncatedErr =
                    stderr.length > 2000
                        ? stderr.slice(0, 2000) + '\n...[stderr truncated]'
                        : stderr
                outputParts.push(`[stderr]\n${truncatedErr}`)
            }

            const output = outputParts.join('\n') || '(no output)'

            if (code !== 0) {
                return `Command exited with code ${code}:\n${output}`
            }

            return output
        } catch (e) {
            if (e.message === '__timeout__') {
                return `Command timed out after ${effectiveTimeout}ms.`
            }
            return `Command execution failed: ${e.message}`
        }
    }
}
