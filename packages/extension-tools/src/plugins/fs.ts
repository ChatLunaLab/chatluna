import { StructuredTool, Tool, ToolParams } from '@langchain/core/tools'
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
import { ChatLunaTool } from 'koishi-plugin-chatluna/llm-core/platform/types'

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

    const fileReadTool = new ReadFileTool({
        store
    })

    const fileWriteTool = new WriteFileTool({
        store
    })

    const listFileTool = new ListFileTool({
        store
    })

    const grepTool = new GrepTool({
        store
    })

    const globTool = new GlobTool({
        store
    })

    const renameTool = new RenameTool({
        store
    })

    const multiRenameTool = new MultiRenameTool({
        store
    })

    const multiWriteFileTool = new MultiWriteFileTool({
        store
    })

    const updateFileTool = new UpdateFileTool({
        store
    })

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

    plugin.registerTool(fileReadTool.name, {
        selector: fsSelector,
        createTool: () => fileReadTool
    })

    plugin.registerTool(fileWriteTool.name, {
        selector: fsSelector,

        createTool: () => fileWriteTool
    })

    plugin.registerTool(listFileTool.name, {
        selector: fsSelector,
        createTool: () => listFileTool
    })

    plugin.registerTool(grepTool.name, {
        selector: fsSelector,
        createTool: () => grepTool
    })

    plugin.registerTool(globTool.name, {
        selector: fsSelector,
        createTool: () => globTool
    })

    plugin.registerTool(renameTool.name, {
        selector: fsSelector,
        createTool: () => renameTool
    })

    plugin.registerTool(multiRenameTool.name, {
        selector: fsSelector,
        createTool: () => multiRenameTool
    })

    plugin.registerTool(multiWriteFileTool.name, {
        selector: fsSelector,

        createTool: () => multiWriteFileTool
    })

    plugin.registerTool(updateFileTool.name, {
        selector: fsSelector,

        createTool: () => updateFileTool
    })
}

interface BaseFileStore {
    readFile(path: string): Promise<string>

    writeFile(writePath: string, contents: string): Promise<void>

    listFiles(path?: string): Promise<string[]>

    grep(
        pattern: string,
        path?: string,
        glob?: string,
        outputMode?: 'content' | 'files_with_matches' | 'count'
    ): Promise<string[] | number>

    glob(pattern: string, path?: string): Promise<string[]>

    editFile(
        filePath: string,
        oldText: string,
        newText: string
    ): Promise<boolean>

    updateFile(
        filePath: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ): Promise<{ success: boolean; context: string; replacements: number }>

    rename(oldPath: string, newPath: string): Promise<void>
}

class FileStore implements BaseFileStore {
    constructor(
        private _scope: string,
        private _ignores: string[] = []
    ) {}

    async readFile(path: string): Promise<string> {
        if (!path.startsWith(this._scope)) {
            throw new Error(`path "${path}" is not in scope "${this._scope}"`)
        }

        return JSON.stringify({
            path,
            content: (await fs.readFile(path)).toString()
        })
    }

    async writeFile(writePath: string, contents: string): Promise<void> {
        if (!writePath.startsWith(this._scope)) {
            throw new Error(
                `path "${writePath}" is not in scope "${this._scope}"`
            )
        }

        const dir = path.dirname(writePath)
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(writePath, contents)
    }

    async listFiles(dirPath: string = this._scope): Promise<string[]> {
        if (!dirPath.startsWith(this._scope)) {
            throw new Error(
                `path "${dirPath}" is not in scope "${this._scope}"`
            )
        }

        const entries = await fs.readdir(dirPath, { withFileTypes: true })
        return entries
            .map((entry) => {
                const fullPath = path.join(dirPath, entry.name)
                return entry.isDirectory() ? `${fullPath}/` : fullPath
            })
            .filter((fullPath) => !this._shouldIgnore(fullPath))
    }

