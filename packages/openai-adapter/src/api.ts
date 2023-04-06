import { Logger, Quester } from 'koishi'
import OpenAIAdapter from "./index"

export class Api {

    private logger = new Logger('@dingyi222666/chathub-openai-adapter/api')

    constructor(
        private readonly config: OpenAIAdapter.Config,
        private readonly http: Quester
    ) { }

    private buildHeaders() {
        return {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json"
        }
    }

    private async get(url: string, params?: any): Promise<Quester.AxiosResponse> {
        const reqeustUrl = `${this.config.apiEndPoint}${url}`

        return this.http.get(reqeustUrl, {
            headers: this.buildHeaders()
        })
    }

    async listModels(): Promise<string[]> {
        try {
            const response = await this.get("model")

            return response.data as string[]
        } catch (e) {

            this.logger.error(
                "Error when listing openai models, Result: " + e.response
                    ? (e.response ? e.response.data : e)
                    : e
            );

            // return fake empty models
            return []
        }

    }

}