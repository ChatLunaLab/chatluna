/** @module computer/backends/local/store */

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import fs from 'fs/promises'
import path from 'path'
import { createInterface } from 'node:readline'
import micromatch from 'micromatch'
import which from 'which'
import { LocalBackendConfig } from '../../../types'
import type { FileContent, TextOutput } from '../../types'
import { LocalOutputCollector } from './output'

const rg = which.sync('rg', { nothrow: true })
const INTERNAL_IGNORES = ['**/.tmp-chatluna-*']

export interface BaseFileStore {
    readFile(filePath: string, offset?: number, limit?: number): Promise<string>
    writeFile(writePath: string, contents: FileContent): Promise<void>
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
    ): Promise<string[] | TextOutput>
    glob(pattern: string, searchPath?: string): Promise<string[] | TextOutput>
    readonly scope: string
    isInScope(filePath: string): boolean
}

export class FileStore implements BaseFileStore {
    constructor(private _cfg: LocalBackendConfig) {}

    get scope() {
        return this._cfg.scopePath
    }

    isInScope(filePath: string) {
        return true
    }

    async readFile(filePath: string, offset?: number, limit?: number) {
        const stat = await fs.stat(filePath)
        if (stat.isDirectory()) {
            return (await fs.readdir(filePath, { withFileTypes: true }))
                .filter(
                    (entry) =>
                        !this._shouldIgnore(path.join(filePath, entry.name))
                )
                .map((entry) =>
                    entry.isDirectory()
                        ? `${path.join(filePath, entry.name)}/`
                        : path.join(filePath, entry.name)
                )
                .join('\n')
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

    async writeFile(writePath: string, contents: FileContent) {
        await fs.mkdir(path.dirname(writePath), { recursive: true })
        await fs.writeFile(writePath, contents)
    }

    async editFile(
        filePath: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ) {
        const next = replaceSubstring(
            await fs.readFile(filePath, 'utf-8'),
            oldString,
            newString,
            replaceCount
        )

        if (next.count < 1) {
            return { success: false, context: '', replacements: 0 }
        }

        await fs.writeFile(filePath, next.result)

        return {
            success: true,
            context: buildEditContext(next.result, oldString, newString),
            replacements: next.count
        }
    }

    async grep(pattern: string, searchPath?: string, include?: string) {
        const dir = searchPath || this._cfg.scopePath || process.cwd()

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
                '--follow',
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

            const output = new LocalOutputCollector('grep')
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
                closed = new Promise<number>((resolve) => {
                    child!.on('error', (err) => {
                        spawnError = err
                    })
                    child.on('close', (code) => resolve(code ?? 0))
                })
                let count = 0
                for await (const line of createInterface({
                    input: child.stdout,
                    crlfDelay: Infinity
                })) {
                    const item = JSON.parse(line)
                    if (item.type !== 'match') continue

                    const raw = item.data.path.text as string | undefined
                    if (!raw) continue

                    const file = path.resolve(dir, raw)
                    if (this._shouldIgnore(file)) continue
                    if (include && !this._matchPattern(file, include)) continue

                    const text = (
                        (item.data.lines.text as string | undefined) || ''
                    ).replace(/\r?\n$/, '')
                    await output.append(
                        `${count > 0 ? '\n' : ''}${file}:${item.data.line_number}:${text}`
                    )
                    count += 1
                }

                const exitCode = await closed
                if (spawnError) throw spawnError
                if (exitCode === 1) {
                    await output.dispose()
                    return []
                }

                if (exitCode !== 0) {
                    throw new Error(
                        stderr.trim() || `ripgrep exited with ${exitCode}`
                    )
                }

                if (count < 1) {
                    await output.dispose()
                    return []
                }
                return { ...(await output.finish()), count }
            } catch (err) {
                if (
                    child &&
                    child.exitCode == null &&
                    child.signalCode == null
                ) {
                    child.kill()
                }
                await closed
                await output.dispose()
                if (process.env['CHATLUNA_AGENT_DEBUG']) {
                    console.debug(err)
                }
            }
        }

        const output = new LocalOutputCollector('grep')
        const regex = new RegExp(pattern, 'gm')
        let count = 0
        try {
            for await (const file of stat.isDirectory()
                ? this._walk(dir)
                : [dir]) {
                if (this._shouldIgnore(file)) continue
                if (include && !this._matchPattern(file, include)) continue

                const lines = createInterface({
                    input: createReadStream(file),
                    crlfDelay: Infinity
                })[Symbol.asyncIterator]()
                let lineNumber = 0
                while (true) {
                    const next = await lines.next().catch((err) => {
                        if (process.env['CHATLUNA_AGENT_DEBUG']) {
                            console.debug(err)
                        }
                        return undefined
                    })
                    if (!next || next.done) break

                    lineNumber += 1
                    if (regex.test(next.value)) {
                        await output.append(
                            `${count > 0 ? '\n' : ''}${file}:${lineNumber}:${next.value}`
                        )
                        count += 1
                    }
                    regex.lastIndex = 0
                }
            }

            if (count < 1) {
                await output.dispose()
                return []
            }
            return { ...(await output.finish()), count }
        } catch (err) {
            await output.dispose()
            throw err
        }
    }

