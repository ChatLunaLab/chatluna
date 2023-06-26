import { createLogger } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/utils/logger'
import { ChatHubPlugin } from "@dingyi222666/koishi-plugin-chathub/lib/services/chat"
import { ToolProvider } from '@dingyi222666/koishi-plugin-chathub/lib/llm-core/model/base'

import { Context, Schema } from 'koishi'
import { plugin } from './plugin'
import { Tool } from 'langchain/tools'

const logger = createLogger('@dingyi222666/chathub-plugin-common')

class CommonPlugin extends ChatHubPlugin<CommonPlugin.Config> {

    name = "@dingyi222666/chathub-plugin-common"

    constructor(protected ctx: Context, public readonly config: CommonPlugin.Config) {
        super(ctx, config)

        setTimeout(async () => {

            await ctx.chathub.registerPlugin(this)

            await plugin(ctx, config, this)
        })


    }
}

export class WrapperToolProvider implements ToolProvider {

    protected constructor(private readonly _name: string, private readonly _createTool: ToolProvider['createTool'], private readonly _description?: string) { }

    name: string = this._name
    description?: string = this._description
    createTool(params: Record<string, any>): Promise<Tool> {
        return this._createTool(params)
    }

    static wrap(name: string, createTool: ToolProvider['createTool'], description?: string) {
        return new WrapperToolProvider(name, createTool, description)
    }

}

namespace CommonPlugin {

    export interface Config extends ChatHubPlugin.Config {
        request: boolean,
        requestMaxOutputLength: number,

        fs: boolean,
        fsScopePath: string
    }

    export const Config: Schema<Config> = Schema.intersect([
        Schema.object({
            request: Schema.boolean()
                .description('是否启用 request 插件（为模型提供 get/post 请求接口）')
                .default(true),
            fs: Schema.boolean()
                .description('是否启用 fs 插件（为模型提供文件读写接口）')
                .default(false),

        }).description('插件列表'),


        Schema.union([
            Schema.object({
                request: Schema.const(true).required(),
                requestMaxOutputLength: Schema.number()
                    .min(500).max(8600).default(2000)
                    .description('request 插件最大输出长度'),
            }).description('request 插件配置'),
            Schema.object({
                fs: Schema.const(true).required(),
                fsScopePath: Schema.string()
                    .description('fs 插件的作用域路径 (为空则为整个电脑上的任意路径）')
                    .default("")
            }),
            Schema.object({})
        ]),
    ]) as Schema<Config>

    export const using = ['chathub']


}



export default CommonPlugin