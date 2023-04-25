
import { Context } from 'koishi';
import { buildTextElement, replyMessage } from '@dingyi222666/koishi-plugin-chathub';
import NewBingAdapter from '.';
import { NewBingClient } from './client';

const toneStyleMap = {
    balanced: ["平衡", "balanced"],
    creative: ["创造", "创意", "creative"],
    precise: ["精准", "precise"],
    fast: ["新平衡", "fast"],
}



export default function apply(ctx: Context, config: NewBingAdapter.Config) {

    ctx.command('chathub.newbing.switchToneStyle <toneStyle:text>', '切换newbing的对话风格')
        .alias("切换newbing对话风格")
        .action(async ({ session }, toneStyle) => {
            const resolvedToneStyle = resolveToneStyle(toneStyle)
            if (resolvedToneStyle == config.toneStyle) {
                await replyMessage(ctx, session, buildTextElement(`当前的NewBing对话风格已为 ${config.toneStyle}`))
                return
            }

            config.toneStyle = resolvedToneStyle
            ctx.scope.update(config, true)
            // await commandArgs.client.reset() 
            // 总是重启adapter

            await replyMessage(ctx, session, buildTextElement(`已切换到NewBing对话风格 ${config.toneStyle}`))
        }).

    ctx.command('chathub.newbing.listToneStyle', '列出所有newbing支持的对话风格')
        .alias("列出可用的newbing对话风格")
        .action(async ({ session }) => {
            const toneStyles = Object.keys(toneStyleMap)
            const toneStyleList = toneStyles.map(toneStyle => {
                return `${toneStyleMap[toneStyle][0]}`
            }).join("\n")

            await replyMessage(ctx, session, buildTextElement(`目前已支持的NewBing对话风格有：\n${toneStyleList}`))
        })
}

function resolveToneStyle(name: string) {
    for (const key in toneStyleMap) {
        if (toneStyleMap[key].includes(name)) return key
    }
    return name
}

export interface CommandArgs {
    client: NewBingClient
}