    async glob(pattern: string, searchPath?: string) {
        const dir = searchPath || this._cfg.scopePath || process.cwd()

        const stat = await fs.stat(dir).catch(() => null)
        if (!stat) {
            return []
        }

        if (!stat.isDirectory()) {
            return this._matchPattern(dir, pattern) ? [dir] : []
        }

        if (rg) {
            const args = [
                '--files',
                '--hidden',
                '--no-ignore',
                '--follow',
                '-0'
            ]

            args.push('-g', pattern)
            for (const item of [...this._cfg.ignores, ...INTERNAL_IGNORES]) {
                args.push('-g', `!${item}`)
            }

            args.push('.')

            const output = new LocalOutputCollector('glob')
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
                closed = new Promise<number>((resolve) => {
                    child!.on('error', (err) => {
                        spawnError = err
                    })
                    child.on('close', (code) => resolve(code ?? 0))
                })
                child.stdout.setEncoding('utf8')
                let rest = ''
                let count = 0
                for await (const chunk of child.stdout) {
                    const files = `${rest}${chunk}`.split('\0')
                    rest = files.pop()!
                    for (const raw of files) {
                        const file = path.resolve(dir, raw)
                        if (this._shouldIgnore(file)) continue
                        if (!this._matchPattern(file, pattern)) continue
                        await output.append(`${count > 0 ? '\n' : ''}${file}`)
                        count += 1
                    }
                }

                const exitCode = await closed
                if (spawnError) throw spawnError
                if (exitCode !== 0) {
                    throw new Error(
                        stderr.trim() || `ripgrep exited with ${exitCode}`
                    )
                }

                if (count < 1) {
                    await output.dispose()
                    return []
                }
                return { ...(await output.finish()), count }
            } catch (err) {
                if (
                    child &&
                    child.exitCode == null &&
                    child.signalCode == null
                ) {
                    child.kill()
                }
                await closed
                await output.dispose()
                if (process.env['CHATLUNA_AGENT_DEBUG']) {
                    console.debug(err)
                }
            }
        }

        const output = new LocalOutputCollector('glob')
        let count = 0
        try {
            for await (const file of this._walk(dir)) {
                if (!this._matchPattern(file, pattern)) continue
                await output.append(`${count > 0 ? '\n' : ''}${file}`)
                count += 1
            }
            if (count < 1) {
                await output.dispose()
                return []
            }
            return { ...(await output.finish()), count }
        } catch (err) {
            await output.dispose()
            throw err
        }
    }

    private async *_walk(dirPath: string): AsyncGenerator<string> {
        try {
            for await (const entry of await fs.opendir(dirPath)) {
                const fullPath = path.join(dirPath, entry.name)
                if (this._shouldIgnore(fullPath)) continue

                if (entry.isDirectory()) {
                    yield* this._walk(fullPath)
                    continue
                }

                if (entry.isFile()) {
                    yield fullPath
                    continue
                }

                if (!entry.isSymbolicLink()) continue

                try {
                    const stat = await fs.stat(fullPath)
                    if (stat.isDirectory()) {
                        yield* this._walk(fullPath)
                        continue
                    }

                    if (stat.isFile()) yield fullPath
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
        const rel = path
            .relative(this._cfg.scopePath || process.cwd(), filePath)
            .replaceAll('\\', '/')
        return micromatch.some(
            [rel, filePath.replaceAll('\\', '/'), path.basename(filePath)],
            pattern,
            { dot: true }
        )
    }

    private _shouldIgnore(filePath: string) {
        return micromatch.isMatch(
            path
                .relative(this._cfg.scopePath || process.cwd(), filePath)
                .replace(/\\/g, '/'),
            [...this._cfg.ignores, ...INTERNAL_IGNORES],
            { dot: true }
        )
    }
}

function replaceSubstring(
    content: string,
    oldString: string,
    newString: string,
    replaceCount?: number
) {
    if (!content.includes(oldString)) {
        return { result: content, count: 0 }
    }

    if (replaceCount === 1) {
        if (
            content.indexOf(
                oldString,
                content.indexOf(oldString) + oldString.length
            ) !== -1
        ) {
            throw new Error(
                'Found multiple matches for oldString. Provide more surrounding ' +
                    'lines in oldString to identify the correct match, or set ' +
                    'replaceAll to change every instance.'
            )
        }
    }

    let count = 0
    const result = content.replaceAll(oldString, (item) => {
        if (replaceCount != null && count >= replaceCount) {
            return item
        }

        count += 1
        return newString
    })

    return { result, count }
}

function buildEditContext(
    content: string,
    oldString: string,
    newString: string
): string {
    const lines = content.split('\n')
    const row = lines.findIndex((line) => line.includes(newString || oldString))
    const start = Math.max(0, row - 10)
    const end = Math.min(lines.length, row + 11)

    return lines
        .slice(start, end)
        .map(
            (line, idx) =>
                `${start + idx + 1 === row + 1 ? '>' : ' '} ${start + idx + 1}: ${line}`
        )
        .join('\n')
}
