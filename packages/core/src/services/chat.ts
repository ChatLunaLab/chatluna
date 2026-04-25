import { CallbackManager } from '@langchain/core/callbacks/manager'
import fs from 'fs'
import path from 'path'
import {
    Awaitable,
    Computed,
    Context,
    Dict,
    Schema,
    Service,
    Session
} from 'koishi'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
import { ChatInterface } from 'koishi-plugin-chatluna/llm-core/chat/app'
import { Cache } from '../cache'
import { ChatChain } from '../chains/chain'
import { ChatLunaLLMChainWrapper } from 'koishi-plugin-chatluna/llm-core/chain/base'
import {
    type ChatLunaAgent,
    createAgent,
    type CreateChatLunaAgentOptions,
    resolveAgentEmbeddings,
    resolveAgentModel,
    resolveAgentPreset,
    resolveAgentTools
} from 'koishi-plugin-chatluna/llm-core/agent'
import { BasePlatformClient } from 'koishi-plugin-chatluna/llm-core/platform/client'
import {
    ClientConfig,
    ClientConfigPool,
    ClientConfigPoolMode
} from 'koishi-plugin-chatluna/llm-core/platform/config'
import {
    ChatLunaBaseEmbeddings,
    ChatLunaChatModel
} from 'koishi-plugin-chatluna/llm-core/platform/model'
import {
    PlatformService,
    ToolMaskArg,
    ToolMaskResolver
} from 'koishi-plugin-chatluna/llm-core/platform/service'
import {
    ChatLunaTool,
    CreateChatLunaLLMChainParams,
    CreateVectorStoreFunction,
    ModelType,
    PlatformClientNames
} from 'koishi-plugin-chatluna/llm-core/platform/types'
import { PresetService } from 'koishi-plugin-chatluna/preset'
import { Message } from '../types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { MessageTransformer } from './message_transform'
import { ChatCallbackProviderInput, ChatCallbacksProvider } from './types'
import { ConversationService } from './conversation'
import { type ChatOptions, ConversationRuntime } from './conversation_runtime'
import { ConstraintRecord, ConversationRecord } from './conversation_types'
import { chatLunaFetch, ws } from 'koishi-plugin-chatluna/utils/request'
import * as fetchType from 'undici/types/fetch'
import { ClientOptions, WebSocket } from 'ws'
import { ClientRequestArgs } from 'http'
import { Config } from '../config'
import { DefaultRenderer, Renderer } from 'koishi-plugin-chatluna'
import { withResolver } from 'koishi-plugin-chatluna/utils/promise'
import { emptyEmbeddings } from 'koishi-plugin-chatluna/llm-core/model/in_memory'
import { ChatLunaPromptRenderService } from './prompt_renderer'
import { computed, ComputedRef, watch } from '@vue/reactivity'
import { Embeddings } from '@langchain/core/embeddings'
import { RunnableConfig } from '@langchain/core/runnables'
import type { Notifier } from '@koishijs/plugin-notifier'
import { ChatLunaContextManagerService } from 'koishi-plugin-chatluna/llm-core/prompt'
import { createChatPrompt } from 'koishi-plugin-chatluna/utils/chatluna'

export class ChatLunaService extends Service<Config> {
    private _plugins: Record<string, ChatLunaPlugin> = {}
    private readonly _chain: ChatChain
    private readonly _keysCache: Cache<'chatluna/keys', string>
    private readonly _preset: PresetService
    private readonly _platformService: PlatformService
    private readonly _messageTransformer: MessageTransformer
    private readonly _renderer: DefaultRenderer
    private readonly _promptRenderer: ChatLunaPromptRenderService
    private readonly _contextManager: ChatLunaContextManagerService
    private readonly _conversation: ConversationService
    private readonly _conversationRuntime: ConversationRuntime
    private readonly _callbackProviders = new Set<ChatCallbacksProvider>()
    declare public config: Config

    declare public currentConfig: Config

