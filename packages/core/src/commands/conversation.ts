import { Context } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'
import { completeConversationTarget } from '../utils/conversation'

export function apply(ctx: Context, _config: Config, chain: ChatChain) {
    ctx.command('chatluna.conversation', {
        authority: 1
    }).alias('chatluna.session')

    ctx.command('chatluna.rule', {
        authority: 3
    })

    ctx.command('chatluna.use', {
        authority: 1
    })

    const newCommand = ctx.command('chatluna.new [title:text]', {
        authority: 1
    })
    newCommand
        .alias('chatluna.clear')
        .option('preset', '-p <preset:string>')
        .option('model', '-m <model:string>')
        .option('chatMode', '-c <chatMode:string>')
        .action(async ({ options, session }, title) => {
            await chain.receiveCommand(
                session,
                'conversation_new',
                {
                    conversation_create: {
                        title:
                            title == null || title.trim().length < 1
                                ? undefined
                                : title.trim(),
                        preset:
                            options.preset == null ||
                            options.preset.trim().length < 1
                                ? undefined
                                : options.preset.trim(),
                        model:
                            options.model == null ||
                            options.model.trim().length < 1
                                ? undefined
                                : options.model.trim(),
                        chatMode:
                            options.chatMode == null ||
                            options.chatMode.trim().length < 1
                                ? undefined
                                : options.chatMode.trim()
                    }
                },
                ctx
            )
        })

    const switchCommand = ctx.command('chatluna.switch <conversation:string>', {
        authority: 1
    })
    switchCommand
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, conversation) => {
            const presetLane =
                options.preset == null || options.preset.trim().length < 1
                    ? undefined
                    : options.preset.trim()
            await chain.receiveCommand(
                session,
                'conversation_switch',
                {
                    conversation_manage: {
                        targetConversation: await completeConversationTarget(
                            ctx,
                            session,
                            conversation,
                            presetLane,
                            false,
                            'commands.chatluna.conversation.options.conversation'
                        ),
                        presetLane
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.list', {
        authority: 1
    })
        .option('page', '-p <page:number>')
        .option('limit', '-l <limit:number>')
        .option('archived', '-a')
        .option('all', '--all')
        .option('preset', '-P <preset:string>')
        .action(async ({ options, session }) => {
            await chain.receiveCommand(
                session,
                'conversation_list',
                {
                    page: options.page ?? 1,
                    limit: options.limit ?? 5,
                    conversation_manage: {
                        includeArchived:
                            options.archived === true || options.all === true,
                        presetLane:
                            options.preset == null ||
                            options.preset.trim().length < 1
                                ? undefined
                                : options.preset.trim()
                    }
                },
                ctx
            )
        })

    const currentCommand = ctx.command('chatluna.current', {
        authority: 1
    })
    currentCommand
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }) => {
            await chain.receiveCommand(
                session,
                'conversation_current',
                {
                    conversation_manage: {
                        presetLane:
                            options.preset == null ||
                            options.preset.trim().length < 1
                                ? undefined
                                : options.preset.trim()
                    }
                },
                ctx
            )
        })

    const archiveCommand = ctx.command(
        'chatluna.archive [conversation:string]',
        {
            authority: 1
        }
    )
    archiveCommand
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, conversation) => {
            const presetLane =
                options.preset == null || options.preset.trim().length < 1
                    ? undefined
                    : options.preset.trim()
            await chain.receiveCommand(
                session,
                'conversation_archive',
                {
                    conversation_manage: {
                        targetConversation: await completeConversationTarget(
                            ctx,
                            session,
                            conversation,
                            presetLane,
                            true,
                            'commands.chatluna.conversation.options.conversation'
                        ),
                        presetLane
                    }
                },
                ctx
            )
        })

    const restoreCommand = ctx.command(
        'chatluna.restore [conversation:string]',
        {
            authority: 1
        }
    )
    restoreCommand
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, conversation) => {
            const presetLane =
                options.preset == null || options.preset.trim().length < 1
                    ? undefined
                    : options.preset.trim()
            await chain.receiveCommand(
                session,
                'conversation_restore',
                {
                    conversation_manage: {
                        targetConversation: await completeConversationTarget(
                            ctx,
                            session,
                            conversation,
                            presetLane,
                            true,
                            'commands.chatluna.conversation.options.conversation'
                        ),
                        presetLane
                    }
                },
                ctx
            )
        })

    const exportCommand = ctx.command('chatluna.export [conversation:string]', {
        authority: 1
    })
    exportCommand
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, conversation) => {
            const presetLane =
                options.preset == null || options.preset.trim().length < 1
                    ? undefined
                    : options.preset.trim()
            await chain.receiveCommand(
                session,
                'conversation_export',
                {
                    conversation_manage: {
                        targetConversation: await completeConversationTarget(
                            ctx,
                            session,
                            conversation,
                            presetLane,
                            true,
                            'commands.chatluna.conversation.options.conversation'
                        ),
                        presetLane
                    }
                },
                ctx
            )
        })

    const compressCommand = ctx.command(
        'chatluna.compress [conversation:string]',
        {
            authority: 1
        }
    )
    compressCommand
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, conversation) => {
            const presetLane =
                options.preset == null || options.preset.trim().length < 1
                    ? undefined
                    : options.preset.trim()
            await chain.receiveCommand(
                session,
                'conversation_compress',
                {
                    force: true,
                    conversation_manage: {
                        targetConversation: await completeConversationTarget(
                            ctx,
                            session,
                            conversation,
                            presetLane,
                            true,
                            'commands.chatluna.conversation.options.conversation'
                        ),
                        presetLane
                    },
                    i18n_base: 'commands.chatluna.compress.messages'
                },
                ctx
            )
        })

    ctx.command('chatluna.rename <title:text>', {
        authority: 1
    })
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, title) => {
            await chain.receiveCommand(
                session,
                'conversation_rename',
                {
                    conversation_manage: {
                        title:
                            title == null || title.trim().length < 1
                                ? undefined
                                : title.trim(),
                        presetLane:
                            options.preset == null ||
                            options.preset.trim().length < 1
                                ? undefined
                                : options.preset.trim()
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.delete [conversation:string]', {
        authority: 1
    })
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, conversation) => {
            const presetLane =
                options.preset == null || options.preset.trim().length < 1
                    ? undefined
                    : options.preset.trim()
            await chain.receiveCommand(
                session,
                'conversation_delete',
                {
                    conversation_manage: {
                        targetConversation: await completeConversationTarget(
                            ctx,
                            session,
                            conversation,
                            presetLane,
                            true,
                            'commands.chatluna.conversation.options.conversation'
                        ),
                        presetLane
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.use.model <model:string>', {
        authority: 1
    })
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, model) => {
            await chain.receiveCommand(
                session,
                'conversation_use_model',
                {
                    conversation_manage: {
                        presetLane:
                            options.preset == null ||
                            options.preset.trim().length < 1
                                ? undefined
                                : options.preset.trim()
                    },
                    conversation_use: {
                        model:
                            model == null || model.trim().length < 1
                                ? undefined
                                : model.trim()
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.use.preset <preset:string>', {
        authority: 1
    })
        .option('lane', '-p <lane:string>')
        .action(async ({ options, session }, preset) => {
            await chain.receiveCommand(
                session,
                'conversation_use_preset',
                {
                    conversation_manage: {
                        presetLane:
                            options.lane == null ||
                            options.lane.trim().length < 1
                                ? undefined
                                : options.lane.trim()
                    },
                    conversation_use: {
                        preset:
                            preset == null || preset.trim().length < 1
                                ? undefined
                                : preset.trim()
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.use.mode <mode:string>', {
        authority: 1
    })
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, mode) => {
            await chain.receiveCommand(
                session,
                'conversation_use_mode',
                {
                    conversation_manage: {
                        presetLane:
                            options.preset == null ||
                            options.preset.trim().length < 1
                                ? undefined
                                : options.preset.trim()
                    },
                    conversation_use: {
                        chatMode:
                            mode == null || mode.trim().length < 1
                                ? undefined
                                : mode.trim()
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.rule.model <model:string>', {
        authority: 3
    }).action(async ({ session }, model) => {
        await chain.receiveCommand(
            session,
            'conversation_rule_model',
            {
                conversation_rule: {
                    model:
                        model == null || model.trim().length < 1
                            ? undefined
                            : model.trim()
                }
            },
            ctx
        )
    })

    ctx.command('chatluna.rule.preset <preset:string>', {
        authority: 3
    }).action(async ({ session }, preset) => {
        await chain.receiveCommand(
            session,
            'conversation_rule_preset',
            {
                conversation_rule: {
                    preset:
                        preset == null || preset.trim().length < 1
                            ? undefined
                            : preset.trim()
                }
            },
            ctx
        )
    })
    ctx.command('chatluna.rule.mode <mode:string>', {
        authority: 3
    }).action(async ({ session }, mode) => {
        await chain.receiveCommand(
            session,
            'conversation_rule_mode',
            {
                conversation_rule: {
                    chatMode:
                        mode == null || mode.trim().length < 1
                            ? undefined
                            : mode.trim()
                }
            },
            ctx
        )
    })

    ctx.command('chatluna.rule.share <mode:string>', {
        authority: 3
    }).action(async ({ session }, mode) => {
        await chain.receiveCommand(
            session,
            'conversation_rule_share',
            {
                conversation_rule: {
                    share:
                        mode == null || mode.trim().length < 1
                            ? undefined
                            : mode.trim()
                }
            },
            ctx
        )
    })

    ctx.command('chatluna.rule.lock [state:string]', {
        authority: 3
    }).action(async ({ session }, state) => {
        await chain.receiveCommand(
            session,
            'conversation_rule_lock',
            {
                conversation_rule: {
                    lock:
                        state == null || state.trim().length < 1
                            ? 'toggle'
                            : state.trim()
                }
            },
            ctx
        )
    })

    ctx.command('chatluna.rule.show', {
        authority: 3
    }).action(async ({ session }) => {
        await chain.receiveCommand(session, 'conversation_rule_show', {}, ctx)
    })
}

declare module '../chains/chain' {
    interface ChainMiddlewareContextOptions {
        conversation_create?: {
            title?: string
            preset?: string
            model?: string
            chatMode?: string
        }
        conversation_manage?: {
            targetConversation?: string
            presetLane?: string
            includeArchived?: boolean
            title?: string
        }
        conversation_use?: {
            model?: string
            preset?: string
            chatMode?: string
        }
        conversation_rule?: {
            model?: string
            preset?: string
            chatMode?: string
            share?: string
            lock?: string
        }
        i18n_base?: string
    }
}
