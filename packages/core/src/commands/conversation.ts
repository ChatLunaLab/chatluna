import { Context } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'

export function apply(ctx: Context, _config: Config, chain: ChatChain) {
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
                        title: title?.trim() || undefined,
                        preset: options.preset?.trim() || undefined,
                        model: options.model?.trim() || undefined,
                        chatMode: options.chatMode?.trim() || undefined
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
            const presetLane = options.preset?.trim() || undefined
            await chain.receiveCommand(
                session,
                'conversation_switch',
                {
                    allPresetLanes: presetLane == null,
                    conversation_manage: {
                        targetConversation: conversation?.trim() || undefined,
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
            const presetLane = options.preset?.trim() || undefined
            await chain.receiveCommand(
                session,
                'conversation_list',
                {
                    page: options.page ?? 1,
                    limit: options.limit ?? 5,
                    conversation_manage: {
                        presetLane,
                        includeArchived:
                            options.archived === true || options.all === true
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
                        presetLane: options.preset?.trim() || undefined
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
            const presetLane = options.preset?.trim() || undefined
            await chain.receiveCommand(
                session,
                'conversation_archive',
                {
                    allPresetLanes: presetLane == null,
                    conversation_manage: {
                        targetConversation: conversation?.trim() || undefined,
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
        .option('archived', '-a')
        .option('all', '--all')
        .action(async ({ options, session }, conversation) => {
            const presetLane = options.preset?.trim() || undefined
            const includeArchived =
                options.archived === true || options.all === true
            await chain.receiveCommand(
                session,
                'conversation_restore',
                {
                    allPresetLanes: presetLane == null,
                    conversation_manage: {
                        targetConversation: conversation?.trim() || undefined,
                        presetLane,
                        includeArchived
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
        .option('archived', '-a')
        .option('all', '--all')
        .action(async ({ options, session }, conversation) => {
            const presetLane = options.preset?.trim() || undefined
            const includeArchived =
                options.archived === true || options.all === true
            await chain.receiveCommand(
                session,
                'conversation_export',
                {
                    allPresetLanes: presetLane == null,
                    conversation_manage: {
                        targetConversation: conversation?.trim() || undefined,
                        presetLane,
                        includeArchived
                    }
                },
                ctx
            )
        })

    const compressCommand = ctx.command(
        'chatluna.compress [instruction:text]',
        {
            authority: 1
        }
    )
    compressCommand
        .alias('chatluna.compact')
        .option('conversation', '-c <conversation:string>')
        .option('preset', '-p <preset:string>')
        .option('archived', '-a')
        .option('all', '--all')
        .action(async ({ options, session }, instruction) => {
            const presetLane = options.preset?.trim() || undefined
            const includeArchived =
                options.archived === true || options.all === true
            await chain.receiveCommand(
                session,
                'conversation_compress',
                {
                    force: true,
                    allPresetLanes: presetLane == null,
                    conversation_manage: {
                        targetConversation:
                            options.conversation?.trim() || undefined,
                        presetLane,
                        includeArchived
                    },
                    conversation_compress: {
                        instruction: instruction?.trim() || undefined
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
                        title: title?.trim() || undefined,
                        presetLane: options.preset?.trim() || undefined
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.delete [conversation:text]', {
        authority: 1
    })
        .option('preset', '-p <preset:string>')
        .option('archived', '-a')
        .option('all', '--all')
        .action(async ({ options, session }, conversation) => {
            const presetLane = options.preset?.trim() || undefined
            const includeArchived =
                options.archived === true || options.all === true
            await chain.receiveCommand(
                session,
                'conversation_delete',
                {
                    allPresetLanes: presetLane == null,
                    conversation_manage: {
                        targetConversation: conversation?.trim() || undefined,
                        presetLane,
                        includeArchived
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
                        presetLane: options.preset?.trim() || undefined
                    },
                    conversation_use: {
                        model: model?.trim() || undefined
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
                        presetLane: options.lane?.trim() || undefined
                    },
                    conversation_use: {
                        preset: preset?.trim() || undefined
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
                        presetLane: options.preset?.trim() || undefined
                    },
                    conversation_use: {
                        chatMode: mode?.trim() || undefined
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.rule.model [model:string]', {
        authority: 3
    })
        .option('force', '-f')
        .option('clear', '-c')
        .option('auto', '-a')
        .action(async ({ options, session }, model) => {
            await chain.receiveCommand(
                session,
                'conversation_rule_model',
                {
                    conversation_rule: {
                        model: model?.trim() || undefined,
                        force: options.force === true,
                        clear: options.clear === true,
                        auto: options.auto === true
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.rule.preset [preset:string]', {
        authority: 3
    })
        .option('force', '-f')
        .option('newOnly', '-n')
        .option('clear', '-c')
        .action(async ({ options, session }, preset) => {
            await chain.receiveCommand(
                session,
                'conversation_rule_preset',
                {
                    conversation_rule: {
                        preset: preset?.trim() || undefined,
                        force: options.force === true,
                        newOnly: options.newOnly === true,
                        clear: options.clear === true
                    }
                },
                ctx
            )
        })
    ctx.command('chatluna.rule.mode [mode:string]', {
        authority: 3
    })
        .option('force', '-f')
        .option('clear', '-c')
        .action(async ({ options, session }, mode) => {
            await chain.receiveCommand(
                session,
                'conversation_rule_mode',
                {
                    conversation_rule: {
                        chatMode: mode?.trim() || undefined,
                        force: options.force === true,
                        clear: options.clear === true
                    }
                },
                ctx
            )
        })

    ctx.command('chatluna.rule.share [mode:string]', {
        authority: 3
    }).action(async ({ session }, mode) => {
        await chain.receiveCommand(
            session,
            'conversation_rule_share',
            {
                conversation_rule: {
                    share: mode?.trim() || undefined
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
                    lock: state?.trim() || 'toggle'
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
            force?: boolean
            newOnly?: boolean
            clear?: boolean
            auto?: boolean
        }
        conversation_compress?: {
            instruction?: string
        }
        i18n_base?: string
    }
}