    constructor(
        public readonly ctx: Context,
        config: Config
    ) {
        super(ctx, 'chatluna')
        this.config = config
        this.currentConfig = config
        this._chain = new ChatChain(ctx, config)
        this._keysCache = new Cache(this.ctx, config, 'chatluna/keys')
        this._preset = new PresetService(ctx, config)
        this._platformService = new PlatformService(ctx)
        this._messageTransformer = new MessageTransformer(config)
        this._renderer = new DefaultRenderer(ctx, config)
        this._promptRenderer = new ChatLunaPromptRenderService()
        this._contextManager = new ChatLunaContextManagerService(ctx)
        this._conversation = new ConversationService(ctx, config)
        this._conversationRuntime = new ConversationRuntime(this)

        this._createTempDir()
        this._defineDatabase()
        this.ctx.on('ready', async () => {
            await this._dedupeConstraintNames()
        })
    }

    async installPlugin(plugin: ChatLunaPlugin) {
        const platformName = plugin.platformName

        if (this._plugins[platformName]) {
            throw new ChatLunaError(
                ChatLunaErrorCode.PLUGIN_ALREADY_REGISTERED,
                new Error(`Plugin ${platformName} already registered`)
            )
        }

        this._plugins[platformName] = plugin

        this.ctx.logger.success(`Plugin %c installed`, platformName)
    }

    async awaitLoadPlatform(
        plugin: ChatLunaPlugin | string,
        timeout: number = 30000
    ) {
        const pluginName =
            typeof plugin === 'string' ? plugin : plugin.platformName

        const { promise, resolve, reject } = withResolver<void>()

        // 提前检测，如果已经加载，则直接返回
        const models = this._platformService.listPlatformModels(
            pluginName,
            ModelType.all
        )

        if (models.value.length > 0) {
            resolve()
            return promise
        }

        let timeoutError: Error | null = null

        try {
            throw new Error(
                `Timeout waiting for platform ${pluginName} to load`
            )
        } catch (e) {
            timeoutError = e
        }

        // 添加超时处理
        const timeoutId = this.ctx.setTimeout(() => {
            reject(timeoutError)
        }, timeout)

        const disposable = watch(
            models,
            () => {
                if ((models.value?.length ?? 0) > 0) {
                    resolve()
                    timeoutId()
                    disposable.stop()
                }
            },
            { deep: true }
        )

        this[Context.origin].effect(() => () => disposable.stop())

        return promise
    }

    uninstallPlugin(plugin: ChatLunaPlugin | string) {
        const platformName =
            typeof plugin === 'string' ? plugin : plugin.platformName

        const targetPlugin = this._plugins[platformName]

        if (!targetPlugin) {
            // this.ctx.logger.warn('Plugin %c not found', platformName)
            return
        }

        const platform = targetPlugin.platformName

        this._conversationRuntime.dispose(platform)

        delete this._plugins[platform]

        this.ctx.logger.success(
            'Plugin %c uninstalled',
            targetPlugin.platformName
        )
    }

    registerToolMaskResolver(name: string, resolver: ToolMaskResolver) {
        return this._platformService.registerToolMaskResolver(name, resolver)
    }

    async resolveToolMask(arg: ToolMaskArg) {
        return this._platformService.resolveToolMask(arg)
    }

    getPlugin(platformName: string) {
        return this._plugins[platformName]
    }

    chat(
        session: Session,
        conversation: ConversationRecord,
        message: Message,
        options: ChatOptions = {}
    ): Promise<Message> {
        return this._conversationRuntime.chat(
            session,
            conversation,
            message,
            options
        )
    }

    registerCallbacksProvider(provider: ChatCallbacksProvider) {
        this._callbackProviders.add(provider)
        return () => {
            this._callbackProviders.delete(provider)
        }
    }

    async resolveCallbacks(input: ChatCallbackProviderInput) {
        let merged = input.callbacks
        for (const provider of this._callbackProviders) {
            merged = CallbackManager.configure(merged, await provider(input))
        }

        return merged
    }

