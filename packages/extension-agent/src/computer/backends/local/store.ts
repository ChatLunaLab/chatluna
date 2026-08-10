/** @module computer/backends/local/store */

import { type ChildProcessWithoutNullStreams, spawn } from 'child_process'
import { createReadStream, realpathSync } from 'fs'
import fs from 'fs/promises'
import path from 'path'
import { createInterface } from 'readline'
import type { Readable } from 'stream'
import micromatch from 'micromatch'
import which from 'which'
import { LocalBackendConfig } from '../../../types'
import type {
    EditResult,
    FileContent,
    TextOutput,
    WriteResult
} from '../../types'
import { replaceFileContent } from '../../file_changes'
import { LocalOutputCollector } from './output'
import { logger } from '../../..'
import { ensureLocalPathAccess, isInsideRoot } from './sandbox'

const rg = which.sync('rg', { nothrow: true })
const INTERNAL_IGNORES = ['**/.tmp-chatluna-*']

export interface BaseFileStore {
    readFile(filePath: string, offset?: number, limit?: number): Promise<string>
    writeFile(writePath: string, contents: FileContent): Promise<WriteResult>
    editFile(
        filePath: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ): Promise<EditResult>
    grep(
        pattern: string,
        searchPath?: string,
        include?: string
    ): Promise<string[] | TextOutput>
    glob(pattern: string, searchPath?: string): Promise<string[] | TextOutput>
    readonly scope: string
    isInScope(filePath: string): boolean
}

export class FileStore implements BaseFileStore {
    constructor(
        private _cfg: LocalBackendConfig,
        private _tmp: string
    ) {}

    get scope() {
        const value = path.resolve(this._cfg.scopePath || process.cwd())
        try {
            return realpathSync.native(value)
        } catch {
            return value
        }
    }

    isInScope(filePath: string) {
        if (this._cfg.dangerouslySkipPermissions) return true
        return isInsideRoot(filePath, this.scope)
    }

    async readFile(filePath: string, offset?: number, limit?: number) {
        await ensureLocalPathAccess(filePath, this._cfg, 'read', this._tmp)
        const stat = await fs.stat(filePath)
        if (stat.isDirectory()) {
            const result: string[] = []
            for (const entry of await fs.readdir(filePath, {
                withFileTypes: true
            })) {
                const item = path.join(filePath, entry.name)
                if (this._shouldIgnore(item)) continue
                try {
                    await ensureLocalPathAccess(
                        item,
                        this._cfg,
                        'read',
                        this._tmp
                    )
                } catch {
                    continue
                }

                if (entry.isDirectory()) {
                    result.push(`${item}/`)
                    continue
                }

                if (entry.isFile()) {
                    result.push(item)
                    continue
                }

                if (!entry.isSymbolicLink()) continue
                try {
                    if ((await fs.stat(item)).isFile()) result.push(item)
                } catch {}
            }
            return result.join('\n')
        }

        const lines = (await fs.readFile(filePath, 'utf-8')).split('\n')
        const start = offset != null ? Math.max(0, offset - 1) : 0
        const end =
            limit != null ? Math.min(lines.length, start + limit) : lines.length
        const result = lines
            .slice(start, end)
            .map((line, idx) => {
                return `${start + idx + 1}: ${line.length > 2000 ? line.slice(0, 2000) : line}`
            })
            .join('\n')

        if (end >= lines.length) {
            return result
        }

        return `${result}\n\n(Showing lines ${start + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.)`
    }

    async writeFile(
        writePath: string,
        contents: FileContent
    ): Promise<WriteResult> {
        await ensureLocalPathAccess(writePath, this._cfg, 'write', this._tmp)
        if (typeof contents === 'string') {
            const before = await fs
                .readFile(writePath, 'utf-8')
                .catch((err) => {
                    if ((err as NodeJS.ErrnoException).code === 'ENOENT')
                        return ''
                    throw err
                })
            if (before === contents) {
                return { type: 'text', before, after: contents }
            }

            await fs.mkdir(path.dirname(writePath), { recursive: true })
            await fs.writeFile(writePath, contents)
            return { type: 'text', before, after: contents }
        }

        await fs.mkdir(path.dirname(writePath), { recursive: true })
        await fs.writeFile(writePath, contents)
        return { type: 'binary' }
    }

