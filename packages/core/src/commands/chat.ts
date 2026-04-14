import { Context, h } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'
import { RenderType } from '../types'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command('chatluna', {
        authority: 1
    }).alias('chatluna')

    ctx.command('chatluna.chat <message:text>')
        .option('conversation', '-c <conversation:string>')
        .option('preset', '-p <preset:string>')
        .option('type', '-t <type: string>')
        .action(async ({ options, session }, message) => {
            const renderType = options.type ?? config.outputMode
            const presetLane =
                options.preset == null || options.preset.trim().length < 1
                    ? undefined
                    : options.preset.trim()
            const allPresetLanes = presetLane == null

            if (
                !ctx.chatluna.renderer.rendererTypeList.some(
                    (type) => type === renderType
                )
            ) {
                return session.text('.invalid-render-type')
            }

            const elements = h.parse(message)
            await chain.receiveCommand(
                session,
                '',
                {
                    message: elements,
                    targetConversation:
                        options.conversation == null ||
                        options.conversation.trim().length < 1
                            ? undefined
                            : options.conversation.trim(),
                    allPresetLanes,
                    presetLane,
                    renderOptions: {
                        session,
                        split: config.splitMessage,
                        type: renderType as RenderType
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.rollback [message:text]')
        .option('conversation', '-c <conversation:string>')
        .option('i', '-i <i: string>')
        .action(async ({ options, session }, message) => {
            const elements = message ? h.parse(message) : undefined
            await chain.receiveCommand(
                session,
                'rollback',
                {
                    message: elements,
                    targetConversation:
                        options.conversation == null ||
                        options.conversation.trim().length < 1
                            ? undefined
                            : options.conversation.trim(),
                    allPresetLanes: true,
                    renderOptions: {
                        session,
                        split: config.splitMessage,
                        type: config.outputMode as RenderType
                    },
                    rollback_round: options.i ?? 1
                },
                ctx
            )
        })

    ctx.command('chatluna.stop')
        .option('conversation', '-c <conversation:string>')
        .action(async ({ options, session }) => {
            await chain.receiveCommand(
                session,
                'stop_chat',
                {
                    targetConversation:
                        options.conversation == null ||
                        options.conversation.trim().length < 1
                            ? undefined
                            : options.conversation.trim(),
                    allPresetLanes: true
                },
                ctx
            )
        })

    ctx.command('chatluna.voice <message:text>')
        .option('conversation', '-c <conversation:string>')
        .option('speaker', '-s <speakerId:number>', { authority: 1 })
        .action(async ({ options, session }, message) => {
            const elements = message ? h.parse(message) : undefined
            await chain.receiveCommand(
                session,
                '',
                {
                    message: elements,
                    targetConversation:
                        options.conversation == null ||
                        options.conversation.trim().length < 1
                            ? undefined
                            : options.conversation.trim(),
                    allPresetLanes: true,
                    renderOptions: {
                        split: config.splitMessage,
                        type: 'voice',
                        voice: {
                            speakerId: options.speaker
                        },
                        session
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.wipe', { authority: 3 }).action(
        async ({ session }) => {
            await chain.receiveCommand(session, 'wipe')
        }
    )

    ctx.command('chatluna.admin.purge-legacy', { authority: 3 }).action(
        async ({ session }) => {
            await chain.receiveCommand(session, 'purge_legacy')
        }
    )

    ctx.command('chatluna.restart').action(async ({ session }) => {
        await chain.receiveCommand(session, 'restart')
    })
}

declare module '../chains/chain' {
    interface ChainMiddlewareContextOptions {
        message?: h[]
        targetConversation?: string
        presetLane?: string
        allPresetLanes?: boolean
    }
}
