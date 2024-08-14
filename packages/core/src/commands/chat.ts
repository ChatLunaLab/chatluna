import { Context } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'
import { RenderType } from '../types'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command('chatluna', 'chatluna相关指令', {
        authority: 1
    }).alias('chatluna')

    ctx.command('chatluna.chat', 'chatluna 聊天相关指令', {
        authority: 1
    })

    ctx.command('chatluna.chat.text <message:text>', '开始和模型进行对话')
        .option('room', '-r <room:string> 指定房间')
        .action(async ({ options, session }, message) => {
            await chain.receiveCommand(session, '', {
                message,
                room_resolve: {
                    name: options.room
                },
                renderOptions: {
                    split: config.splitMessage,
                    type: config.outputMode as RenderType
                }
            })
        })

    ctx.command('chatluna.chat.rollback [message:text]', '重新生成一次内容')
        .option('room', '-r <room:string> 指定房间')
        .action(async ({ options, session }, message) => {
            await chain.receiveCommand(session, 'rollback', {
                message,
                room_resolve: {
                    name: options.room
                },
                renderOptions: {
                    split: config.splitMessage,
                    type: config.outputMode as RenderType
                }
            })
        })

    ctx.command(
        'chatluna.chat.voice <message:text>',
        '和模型进行对话并输出为语音'
    )
        .option('room', '-r <room:string> 指定房间')
        .option('speaker', '-s <speakerId:number> 语音服务的目标人物的ID', {
            authority: 1
        })
        .action(async ({ options, session }, message) => {
            await chain.receiveCommand(session, '', {
                message,
                renderOptions: {
                    split: config.splitMessage,
                    type: 'voice',
                    voice: {
                        speakerId: options.speaker
                    }
                },
                room_resolve: {
                    name: options.room
                }
            })
        })

    ctx.command('chatluna.wipe', '清空 chatluna 的所有使用数据', {
        authority: 3
    }).action(async ({ session }) => {
        await chain.receiveCommand(session, 'wipe')
    })
}
