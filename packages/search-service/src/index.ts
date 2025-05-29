/* eslint-disable max-len */
/* eslint-disable @typescript-eslint/naming-convention */
import { Context, Logger, Schema, Time } from 'koishi'
import { ClientConfig } from 'koishi-plugin-chatluna/llm-core/platform/config'
import { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChatLunaBrowsingChain } from './chain/browsing_chain'
import { PuppeteerBrowserTool } from './tools/puppeteerBrowserTool'
import { apply as configApply } from './config'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatLunaChatModel } from 'koishi-plugin-chatluna/llm-core/platform/model'
import { SearchManager } from './provide'
import { providerPlugin } from './plugin'
import { SearchTool } from './tools/search'
import { SummaryType } from './types'
export let logger: Logger

export function apply(ctx: Context, config: Config) {
    logger = createLogger(ctx, 'chatluna-search-service')
    const plugin = new ChatLunaPlugin<ClientConfig, Config>(
        ctx,
        config,
        'search-service',
        false
    )

    ctx.on('ready', async () => {
        plugin.registerToService()

        const searchManager = new SearchManager(ctx, config)

        providerPlugin(ctx, config, plugin, searchManager)

        plugin.registerTool('web-search', {
            async createTool(params, session) {
                const summaryType: SummaryType =
                    params['summaryType'] ?? config.summaryType

                const summaryModel =
                    config.summaryType === SummaryType.Quality
                        ? await createModel(ctx, config.summaryModel)
                        : undefined

                const model = summaryModel ?? params.model
                const browserTool = new PuppeteerBrowserTool(
                    ctx,
                    model,
                    params.embeddings,
                    {
                        waitUntil:
                            summaryType !== SummaryType.Quality
                                ? 'domcontentloaded'
                                : 'networkidle2',
                        timeout:
                            summaryType !== SummaryType.Quality
                                ? 6 * Time.second
                                : 30 * Time.second,
                        idleTimeout: 3 * Time.minute
                    }
                )
                return new SearchTool(
                    searchManager,
                    browserTool,
                    params.embeddings,
                    model,
                    summaryType
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                ) as any
            },
            selector() {
                return true
            }
        })

        plugin.registerTool('web-browser', {
            async createTool(params, _session) {
                const summaryModel =
                    config.summaryType === SummaryType.Quality
                        ? await createModel(ctx, config.summaryModel)
                        : undefined

                return new PuppeteerBrowserTool(
                    ctx,
                    summaryModel ?? params.model,
                    params.embeddings
                )
            },
            selector() {
                return true
            }
        })

        plugin.registerChatChainProvider(
            'browsing',
            {
                'zh-CN': '浏览模式，可以从外部获取信息',
                'en-US': 'Browsing mode, can get information from web'
            },
            async (params) => {
                const tools = getTools(
                    ctx.chatluna.platform,
                    (name) =>
                        name === 'web-search' ||
                        name === 'web-browser' ||
                        name === 'puppeteer_browser'
                )

                const keywordExtractModel =
                    config.summaryModel.length > 0
                        ? await createModel(ctx, config.summaryModel)
                        : undefined

                const model = params.model
                const options = {
                    preset: params.preset,
                    botName: params.botName,
                    embeddings: params.embeddings,
                    historyMemory: params.historyMemory,
                    summaryType: config.summaryType,
                    summaryModel: keywordExtractModel ?? params.model,
                    thoughtMessage: ctx.chatluna.config.showThoughtMessage,
                    searchPrompt: config.searchPrompt,
                    newQuestionPrompt: config.newQuestionPrompt,
                    contextualCompressionPrompt: config.contextualCompression
                        ? config.contextualCompressionPrompt
                        : undefined,
                    searchFailedPrompt: config.searchFailedPrompt,
                    variableService: ctx.chatluna.variable
                }

                return ChatLunaBrowsingChain.fromLLMAndTools(
                    model,
                    tools,
                    options
                )
            }
        )
    })

    configApply(ctx, config)
}