    async clearCache(conversation: ConversationRecord) {
        return this._conversationRuntime.clearConversationInterface(
            conversation
        )
    }

    async createChatInterface(conversation: ConversationRecord) {
        const config = this.currentConfig
        const chatInterface = new ChatInterface(this.ctx.root, {
            chatMode: conversation.chatMode,
            autoTitle: conversation.autoTitle ?? true,
            botName: config.botNames[0],
            preset: this.preset.getPreset(conversation.preset),
            model: conversation.model,
            conversationId: conversation.id,
            embeddings:
                config.defaultEmbeddings && config.defaultEmbeddings.length > 0
                    ? config.defaultEmbeddings
                    : undefined,
            vectorStoreName:
                config.defaultVectorStore &&
                config.defaultVectorStore.length > 0
                    ? config.defaultVectorStore
                    : undefined
        })

        return chatInterface
    }

    async createChatModel(
        platform: string,
        modelName: string
    ): Promise<ComputedRef<ChatLunaChatModel | undefined>>

    async createChatModel(
        fullModelName: string
    ): Promise<ComputedRef<ChatLunaChatModel | undefined>>

    async createChatModel(platformName: string, model?: string) {
        const service = this._platformService

        if (model == null) {
            ;[platformName, model] = parseRawModelName(platformName)
        }

        const client = await service.getClient(platformName)

        return computed(() => {
            if (client.value == null) {
                return undefined
            }
            try {
                return client.value.createModel(model) as ChatLunaChatModel
            } catch (error) {
                this.ctx.logger.warn(`The model ${model} not found`, error)
            }
            return undefined
        })
    }

    async createEmbeddings(
        platformName: string,
        modelName: string
    ): Promise<ComputedRef<Embeddings | undefined>>

    async createEmbeddings(
        fullModelName: string
    ): Promise<ComputedRef<Embeddings | undefined>>

    async createEmbeddings(platformName: string, modelName?: string) {
        const service = this._platformService

        if (modelName == null) {
            ;[platformName, modelName] = parseRawModelName(platformName)
        }

        const client = await service.getClient(platformName)

        return computed(() => {
            if (client.value == null) {
                if (platformName !== '无') {
                    this.ctx.logger.warn(
                        `The platform ${platformName} no available`
                    )
                }
                return emptyEmbeddings
            }

            try {
                const model = client.value.createModel(modelName)

                if (model instanceof ChatLunaBaseEmbeddings) {
                    return model
                }
            } catch (error) {
                this.ctx.logger.warn(`The model ${modelName} not found`, error)
            }

            this.ctx.logger.warn(
                `The model ${modelName} is not embeddings, return empty embeddings`
            )
            return emptyEmbeddings
        })
    }

    async createAgent(
        options: CreateChatLunaAgentOptions
    ): Promise<ChatLunaAgent> {
        const llm = await resolveAgentModel(options.model, (name) =>
            this.createChatModel(name)
        )
        const embeddings = await resolveAgentEmbeddings(
            options.embeddings,
            (name) => this.createEmbeddings(name),
            this.currentConfig.defaultEmbeddings
        )
        const tools = resolveAgentTools(options.tools, (name) =>
            this.platform.getTool(name)
        )
        const { preset, instructions } = resolveAgentPreset(options, (name) =>
            computed(() => this._preset.getPreset(name).value)
        )
        const prompt =
            options.prompt ?? createChatPrompt(this.ctx, llm.value, preset)

        return createAgent({
            id: options.id,
            name: options.name,
            description: options.description,
            llm,
            embeddings,
            tools,
            prompt,
            mode: options.mode,
            maxSteps: options.maxSteps,
            handleParsingErrors: options.handleParsingErrors,
            instructions,
            returnIntermediateSteps: options.returnIntermediateSteps,
            toolMask: options.toolMask
        })
    }

    get platform() {
        return this._platformService
    }

    get cache() {
        return this._keysCache
    }

    get preset() {
        return this._preset
    }

    get chatChain() {
        return this._chain
    }

    get messageTransformer() {
        return this._messageTransformer
    }

