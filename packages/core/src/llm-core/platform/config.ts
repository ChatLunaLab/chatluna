import { createHash } from 'crypto'
import { Awaitable, Computed, Context } from 'koishi'
import { PlatformClientNames } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'

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

export class ClientConfigPool<T extends ClientConfig = ClientConfig> {
    private _configs: ClientConfigWrapper<T>[] = []

    private _mode: ClientConfigPoolMode = ClientConfigPoolMode.AlwaysTheSame

    private _currentLoadConfigIndex = 0

    private readonly LOCK_DURATIONS = [
        1000,
        5 * 1000,
        10 * 1000,
        30 * 1000,
        60 * 1000,
        2 * 60 * 1000,
        3 * 60 * 1000,
        5 * 60 * 1000,
        10 * 60 * 1000
    ] as const

    private readonly FAILURE_RESET_WINDOW = 5 * 60 * 1000

    private readonly MAX_FAILURES_WINDOW = 30 * 60 * 1000

    constructor(
        private ctx: Context,
        mode: ClientConfigPoolMode = ClientConfigPoolMode.AlwaysTheSame
    ) {
        this._mode = mode

        ctx.setInterval(() => {
            const now = Date.now()
            this._configs.forEach((config) => {
                this._updateConfigAvailability(config, now)
            })
        }, 1000 * 10)
    }

    addConfig(config: T) {
        const wrapperConfig = this._createWrapperConfig(config)

        this._configs.push(wrapperConfig)

        this._updateConfigAvailability(wrapperConfig)
    }

    public findAvailableConfig(): ClientConfigWrapper<T> | undefined {
        const now = Date.now()
        return this._configs.find((config) => {
            this._updateConfigAvailability(config, now)
            return config.isAvailable
        })
    }

    getConfig(lockSelectConfig: boolean = false): ClientConfigWrapper<T> {
        const now = Date.now()

        switch (this._mode) {
            case ClientConfigPoolMode.AlwaysTheSame:
                return this._getFirstAvailableConfig(now)

            case ClientConfigPoolMode.LoadBalancing:
            case ClientConfigPoolMode.RoundRobin:
                return this._getRoundRobinConfig(now, lockSelectConfig)

            case ClientConfigPoolMode.Random:
                return this._getRandomConfig(now)

            default:
                return this._getFirstAvailableConfig(now)
        }
    }

    getConfigs(): readonly ClientConfigWrapper<T>[] {
        return this._configs
    }

    markConfigStatus(config: T, isAvailable: boolean) {
        const key = this._getConfigMD5(config)
        const wrapper = this._configs.find((c) => c.md5() === key)

        if (!wrapper) return

        const now = Date.now()

        if (isAvailable) {
            wrapper.isAvailable = true
            wrapper.lockUntil = undefined
            wrapper.failureCount = 0
            wrapper.lastFailureTime = undefined
        } else {
            this._applyFailureLock(wrapper, now)
        }
    }

    private _getConfigMD5(config: T) {
        const values = Object.keys(config)
            .sort()
            .map((key) => config[key])

        return createHash('md5').update(values.join('')).digest('hex')
    }

    private _createWrapperConfig(config: T): ClientConfigWrapper<T> {
        const wrapper: ClientConfigWrapper<T> = {
            value: config,
            md5: () => {
                if (wrapper._md5 == null) {
                    wrapper._md5 = this._getConfigMD5(config)
                }
                return wrapper._md5
            },
            isAvailable: true,
            failureCount: 0
        }
        return wrapper
    }

    private _getFirstAvailableConfig(now: number): ClientConfigWrapper<T> {
        const config = this.findAvailableConfig()
        if (!config) {
            throw new ChatLunaError(ChatLunaErrorCode.NOT_AVAILABLE_CONFIG)
        }
        return config
    }

    private _getRoundRobinConfig(
        now: number,
        lockSelectConfig: boolean
    ): ClientConfigWrapper<T> {
        if (this._configs.length === 0) {
            throw new ChatLunaError(ChatLunaErrorCode.NOT_AVAILABLE_CONFIG)
        }

        const startIndex = this._currentLoadConfigIndex
        do {
            const config = this._configs[this._currentLoadConfigIndex]

            if (config) {
                this._updateConfigAvailability(config, now)
                if (config.isAvailable) {
                    if (!lockSelectConfig) {
                        this._currentLoadConfigIndex =
                            (this._currentLoadConfigIndex + 1) %
                            this._configs.length
                    }
                    return config
                }
            }

            this._currentLoadConfigIndex =
                (this._currentLoadConfigIndex + 1) % this._configs.length
        } while (this._currentLoadConfigIndex !== startIndex)

        throw new ChatLunaError(ChatLunaErrorCode.NOT_AVAILABLE_CONFIG)
    }

    private _getRandomConfig(now: number): ClientConfigWrapper<T> {
        const availableConfigs = this._configs.filter((config) => {
            this._updateConfigAvailability(config, now)
            return config.isAvailable
        })

        if (availableConfigs.length === 0) {
            throw new ChatLunaError(ChatLunaErrorCode.NOT_AVAILABLE_CONFIG)
        }

        const randomIndex = Math.floor(Math.random() * availableConfigs.length)
        return availableConfigs[randomIndex]
    }

    private _updateConfigAvailability(
        wrapper: ClientConfigWrapper<T>,
        now: number = Date.now()
    ): void {
        if (wrapper.lockUntil && now >= wrapper.lockUntil) {
            wrapper.isAvailable = true
            wrapper.lockUntil = undefined
        }

        if (
            wrapper.lastFailureTime &&
            now - wrapper.lastFailureTime > this.FAILURE_RESET_WINDOW
        ) {
            wrapper.failureCount = 0
            wrapper.lastFailureTime = undefined
            wrapper.isAvailable = true
        }

        if (wrapper.lockUntil && now < wrapper.lockUntil) {
            wrapper.isAvailable = false
        }
    }

    private _applyFailureLock(
        wrapper: ClientConfigWrapper<T>,
        now: number
    ): void {
        wrapper.failureCount += 1
        wrapper.lastFailureTime = now
        wrapper.isAvailable = false

        const lockIndex = Math.min(
            wrapper.failureCount - 1,
            this.LOCK_DURATIONS.length - 1
        )
        const lockDuration = this.LOCK_DURATIONS[lockIndex]

        if (
            wrapper.failureCount === 2 &&
            wrapper.lastFailureTime &&
            now - wrapper.lastFailureTime > this.MAX_FAILURES_WINDOW
        ) {
            wrapper.failureCount = 1
        }

        wrapper.lockUntil = now + lockDuration
    }
}

export enum ClientConfigPoolMode {
    LoadBalancing,
    AlwaysTheSame,
    RoundRobin,
    Random
}
