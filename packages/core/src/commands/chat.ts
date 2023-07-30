import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chains/chain';
import { RenderType } from '../types';
import { ChatMode } from '../middlewares/resolve_room';

export function apply(ctx: Context, config: Config, chain: ChatChain) {

    ctx.command('chathub', 'chathub相关指令', {
        authority: 1,
    }).alias("chathub")

    ctx.command('chathub.chat', 'chathub 聊天相关指令', {
        authority: 1,
    })

    ctx.command("chathub.chat.text <message:text>", "开始和模型进行对话")
        .option("room", "-r <room:string> 指定房间")
        .alias("聊天")
        .action(async ({ options, session }, message) => {
            await chain.receiveCommand(
                session, "", {
                message: message,
                room_resolve: {
                    name: options.room
                },
                renderOptions: {
                    split: config.splitMessage,
                    type: config.outputMode as RenderType
                },

            }
            )
        })

    ctx.command("chathub.chat.voice <message:text>", "和模型进行对话并输出为语音")
        .option("room", "-r <room:string> 指定房间")
        .option("speaker", "-s <speakerId:number> 语音服务的目标人物的ID", {
            authority: 1,
        })
        .alias("语音聊天")
        .action(async ({ options, session }, message) => {
            await chain.receiveCommand(
                session, "", {
                message: message,
        
                renderOptions: {
                    split: config.splitMessage,
                    type: "voice",
                    voice: {
                        speakerId: options.speaker
                    }
                },
                room_resolve: {
                    name: options.room
                },
            })
        })


    ctx.command("chathub.wipe", "清空 chathub 的所有使用数据", {
        authority: 3,
    })
        .alias("双清 chathub")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "wipe"
            )
        })
}