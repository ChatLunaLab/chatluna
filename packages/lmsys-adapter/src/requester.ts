import { ModelRequestParams, ModelRequester } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api';
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config';
import { WebSocket } from 'ws'
import { ChatGenerationChunk } from 'langchain/schema';
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/utils/logger';
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/utils/request"

const logger = createLogger()

const STOP_TOKEN = ["\n\nuser:", "\n\nsystem:", "user:", "system:"]

export class LMSYSRequester extends ModelRequester {
    constructor(private _config: ClientConfig) {
        super()
    }

    async *completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk> {
       
    }


    private _createWebSocket(): WebSocket {
        return request.ws("wss://chat.lmsys.org/queue/join", {
            headers: this._cookie
        })
    }


    private _cookie = {
        'User-Agent': request.randomUA(),
        'Host': 'chat.lmsys.org',

        'Origin': 'https://chat.lmsys.org'
    }

    

    async init(): Promise<void> { }

    async dispose(): Promise<void> { }
}