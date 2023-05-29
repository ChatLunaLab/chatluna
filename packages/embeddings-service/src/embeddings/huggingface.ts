import { Context } from 'koishi';
import EmbeddingsPlugin from '..';
import { CreateParams, EmbeddingsProvider } from '@dingyi222666/chathub-llm-core/lib/model/base';
import { Embeddings } from 'langchain/embeddings/base';
import { HuggingFaceInferenceEmbeddings } from 'langchain/embeddings/hf';

export function apply(ctx: Context, config: EmbeddingsPlugin.Config,
    plugin: EmbeddingsPlugin) {

    if (!config.huggingface) {
        return
    }

    plugin.registerEmbeddingsProvider(new HuggingfaceEmbeddingsProvider(config))
}

// TODO: 自编写 Huggingface API
class HuggingfaceEmbeddingsProvider extends EmbeddingsProvider {

    name = "huggingface"
    description = "huggingface embeddings"

    private _embeddings: string[]

    constructor(private readonly _config: EmbeddingsPlugin.Config) {
        super()
        // TODO：检查模型是否存在
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
            throw new Error("Unsupported huggerface model " + modelName)
        }

        return new HuggingFaceInferenceEmbeddings({
            model: modelName,
            apiKey: this._config.huggingfaceApiKey,
        })
    }
}