    get renderer() {
        return this._renderer
    }

    get promptRenderer() {
        return this._promptRenderer
    }

    get contextManager() {
        return this._contextManager
    }

    get conversation() {
        return this._conversation
    }

    get conversationRuntime() {
        return this._conversationRuntime
    }

    protected async stop(): Promise<void> {
        this._conversationRuntime.dispose()
        this._platformService.dispose()
        this._contextManager.clearAll()
    }

    private _createTempDir() {
        // create dir data/chathub/temp use fs
        // ?
        const tempPath = path.resolve(this.ctx.baseDir, 'data/chatluna/temp')
        if (!fs.existsSync(tempPath)) {
            fs.mkdirSync(tempPath, { recursive: true })
        }
    }

    private async _dedupeConstraintNames() {
        const rows = (await this.ctx.database.get(
            'chatluna_constraint',
            {}
        )) as ConstraintRecord[]

        if (rows.length < 2) {
            return
        }

        const names = new Set<string>()
        const ids = [...rows]
            .sort((left, right) => {
                const leftTime = left.updatedAt?.getTime() ?? 0
                const rightTime = right.updatedAt?.getTime() ?? 0
                if (leftTime !== rightTime) {
                    return rightTime - leftTime
                }

                return (right.id ?? 0) - (left.id ?? 0)
            })
            .filter((row) => {
                if (!names.has(row.name)) {
                    names.add(row.name)
                    return false
                }

                return row.id != null
            })
            .map((row) => row.id!)

        if (ids.length === 0) {
            return
        }

        this.ctx.logger.warn(
            `Removing ${ids.length} duplicate chatluna_constraint rows.`
        )
        await this.ctx.database.remove('chatluna_constraint', {
            id: ids
        })
    }

