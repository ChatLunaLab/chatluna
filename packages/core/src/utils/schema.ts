import { Context, h, Schema } from 'koishi'
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import type { SchemaService } from 'koishi'
import { computed, watch } from '@vue/reactivity'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import type {} from '@koishijs/plugin-notifier'

/**
 * Sets up the model selection schema by automatically watching for model changes
 * in the platform service and updating the 'model' schema.
 * Registers all available LLM model names to the {@link SchemaService} for use in configuration UI.
 * @param ctx - Koishi context object
 */
export function modelSchema(ctx: Context, createNotification: boolean = false) {
    const modelNames = getModelNames(ctx.chatluna.platform)

    const notification = createNotification
        ? ctx.notifier?.create({
              content: h.parse(
                  '您当前没有配置模型，请前往 https://chatluna.chat/guide/configure-model-platform/introduction.html 了解如何安装模型适配器。'
              ),
              type: 'warning'
          })
        : undefined

    const watcher = watch(
        modelNames,
        (modelNames: Schema<string, string>[]) => {
            ctx.schema.set('model', Schema.union(modelNames))
            if (modelNames.length > 1 && notification) {
                notification?.update({
                    content: `当前共加载了 ${modelNames.length} 个模型。`,
                    type: 'success'
                })
            } else {
                notification?.update({
                    content: h.parse(
                        '您当前没有配置模型，请前往 https://chatluna.chat/guide/configure-model-platform/introduction.html 了解如何安装模型适配器。'
                    ),
                    type: 'warning'
                })
            }
        },
        {
            immediate: true
        }
    )

    const stop = () => watcher.stop()

    ctx.effect(() => stop)
}

/**
 * Sets up the embeddings model selection schema by automatically watching for embedding model changes
 * in the platform service and updating the 'embeddings' schema.
 * Registers all available embedding model names to the {@link SchemaService} for use in configuration UI.
 * @param ctx - Koishi context object
 */
export function embeddingsSchema(ctx: Context) {
    const modelNames = getModelNames(
        ctx.chatluna.platform,
        ModelType.embeddings
    )

    const watcher = watch(
        modelNames,
        (modelNames: Schema<string, string>[]) => {
            ctx.schema.set('embeddings', Schema.union(modelNames))
        },
        {
            immediate: true
        }
    )

    const stop = () => watcher.stop()

    ctx.effect(() => stop)
}

/**
 * Sets up the chat chain mode selection schema by automatically watching for chat chain changes
 * in the platform service and updating the 'chat-mode' schema.
 * Registers all available chat chain names and descriptions to the {@link SchemaService} for use in configuration UI.
 * @param ctx - Koishi context object
 */
export function chatChainSchema(ctx: Context) {
    const modelNames = getChatChainNames(ctx.chatluna.platform)

    const watcher = watch(
        modelNames,
        (modelNames: Schema<string, string>[]) => {
            ctx.schema.set('chat-mode', Schema.union(modelNames))
        },
        {
            immediate: true
        }
    )

    const stop = () => watcher.stop()

    ctx.effect(() => stop)
}

/**
 * Sets up the vector store selection schema by automatically watching for vector store changes
 * in the platform service and updating the 'vector-store' schema.
 * Registers all available vector store names to the {@link SchemaService} for use in configuration UI.
 * @param ctx - Koishi context object
 */
export function vectorStoreSchema(ctx: Context) {
    const vectorStoreNames = getVectorStores(ctx, ctx.chatluna.platform)

    const watcher = watch(
        vectorStoreNames,
        (vectorStoreNames: Schema<string, string>[]) => {
            ctx.schema.set('vector-store', Schema.union(vectorStoreNames))
        },
        {
            immediate: true
        }
    )

    const stop = () => watcher.stop()

    ctx.effect(() => stop)
}

function getModelNames(
    service: PlatformService,
    type: ModelType = ModelType.llm
) {
    const models = service.listAllModels(type)

    return computed(() =>
        models.value
            .map((model) => model.platform + '/' + model.name)
            .concat('无')
            .map((model) => Schema.const(model).description(model))
    )
}

function getVectorStores(ctx: Context, service: PlatformService) {
    const vectorStoreNamesRef = service.vectorStores

    return computed(() =>
        vectorStoreNamesRef.value
            .concat('无')
            .map((name) => Schema.const(name).description(name))
    )
}

function getChatChainNames(service: PlatformService) {
    const chains = service.chatChains
    return computed(() =>
        chains.value.map((info) =>
            Schema.const(info.name).i18n(info.description)
        )
    )
}