    async grep(
        pattern: string,
        searchPath?: string,
        globPattern?: string,
        outputMode: 'content' | 'files_with_matches' | 'count' = 'content'
    ): Promise<string[] | number> {
        const searchDir = searchPath || this._scope

        if (!searchDir.startsWith(this._scope)) {
            throw new Error(
                `path "${searchDir}" is not in scope "${this._scope}"`
            )
        }

        const isDirectory = async (path: string): Promise<boolean> => {
            try {
                const stat = await fs.stat(path)
                return stat.isDirectory()
            } catch {
                return false
            }
        }

        const searchTargets: string[] = []

        if (await isDirectory(searchDir)) {
            const files = await this._findFiles(searchDir, globPattern)
            searchTargets.push(...files)
        } else {
            if (!globPattern || this._matchPattern(searchDir, globPattern)) {
                searchTargets.push(searchDir)
            }
        }

        const regex = new RegExp(pattern, 'gm')
        let totalMatches = 0
        const matchingFiles = new Set<string>()
        const allResults: string[] = []

        for (const file of searchTargets) {
            // Skip ignored files
            if (this._shouldIgnore(file)) {
                continue
            }

            try {
                const stat = await fs.stat(file)
                if (!stat.isFile()) continue

                const content = await fs.readFile(file, 'utf-8')
                const lines = content.split('\n')
                let hasMatch = false

                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i]
                    const lineMatches = line.match(regex)

                    if (lineMatches) {
                        hasMatch = true
                        totalMatches += lineMatches.length

                        if (outputMode === 'content') {
                            allResults.push(`${file}:${i + 1}:${line}`)
                        }
                    }
                }

                if (hasMatch) {
                    matchingFiles.add(file)
                }
            } catch (error) {
                continue
            }
        }

        if (outputMode === 'count') {
            return totalMatches
        }

        if (outputMode === 'files_with_matches') {
            return Array.from(matchingFiles)
        }

        return allResults
    }

    async glob(pattern: string, searchPath?: string): Promise<string[]> {
        const searchDir = searchPath || this._scope

        if (!searchDir.startsWith(this._scope)) {
            throw new Error(
                `path "${searchDir}" is not in scope "${this._scope}"`
            )
        }

        const isDirectory = async (path: string): Promise<boolean> => {
            try {
                const stat = await fs.stat(path)
                return stat.isDirectory()
            } catch {
                return false
            }
        }

        if (!(await isDirectory(searchDir))) {
            if (this._matchPattern(searchDir, pattern)) {
                return [searchDir]
            }
            return []
        }

        return this._findFiles(searchDir, pattern)
    }

    async editFile(
        filePath: string,
        oldText: string,
        newText: string
    ): Promise<boolean> {
        if (!filePath.startsWith(this._scope)) {
            throw new Error(
                `path "${filePath}" is not in scope "${this._scope}"`
            )
        }

        try {
            const content = await fs.readFile(filePath, 'utf-8')

            if (!content.includes(oldText)) {
                return false
            }

            const newContent = content.replace(oldText, newText)
            await fs.writeFile(filePath, newContent)

            return true
        } catch (error) {
            return false
        }
    }

    async updateFile(
        filePath: string,
        oldString: string,
        newString: string,
        replaceCount?: number
    ): Promise<{ success: boolean; context: string; replacements: number }> {
        if (!filePath.startsWith(this._scope)) {
            throw new Error(
                `path "${filePath}" is not in scope "${this._scope}"`
            )
        }

        const content = await fs.readFile(filePath, 'utf-8')
        const lines = content.split('\n')

        if (!content.includes(oldString)) {
            return {
                success: false,
                context: '',
                replacements: 0
            }
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

        // Write the updated content
        await fs.writeFile(filePath, newLines.join('\n'))

        // Generate context (10 lines before and after each modification)
        const contextLines: string[] = []
        const contextSet = new Set<number>()

        for (const lineNum of modifiedLines) {
            const start = Math.max(0, lineNum - 10)
            const end = Math.min(newLines.length - 1, lineNum + 10)

            for (let i = start; i <= end; i++) {
                contextSet.add(i)
            }
        }

        const sortedContext = Array.from(contextSet).sort((a, b) => a - b)

        for (const lineNum of sortedContext) {
            const marker = modifiedLines.includes(lineNum) ? '>' : ' '
            contextLines.push(`${marker} ${lineNum + 1}: ${newLines[lineNum]}`)
        }

        return {
            success: true,
            context: contextLines.join('\n'),
            replacements
        }
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        if (!oldPath.startsWith(this._scope)) {
            throw new Error(
                `path "${oldPath}" is not in scope "${this._scope}"`
            )
        }
        if (!newPath.startsWith(this._scope)) {
            throw new Error(
                `path "${newPath}" is not in scope "${this._scope}"`
            )
        }

        const newDir = path.dirname(newPath)

        // check is dir or file
        if (await fs.stat(oldPath).then((stat) => stat.isDirectory())) {
            await fs.mkdir(newDir, { recursive: true })
            await fs.rename(oldPath, newPath)
        } else {
            // if oldPath is a file, ensure the directory exists
            await fs.mkdir(newDir, { recursive: true })
            await fs.rename(oldPath, newPath)
        }
    }

    private async _findFiles(
        dirPath: string,
        pattern?: string,
        includeDirectories: boolean = false
    ): Promise<string[]> {
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true })
            const subdirectoryPromises: Promise<string[]>[] = []
            const results: string[] = []

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name)

                // Check if the path should be ignored
                if (this._shouldIgnore(fullPath)) {
                    continue
                }

                if (entry.isDirectory()) {
                    if (
                        includeDirectories &&
                        (!pattern || this._matchPattern(fullPath, pattern))
                    ) {
                        results.push(fullPath)
                    }

                    subdirectoryPromises.push(
                        this._findFiles(fullPath, pattern, includeDirectories)
                    )
                } else if (entry.isFile()) {
                    if (!pattern || this._matchPattern(fullPath, pattern)) {
                        results.push(fullPath)
                    }
                } else if (entry.isSymbolicLink()) {
                    try {
                        const stat = await fs.stat(fullPath)
                        if (stat.isFile()) {
                            if (
                                !pattern ||
                                this._matchPattern(fullPath, pattern)
                            ) {
                                results.push(fullPath)
                            }
                        } else if (stat.isDirectory() && includeDirectories) {
                            if (
                                !pattern ||
                                this._matchPattern(fullPath, pattern)
                            ) {
                                results.push(fullPath)
                            }
                            subdirectoryPromises.push(
                                this._findFiles(
                                    fullPath,
                                    pattern,
                                    includeDirectories
                                )
                            )
                        }
                    } catch {
                        // Skip broken symlinks
                    }
                }
            }

            const filesFromSubdirectories =
                await Promise.all(subdirectoryPromises)

            return results.concat(...filesFromSubdirectories)
        } catch (error) {
            return []
        }
    }

    private _matchPattern(filePath: string, pattern: string): boolean {
        const relativePath = path.relative(this._scope, filePath)
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
        if (this._ignores.length === 0) {
            return false
        }

        const relativePath = path.relative(this._scope, filePath)
        const normalizedPath = relativePath.replace(/\\/g, '/')

        return micromatch.isMatch(normalizedPath, this._ignores, { dot: true })
    }
}

