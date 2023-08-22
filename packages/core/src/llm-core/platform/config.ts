import Cache from '@koishijs/cache'
import { Context } from 'koishi'
import md5 from 'md5'

export interface ClientConfig {
    apiKey: string
    platform: string
    maxRetries: number
    apiEndpoint?: string
}

export interface ClientConfigWrapper<T extends ClientConfig> {
    value: T
    md5(): string
    isAvailable: boolean
    _md5?: string
}

export class ClientConfigPool<T extends ClientConfig> {

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
            for (const config of this._configs) {
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
        const configs = await this.ctx.cache.entries('chathub/client_config')

        for (const key in configs) {
            const isAvailable = configs[key]

            const config = this._configs.find(c => c.md5() === key)

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