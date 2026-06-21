/* eslint-disable max-len */
/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaBrowsingChain } from './chain/browsing_chain'
import { Config, apply as configApply } from './config'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { SearchManager } from './provide'
import { providerPlugin } from './plugin'
import { SEARCH_TOOL_DESCRIPTION, SearchTool } from './tools/search'
import { SummaryType } from './types'
import { computed } from 'koishi-plugin-chatluna'
import { BrowserManager } from './tools/browser/manager'
import { registerBrowserTools } from './tools/browser/tools'

export { Config } from './config'

export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-search-service')

    ctx.on('ready', async () => {
        const keywordExtractModel =
            config.summaryModel && config.summaryModel !== 'empty'
                ? await createModel(ctx, config.summaryModel)
                : null

        const plugin = new ChatLunaPlugin<ClientConfig, Config>(
            ctx,
            config,
            'search-service',
            false
        )

        const searchManager = new SearchManager(ctx, config)
        if (config.enableBrowser && !ctx.puppeteer) {
            logger.warn(
                'Browser tools are disabled because puppeteer is not available.'
            )
        }

        const browserManager = config.enableBrowser && ctx.puppeteer
            ? new BrowserManager(ctx, config)
            : undefined
        const summaryModel = computed(() => keywordExtractModel?.value)

        if (browserManager) {
            registerBrowserTools(plugin, browserManager, summaryModel)
        }

        if (config.searchEngine.length > 0) {
            await providerPlugin(ctx, config, plugin, searchManager)

            plugin.registerTool('web_search', {
                description: SEARCH_TOOL_DESCRIPTION,
                createTool(params) {
                    const summaryType: SummaryType =
                        params['summaryType'] ?? config.summaryType

                    const browserModelRef = computed(
                        () => keywordExtractModel?.value ?? null
                    )
                    return new SearchTool(
                        searchManager,
                        browserManager,
                        params.embeddings,
                        browserModelRef,
                        summaryType
                    )
                },
                selector() {
                    return true
                },
                meta: {
                    source: 'extension',
                    group: 'search',
                    tags: ['search', 'web'],
                    defaultAvailability: {
                        enabled: true,
                        main: true,
                        chatluna: true,
                        characterScope: 'all'
                    }
                }
            })
        }

        if (config.searchEngine.length > 0) {
            plugin.registerChatChainProvider(
                'browsing',
                {
                    'zh-CN': '浏览模式，可以从外部获取信息',
                    'en-US': 'Browsing mode, can get information from web'
                },
                (params) => {
                    const tools = getTools(
                        ctx.chatluna.platform,
                        (name) =>
                            name === 'web_search' ||
                            (config.enableBrowser &&
                                name.startsWith('browser_'))
                    )

                    const summaryModel = computed(
                        () => keywordExtractModel?.value ?? params.model
                    )

                    const model = params.model
                    const options = {
                        preset: params.preset,
                        botName: params.botName,
                        embeddings: params.embeddings,
                        historyMemory: params.historyMemory,
                        summaryType: config.summaryType,
                        summaryModel,
                        thoughtMessage: ctx.chatluna.config.showThoughtMessage,
                        searchPrompt: config.searchPrompt,
                        newQuestionPrompt: config.newQuestionPrompt,
                        contextualCompressionPrompt:
                            config.contextualCompression
                                ? config.contextualCompressionPrompt
                                : undefined,
                        searchFailedPrompt: config.searchFailedPrompt,
                        variableService: ctx.chatluna.promptRenderer,
                        contextManager: ctx.chatluna.contextManager,
                        browserManager
                    }

                    return ChatLunaBrowsingChain.fromLLMAndTools(
                        model,
                        tools,
                        options
                    )
                }
            )
        }
    })

    configApply(ctx, config)
}

function getTools(service: PlatformService, filter: (name: string) => boolean) {
    const tools = service.getTools()

    return computed(() =>
        tools.value.filter(filter).map((name) => ({
            name,
            tool: service.getTool(name)
        }))
    )
}

export async function createModel(ctx: Context, model: string) {
    logger.debug('Create summary model: %s', model)
    if (model == null || model === 'empty') {
        return null
    }

    const [platform, modelName] = parseRawModelName(model)
    await ctx.chatluna.awaitLoadPlatform(platform)
    return ctx.chatluna.createChatModel(platform, modelName)
}

export const inject = {
    required: ['chatluna'],
    optional: ['puppeteer', 'chatluna_agent']
}

export const name = 'chatluna-search-service'
