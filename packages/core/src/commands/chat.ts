import { Context, h, Session } from 'koishi'
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
            const presetLane = normalizeTarget(options.preset)

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
                    targetConversation: await completeConversationTarget(
                        ctx,
                        session,
                        options.conversation,
                        presetLane,
                        false
                    ),
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
                    targetConversation: await completeConversationTarget(
                        ctx,
                        session,
                        options.conversation,
                        undefined,
                        false
                    ),
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
                    targetConversation: await completeConversationTarget(
                        ctx,
                        session,
                        options.conversation,
                        undefined,
                        false
                    )
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
                    targetConversation: await completeConversationTarget(
                        ctx,
                        session,
                        options.conversation,
                        undefined,
                        false
                    ),
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

function normalizeTarget(value?: string | null) {
    return value == null || value.trim().length < 1 ? undefined : value.trim()
}

async function completeConversationTarget(
    ctx: Context,
    session: Session,
    target?: string,
    presetLane?: string,
    includeArchived = true
) {
    const value = normalizeTarget(target)
    if (value == null) {
        return undefined
    }

    const conversations = await ctx.chatluna.conversation.listConversations(
        session,
        {
            presetLane,
            includeArchived
        }
    )
    const expect = Array.from(
        new Set(
            conversations.flatMap((conversation) => [
                conversation.id,
                String(conversation.seq ?? ''),
                conversation.title
            ])
        )
    ).filter((item) => item.length > 0)

    if (expect.length === 0) {
        return value
    }

    return session.suggest({
        actual: value,
        expect,
        suffix: session.text('commands.chatluna.chat.text.options.conversation')
    })
}

declare module '../chains/chain' {
    interface ChainMiddlewareContextOptions {
        message?: h[]
        conversationId?: string
        targetConversation?: string
        presetLane?: string
    }
}