    private _defineDatabase() {
        const ctx = this.ctx

        ctx.database.extend(
            'chatluna_conversation',
            {
                id: {
                    type: 'char',
                    length: 255
                },
                seq: {
                    type: 'unsigned',
                    nullable: true
                },
                bindingKey: {
                    type: 'string',
                    length: 255
                },
                title: 'string',
                model: {
                    type: 'char',
                    length: 100
                },
                preset: {
                    type: 'char',
                    length: 255
                },
                chatMode: {
                    type: 'char',
                    length: 20
                },
                createdBy: {
                    type: 'char',
                    length: 255
                },
                createdAt: {
                    type: 'timestamp',
                    nullable: false,
                    initial: new Date()
                },
                updatedAt: {
                    type: 'timestamp',
                    nullable: false,
                    initial: new Date()
                },
                lastChatAt: {
                    type: 'timestamp',
                    nullable: true
                },
                status: {
                    type: 'char',
                    length: 20
                },
                latestMessageId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                additional_kwargs: {
                    type: 'text',
                    nullable: true
                },
                compression: {
                    type: 'text',
                    nullable: true
                },
                archivedAt: {
                    type: 'timestamp',
                    nullable: true
                },
                archiveId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                legacyRoomId: {
                    type: 'unsigned',
                    nullable: true
                },
                legacyMeta: {
                    type: 'text',
                    nullable: true
                },
                autoTitle: {
                    type: 'boolean',
                    nullable: true
                }
            },
            {
                autoInc: false,
                primary: 'id',
                unique: ['id']
            }
        )

        ctx.database.extend(
            'chatluna_message',
            {
                id: {
                    type: 'char',
                    length: 255
                },
                conversationId: {
                    type: 'char',
                    length: 255
                },
                parentId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                role: {
                    type: 'char',
                    length: 20
                },
                text: {
                    type: 'text',
                    nullable: true
                },
                content: {
                    type: 'binary',
                    nullable: true
                },
                name: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                tool_call_id: {
                    type: 'string',
                    nullable: true
                },
                tool_calls: {
                    type: 'json',
                    nullable: true
                },
                additional_kwargs_binary: {
                    type: 'binary',
                    nullable: true
                },
                response_metadata_binary: {
                    type: 'binary',
                    nullable: true
                },
                rawId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                createdAt: {
                    type: 'timestamp',
                    nullable: true
                }
            },
            {
                autoInc: false,
                primary: 'id',
                unique: ['id']
            }
        )

        ctx.database.extend(
            'chatluna_binding',
            {
                bindingKey: {
                    type: 'string',
                    length: 255
                },
                activeConversationId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                lastConversationId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                updatedAt: {
                    type: 'timestamp',
                    nullable: false,
                    initial: new Date()
                }
            },
            {
                autoInc: false,
                primary: 'bindingKey',
                unique: ['bindingKey']
            }
        )

        ctx.database.extend(
            'chatluna_constraint',
            {
                id: 'unsigned',
                name: 'string',
                enabled: {
                    type: 'boolean',
                    initial: true
                },
                priority: {
                    type: 'integer',
                    initial: 0
                },
                createdBy: {
                    type: 'char',
                    length: 255
                },
                createdAt: {
                    type: 'timestamp',
                    nullable: false,
                    initial: new Date()
                },
                updatedAt: {
                    type: 'timestamp',
                    nullable: false,
                    initial: new Date()
                },
                platform: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                selfId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                guildId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                channelId: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                direct: {
                    type: 'boolean',
                    nullable: true
                },
                users: {
                    type: 'text',
                    nullable: true
                },
                excludeUsers: {
                    type: 'text',
                    nullable: true
                },
                routeMode: {
                    type: 'char',
                    length: 20,
                    nullable: true
                },
                routeKey: {
                    type: 'string',
                    length: 255,
                    nullable: true
                },
                activePresetLane: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                defaultModel: {
                    type: 'char',
                    length: 100,
                    nullable: true
                },
                defaultPreset: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                defaultChatMode: {
                    type: 'char',
                    length: 20,
                    nullable: true
                },
                fixedModel: {
                    type: 'char',
                    length: 100,
                    nullable: true
                },
                fixedPreset: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                fixedChatMode: {
                    type: 'char',
                    length: 20,
                    nullable: true
                },
                lockConversation: {
                    type: 'boolean',
                    nullable: true
                },
                allowNew: {
                    type: 'boolean',
                    nullable: true
                },
                allowSwitch: {
                    type: 'boolean',
                    nullable: true
                },
                allowArchive: {
                    type: 'boolean',
                    nullable: true
                },
                allowExport: {
                    type: 'boolean',
                    nullable: true
                },
                manageMode: {
                    type: 'char',
                    length: 20,
                    nullable: true
                }
            },
            {
                autoInc: true,
                primary: 'id',
                unique: ['name']
            }
        )

        ctx.database.extend(
            'chatluna_archive',
            {
                id: {
                    type: 'char',
                    length: 255
                },
                conversationId: {
                    type: 'char',
                    length: 255
                },
                path: 'string',
                formatVersion: {
                    type: 'unsigned'
                },
                messageCount: {
                    type: 'unsigned'
                },
                checksum: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                size: {
                    type: 'unsigned'
                },
                state: {
                    type: 'char',
                    length: 20
                },
                createdAt: {
                    type: 'timestamp',
                    nullable: false,
                    initial: new Date()
                },
                restoredAt: {
                    type: 'timestamp',
                    nullable: true
                }
            },
            {
                autoInc: false,
                primary: 'id',
                unique: ['id']
            }
        )

        ctx.database.extend(
            'chatluna_acl',
            {
                conversationId: {
                    type: 'char',
                    length: 255
                },
                principalType: {
                    type: 'char',
                    length: 20
                },
                principalId: {
                    type: 'char',
                    length: 255
                },
                permission: {
                    type: 'char',
                    length: 20
                }
            },
            {
                autoInc: false,
                primary: [
                    'conversationId',
                    'principalType',
                    'principalId',
                    'permission'
                ]
            }
        )

        ctx.database.extend(
            'chatluna_meta',
            {
                key: {
                    type: 'string',
                    length: 255
                },
                value: {
                    type: 'text',
                    nullable: true
                },
                updatedAt: {
                    type: 'timestamp',
                    nullable: false,
                    initial: new Date()
                }
            },
            {
                autoInc: false,
                primary: 'key',
                unique: ['key']
            }
        )

        ctx.database.extend(
            'chatluna_docstore',
            {
                key: {
                    type: 'char',
                    length: 255
                },
                id: {
                    type: 'char',
                    length: 255
                },
                pageContent: 'text',
                metadata: 'json',
                createdAt: 'date'
            },
            {
                autoInc: false,
                primary: ['key', 'id']
            }
        )
    }

