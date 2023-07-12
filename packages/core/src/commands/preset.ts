import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';
import { ChatMode } from '../middlewares/resolve_conversation_info';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command("chathub.listpreset", "列出所有目前支持的预设")
        .alias("预设列表")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "listPreset"
            )
        })

    ctx.command("chathub.setpreset <preset:string>", "设置当前使用的预设")
        .alias("切换预设")
        .option("chatMode", "-c <chatMode:string> 选择聊天模式", {
            authority: 1,
        })
        .option("model", "-m <model:string> 切换的目标模型")
        .option("global", "-g 也设置为全局会话默认的预设？")
        .action(async ({ options, session }, preset) => {
            await chain.receiveCommand(
                session, "setPreset", {
                setPreset: preset,
                setPresetAndForce: options.global,
                chatMode: (options.chatMode as ChatMode) ?? config.chatMode as ChatMode,
                setModel: options.model,
                reset: {
                    trigger: true,
                    sendMessage: false
                }
            }
            )
        })

    ctx.command("chathub.resetpreset [model:string]", "重置为默认使用的预设（chatgpt预设）")
        .option("chatMode", "-c <chatMode:string> 选择聊天模式", {
            authority: 1,
        })
        .alias("重置预设")
        .action(async ({ options, session }, model) => {
            await chain.receiveCommand(
                session, "reset_preset", {
                setModel: model,
                chatMode: (options.chatMode as ChatMode) ?? config.chatMode as ChatMode,
                reset: {
                    trigger: true,
                    sendMessage: false
                }
            }
            )
        })

    ctx.command("chathub.addpreset <preset:string>", "添加一个预设")
        .alias("添加预设")
        .action(async ({ session }, preset) => {
            await chain.receiveCommand(
                session, "add_preset", {
                addPreset: preset,
            }
            )
        })
}