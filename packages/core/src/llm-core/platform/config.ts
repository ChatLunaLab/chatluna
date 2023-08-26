import Cache from '@koishijs/cache'
import { Awaitable, Computed, Context } from 'koishi'
import md5 from 'md5'
import { PlatformClientNames } from './types'

export interface ClientConfig {
    apiKey: string
    platform: PlatformClientNames
    maxRetries: number
    concurrentMaxSize: number
    apiEndpoint?: string
    chatLimit: Computed<Awaitable<number>>
}

export interface ClientConfigWrapper<T extends ClientConfig = ClientConfig> {
    value: T
    md5(): string
    isAvailable: boolean
    _md5?: string
}

export class ClientConfigPool<T extends ClientConfig = ClientConfig> {

    private _configs: ClientConfigWrapper<T>[] = []

    private _mode: ClientConfigPoolMode = ClientConfigPoolMode.AlwaysTheSame

    private _currentLoadConfigIndex = 0

    constructor(private ctx: Context, mode: ClientConfigPoolMode = ClientConfigPoolMode.AlwaysTheSame) {
        this._mode = mode
    }

    async addConfig(config: T) {
        const wrapperConfig = this._createWrapperConfig(config)

        this._configs.push(wrapperConfig)

        await this._checkConfigs()

        if (wrapperConfig.isAvailable === true) {
            await this.markConfigStatus(config, true)
        }
    }

    getConfig(): ClientConfigWrapper<T> {
        if (this._mode === ClientConfigPoolMode.AlwaysTheSame) {
            for (let i = 0; i < this._configs.length; i++) {
                const config = this._configs[i]

                if (config.isAvailable) {
                    return config
                }
            }
        }

        while (true) {
            const config = this._configs[this._currentLoadConfigIndex]

            if (config.isAvailable) {
                this._currentLoadConfigIndex = (this._currentLoadConfigIndex + 1) % this._configs.length

                return config
            }

            this._currentLoadConfigIndex = (this._currentLoadConfigIndex + 1) % this._configs.length
        }
    }

    getConfigs(): ReadonlyArray<ClientConfigWrapper<T>> {
        return this._configs
    }

    async markConfigStatus(config: T, isAvailable: boolean) {
        const key = this._getConfigMD5(config)

        await this.ctx.cache.set('chathub/client_config', key, isAvailable)

        const wrapper = this._configs.find(c => c.md5() === key)

        wrapper.isAvailable = isAvailable
    }


    private _getConfigMD5(config: T) {
        const values = Object.values(config)

        return md5(values.join(''))
    }


    private _createWrapperConfig(config: T): ClientConfigWrapper<T> {
        let wrapper: ClientConfigWrapper<T>
        wrapper = {
            value: config,
            md5: () => {
                if (wrapper._md5 == null) {
                    wrapper._md5 = this._getConfigMD5(config)
                }
                return wrapper._md5
            },
            isAvailable: true
        }
        return wrapper
    }

    private async _checkConfigs() {
        for (const config of this._configs) {
            const md5 = config.md5()

            const isAvailable = await this.ctx.cache.get('chathub/client_config', md5)

            config.isAvailable = isAvailable
        }
    }



}

declare module '@koishijs/cache' {
    interface Tables {
        'chathub/client_config': boolean
    }
}

export enum ClientConfigPoolMode {
    LoadBalancing,
    AlwaysTheSame
}