    async editFile(
        filePath: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ) {
        await ensureLocalPathAccess(filePath, this._cfg, 'write', this._tmp)
        const result = replaceFileContent(
            await fs.readFile(filePath, 'utf-8'),
            oldString,
            newString,
            replaceCount
        )

        if (!result.success) return result
        if (result.before === result.after) return result

        await fs.writeFile(filePath, result.after)
        return result
    }

    async grep(pattern: string, searchPath?: string, include?: string) {
        const dir = searchPath || this.scope
        await ensureLocalPathAccess(dir, this._cfg, 'read', this._tmp)

        const stat = await fs.stat(dir).catch(() => null)
        if (!stat) {
            return []
        }

        if (stat.isDirectory() && rg) {
            const args = [
                '--json',
                '-n',
                '--hidden',
                '--no-ignore',
                '--color',
                'never',
                '--engine',
                'auto'
            ]

            if (include) {
                args.push('-g', include)
            }

            for (const item of [...this._cfg.ignores, ...INTERNAL_IGNORES]) {
                args.push('-g', `!${item}`)
            }

            args.push('-e', pattern, '.')

            const output = new LocalOutputCollector('grep', this._tmp)
            try {
                const found = await this._runRg(args, dir, async (stdout) => {
                    for await (const line of createInterface({
                        input: stdout,
                        crlfDelay: Infinity
                    })) {
                        const item = JSON.parse(line)
                        if (item.type !== 'match') continue

                        const raw = item.data.path.text as string | undefined
                        if (!raw) continue

                        const file = path.resolve(dir, raw)
                        if (this._shouldIgnore(file)) continue
                        if (include && !this._matchPattern(file, include))
                            continue
                        try {
                            await ensureLocalPathAccess(
                                file,
                                this._cfg,
                                'read',
                                this._tmp
                            )
                        } catch {
                            continue
                        }

                        const text = (
                            (item.data.lines.text as string | undefined) || ''
                        ).replace(/\r?\n$/, '')
                        await output.appendLine(
                            `${file}:${item.data.line_number}:${text}`
                        )
                    }
                })
                if (!found) {
                    await output.dispose()
                    return []
                }
                return await output.finish()
            } catch (err) {
                if (output.count > 0) {
                    return await output.finish()
                }
                await output.dispose()
                logger.warn(err)
            }
        }

        const regex = new RegExp(pattern, 'gm')
        return await this._scanFallback(
            'grep',
            stat.isDirectory() ? this._walk(dir) : [dir],
            async (output, file) => {
                if (include && !this._matchPattern(file, include)) return

                let lineNumber = 0
                try {
                    for await (const line of createInterface({
                        input: createReadStream(file),
                        crlfDelay: Infinity
                    })) {
                        lineNumber += 1
                        if (regex.test(line)) {
                            await output.appendLine(
                                `${file}:${lineNumber}:${line}`
                            )
                        }
                        regex.lastIndex = 0
                    }
                } catch (err) {
                    if (process.env['CHATLUNA_AGENT_DEBUG']) {
                        console.debug(err)
                    }
                }
            }
        )
    }

    async glob(pattern: string, searchPath?: string) {
        const dir = searchPath || this.scope
        await ensureLocalPathAccess(dir, this._cfg, 'read', this._tmp)

        const stat = await fs.stat(dir).catch(() => null)
        if (!stat) {
            return []
        }

        if (!stat.isDirectory()) {
            return this._matchPattern(dir, pattern) ? [dir] : []
        }

        if (rg) {
            const args = ['--files', '--hidden', '--no-ignore', '-0']

            args.push('-g', pattern)
            for (const item of [...this._cfg.ignores, ...INTERNAL_IGNORES]) {
                args.push('-g', `!${item}`)
            }

            args.push('.')

            const output = new LocalOutputCollector('glob', this._tmp)
            try {
                const found = await this._runRg(args, dir, async (stdout) => {
                    let rest = ''
                    for await (const chunk of stdout) {
                        const files = `${rest}${chunk}`.split('\0')
                        rest = files.pop()!
                        for (const raw of files) {
                            const file = path.resolve(dir, raw)
                            if (this._shouldIgnore(file)) continue
                            if (!this._matchPattern(file, pattern)) continue
                            try {
                                await ensureLocalPathAccess(
                                    file,
                                    this._cfg,
                                    'read',
                                    this._tmp
                                )
                            } catch {
                                continue
                            }
                            await output.appendLine(file)
                        }
                    }
                })
                if (!found) {
                    await output.dispose()
                    return []
                }
                return await output.finish()
            } catch (err) {
                if (output.count > 0) {
                    return await output.finish()
                }
                await output.dispose()
                logger.warn(err)
            }
        }

        return await this._scanFallback(
            'glob',
            this._walk(dir),
            async (output, file) => {
                if (!this._matchPattern(file, pattern)) return
                await output.appendLine(file)
            }
        )
    }

