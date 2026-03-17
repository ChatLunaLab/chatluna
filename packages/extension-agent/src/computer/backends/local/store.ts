/** @module computer/backends/local/store */

import fs from 'fs/promises'
import path from 'path'
import micromatch from 'micromatch'
import { LocalBackendConfig } from '../../../types'

export interface BaseFileStore {
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
            const entries = await fs.readdir(filePath, { withFileTypes: true })
            return entries
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

        const raw = await fs.readFile(filePath, 'utf-8')
        const lines = raw.split('\n')
        const start = offset != null ? Math.max(0, offset - 1) : 0
        const end =
            limit != null ? Math.min(lines.length, start + limit) : lines.length
        const result = lines
            .slice(start, end)
            .map((line, idx) => {
                const text = line.length > 2000 ? line.slice(0, 2000) : line
                return `${start + idx + 1}: ${text}`
            })
            .join('\n')

        if (end >= lines.length) {
            return result
        }

        return `${result}\n\n(Showing lines ${start + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.)`
    }

    async writeFile(writePath: string, contents: string) {
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
        const content = await fs.readFile(filePath, 'utf-8')
        const next = replaceSubstring(
            content,
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
        const files = stat?.isDirectory()
            ? await this._findFiles(dir, include)
            : include == null || this._matchPattern(dir, include)
              ? [dir]
              : []

        const regex = new RegExp(pattern, 'gm')
        const results: { file: string; mtime: number; lines: string[] }[] = []

        for (const file of files) {
            if (this._shouldIgnore(file)) {
                continue
            }

            try {
                const fileStat = await fs.stat(file)
                if (!fileStat.isFile()) {
                    continue
                }

                const content = await fs.readFile(file, 'utf-8')
                const lines = content.split('\n')
                const matched: string[] = []
                for (let idx = 0; idx < lines.length; idx++) {
                    if (regex.test(lines[idx])) {
                        matched.push(`${file}:${idx + 1}:${lines[idx]}`)
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
            } catch (err) {
                if (process.env['CHATLUNA_AGENT_DEBUG']) {
                    console.debug(err)
                }
            }
        }

        results.sort((a, b) => b.mtime - a.mtime)
        return results.flatMap((item) => item.lines)
    }

    async glob(pattern: string, searchPath?: string) {
        const dir = searchPath || this._cfg.scopePath || process.cwd()
        this.assertInScope(dir)

        const stat = await fs.stat(dir).catch(() => null)
        if (!stat?.isDirectory()) {
            return this._matchPattern(dir, pattern) ? [dir] : []
        }

        const files = await this._findFiles(dir, pattern)
        const list = await Promise.all(
            files.map(async (file) => ({
                path: file,
                mtime: (await fs.stat(file).catch(() => null))?.mtimeMs ?? 0
            }))
        )

        list.sort((a, b) => b.mtime - a.mtime)
        return list.map((item) => item.path)
    }

    private async _findFiles(
        dirPath: string,
        pattern?: string
    ): Promise<string[]> {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true })
            const results: string[] = []
            const sub: Promise<string[]>[] = []

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name)
                if (this._shouldIgnore(fullPath)) {
                    continue
                }

                if (entry.isDirectory()) {
                    sub.push(this._findFiles(fullPath, pattern))
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
                    if (stat.isFile()) {
                        if (!pattern || this._matchPattern(fullPath, pattern)) {
                            results.push(fullPath)
                        }
                        continue
                    }

                    if (stat.isDirectory()) {
                        sub.push(this._findFiles(fullPath, pattern))
                    }
                } catch (err) {
                    if (process.env['CHATLUNA_AGENT_DEBUG']) {
                        console.debug(err)
                    }
                }
            }

            return results.concat(...(await Promise.all(sub)))
        } catch (err) {
            if (process.env['CHATLUNA_AGENT_DEBUG']) {
                console.debug(err)
            }
            return []
        }
    }

    private _matchPattern(filePath: string, pattern: string) {
        const base = this._cfg.scopePath || process.cwd()
        const relativePath = path.relative(base, filePath).replaceAll('\\', '/')
        return micromatch.some(
            [
                relativePath,
                filePath.replaceAll('\\', '/'),
                path.basename(filePath)
            ],
            pattern,
            { dot: true }
        )
    }

    private _shouldIgnore(filePath: string) {
        if (this._cfg.ignores.length === 0) {
            return false
        }

        const base = this._cfg.scopePath || process.cwd()
        const relativePath = path.relative(base, filePath).replace(/\\/g, '/')
        return micromatch.isMatch(relativePath, this._cfg.ignores, {
            dot: true
        })
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
        const firstIdx = content.indexOf(oldString)
        const secondIdx = content.indexOf(
            oldString,
            firstIdx + oldString.length
        )
        if (secondIdx !== -1) {
            throw new Error(
                'Found multiple matches for oldString. Provide more surrounding lines in oldString to identify the correct match, or set replaceAll to change every instance.'
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
    const marker = newString || oldString
    const row = lines.findIndex((line) => line.includes(marker))
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