interface ReadFileParams extends ToolParams {
    store: BaseFileStore
}

export class ReadFileTool extends Tool {
    name = 'file_read'

    description =
        'Read file content from disk. Provide the complete file path to read its contents.'

    store: BaseFileStore

    constructor({ store }: ReadFileParams) {
        super()

        this.store = store
    }

    async _call(filePath: string) {
        try {
            return await this.store.readFile(filePath)
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
        "Write text content to a file on disk. Creates the file if it doesn't exist, overwrites if it does."

    schema = z.object({
        filePath: z.string().describe('The path to write the file.'),
        text: z.string().describe('The content to write to the file.')
    })

    store: BaseFileStore

    constructor({ store, ...rest }: WriteFileParams) {
        super(rest)

        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { filePath, text } = input
        try {
            await this.store.writeFile(filePath, text)
            return 'File written to successfully.'
        } catch (e) {
            return 'File write failed: ' + e.message
        }
    }
}

interface ListFileParams extends ToolParams {
    store: BaseFileStore
}

export class ListFileTool extends StructuredTool {
    name = 'file_list'

    description =
        'List files and directories. Use recursive option to search subdirectories.'

    schema = z.object({
        dirPath: z
            .string()
            .describe(
                'The directory path to list files from. Defaults to the root scope.'
            ),
        recursive: z
            .boolean()
            .optional()
            .default(false)
            .describe('Whether to list files recursively.')
    })

    store: BaseFileStore

    constructor({ store, ...rest }: ListFileParams) {
        super(rest)
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { dirPath, recursive } = input
        try {
            if (recursive) {
                const files = await this.store.glob('**/*', dirPath)
                const stats = await Promise.all(
                    files.map(async (file) => {
                        try {
                            const stat = await fs.stat(file)
                            return { path: file, isDir: stat.isDirectory() }
                        } catch {
                            return { path: file, isDir: false }
                        }
                    })
                )
                return stats
                    .map(({ path, isDir }) => (isDir ? `${path}/` : path))
                    .join('\n')
            } else {
                const files = await this.store.listFiles(dirPath)
                return files.join('\n')
            }
        } catch (e) {
            return 'List files failed: ' + e.message
        }
    }
}

interface GrepParams extends ToolParams {
    store: BaseFileStore
}

export class GrepTool extends StructuredTool {
    name = 'file_grep'

    description =
        'Search for text patterns in files using regular expressions. Returns matching lines or file paths.'

    schema = z.object({
        pattern: z.string().describe('The regex pattern to search for.'),
        searchPath: z.string().describe('The directory path to search in.'),
        globPattern: z
            .string()
            .optional()
            .describe('Optional glob pattern to filter files.'),
        outputMode: z
            .enum(['content', 'files_with_matches', 'count'])
            .optional()
            .default('content')
            .describe(
                'Output format: content shows matching lines, files_with_matches shows file paths, count shows number of matches.'
            )
    })

    store: BaseFileStore

    constructor({ store, ...rest }: GrepParams) {
        super(rest)
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { pattern, searchPath, globPattern, outputMode } = input
        try {
            const results = await this.store.grep(
                pattern,
                searchPath,
                globPattern,
                outputMode
            )
            if (Array.isArray(results)) {
                return results.join('\n')
            } else {
                return results.toString()
            }
        } catch (e) {
            return 'Grep failed: ' + e.message
        }
    }
}

interface GlobParams extends ToolParams {
    store: BaseFileStore
}

export class GlobTool extends StructuredTool {
    name = 'file_glob'

    description =
        'Find files by name patterns using glob syntax (e.g., *.js, **/*.txt). Returns matching file paths.'

    schema = z.object({
        pattern: z
            .string()
            .describe('The glob pattern to match files against.'),
        searchPath: z.string().describe('The directory path to search in.')
    })

    store: BaseFileStore

    constructor({ store, ...rest }: GlobParams) {
        super(rest)
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { pattern, searchPath } = input
        try {
            const files = await this.store.glob(pattern, searchPath)
            return files.join('\n')
        } catch (e) {
            return 'Glob failed: ' + e.message
        }
    }
}

interface RenameParams extends ToolParams {
    store: BaseFileStore
}

export class RenameTool extends StructuredTool {
    name = 'file_rename'

    description =
        'Rename or move files and directories. Provide the current path and new desired path.'

    schema = z.object({
        oldPath: z.string().describe('The current file or directory path.'),
        newPath: z.string().describe('The new file or directory path.')
    })

    store: BaseFileStore

    constructor({ store, ...rest }: RenameParams) {
        super(rest)
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { oldPath, newPath } = input
        try {
            await this.store.rename(oldPath, newPath)
            return `Successfully renamed ${oldPath} to ${newPath}`
        } catch (e) {
            return 'Rename failed: ' + e.message
        }
    }
}

export class MultiRenameTool extends StructuredTool {
    name = 'file_multi_rename'

    description =
        'Rename multiple files or directories based on a pattern. Uses micromatch for pattern matching.'

    schema = z.object({
        pattern: z.string().describe('The glob pattern to match files.'),
        replacement: z.string().describe('The new name pattern.'),
        searchPath: z
            .string()
            .optional()
            .describe(
                'The directory path to search in. Defaults to the root scope.'
            )
    })

    store: BaseFileStore

    constructor({ store, ...rest }: RenameParams) {
        super(rest)
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { pattern, replacement, searchPath } = input
        try {
            const files = await this.store.glob(pattern, searchPath)
            for (const file of files) {
                const newFileName = file.replace(pattern, replacement)
                await this.store.rename(file, newFileName)
            }
            return `Successfully renamed files matching ${pattern} to ${replacement}`
        } catch (e) {
            return 'Multi rename failed: ' + e.message
        }
    }
}

export class MultiWriteFileTool extends StructuredTool {
    name = 'file_multi_write'

    description =
        'Write multiple files with different contents. Each file is specified by its path and content.'

    schema = z.object({
        files: z
            .array(
                z.object({
                    filePath: z
                        .string()
                        .describe('The path to write the file.'),
                    text: z
                        .string()
                        .describe('The content to write to the file.')
                })
            )
            .describe('An array of files to write.')
    })

    store: BaseFileStore

    constructor({ store, ...rest }: WriteFileParams) {
        super(rest)
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { files } = input
        try {
            for (const { filePath, text } of files) {
                await this.store.writeFile(filePath, text)
            }
            return 'All files written successfully.'
        } catch (e) {
            return 'Multi write failed: ' + e.message
        }
    }
}

interface UpdateFileParams extends ToolParams {
    store: BaseFileStore
}

export class UpdateFileTool extends StructuredTool {
    name = 'file_update'

    description =
        'Replace text in a file with optional replacement count limit. Returns context showing 10 lines before and after each change.'

    schema = z.object({
        filePath: z.string().describe('The path to the file to update.'),
        oldString: z.string().describe('The text string to find and replace.'),
        newString: z.string().describe('The replacement text string.'),
        replaceCount: z
            .number()
            .optional()
            .describe(
                'Maximum number of replacements to make. If not specified, replaces all occurrences.'
            )
    })

    store: BaseFileStore

    constructor({ store, ...rest }: UpdateFileParams) {
        super(rest)
        this.store = store
    }

    async _call(input: z.infer<typeof this.schema>) {
        const { filePath, oldString, newString, replaceCount } = input
        try {
            const result = await this.store.updateFile(
                filePath,
                oldString,
                newString,
                replaceCount
            )

            if (!result.success) {
                return `No occurrences of "${oldString}" found in ${filePath}`
            }

            return `Successfully replaced ${result.replacements} occurrence(s) in ${filePath}\n\nContext (> marks modified lines):\n${result.context}`
        } catch (e) {
            return 'File update failed: ' + e.message
        }
    }
}
