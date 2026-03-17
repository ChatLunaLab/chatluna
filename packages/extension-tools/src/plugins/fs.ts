import { StructuredTool, ToolParams } from '@langchain/core/tools'
import fs from 'fs/promises'
import { spawn } from 'node:child_process'
import { Context, Session } from 'koishi'
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
import which from 'which'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    const agent = (ctx as Context & { chatluna_agent?: { computer?: unknown } })
        .chatluna_agent

    if (agent?.computer) {
        ctx.logger.warn(
            '[chatluna-plugin-common] fs tools are now managed by extension-agent. Skipping registration.'
        )
        return
    }

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
        description: new ReadFileTool({ store, config }).description,
        selector: fsSelector,
        createTool: () => new ReadFileTool({ store, config })
    })

    plugin.registerTool('file_write', {
        description: new WriteFileTool({ store, config }).description,
        selector: fsSelector,
        createTool: () => new WriteFileTool({ store, config })
    })

    plugin.registerTool('file_edit', {
        description: new EditFileTool({ store, config }).description,
        selector: fsSelector,
        createTool: () => new EditFileTool({ store, config })
    })

    plugin.registerTool('grep', {
        description: new GrepTool({ store, config }).description,
        selector: fsSelector,
        createTool: () => new GrepTool({ store, config })
    })

    plugin.registerTool('glob', {
        description: new GlobTool({ store, config }).description,
        selector: fsSelector,
        createTool: () => new GlobTool({ store, config })
    })

    plugin.registerTool('bash', {
        description: new BashTool({
            store,
            config,
            scopePath: config.fsScopePath ?? '',
            allowedCommands: config.bashAllowedCommands ?? [],
            blockedCommands: config.bashBlockedCommands ?? [],
            timeout: config.bashTimeout ?? 30000,
            autoExecute: config.bashAutoExecute ?? false
        }).description,
        selector: fsSelector,
        createTool: () =>
            new BashTool({
                store,
                config,
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
// Notify helper
// ---------------------------------------------------------------------------

async function notify(session: Session | undefined, msg: string) {
    if (session) {
        await session.send(msg)
    }
}

// ---------------------------------------------------------------------------
// Tools
// ---------------------------------------------------------------------------

interface ReadFileParams extends ToolParams {
    store: BaseFileStore
    config: Config
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
            .optional()
            .describe('The line number to start reading from (1-indexed).'),
        limit: z
            .number()
            .optional()
            .describe('The maximum number of lines to read (defaults to 2000).')
    })

    store: BaseFileStore
    private config: Config

    constructor({ store, config }: ReadFileParams) {
        super()
        this.store = store
        this.config = config
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const { filePath, offset, limit } = input
        const session = toolConfig?.configurable?.session

        if (this.config.fsNotify) {
            await notify(session, `读取文件: ${filePath}`)
        }

        try {
            const result = await this.store.readFile(
                filePath,
                offset,
                limit ?? 2000
            )
            if (this.config.fsNotify) {
                const lines = result.split('\n').length
                await notify(session, `完成读取: ${filePath} (${lines} 行)`)
            }
            return result
        } catch (e) {
            return 'File read failed: ' + e.message
        }
    }
}

interface WriteFileParams extends ToolParams {
    store: BaseFileStore
    config: Config
}

export class WriteFileTool extends StructuredTool {
    name = 'file_write'

    description = `Writes a file to the local filesystem.

Usage:
- This tool will overwrite the existing file if there is one at the provided path.
- ALWAYS prefer editing existing files. NEVER write new files unless explicitly required.
- Creates the file and parent directories if they don't exist.`

    schema = z.object({
        filePath: z
            .string()
            .describe(
                'The absolute path to the file to write (must be absolute, not relative).'
            ),
        content: z.string().describe('The content to write to the file.')
    })

    store: BaseFileStore
    private config: Config

    constructor({ store, config, ...rest }: WriteFileParams) {
        super(rest)
        this.store = store
        this.config = config
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const { filePath, content } = input
        const session = toolConfig?.configurable?.session

        if (this.config.fsNotify) {
            await notify(session, `写入文件: ${filePath}`)
        }

        try {
            await this.store.writeFile(filePath, content)
            if (this.config.fsNotify) {
                await notify(session, `完成写入: ${filePath}`)
            }
            return `✓ ${filePath}`
        } catch (e) {
            return `✗ ${filePath}: ${e.message}`
        }
    }
}

interface EditFileParams extends ToolParams {
    store: BaseFileStore
    config: Config
}

export class EditFileTool extends StructuredTool {
    name = 'file_edit'

    description = `Performs exact string replacement in a file.

Usage:
- The edit will FAIL if oldString is not found in the file.
- The edit will FAIL if oldString is found multiple times — provide more surrounding context to make it unique, or use replaceAll to change every instance.
- Use replaceAll for renaming variables or strings across the whole file.
- Returns context showing 10 lines before and after each change.`

    schema = z.object({
        filePath: z
            .string()
            .describe('The absolute path to the file to modify.'),
        oldString: z.string().describe('The text to replace.'),
        newString: z
            .string()
            .describe(
                'The text to replace it with (must be different from oldString).'
            ),
        replaceAll: z
            .boolean()
            .optional()
            .describe('Replace all occurrences of oldString (default false).')
    })

    store: BaseFileStore
    private config: Config

    constructor({ store, config, ...rest }: EditFileParams) {
        super(rest)
        this.store = store
        this.config = config
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const { filePath, oldString, newString, replaceAll } = input
        const session = toolConfig?.configurable?.session

        if (this.config.fsNotify) {
            await notify(session, `编辑文件: ${filePath}`)
        }

        try {
            // Check uniqueness when replaceAll is not set
            const content = await fs
                .readFile(filePath, 'utf-8')
                .catch(() => null)
            if (content === null) {
                return `File edit failed: could not read ${filePath}`
            }

            if (!content.includes(oldString)) {
                return `oldString not found in ${filePath}`
            }

            if (!replaceAll) {
                const firstIdx = content.indexOf(oldString)
                const secondIdx = content.indexOf(oldString, firstIdx + 1)
                if (secondIdx !== -1) {
                    return `Found multiple matches for oldString in ${filePath}. Provide more surrounding lines in oldString to identify the correct match, or set replaceAll to change every instance.`
                }
            }

            const replaceCount = replaceAll ? undefined : 1
            const result = await this.store.editFile(
                filePath,
                oldString,
                newString,
                replaceCount
            )

            if (!result.success) {
                return `oldString not found in ${filePath}`
            }

            if (this.config.fsNotify) {
                await notify(
                    session,
                    `完成编辑: ${filePath} (替换 ${result.replacements} 处)`
                )
            }

            return `Replaced ${result.replacements} occurrence(s) in ${filePath}\n\nContext (> marks modified lines):\n${result.context}`
        } catch (e) {
            return 'File edit failed: ' + e.message
        }
    }
}

interface GrepParams extends ToolParams {
    store: BaseFileStore
    config: Config
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
    private config: Config

    constructor({ store, config, ...rest }: GrepParams) {
        super(rest)
        this.store = store
        this.config = config
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const { pattern, path: searchPath, include } = input
        const session = toolConfig?.configurable?.session

        if (this.config.fsNotify) {
            await notify(
                session,
                `搜索: ${pattern}${include ? ` (${include})` : ''}${searchPath ? ` in ${searchPath}` : ''}`
            )
        }

        try {
            const results = await this.store.grep(pattern, searchPath, include)
            if (results.length === 0) {
                return 'No matches found.'
            }

            if (this.config.fsNotify) {
                await notify(session, `找到 ${results.length} 条匹配`)
            }

            return results.join('\n')
        } catch (e) {
            return 'Grep failed: ' + e.message
        }
    }
}

interface GlobParams extends ToolParams {
    store: BaseFileStore
    config: Config
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
    private config: Config

    constructor({ store, config, ...rest }: GlobParams) {
        super(rest)
        this.store = store
        this.config = config
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ) {
        const { pattern, path: searchPath } = input
        const session = toolConfig?.configurable?.session

        if (this.config.fsNotify) {
            await notify(
                session,
                `查找文件: ${pattern}${searchPath ? ` in ${searchPath}` : ''}`
            )
        }

        try {
            const files = await this.store.glob(pattern, searchPath)
            if (files.length === 0) {
                return 'No files matched.'
            }

            if (this.config.fsNotify) {
                await notify(session, `找到 ${files.length} 个文件`)
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
    config: Config
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

            .optional()
            .describe(
                'Timeout in milliseconds. Defaults to the configured timeout.'
            )
    })

    constructor(private params: BashToolParams) {
        super()
    }

    private async _resolveShellCommand(command: string): Promise<{
        file: string
        args: string[]
        env?: NodeJS.ProcessEnv
    }> {
        if (process.platform !== 'win32') {
            return {
                file: process.env['SHELL'] || 'bash',
                args: ['-lc', command]
            }
        }

        const gitBashPath = await this._resolveWindowsGitBashPath()
        if (gitBashPath != null) {
            return {
                file: gitBashPath,
                args: ['-lc', command],
                env: {
                    ...process.env,
                    CHERE_INVOKING: '1',
                    LANG: process.env['LANG'] || 'C.UTF-8',
                    LC_ALL: process.env['LC_ALL'] || 'C.UTF-8'
                }
            }
        }

        const powershellPath =
            which.sync('pwsh.exe', { nothrow: true }) ??
            which.sync('pwsh', { nothrow: true }) ??
            which.sync('powershell.exe', { nothrow: true }) ??
            'powershell.exe'

        return {
            file: powershellPath,
            args: [
                '-NoLogo',
                '-NoProfile',
                '-NonInteractive',
                '-ExecutionPolicy',
                'Bypass',
                '-Command',
                this._buildWindowsPowerShellCommand(command)
            ],
            env: {
                ...process.env,
                PYTHONUTF8: '1',
                PYTHONIOENCODING: 'utf-8'
            }
        }
    }

    private _buildWindowsPowerShellCommand(command: string): string {
        return [
            '$OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
            '[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)',
            '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)',
            "$PSDefaultParameterValues['Out-File:Encoding'] = 'utf8'",
            "$PSDefaultParameterValues['*:Encoding'] = 'utf8'",
            'chcp.com 65001 > $null',
            command
        ].join('; ')
    }

    private async _resolveWindowsGitBashPath(): Promise<string | null> {
        if (process.platform !== 'win32') {
            return null
        }

        const exists = async (targetPath: string) => {
            try {
                await fs.access(targetPath)
                return true
            } catch {
                return false
            }
        }

        const candidateRoots = new Set<string>()
        const gitPaths = [
            which.sync('git.exe', { nothrow: true }),
            which.sync('git', { nothrow: true })
        ].filter((value): value is string => value != null)

        for (const gitPath of gitPaths) {
            const gitDir = path.dirname(gitPath)
            candidateRoots.add(path.resolve(gitDir, '..'))
            candidateRoots.add(path.resolve(gitDir, '..', '..'))
        }

        for (const envKey of [
            'ProgramW6432',
            'ProgramFiles',
            'ProgramFiles(x86)',
            'LocalAppData'
        ]) {
            const basePath = process.env[envKey]
            if (basePath != null && basePath.length > 0) {
                candidateRoots.add(path.join(basePath, 'Git'))
            }
        }

        for (const root of candidateRoots) {
            for (const relativePath of [
                'bin\\bash.exe',
                'usr\\bin\\bash.exe'
            ]) {
                const candidate = path.resolve(root, relativePath)
                if (await exists(candidate)) {
                    return candidate
                }
            }
        }

        return null
    }

    async _call(
        input: z.infer<typeof this.schema>,
        _runManager: unknown,
        toolConfig: ChatLunaToolRunnable
    ): Promise<string> {
        const { command, workdir, timeout } = input
        const {
            store,
            config,
            scopePath,
            blockedCommands,
            allowedCommands,
            autoExecute
        } = this.params

        const session = toolConfig?.configurable?.session

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

        // --- 6. Notify before execution ---
        if (config.fsNotify) {
            await notify(session, `执行命令: \`${command}\``)
        }

        // --- 7. Execute ---
        const effectiveTimeout = timeout ?? this.params.timeout
        const shellCommand = await this._resolveShellCommand(command)
        const decodeOutput = (chunks: Buffer[]) =>
            Buffer.concat(chunks).toString('utf8').replace(/\r\n/g, '\n')

        const execWithTimeout = (): Promise<{
            code: number | null
            stdout: string
            stderr: string
            signal: NodeJS.Signals | null
        }> =>
            new Promise((resolve, reject) => {
                const stdoutChunks: Buffer[] = []
                const stderrChunks: Buffer[] = []
                const child = spawn(shellCommand.file, shellCommand.args, {
                    cwd: effectiveWorkdir,
                    env: shellCommand.env,
                    stdio: ['ignore', 'pipe', 'pipe'],
                    windowsHide: true
                })

                let settled = false
                const timer = setTimeout(() => {
                    if (!settled) {
                        settled = true
                        child.kill()
                        reject(new Error(`__timeout__`))
                    }
                }, effectiveTimeout)

                child.stdout.on('data', (chunk: Buffer | string) => {
                    stdoutChunks.push(
                        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                    )
                })

                child.stderr.on('data', (chunk: Buffer | string) => {
                    stderrChunks.push(
                        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                    )
                })

                child.on('error', (error) => {
                    if (!settled) {
                        settled = true
                        clearTimeout(timer)
                        reject(error)
                    }
                })

                child.on('close', (code, signal) => {
                    if (!settled) {
                        settled = true
                        clearTimeout(timer)
                        resolve({
                            code,
                            signal,
                            stdout: decodeOutput(stdoutChunks),
                            stderr: decodeOutput(stderrChunks)
                        })
                    }
                })
            })

        try {
            const { code, stdout, stderr, signal } = await execWithTimeout()

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

            // --- 8. Notify after execution ---
            if (config.fsNotify) {
                await notify(
                    session,
                    code !== 0 || signal != null
                        ? `命令执行失败${signal != null ? ` (${signal})` : ` (exit ${code})`}`
                        : `命令执行完成`
                )
            }

            if (signal != null) {
                return `Command terminated by signal ${signal}:\n${output}`
            }

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