    private async _runRg(
        args: string[],
        dir: string,
        consume: (stdout: Readable) => Promise<void>
    ): Promise<boolean> {
        let child: ChildProcessWithoutNullStreams | undefined
        let closed: Promise<number> | undefined
        let spawnError: Error | undefined
        try {
            child = spawn(rg, args, {
                cwd: dir,
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true
            })
            let stderr = ''
            child.stderr.setEncoding('utf8')
            child.stderr.on('data', (text: string) => {
                stderr += text.slice(0, 8000 - stderr.length)
            })
            child.stdout.setEncoding('utf8')
            closed = new Promise<number>((resolve) => {
                child!.on('error', (err) => {
                    spawnError = err
                })
                child.on('close', (code) => resolve(code ?? 0))
            })
            const timeout = this._cfg.commandTimeoutMs
            let timedOut = false
            const timer =
                timeout > 0
                    ? setTimeout(() => {
                          timedOut = true
                          if (
                              child &&
                              child.exitCode == null &&
                              child.signalCode == null
                          ) {
                              child.kill()
                          }
                      }, timeout)
                    : undefined
            try {
                await consume(child.stdout)
                const exitCode = await closed
                if (spawnError) throw spawnError
                if (timedOut) {
                    throw new Error(`ripgrep timed out after ${timeout}ms`)
                }
                if (exitCode === 1) return false
                if (exitCode !== 0) {
                    throw new Error(
                        stderr.trim() || `ripgrep exited with ${exitCode}`
                    )
                }
                return true
            } finally {
                if (timer) clearTimeout(timer)
            }
        } catch (err) {
            if (child && child.exitCode == null && child.signalCode == null) {
                child.kill()
            }
            await closed
            throw err
        }
    }

    private async _scanFallback(
        name: string,
        files: AsyncIterable<string> | Iterable<string>,
        collect: (output: LocalOutputCollector, file: string) => Promise<void>
    ): Promise<TextOutput> {
        const output = new LocalOutputCollector(name, this._tmp)
        try {
            for await (const file of files) {
                if (this._shouldIgnore(file)) continue
                await collect(output, file)
            }
            return await output.finish()
        } catch (err) {
            await output.dispose()
            throw err
        }
    }

    private async *_walk(
        dirPath: string,
        seen = new Set<string>()
    ): AsyncGenerator<string> {
        const real = await fs.realpath(dirPath).catch(() => dirPath)
        if (seen.has(real)) return
        seen.add(real)
        try {
            for await (const entry of await fs.opendir(dirPath)) {
                const fullPath = path.join(dirPath, entry.name)
                if (this._shouldIgnore(fullPath)) continue

                if (entry.isDirectory()) {
                    yield* this._walk(fullPath, seen)
                    continue
                }

                if (entry.isFile()) {
                    yield fullPath
                    continue
                }

                if (!entry.isSymbolicLink()) continue

                try {
                    const stat = await fs.stat(fullPath)
                    if (!stat.isFile()) continue
                    await ensureLocalPathAccess(
                        fullPath,
                        this._cfg,
                        'read',
                        this._tmp
                    )
                    yield fullPath
                } catch (err) {
                    if (process.env['CHATLUNA_AGENT_DEBUG']) {
                        console.debug(err)
                    }
                }
            }
        } catch (err) {
            if (process.env['CHATLUNA_AGENT_DEBUG']) {
                console.debug(err)
            }
        }
    }

    private _matchPattern(filePath: string, pattern: string) {
        const rel = path.relative(this.scope, filePath).replaceAll('\\', '/')
        return micromatch.some(
            [rel, filePath.replaceAll('\\', '/'), path.basename(filePath)],
            pattern,
            { dot: true }
        )
    }

    private _shouldIgnore(filePath: string) {
        return micromatch.isMatch(
            path.relative(this.scope, filePath).replace(/\\/g, '/'),
            [...this._cfg.ignores, ...INTERNAL_IGNORES],
            { dot: true }
        )
    }
}
