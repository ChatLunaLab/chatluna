import { EmbeddingsRequestParams, EmbeddingsRequester, ModelRequestParams, ModelRequester } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/api';
import { ClientConfig } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/platform/config';
import { request } from "@dingyi222666/koishi-plugin-chathub/lib/utils/request"
import { Dict } from 'koishi';
import { ChatGenerationChunk } from 'langchain/schema';

export class OpenAIRequester extends ModelRequester implements EmbeddingsRequester {
    constructor(private _config: ClientConfig) {
        super()
    }

    completionStream(params: ModelRequestParams): AsyncGenerator<ChatGenerationChunk, any, unknown> {
        throw new Error('Method not implemented.');
    }


    embeddings(params: EmbeddingsRequestParams): Promise<number[] | number[][]> {
        throw new Error('Method not implemented.');
    }


    async getModels(): Promise<string[]> {
        let data: any
        try {
            const response = await this._get("models")
            data = await response.text()
            data = JSON.parse(data as string)

            return (<Record<string, any>[]>(data.data)).map((model) => model.id)
        } catch (e) {

            const error = new Error("error when listing openai models, Result: " + JSON.stringify(data))

            error.stack = e.stack
            error.cause = e.cause

            throw error
        }
    }

    private _get(url: string) {
        const requestUrl = this._concatUrl(url)

        return request.fetch(requestUrl, {
            method: 'GET',
            headers: this._buildHeaders()
        })
    }


    private _buildHeaders() {
        return {
            Authorization: `Bearer ${this._config.apiKey}`,
            "Content-Type": "application/json"
        }
    }

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

    async init(): Promise<void> { }

    async dispose(): Promise<void> { }
}