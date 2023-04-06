import { Service, Dict, Context, Schema, Logger } from 'koishi'
import { Disposed, InjectData } from '../types'

/**
 * 注入大语言模型的信息的支持
 */
export class LLMInjectService extends Service {

  private config: LLMInjectService.Config
  private sources: Dict<InjectSource> = {}
  private counter = 0
  private logger = new Logger('@dingyi222666/koishi-plugin-chathub-injectService')

  constructor(ctx: Context, config: LLMInjectService.Config) {
    super(ctx, 'llm-inject', true)
    this.config = config

    this.logger.info('llminjectService started')
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

    // 中文测试
    this.logger.info(`register inject source ${source}`)

    return this.caller.collect('llminject', () =>
      delete this.sources[id]
    )
  }
}

export abstract class InjectSource<Config extends LLMInjectService.Config = LLMInjectService.Config> {
  static using = ['llminject']

  constructor(public ctx: Context, public config: Config) {
    this.ctx.llminject.register(this)
  }

  abstract search(query: string): Promise<InjectData[]>
}


export namespace LLMInjectService {
  export interface Config {
    weight: number
  }

  export const config: Schema<Config> = Schema.object({
    weight: Schema.number().min(1).max(100).default(1).description('注入信息来源的权重。在多个实现的注入服务里在按照各自的权重随机选择（权重越大约优先'),
  }).description('全局设置')

}


declare module 'koishi' {
  interface Context {
    llminject: LLMInjectService;
  }
}