function getTools(service: PlatformService, filter: (name: string) => boolean) {
    const tools = service.getTools().filter(filter)

    return tools.map((name) => ({
        name,
        tool: service.getTool(name)
    }))
}

export async function createModel(ctx: Context, model: string) {
    logger.debug('create summary model: %s', model)
    if (model == null || model === 'empty') {
        return null
    }

    const [platform, modelName] = parseRawModelName(model)
    await ctx.chatluna.awaitLoadPlatform(platform)
    return ctx.chatluna.createChatModel(
        platform,
        modelName
    ) as Promise<ChatLunaChatModel>
}

export interface Config extends ChatLunaPlugin.Config {
    searchEngine: string[]
    topK: number
    summaryType: SummaryType
    summaryModel: string
    mulitSourceMode: 'average' | 'total'
    searchFailedPrompt: string

    serperApiKey: string
    serperCountry: string
    serperLocation: string
    serperSearchResults: number

    bingSearchApiKey: string
    bingSearchLocation: string
    azureLocation: string

    wikipediaBaseURL: string[]
    maxWikipediaDocContentLength: number

    tavilyApiKey: string

    searxngBaseURL: string

    puppeteerTimeout: number
    puppeteerIdleTimeout: number

    searchPrompt: string
    newQuestionPrompt: string
    searchThreshold: number
    contextualCompression: boolean
    contextualCompressionPrompt: string

    freeSearchBaseURL: string
}

