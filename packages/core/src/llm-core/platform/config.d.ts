import { Awaitable, Computed, Context } from 'koishi'
import { PlatformClientNames } from 'koishi-plugin-chatluna/llm-core/platform/types'
export interface ClientConfig {
    apiKey: string
    platform: PlatformClientNames
    maxRetries: number
    concurrentMaxSize: number
    apiEndpoint?: string
    timeout: number
    chatLimit: Computed<Awaitable<number>>
}
export interface ClientConfigWrapper<T extends ClientConfig = ClientConfig> {
    value: T
    md5(): string
    isAvailable: boolean
    _md5?: string
    lockUntil?: number
    failureCount: number
    lastFailureTime?: number
}
export declare class ClientConfigPool<T extends ClientConfig = ClientConfig> {
    private ctx
    private _configs
    private _mode
    private _currentLoadConfigIndex
    private readonly LOCK_DURATIONS
    private readonly FAILURE_RESET_WINDOW
    private readonly MAX_FAILURES_WINDOW
    constructor(ctx: Context, mode?: ClientConfigPoolMode)
    addConfig(config: T): void
    findAvailableConfig(): ClientConfigWrapper<T> | undefined
    getConfig(lockSelectConfig?: boolean): ClientConfigWrapper<T>
    getConfigs(): readonly ClientConfigWrapper<T>[]
    markConfigStatus(config: T, isAvailable: boolean): void
    private _getConfigMD5
    private _createWrapperConfig
    private _getFirstAvailableConfig
    private _getRoundRobinConfig
    private _getRandomConfig
    private _updateConfigAvailability
    private _applyFailureLock
}
export declare enum ClientConfigPoolMode {
    LoadBalancing = 0,
    AlwaysTheSame = 1,
    RoundRobin = 2,
    Random = 3
}
