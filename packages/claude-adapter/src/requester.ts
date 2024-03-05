import {
    ModelRequester,
    ModelRequestParams
} from 'koishi-plugin-chatluna/lib/llm-core/platform/api'
import { ChatGenerationChunk } from '@langchain/core/outputs'
import { ClientConfig } from 'koishi-plugin-chatluna/lib/llm-core/platform/config'
import { createLogger } from 'koishi-plugin-chatluna/lib/utils/logger'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/lib/utils/error'
import { Context, Logger } from 'koishi'
import { formatMessages } from './utils'
import { Config } from '.'

let logger: Logger

export class ClaudeRequester extends ModelRequester {
    constructor(
        private ctx: Context,
        private _pluginConfig: Config,
        private _config: ClientConfig
    ) {
        super()
        logger = createLogger(ctx, 'chatluna-claude-adapter')
    }

    async *completionStream(
        params: ModelRequestParams
    ): AsyncGenerator<ChatGenerationChunk> {}

    private _concatUrl(url: string): string {
        const apiEndPoint = this._config.apiEndpoint

        // match the apiEndPoint ends with '/v1' or '/v1/' using regex
        if (!apiEndPoint.match(/\/v1\/?$/)) {
            if (apiEndPoint.endsWith('/')) {
                return apiEndPoint + 'v1/' + url
            }

            return apiEndPoint + '/v1/' + url
        }

        if (apiEndPoint.endsWith('/')) {
            return apiEndPoint + url
        }

        return apiEndPoint + '/' + url
    }
}
