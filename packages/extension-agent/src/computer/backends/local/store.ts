/** @module computer/backends/local/store */

import { spawn } from 'node:child_process'
import fs from 'fs/promises'
import path from 'path'
import micromatch from 'micromatch'
import which from 'which'
import { LocalBackendConfig } from '../../../types'
import type { FileContent } from '../../types'

const rg = which.sync('rg', { nothrow: true })

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
    ): Promise<string[]>
    glob(pattern: string, searchPath?: string): Promise<string[]>
    readonly scope: string
    isInScope(filePath: string): boolean
}

export class FileStore implements BaseFileStore {
    constructor(private _cfg: LocalBackendConfig) {}

    get scope() {
        return this._cfg.scopePath
    }

    isInScope(filePath: string) {
        if (!this._cfg.scopePath) {
            return true
        }

        const target = path.resolve(filePath)
        const scope = path.resolve(this._cfg.scopePath)
        return target === scope || target.startsWith(scope + path.sep)
    }

    async readFile(filePath: string, offset?: number, limit?: number) {
        this.assertInScope(filePath)

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
        this.assertInScope(writePath)

        await fs.mkdir(path.dirname(writePath), { recursive: true })
        await fs.writeFile(writePath, contents)
    }

    async editFile(
        filePath: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ) {
        this.assertInScope(filePath)
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
        this.assertInScope(dir)

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

            for (const item of this._cfg.ignores) {
                args.push('-g', `!${item}`)
            }

            args.push('-e', pattern, '.')

            try {
                const result = await runProcess(rg, args, dir)
                if (result.exitCode === 1) {
                    return []
                }

                if (result.exitCode !== 0) {
                    throw new Error(
                        result.stderr ||
                            `ripgrep exited with ${result.exitCode}`
                    )
                }

                const matched = new Map<string, string[]>()
                for (const line of result.stdout.split('\n')) {
                    if (!line) {
                        continue
                    }

                    const item = JSON.parse(line)
                    if (item.type !== 'match') {
                        continue
                    }

                    const raw = item.data.path.text as string | undefined
                    if (!raw) {
                        continue
                    }

                    const file = path.resolve(dir, raw)
                    if (this._shouldIgnore(file)) {
                        continue
                    }

                    if (include && !this._matchPattern(file, include)) {
                        continue
                    }

                    const text = (
                        (item.data.lines.text as string | undefined) || ''
                    ).replace(/\r?\n$/, '')
                    if (!matched.has(file)) {
                        matched.set(file, [])
                    }
                    matched
                        .get(file)
                        .push(`${file}:${item.data.line_number}:${text}`)
                }

                const files = await sortByMtime([...matched.keys()])
                return files.flatMap((f) => matched.get(f) || [])
            } catch (err) {
                if (process.env['CHATLUNA_AGENT_DEBUG']) {
                    console.debug(err)
                }
            }
        }

        const files = stat.isDirectory()
            ? await this._findFiles(dir, include)
            : include == null || this._matchPattern(dir, include)
              ? [dir]
              : []

        const regex = new RegExp(pattern, 'gm')
        const matched = new Map<string, string[]>()

        for (const file of files) {
            if (this._shouldIgnore(file)) {
                continue
            }

            const content = await fs.readFile(file, 'utf-8').catch(() => null)
            if (content == null) {
                continue
            }

            const lines = content.split('\n')
            const list: string[] = []
            for (let idx = 0; idx < lines.length; idx++) {
                if (regex.test(lines[idx])) {
                    list.push(`${file}:${idx + 1}:${lines[idx]}`)
                }
                regex.lastIndex = 0
            }

            if (list.length > 0) {
                matched.set(file, list)
            }
        }

        return (await sortByMtime([...matched.keys()])).flatMap(
            (f) => matched.get(f) || []
        )
    }

    async glob(pattern: string, searchPath?: string) {
        const dir = searchPath || this._cfg.scopePath || process.cwd()
        this.assertInScope(dir)

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
            for (const item of this._cfg.ignores) {
                args.push('-g', `!${item}`)
            }

            args.push('.')

            try {
                const result = await runProcess(rg, args, dir)
                if (result.exitCode !== 0) {
                    throw new Error(
                        result.stderr ||
                            `ripgrep exited with ${result.exitCode}`
                    )
                }

                return sortByMtime(
                    result.stdout
                        .split('\0')
                        .filter(Boolean)
                        .map((file) => path.resolve(dir, file))
                        .filter(
                            (file) =>
                                !this._shouldIgnore(file) &&
                                this._matchPattern(file, pattern)
                        )
                )
            } catch (err) {
                if (process.env['CHATLUNA_AGENT_DEBUG']) {
                    console.debug(err)
                }
            }
        }

        return sortByMtime(await this._findFiles(dir, pattern))
    }

    private async _findFiles(
        dirPath: string,
        pattern?: string
    ): Promise<string[]> {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true })
            const results: string[] = []

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name)
                if (this._shouldIgnore(fullPath)) {
                    continue
                }

                if (entry.isDirectory()) {
                    results.push(...(await this._findFiles(fullPath, pattern)))
                    continue
                }

                if (entry.isFile()) {
                    if (!pattern || this._matchPattern(fullPath, pattern)) {
                        results.push(fullPath)
                    }
                    continue
                }

                if (!entry.isSymbolicLink()) {
                    continue
                }

                try {
                    const stat = await fs.stat(fullPath)
                    if (stat.isDirectory()) {
                        results.push(
                            ...(await this._findFiles(fullPath, pattern))
                        )
                        continue
                    }

                    if (stat.isFile()) {
                        if (!pattern || this._matchPattern(fullPath, pattern)) {
                            results.push(fullPath)
                        }
                    }
                } catch (err) {
                    if (process.env['CHATLUNA_AGENT_DEBUG']) {
                        console.debug(err)
                    }
                }
            }

            return results
        } catch (err) {
            if (process.env['CHATLUNA_AGENT_DEBUG']) {
                console.debug(err)
            }
            return []
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
        if (this._cfg.ignores.length === 0) {
            return false
        }
        return micromatch.isMatch(
            path
                .relative(this._cfg.scopePath || process.cwd(), filePath)
                .replace(/\\/g, '/'),
            this._cfg.ignores,
            { dot: true }
        )
    }

    private assertInScope(filePath: string) {
        if (this.isInScope(filePath)) {
            return
        }

        throw new Error(
            `path "${filePath}" is not in scope "${this._cfg.scopePath}"`
        )
    }
}

function runProcess(file: string, args: string[], cwd: string) {
    return new Promise<{
        exitCode: number
        stdout: string
        stderr: string
    }>((resolve, reject) => {
        const stdout: Buffer[] = []
        const stderr: Buffer[] = []
        const child = spawn(file, args, {
            cwd,
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
        })

        child.stdout.on('data', (chunk: Buffer | string) => {
            stdout.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })

        child.stderr.on('data', (chunk: Buffer | string) => {
            stderr.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })

        child.on('error', reject)
        child.on('close', (code) => {
            resolve({
                exitCode: code ?? 0,
                stdout: Buffer.concat(stdout).toString('utf8'),
                stderr: Buffer.concat(stderr).toString('utf8').trim()
            })
        })
    })
}

async function sortByMtime(files: string[]) {
    const list = await Promise.all(
        files.map(async (file) => ({
            path: file,
            mtime: (await fs.stat(file).catch(() => null))?.mtimeMs ?? 0
        }))
    )

    list.sort((a, b) => b.mtime - a.mtime)
    return list.map((item) => item.path)
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
