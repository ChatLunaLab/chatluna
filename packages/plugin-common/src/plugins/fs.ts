import { Tool, ToolParams } from '@langchain/core/tools'
import fs from 'fs/promises'
import { Context } from 'koishi'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { fuzzyQuery } from 'koishi-plugin-chatluna/utils/string'
import path from 'path'
import { Config } from '..'

export async function apply(
    ctx: Context,
    config: Config,
    plugin: ChatLunaPlugin
) {
    if (config.fs !== true) {
        return
    }

    const store = new FileStore(config.fsScopePath ?? '')

    const fileReadTool = new ReadFileTool({
        store
    })

    const fileWriteTool = new WriteFileTool({
        store
    })

    plugin.registerTool(fileReadTool.name, {
        selector(history) {
            return history.some((item) => {
                const content = item.content as string
                if (content == null) return false
                return fuzzyQuery(content, [
                    'file',
                    'open',
                    '打开',
                    '文件',
                    '读',
                    '看',
                    '获取',
                    'execute'
                ])
            })
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createTool: async () => fileReadTool as any
    })

    plugin.registerTool(fileWriteTool.name, {
        selector(history) {
            return history.some((item) => {
                const content = item.content as string
                return fuzzyQuery(content, [
                    'file',
                    'open',
                    '打开',
                    '写入',
                    '写',

                    '读取',
                    '获取',
                    'execute'
                ])
            })
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createTool: async () => fileWriteTool as any
    })
}

interface BaseFileStore {
    readFile(path: string): Promise<string>

    writeFile(writePath: string, contents: string): Promise<void>
}

class FileStore implements BaseFileStore {
    constructor(private _scope: string) {}

    async readFile(path: string): Promise<string> {
        // check the path is in scope, if not, throw error

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
            throw new Error(`path "${path}" is not in scope "${this._scope}"`)
        }

        // check the parent dir is exists, if not, create it

        const dir = path.dirname(writePath)

        try {
            await fs.access(dir)
        } catch {
            await fs.mkdir(dir, { recursive: true })
        }

        await fs.writeFile(writePath, contents)
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    lc_namespace: string[] = []
}

interface ReadFileParams extends ToolParams {
    store: BaseFileStore
}

export class ReadFileTool extends Tool {
    name = 'read_file'

    description = 'Read file from disk, The input must be a path.'

    store: BaseFileStore

    constructor({ store }: ReadFileParams) {
        super()

        this.store = store
    }

    async _call(filePath: string) {
        return await this.store.readFile(filePath)
    }
}

interface WriteFileParams extends ToolParams {
    store: BaseFileStore
}

export class WriteFileTool extends Tool {
    name = 'write_file'

    description = `Write file from disk. The input must be like following "file_path", "text", E.g. "./test.txt", "hello world". `

    store: BaseFileStore

    constructor({ store, ...rest }: WriteFileParams) {
        super(rest)

        this.store = store
    }

    private _readInput(rawText: string) {
        // match use regex
        const regex = /"(.*)",(\s*)?"(.*)"$/
        const match = rawText.match(regex)
        if (!match) {
            throw new Error(
                `Input "${rawText}" is not match the regex "${regex}"`
            )
        }
        const filePath = match[1]
        const text = match[3]
        return { filePath, text }
    }

    async _call(rawText: string) {
        const { filePath, text } = this._readInput(rawText)
        try {
            await this.store.writeFile(filePath, text)
            return 'File written to successfully.'
        } catch (e) {
            return 'File write failed: ' + e.message
        }
    }
}