export const Config: Schema<Config> = Schema.intersect([
    ChatLunaPlugin.Config,

    Schema.object({
        searchEngine: Schema.array(
            Schema.union([
                Schema.const('free-google-api').description(
                    'Free Google (API & Web)'
                ),
                Schema.const('bing-web').description('Bing (Web)'),
                Schema.const('bing-api').description('Bing (API)'),
                Schema.const('duckduckgo-lite').description(
                    'DuckDuckGo (Lite)'
                ),
                Schema.const('serper').description('Serper (Google)'),
                Schema.const('tavily').description('Tavily (API)'),
                Schema.const('google-web').description('Google (Web)'),
                Schema.const('wikipedia').description('Wikipedia'),
                Schema.const('searxng').description('SearxNG')
            ])
        )
            .default(['free-google-api'])
            .role('select'),
        topK: Schema.number().min(2).max(50).step(1).default(5),
        puppeteerTimeout: Schema.number().default(60000),
        puppeteerIdleTimeout: Schema.number().default(300000),
        summaryType: Schema.union([
            Schema.const('speed'),
            Schema.const('balanced'),
            Schema.const('quality')
        ]).default('speed') as Schema<Config['summaryType']>,
        mulitSourceMode: Schema.union([
            Schema.const('average'),
            Schema.const('total')
        ]).default('average') as Schema<Config['mulitSourceMode']>,
        summaryModel: Schema.dynamic('model').default('empty'),

        searchThreshold: Schema.percent().step(0.01).default(0.25),
        contextualCompression: Schema.boolean().default(false)
    }),

    Schema.object({
        serperApiKey: Schema.string().role('secret'),
        serperCountry: Schema.string().default('cn'),
        serperLocation: Schema.string().default('zh-cn'),
        serperSearchResults: Schema.number().min(2).max(20).default(10)
    }),

    Schema.object({
        bingSearchApiKey: Schema.string().role('secret'),
        bingSearchLocation: Schema.string().default('zh-CN'),
        azureLocation: Schema.string().default('global')
    }),

    Schema.object({
        tavilyApiKey: Schema.string().role('secret')
    }),

    Schema.object({
        freeSearchBaseURL: Schema.string().default(
            'https://search.dingyi222666.top'
        )
    }),

    Schema.object({
        wikipediaBaseURL: Schema.array(Schema.string()).default([
            'https://en.wikipedia.org/w/api.php',
            'https://mzh.moegirl.org.cn/api.php'
        ]),
        maxWikipediaDocContentLength: Schema.number().default(5000)
    }),

    Schema.object({
        searxngBaseURL: Schema.string().default('https://paulgo.io')
    }),

    Schema.object({
        searchPrompt: Schema.string()
            .role('textarea')
            .default(
                `Based on the search results, generate a detailed response with proper citations:

1. Main Content:
   - Present information in well-organized sections
   - Include specific details, data, and technical terms
   - Keep original language and terminology
   - Mark each key fact with a citation [^1]
   - For multiple sources, use sequential citations [^1][^2]

2. Media Content:
   - Include images when available: ![description](image_url)[^3]
   - Format tables and structured data properly

3. Organization:
   - Use clear section headings
   - Present information in logical order
   - Include bullet points for clarity
   - Highlight important quotes with proper attribution

Context:
<context>
    {context}
</context>

Output with citation References:
[^1]: [title](url)
[^2]: [title](url)
...

Output Language need same as user input language.`
            ),
        newQuestionPrompt: Schema.string()
            .role('textarea')
            .default(
                `Analyze the follow-up question and return a JSON response based on the given conversation context.

Rules:
- CRITICAL: Use the exact same language as the input. Do not translate or change the language under any circumstances.
- Make the question self-contained and clear
- Optimize for search engine queries with time-sensitivity in mind
- Consider the current time: {time} when need formulating search queries
- ALWAYS generate 2-3 different search keywords/phrases for multi-source verification
- Do not add any explanations or additional content
- Base your response on a comprehensive analysis of the chat history
- Return your response in the following JSON format ONLY:
  {{
    "thought": "your reasoning about what to do with user input. Use the text language as the input",
    "action": "skip" | "search" | "url",
    "content": ["string1", "string2", ...] (optional array of strings)
  }}

Action types explanation:
1. "skip" - Use when the question doesn't require an internet search (e.g., personal opinions, simple calculations, or information already provided in the chat history)
   Example: {{ "thought": "This is asking for a personal opinion which doesn't require search", "action": "skip" }}

2. "search" - Use when you need to generate search-engine-friendly questions
   Example: For "What's the weather like in Tokyo and New York?"
   {{ "thought": "This requires checking current weather in two different cities as of {time}", "action": "search", "content": ["Current latest weather in Tokyo {time}", "Current latest weather in New York {time}", "Tokyo weather forecast today", "New York weather forecast today"] }}

3. "url" - Use when the message contains one or more URLs that should be browsed
   Example: For "Can you summarize the information from https://example.com/article and https://example.org/data?"
   {{ "thought": "This requires browsing two specific URLs to gather information", "action": "url", "content": ["https://example.com/article", "https://example.org/data"] }}

IMPORTANT:
- Your JSON response MUST be in the same language as the follow up input. This is crucial for maintaining context and accuracy.
- For time-sensitive queries (news, weather, events, etc.), ALWAYS include the current time {time} in your search queries.
- ALWAYS generate multiple (2-3) search queries for better coverage and verification from different sources.

Chat History:
{chat_history}
Current Time: {time}
Follow-up Input: {question}
JSON Response:`
            ),
        searchFailedPrompt: Schema.string()
            .role('textarea')
            .default(
                `For query "{question}" with no search results:

1. Inform user about no results found
2. Offer base knowledge assistance with clear limitations:
   - Based on training data, not current info
   - May be outdated for time-sensitive topics
   - No recent developments included

Use same language as query. Suggest alternative search terms if possible.`
            ),
        contextualCompressionPrompt: Schema.string().role('textarea')
            .default(`Summarize the context based on the search action. Format in Markdown with citations. Return 'empty' if nothing relevant found.

Context:
<context>
    {context}
</context>

Action:
{action}

Output:
---
{{First paragraph as overview with citations[^1]}}

{{2-5 detail paragraphs with supporting information and citations[^2][^3]}}

## References
[^1]: [title1](url1)
[^2]: [title2](url2)
[^3]: [title3](url3)
---`)
    })
]).i18n({
    'zh-CN': require('./locales/zh-CN.schema.yml'),
    'en-US': require('./locales/en-US.schema.yml')
}) as Schema<Config>

export const inject = ['chatluna', 'puppeteer']

export const name = 'chatluna-search-service'