    static inject = ['database']
}

export class ChatLunaPlugin<
    R extends ClientConfig = ClientConfig,
    T extends ChatLunaPlugin.Config = ChatLunaPlugin.Config
> {
    private _supportModels: string[] = []

    public readonly platformConfigPool: ClientConfigPool<R>

    private _platformService: PlatformService

    constructor(
        protected ctx: Context,
        public readonly config: T,
        public platformName: PlatformClientNames,
        createConfigPool: boolean = true
    ) {
        ctx.on('dispose', async () => {
            ctx.chatluna.uninstallPlugin(this)
        })

        ctx.on('ready', async () => {
            ctx.chatluna.installPlugin(this)
        })

        if (createConfigPool) {
            if (config == null) {
                const error = new Error('Check Config!')

                // unstable code
                this.ctx.scope.cancel(error)
                throw error
            }

            this.platformConfigPool = new ClientConfigPool<R>(
                ctx,
                config.configMode === 'default'
                    ? ClientConfigPoolMode.AlwaysTheSame
                    : ClientConfigPoolMode.LoadBalancing
            )
        }

        this._platformService = ctx.chatluna.platform

        const models = this._platformService.listPlatformModels(
            this.platformName,
            ModelType.llm
        )

        const watcher = watch(
            models,
            () => {
                this._supportModels = (models.value ?? []).map(
                    (model) => `${this.platformName}/${model.name}`
                )
            },
            { deep: true }
        )

        const stop = () => watcher.stop()

        this.ctx.effect(() => stop)
    }

    parseConfig(f: (config: T) => R[]) {
        const configs = f(this.config)

        for (const config of configs) {
            this.platformConfigPool.addConfig(config)
        }
    }

    private createRunnableConfig(): RunnableConfig {
        const abortController = new AbortController()

        const abort = () =>
            abortController.abort(
                new ChatLunaError(ChatLunaErrorCode.ABORTED, undefined, true)
            )

        this.ctx.effect(() => abort)

        return {
            signal: abortController.signal
        }
    }

    async initClient() {
        let notification: Notifier | undefined
        let result: { type: 'success' | 'danger'; content: string } | undefined

        this.ctx.inject(['notifier'], (ctx) => {
            if (notification) return
            if (result) {
                notification = ctx.notifier.create({
                    content: result.content,
                    type: result.type
                })
            } else {
                notification = ctx.notifier.create({
                    content: `适配器 ${this.platformName} 加载中...`,
                    type: 'primary'
                })
            }
            ctx.effect(() => () => notification?.dispose())
        })

        try {
            await this._platformService.createClient(
                this.platformName,
                this.createRunnableConfig()
            )

            const content = `适配器 ${this.platformName} 加载成功，共加载了 ${this._supportModels.length} 个模型。`
            if (notification) {
                notification.update({ content, type: 'success' })
            } else {
                result = { type: 'success', content }
            }
        } catch (e) {
            const content = `适配器 ${this.platformName} 加载失败: ${e.message}`
            if (notification) {
                notification.update({ content, type: 'danger' })
            } else {
                result = { type: 'danger', content }
            }

            this.ctx.chatluna.uninstallPlugin(this)

            // unstable code
            this.ctx.scope.cancel(e)

            throw e
        }
    }

    get supportedModels(): readonly string[] {
        return this._supportModels
    }

    registerToService() {
        try {
            throw new Error('Please remove this method')
        } catch (e) {
            this.ctx.logger.warn(
                `Now the plugin support auto installation, Please remove call this method`,
                e
            )
        }
    }

    registerClient(
        func: () => BasePlatformClient,
        platformName: string = this.platformName
    ) {
        this.ctx.effect(() =>
            this._platformService.registerClient(platformName, func)
        )
    }

    registerVectorStore(name: string, func: CreateVectorStoreFunction) {
        this.ctx.effect(() =>
            this._platformService.registerVectorStore(name, func)
        )
    }

    registerTool(name: string, tool: ChatLunaTool) {
        this.ctx.effect(() => this._platformService.registerTool(name, tool))
    }

    registerChatChainProvider(
        name: string,
        description: Dict<string>,
        func: (params: CreateChatLunaLLMChainParams) => ChatLunaLLMChainWrapper
    ) {
        this.ctx.effect(() =>
            this._platformService.registerChatChain(name, description, func)
        )
    }

    registerRenderer(
        name: string,
        renderer: (ctx: Context, config: Config) => Renderer
    ) {
        this.ctx.effect(() =>
            this.ctx.chatluna.renderer.addRenderer(name, renderer)
        )
    }

    fetch(
        info: fetchType.RequestInfo,
        init?: fetchType.RequestInit,
        proxy?: string
    ) {
        if (proxy != null) {
            return chatLunaFetch(info, init, proxy)
        }

        const proxyMode = this.config.proxyMode

        switch (proxyMode) {
            case 'system':
                return chatLunaFetch(info, init)
            case 'off':
                return chatLunaFetch(info, init, 'null')
            case 'on':
                return chatLunaFetch(info, init, this.config.proxyAddress)
            default:
                return chatLunaFetch(info, init)
        }
    }

    ws(url: string, options?: ClientOptions | ClientRequestArgs): WebSocket {
        const proxyMode = this.config.proxyMode

        let webSocket: WebSocket

        switch (proxyMode) {
            case 'system':
                webSocket = ws(url, options)
                break
            case 'off':
                webSocket = ws(url, options, 'null')
                break
            case 'on':
                webSocket = ws(url, options, this.config.proxyAddress)
                break
            default:
                webSocket = ws(url, options)
                break
        }

        this.ctx.effect(() => webSocket.close)

        webSocket.on('error', (err) => {
            this.ctx.logger.error(err)
        })

        return webSocket
    }
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace ChatLunaPlugin {
    export interface Config {
        chatConcurrentMaxSize?: number
        chatTimeLimit?: Computed<Awaitable<number>>
        timeout?: number
        configMode: string
        maxRetries: number
        proxyMode: string
        proxyAddress: string
    }

    export const Config: Schema<ChatLunaPlugin.Config> = Schema.intersect([
        Schema.object({
            chatConcurrentMaxSize: Schema.number().min(1).max(8).default(3),
            chatTimeLimit: Schema.computed(
                Schema.number().min(1).max(2000)
            ).default(200),
            configMode: Schema.union([
                Schema.const('default'),
                Schema.const('balance')
            ]).default('default'),
            maxRetries: Schema.number().min(1).max(6).default(5),
            timeout: Schema.number().default(300 * 1000),
            proxyMode: Schema.union([
                Schema.const('system'),
                Schema.const('off'),
                Schema.const('on')
            ]).default('system')
        }),
        Schema.union([
            Schema.object({
                proxyMode: Schema.const('on').required(),
                proxyAddress: Schema.string().default('http://127.0.0.1:7897')
            }),
            Schema.object({
                proxyMode: Schema.const('off').required()
            }),
            Schema.object({
                proxyMode: Schema.const('system')
            })
        ])
    ]).i18n({
        'zh-CN': require('../locales/zh-CN.schema.plugin.yml'),
        'en-US': require('../locales/en-US.schema.plugin.yml')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }) as any
}

export * from './prompt_renderer'
export * from './types'
export * from './message_transform'
export * from '../llm-core/prompt/context_manager'
