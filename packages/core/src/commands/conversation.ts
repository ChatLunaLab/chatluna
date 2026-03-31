import { Command, Context, Session } from 'koishi'
import { Config } from '../config'
import { ChatChain } from '../chains/chain'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'

function normalizeTarget(value?: string | null) {
    return value == null || value.trim().length < 1 ? undefined : value.trim()
}

function setChoices(cmd: Command, index: number, values: string[]) {
    if (cmd._arguments[index] != null) {
        cmd._arguments[index].type = values
    }
}

function setOptionChoices(cmd: Command, name: string, values: string[]) {
    if (cmd._options[name] != null) {
        cmd._options[name].type = values
    }
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
        suffix: session.text(
            'commands.chatluna.conversation.options.conversation'
        )
    })
}

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const modes = ['chat', 'plugin', 'browsing']
    const shares = ['personal', 'shared', 'reset']
    const locks = ['on', 'off', 'toggle', 'reset']
    const models = ctx.chatluna.platform
        .listAllModels(ModelType.llm)
        .value.map((item) => item.name)

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
                        title: normalizeTarget(title),
                        preset: normalizeTarget(options.preset),
                        model: normalizeTarget(options.model),
                        chatMode: normalizeTarget(options.chatMode)
                    }
                },
                ctx
            )
        })
    setOptionChoices(newCommand, 'model', models)
    setOptionChoices(newCommand, 'chatMode', modes)

    const switchCommand = ctx.command('chatluna.switch <conversation:string>', {
        authority: 1
    })
    switchCommand
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, conversation) => {
            const presetLane = normalizeTarget(options.preset)
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
                            false
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
                        presetLane: normalizeTarget(options.preset)
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
                        presetLane: normalizeTarget(options.preset)
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
            const presetLane = normalizeTarget(options.preset)
            await chain.receiveCommand(
                session,
                'conversation_archive',
                {
                    conversation_manage: {
                        targetConversation: await completeConversationTarget(
                            ctx,
                            session,
                            conversation,
                            presetLane
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
            const presetLane = normalizeTarget(options.preset)
            await chain.receiveCommand(
                session,
                'conversation_restore',
                {
                    conversation_manage: {
                        targetConversation: await completeConversationTarget(
                            ctx,
                            session,
                            conversation,
                            presetLane
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
            const presetLane = normalizeTarget(options.preset)
            await chain.receiveCommand(
                session,
                'conversation_export',
                {
                    conversation_manage: {
                        targetConversation: await completeConversationTarget(
                            ctx,
                            session,
                            conversation,
                            presetLane
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
            const presetLane = normalizeTarget(options.preset)
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
                            presetLane
                        ),
                        presetLane
                    },
                    i18n_base: 'commands.chatluna.compress.messages'
                },
                ctx
            )
        })

    const renameCommand = ctx
        .command('chatluna.rename <title:text>', {
            authority: 1
        })
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, title) => {
            await chain.receiveCommand(
                session,
                'conversation_rename',
                {
                    conversation_manage: {
                        title: normalizeTarget(title),
                        presetLane: normalizeTarget(options.preset)
                    }
                },
                ctx
            )
        })

    const deleteCommand = ctx
        .command('chatluna.delete [conversation:string]', {
            authority: 1
        })
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, conversation) => {
            const presetLane = normalizeTarget(options.preset)
            await chain.receiveCommand(
                session,
                'conversation_delete',
                {
                    conversation_manage: {
                        targetConversation: await completeConversationTarget(
                            ctx,
                            session,
                            conversation,
                            presetLane
                        ),
                        presetLane
                    }
                },
                ctx
            )
        })

    const useModelCommand = ctx
        .command('chatluna.use.model <model:string>', {
            authority: 1
        })
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, model) => {
            await chain.receiveCommand(
                session,
                'conversation_use_model',
                {
                    conversation_manage: {
                        presetLane: normalizeTarget(options.preset)
                    },
                    conversation_use: {
                        model: normalizeTarget(model)
                    }
                },
                ctx
            )
        })
    setChoices(useModelCommand, 0, models)

    const usePresetCommand = ctx
        .command('chatluna.use.preset <preset:string>', {
            authority: 1
        })
        .option('lane', '-p <lane:string>')
        .action(async ({ options, session }, preset) => {
            await chain.receiveCommand(
                session,
                'conversation_use_preset',
                {
                    conversation_manage: {
                        presetLane: normalizeTarget(options.lane)
                    },
                    conversation_use: {
                        preset: normalizeTarget(preset)
                    }
                },
                ctx
            )
        })

    const useModeCommand = ctx
        .command('chatluna.use.mode <mode:string>', {
            authority: 1
        })
        .option('preset', '-p <preset:string>')
        .action(async ({ options, session }, mode) => {
            await chain.receiveCommand(
                session,
                'conversation_use_mode',
                {
                    conversation_manage: {
                        presetLane: normalizeTarget(options.preset)
                    },
                    conversation_use: {
                        chatMode: normalizeTarget(mode)
                    }
                },
                ctx
            )
        })
    setChoices(useModeCommand, 0, modes)

    const ruleModelCommand = ctx
        .command('chatluna.rule.model <model:string>', {
            authority: 3
        })
        .action(async ({ session }, model) => {
            await chain.receiveCommand(
                session,
                'conversation_rule_model',
                {
                    conversation_rule: {
                        model: normalizeTarget(model)
                    }
                },
                ctx
            )
        })
    setChoices(ruleModelCommand, 0, [...models, 'reset'])

    const rulePresetCommand = ctx
        .command('chatluna.rule.preset <preset:string>', {
            authority: 3
        })
        .action(async ({ session }, preset) => {
            await chain.receiveCommand(
                session,
                'conversation_rule_preset',
                {
                    conversation_rule: {
                        preset: normalizeTarget(preset)
                    }
                },
                ctx
            )
        })
    const ruleModeCommand = ctx
        .command('chatluna.rule.mode <mode:string>', {
            authority: 3
        })
        .action(async ({ session }, mode) => {
            await chain.receiveCommand(
                session,
                'conversation_rule_mode',
                {
                    conversation_rule: {
                        chatMode: normalizeTarget(mode)
                    }
                },
                ctx
            )
        })
    setChoices(ruleModeCommand, 0, [...modes, 'reset'])

    const ruleShareCommand = ctx
        .command('chatluna.rule.share <mode:string>', {
            authority: 3
        })
        .action(async ({ session }, mode) => {
            await chain.receiveCommand(
                session,
                'conversation_rule_share',
                {
                    conversation_rule: {
                        share: normalizeTarget(mode)
                    }
                },
                ctx
            )
        })
    setChoices(ruleShareCommand, 0, shares)

    const ruleLockCommand = ctx
        .command('chatluna.rule.lock [state:string]', {
            authority: 3
        })
        .action(async ({ session }, state) => {
            await chain.receiveCommand(
                session,
                'conversation_rule_lock',
                {
                    conversation_rule: {
                        lock: normalizeTarget(state) ?? 'toggle'
                    }
                },
                ctx
            )
        })
    setChoices(ruleLockCommand, 0, locks)

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
