import { Context, h } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'
import { RenderType } from '../types'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const root = ctx
        .command('chatluna', {
            authority: 1
        })
        .alias('chatluna')

    const toJSON = root.toJSON.bind(root)
    root.toJSON = () => {
        const data = toJSON()
        data.children = data.children.filter((cmd) => {
            return (
                root.children.find((child) => child.name === cmd.name)?.config
                    .slash !== false
            )
        })
        return data
    }

    ctx.command('chatluna.chat <message:text>')
        .option('conversation', '-c <conversation:string>')
        .option('preset', '-p <preset:string>')
        .option('type', '-t <type: string>')
        .action(async ({ options, session }, message) => {
            const renderType = options.type ?? config.outputMode
            const presetLane = options.preset?.trim() || undefined
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
                        options.conversation?.trim() || undefined,
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
                        options.conversation?.trim() || undefined,
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
                        options.conversation?.trim() || undefined,
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
                        options.conversation?.trim() || undefined,
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

    ctx.command('chatluna.admin', { authority: 3, slash: false })

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
