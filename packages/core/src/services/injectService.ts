import { Service, Dict, Context, Schema, Logger } from 'koishi'
import { Disposed, InjectData } from '../types'
import { createLogger } from '../utils/logger'

const logger = createLogger('@dingyi222666/chathub/injectService')

/**
 * 注入大语言模型的信息的支持
 */
export class LLMInjectService extends Service {

   private sources: Dict<InjectSource> = {}
    private counter = 0


    constructor(ctx: Context,protected config: LLMInjectService.Config) {
        super(ctx, 'llminject', true)
        this.config = config

        logger.debug('llminjectService started')
    }

    async search(query: string): Promise<InjectData[]> {
        const sources = Object.values(this.sources)
            .sort((a, b) => {
                if (a.config.weight !== b.config.weight)
                    return a.config.weight - b.config.weight

                return Math.random() - 0.5
            })

        const firstSource = sources[0]

        if (!firstSource) return []

        return firstSource.search(query)

    }


    public register(source: InjectSource) {
        const id = this.counter++
        this.sources[id] = source

        logger.debug(`register inject source ${source.label}`)

        return this.caller.collect('llminject', () =>
            delete this.sources[id]
        )
    }
}

export abstract class InjectSource<Config extends LLMInjectService.Config = LLMInjectService.Config> {
    static using = ['llminject']

    constructor(public ctx: Context, public config: Config) {
        const disposed = ctx.llminject.register(this)

        ctx.on('dispose', () => {
            disposed()
        })
    }

    abstract search(query: string): Promise<InjectData[]>

    label: string
}


export namespace LLMInjectService {
    export interface Config {
        weight: number
    }

    export const config: Schema<Config> = Schema.object({
        weight: Schema.number().min(1).max(100).step(1).default(1).description('注入信息来源的权重。在多个实现的注入服务里在按照各自的权重随机选择（权重越大越优先'),
    }).description('全局设置')

}


declare module 'koishi' {
    interface Context {
        llminject: LLMInjectService;
    }
}
