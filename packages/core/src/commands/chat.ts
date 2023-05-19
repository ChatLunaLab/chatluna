import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';
import { RenderType } from '../types';

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    ctx.command('chathub', 'chathub相关指令', {
        authority: 1,
    }).alias("chathub")

    ctx.command("chathub.chat [model:string] <message:text>", "开始和模型进行对话")
        .option("chatMode", "-c <chatMode:string> 选择聊天模式（目前还不可用）", {
            authority: 1,
        })
        .alias("聊天")
        .action(async ({ session }, model, message, chatMode) => {
            await chain.receiveCommand(
                session, "", {
                message: message || model,
                setModel: message == null ? null : model,
                renderOptions: {
                    split: config.splitMessage,
                    type: config.outputMode as RenderType
                }
            }
            )
        })

    ctx.command("chathub.voice [model:string] <message:text>", "和模型进行对话并输出为语音")
        .option("chatMode", "-c <chatMode:string> 选择聊天模式（目前还不可用）", {
            authority: 1,
        })
        .option("speaker", "-s <speakerId:number> 语音服务的目标人物的ID", {
            authority: 1,
        })
        .alias("转语音聊天")
        .action(async ({ options, session }, model, message, chatMode) => {
            await chain.receiveCommand(
                session, "", {
                message: message || model,
                setModel: message == null ? null : model,
                renderOptions: {
                    split: config.splitMessage,
                    type: "voice",
                    voice: {
                        speakerId: options.speaker
                    }
                }
            }
            )
        })
}