import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';
import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger';
import { Factory } from '@dingyi222666/chathub-llm-core/lib/chat/factory';
import { preset } from './resolve_preset';

const logger = createLogger("@dingyi222666/chathub/middlewares/list_all_preset")


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("list_all_preset", async (session, context) => {

        const { command } = context

        if (command !== "listPreset") return true

        const buffer = ["以下是目前可用的模型列表"]

        const presets = await preset.getAllPreset()

        presets.forEach((preset) => {
            buffer.push(preset)
        })

        buffer.push("\n你也可以使用 chathub.setPreset <preset> 来设置预设喵")

        context.message = buffer.join("\n")

        return false
    }).after("lifecycle-handle_command")
}

declare module '../chain' {
    interface ChainMiddlewareName {
        "list_all_preset": never
    }
}