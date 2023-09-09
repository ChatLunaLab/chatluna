import { Context } from 'koishi'
import { Config } from '..'
import { VectorStore } from 'langchain/vectorstores/base'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger'
import { Tool, ToolParams } from 'langchain/tools'
import { Embeddings } from 'langchain/embeddings/base'
import { BaseLanguageModel } from 'langchain/base_language'
import { ChatHubPlugin } from '@dingyi222666/koishi-plugin-chathub/lib/services/chat'

const logger = createLogger()

export function apply(ctx: Context, config: Config, plugin: ChatHubPlugin) {
    if (config.bilibili !== true) {
        return
    }

    plugin.registerTool('bilibili', async (param) => {
        return new BilibiliTool({
            model: param.model,
            embeddings: param.embeddings,
            timeout: config.bilibiliTempTimeout
        })
    })
}

export interface BilibiliArgs extends ToolParams {
    model: BaseLanguageModel

    embeddings: Embeddings

    timeout: number
}

export class BilibiliTool extends Tool implements BilibiliArgs {
    name = 'bilibili'

    private _tmpVectorStore: Record<string, VectorStore> = {}

    model: BaseLanguageModel
    embeddings: Embeddings
    timeout: number

    constructor({ timeout, embeddings, model }: BilibiliArgs) {
        super(...arguments)

        setInterval(() => {
            this._tmpVectorStore = {}
        }, timeout)
        this.timeout = timeout
        this.embeddings = embeddings
        this.model = model
    }

    /** @ignore */
    async _call(input: string) {
        const { bv, question } = JSON.parse(input)

        return ''
    }

    description = `A tool for accessing bilibili videos, which can be used to get video overview, information, input must be a json string with two keys "bv", "question". The  If the question content is empty, it returns the video overview information. For example, if you want to get what topic the video talks about, you can input {"bv":"xxxx", "question":"What topic does this video talk about?"}`
}
