import { Context, h } from 'koishi';
import { Config } from '../config';
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain';
import { createLogger } from '../utils/logger';



const logger = createLogger()


export function apply(ctx: Context, config: Config, chain: ChatChain) {
    chain.middleware("list_all_preset", async (session, context) => {

        const { command } = context
        const preset = ctx.chathub.preset

        if (command !== "list_preset") return ChainMiddlewareRunStatus.SKIPPED

        const buffer: string[][] = [["以下是目前可用的预设列表\n"]]
        let currentBuffer = buffer[0]

        const presets = await preset.getAllPreset()

        let presetCount = 0
        for (const preset of presets) {
            presetCount++

            currentBuffer.push(preset)

            if (presetCount % 15 === 0) {
                currentBuffer = []
                buffer.push(currentBuffer)
            }
        }

        buffer.push(["\n你也可以使用 chathub.room.set -p <preset> 来设置预设喵"])

        context.message = buffer.map(line => line.join("\n")).map(text => [h.text(text)])

        return ChainMiddlewareRunStatus.STOP
    }).after("lifecycle-handle_command")
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        "list_all_preset": never
    }
}