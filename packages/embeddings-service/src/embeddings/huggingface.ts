import { Context } from 'koishi';
import EmbeddingsPlugin from '..';
import { CreateParams, EmbeddingsProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base';
import { Embeddings, EmbeddingsParams } from 'langchain/embeddings/base';
import { request } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/request'
import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger';


const logger = createLogger('@dingyi222666/chathub-embeddings-service/embeddings/huggingface')

export function apply(ctx: Context, config: EmbeddingsPlugin.Config,
    plugin: EmbeddingsPlugin) {

    if (!config.huggingface) {
        return
    }

    plugin.registerEmbeddingsProvider(new HuggingfaceEmbeddingsProvider(config))
}


class HuggingfaceEmbeddingsProvider extends EmbeddingsProvider {

    name = "huggingface"
    description = "huggingface embeddings"

    private _embeddings: string[]

    constructor(private readonly _config: EmbeddingsPlugin.Config) {
        super()
        this._embeddings = [_config.huggingfaceEmbeddingModel]
    }

    listEmbeddings(): Promise<string[]> {
        return Promise.resolve(this._embeddings)
    }

    isSupported(embedding: string): Promise<boolean> {
        return Promise.resolve(this._embeddings.includes(embedding))
    }

    async createEmbeddings(modelName: string, params: CreateParams): Promise<Embeddings> {

        if (!this._embeddings.includes(modelName)) {
            throw new Error("Unsupported huggingface model " + modelName)
        }

        return new HuggingFaceInferenceEmbeddings({
            model: modelName,
            apiKey: this._config.huggingfaceApiKey,
        })
    }
}


export interface HuggingFaceInferenceEmbeddingsParams extends EmbeddingsParams {
    apiKey?: string;
    model?: string;
}

class HfInference {

    constructor(
        private readonly _apiKey?: string
    ) { }

    async featureExtraction(params: {
        model: string;
        inputs: string[];
    }): Promise<number[][]> {

        const url = "https://api-inference.huggingface.co/models/" + params.model

        const headers = {
            Authorization: `Bearer ${this._apiKey}`
        }

        const response = await request.fetch(url, {
            method: "POST",
            body: JSON.stringify(params.inputs),
            headers,
        })

        if (!response.ok) {
            if (response.headers.get("Content-Type")?.startsWith("application/json")) {
                const output: any = await response.json();
                if (output.error) {
                    throw new Error(output.error);
                }
            }
            throw new Error("An error occurred while fetching the blob");
        }


        return (await response.json()) as number[][]
    }
}

export class HuggingFaceInferenceEmbeddings
    extends Embeddings
    implements HuggingFaceInferenceEmbeddingsParams {
    apiKey?: string;

    model: string;

    client: HfInference;

    constructor(fields?: HuggingFaceInferenceEmbeddingsParams) {
        super(fields ?? {});

        this.model =
            fields?.model ?? "sentence-transformers/distilbert-base-nli-mean-tokens";
        this.apiKey =
            fields?.apiKey
        this.client = new HfInference(this.apiKey);
    }

    _embed(texts: string[]): Promise<number[][]> {
        // replace newlines, which can negatively affect performance.
        const clean = texts.map((text) => text.replace(/\n/g, " "));
        return this.caller.call(() =>
            this.client.featureExtraction({
                model: this.model,
                inputs: clean,
            })
        ) as Promise<number[][]>;
    }

    async embedQuery(document: string): Promise<number[]> {
        const embeddings = await this._embed([document]);
        return embeddings[0];
    }

    embedDocuments(documents: string[]): Promise<number[][]> {
        return this._embed(documents);
    }
}