import { Context, h, Session } from 'koishi'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'
import { Config } from '../../config'
import {
    ConversationListEntry,
    ConversationRecord,
    getBaseBindingKey,
    getPresetLane,
    ResolvedConversationContext
} from '../../services/conversation_types'
import { Pagination } from 'koishi-plugin-chatluna/utils/pagination'
import { checkAdmin } from 'koishi-plugin-chatluna/utils/koishi'
import { logger } from '../..'
import fs from 'fs/promises'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    function middleware(
        name: Parameters<typeof chain.middleware>[0],
        fn: (
            session: Session,
            context: ChainMiddlewareContext
        ) => Promise<ChainMiddlewareRunStatus>
    ) {
        chain
            .middleware(name, async (session, context) => {
                if (context.command !== name) {
                    return ChainMiddlewareRunStatus.SKIPPED
                }
                return fn(session, context)
            })
            .after('lifecycle-handle_command')
            .before('lifecycle-request_conversation')
    }

    middleware('conversation_new', async (session, context) => {
        const presetLane = context.options.conversation_create?.preset
        const resolved = await ctx.chatluna.conversation.resolveContext(
            session,
            { presetLane }
        )

        if (
            resolved.constraint.manageMode === 'admin' &&
            !(await checkAdmin(session))
        ) {
            context.message = session.text(
                'chatluna.conversation.messages.admin_required'
            )
            return ChainMiddlewareRunStatus.STOP
        }

        if (
            resolved.constraint.lockConversation &&
            resolved.binding?.activeConversationId != null
        ) {
            context.message = session.text(
                'chatluna.conversation.messages.action_locked',
                [session.text('chatluna.conversation.action.create')]
            )
            return ChainMiddlewareRunStatus.STOP
        }

        const createModel = context.options.conversation_create?.model
        if (
            createModel != null &&
            resolved.constraint.fixedModel != null &&
            createModel !== resolved.constraint.fixedModel
        ) {
            context.message = session.text(
                'chatluna.conversation.messages.fixed_model',
                [resolved.constraint.fixedModel]
            )
            return ChainMiddlewareRunStatus.STOP
        }

        const createChatMode = context.options.conversation_create?.chatMode
        if (
            createChatMode != null &&
            resolved.constraint.fixedChatMode != null &&
            createChatMode !== resolved.constraint.fixedChatMode
        ) {
            context.message = session.text(
                'chatluna.conversation.messages.fixed_chat_mode',
                [resolved.constraint.fixedChatMode]
            )
            return ChainMiddlewareRunStatus.STOP
        }

        if (!resolved.constraint.allowNew) {
            context.message = session.text(
                'chatluna.conversation.messages.action_disabled',
                [session.text('chatluna.conversation.action.create')]
            )
            return ChainMiddlewareRunStatus.STOP
        }

        const conversation = await ctx.chatluna.conversation.createConversation(
            session,
            {
                bindingKey: resolved.bindingKey,
                title:
                    context.options.conversation_create?.title ??
                    presetLane ??
                    session.text('chatluna.conversation.default_title'),
                model:
                    createModel ??
                    resolved.effectiveModel ??
                    config.defaultModel,
                preset: resolved.effectivePreset ?? config.defaultPreset,
                chatMode:
                    createChatMode ??
                    resolved.effectiveChatMode ??
                    config.defaultChatMode
            }
        )

        context.options.conversationId = conversation.id
        context.message = session.text(
            'chatluna.conversation.messages.new_success',
            [
                conversation.title,
                conversation.seq ?? conversation.id,
                conversation.id
            ]
        )
        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_switch', async (session, context) => {
        const targetConversation =
            context.options.conversation_manage?.targetConversation

        if (targetConversation == null) {
            context.message = session.text(
                'chatluna.conversation.messages.target_required'
            )
            return ChainMiddlewareRunStatus.STOP
        }

        try {
            const conversation =
                await ctx.chatluna.conversation.switchConversation(session, {
                    targetConversation,
                    allPresetLanes: true
                })

            context.options.conversationId = conversation.id
            context.message = session.text(
                'chatluna.conversation.messages.switch_success',
                [
                    conversation.title,
                    conversation.seq ?? conversation.id,
                    conversation.id
                ]
            )
        } catch (error) {
            context.message = session.text(
                'chatluna.conversation.messages.switch_failed',
                [formatConversationError(session, error, 'switch')]
            )
        }

        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_list', async (session, context) => {
        const page = context.options.page ?? 1
        const limit = context.options.limit ?? 5
        const includeArchived =
            context.options.conversation_manage?.includeArchived === true
        const resolved = await ctx.chatluna.conversation.getCurrentConversation(
            session,
            {
                useRoutePresetLane: true
            }
        )
        const conversations =
            await ctx.chatluna.conversation.listConversationEntries(session, {
                allPresetLanes: true,
                includeArchived
            })

        if (conversations.length === 0) {
            context.message = session.text(
                'chatluna.conversation.messages.list_empty'
            )
            return ChainMiddlewareRunStatus.STOP
        }

        const pagination = new Pagination<ConversationListEntry>({
            formatItem: (item) =>
                formatConversationLine(
                    session,
                    item.conversation,
                    resolved,
                    false,
                    item.displaySeq
                ),
            formatString: {
                top:
                    session.text('chatluna.conversation.messages.list_header') +
                    '\n',
                bottom: '',
                pages:
                    '\n' +
                    session.text('chatluna.conversation.messages.list_pages')
            }
        })

        const key = `${getBaseBindingKey(resolved.bindingKey)}:all`
        await pagination.push(conversations, key)
        context.message = await pagination.getFormattedPage(page, limit, key)
        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_current', async (session, context) => {
        const presetLane = context.options.conversation_manage?.presetLane
        const resolved = await ctx.chatluna.conversation.getCurrentConversation(
            session,
            {
                presetLane,
                useRoutePresetLane: presetLane == null
            }
        )

        if (resolved.conversation == null) {
            context.message = session.text(
                'chatluna.conversation.messages.current_empty'
            )
            return ChainMiddlewareRunStatus.STOP
        }

        context.message = [
            session.text('chatluna.conversation.messages.current_header'),
            formatConversationLine(session, resolved.conversation, resolved)
        ].join('\n')
        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_rename', async (session, context) => {
        const title = context.options.conversation_manage?.title
        if (title == null) {
            context.message = session.text(
                'chatluna.conversation.messages.title_required'
            )
            return ChainMiddlewareRunStatus.STOP
        }

        try {
            const conversation =
                await ctx.chatluna.conversation.renameConversation(session, {
                    conversationId: context.options.conversationId,
                    targetConversation:
                        context.options.conversation_manage?.targetConversation,
                    presetLane: context.options.conversation_manage?.presetLane,
                    title
                })

            context.message = session.text(
                'chatluna.conversation.messages.rename_success',
                [
                    conversation.title,
                    conversation.seq ?? conversation.id,
                    conversation.id
                ]
            )
        } catch (error) {
            context.message = session.text(
                'chatluna.conversation.messages.rename_failed',
                [formatConversationError(session, error, 'rename')]
            )
        }

        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_delete', async (session, context) => {
        try {
            const presetLane = context.options.conversation_manage?.presetLane
            const conversation =
                await ctx.chatluna.conversation.deleteConversation(session, {
                    conversationId: context.options.conversationId,
                    targetConversation:
                        context.options.conversation_manage?.targetConversation,
                    presetLane,
                    allPresetLanes: presetLane == null
                })

            context.message = session.text(
                'chatluna.conversation.messages.delete_success',
                [
                    conversation.title,
                    conversation.seq ?? conversation.id,
                    conversation.id
                ]
            )
        } catch (error) {
            context.message = session.text(
                'chatluna.conversation.messages.delete_failed',
                [formatConversationError(session, error, 'delete')]
            )
        }

        return ChainMiddlewareRunStatus.STOP
    })

    for (const field of ['model', 'preset', 'mode'] as const) {
        const fieldMap = {
            model: {
                cmd: 'conversation_use_model' as const,
                optKey: 'model' as const,
                recordKey: 'model' as const,
                successKey: 'use_model_success',
                failKey: 'use_model_failed'
            },
            preset: {
                cmd: 'conversation_use_preset' as const,
                optKey: 'preset' as const,
                recordKey: 'preset' as const,
                successKey: 'use_preset_success',
                failKey: 'use_preset_failed'
            },
            mode: {
                cmd: 'conversation_use_mode' as const,
                optKey: 'chatMode' as const,
                recordKey: 'chatMode' as const,
                successKey: 'use_mode_success',
                failKey: 'use_mode_failed'
            }
        }[field]

        middleware(fieldMap.cmd, async (session, context) => {
            try {
                const conversation =
                    await ctx.chatluna.conversation.updateConversationUsage(
                        session,
                        {
                            conversationId: context.options.conversationId,
                            presetLane:
                                context.options.conversation_manage?.presetLane,
                            [fieldMap.optKey]:
                                context.options.conversation_use?.[
                                    fieldMap.optKey
                                ]
                        }
                    )

                context.message = session.text(
                    `chatluna.conversation.messages.${fieldMap.successKey}`,
                    [
                        conversation[fieldMap.recordKey],
                        conversation.title,
                        conversation.id
                    ]
                )
            } catch (error) {
                context.message = session.text(
                    `chatluna.conversation.messages.${fieldMap.failKey}`,
                    [formatConversationError(session, error, 'update')]
                )
            }

            return ChainMiddlewareRunStatus.STOP
        })
    }

    middleware('conversation_archive', async (session, context) => {
        const targetConversation = pickConversationTarget(context)

        try {
            const presetLane = context.options.conversation_manage?.presetLane
            const result = await ctx.chatluna.conversation.archiveConversation(
                session,
                {
                    targetConversation,
                    presetLane,
                    allPresetLanes: presetLane == null
                }
            )

            context.message = session.text(
                'chatluna.conversation.messages.archive_success',
                [
                    result.conversation.title,
                    result.conversation.seq ?? result.conversation.id,
                    result.conversation.id,
                    result.archive.id
                ]
            )
        } catch (error) {
            context.message = session.text(
                'chatluna.conversation.messages.archive_failed',
                [formatConversationError(session, error, 'archive')]
            )
        }

        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_restore', async (session, context) => {
        const targetConversation = pickConversationTarget(context)

        try {
            const presetLane = context.options.conversation_manage?.presetLane
            const conversation =
                await ctx.chatluna.conversation.reopenConversation(session, {
                    targetConversation,
                    presetLane,
                    allPresetLanes: presetLane == null,
                    includeArchived: true
                })

            context.options.conversationId = conversation.id
            context.message = session.text(
                'chatluna.conversation.messages.restore_success',
                [
                    conversation.title,
                    conversation.seq ?? conversation.id,
                    conversation.id
                ]
            )
        } catch (error) {
            context.message = session.text(
                'chatluna.conversation.messages.restore_failed',
                [formatConversationError(session, error, 'restore')]
            )
        }

        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_export', async (session, context) => {
        const targetConversation = pickConversationTarget(context)

        try {
            const presetLane = context.options.conversation_manage?.presetLane
            const result = await ctx.chatluna.conversation.exportConversation(
                session,
                {
                    targetConversation,
                    presetLane,
                    allPresetLanes: presetLane == null,
                    includeArchived: true
                }
            )

            try {
                const buffer = await fs.readFile(result.path)
                await session.send(
                    h.file(buffer, 'application/markdown', {
                        title: result.conversation.title + '.md'
                    })
                )
            } catch (error) {
                logger.error(error)
            }

            context.message = session.text(
                'chatluna.conversation.messages.export_success',
                [
                    result.conversation.title,
                    result.conversation.seq ?? result.conversation.id,
                    result.conversation.id,
                    result.path,
                    result.size
                ]
            )
        } catch (error) {
            context.message = session.text(
                'chatluna.conversation.messages.export_failed',
                [formatConversationError(session, error, 'export')]
            )
        }

        return ChainMiddlewareRunStatus.STOP
    })

    for (const ruleField of ['model', 'mode'] as const) {
        const ruleMap = {
            model: {
                cmd: 'conversation_rule_model' as const,
                optKey: 'model' as const,
                defaultKey: 'defaultModel' as const,
                constraintKey: 'fixedModel' as const,
                msgKey: 'rule_model_status'
            },
            mode: {
                cmd: 'conversation_rule_mode' as const,
                optKey: 'chatMode' as const,
                defaultKey: 'defaultChatMode' as const,
                constraintKey: 'fixedChatMode' as const,
                msgKey: 'rule_mode_status'
            }
        }[ruleField]

        middleware(ruleMap.cmd, async (session, context) => {
            const value = context.options.conversation_rule?.[ruleMap.optKey]
            const clear =
                context.options.conversation_rule?.clear === true ||
                value === 'reset'
            const force = context.options.conversation_rule?.force === true

            try {
                const record =
                    value == null && !clear
                        ? await ctx.chatluna.conversation.getManagedConstraint(
                              session
                          )
                        : await ctx.chatluna.conversation.updateManagedConstraint(
                              session,
                              clear
                                  ? {
                                        [ruleMap.defaultKey]: null,
                                        [ruleMap.constraintKey]: null
                                    }
                                  : force
                                    ? {
                                          [ruleMap.constraintKey]: value
                                      }
                                    : {
                                          [ruleMap.defaultKey]: value
                                      }
                          )

                context.message = session.text(
                    `chatluna.conversation.messages.${ruleMap.msgKey}`,
                    [
                        record?.[ruleMap.defaultKey] ?? 'reset',
                        record?.[ruleMap.constraintKey] ?? 'reset'
                    ]
                )
            } catch (error) {
                context.message = formatConversationError(
                    session,
                    error,
                    ruleField
                )
            }

            return ChainMiddlewareRunStatus.STOP
        })
    }

    middleware('conversation_rule_preset', async (session, context) => {
        const value = context.options.conversation_rule?.preset
        const clear =
            context.options.conversation_rule?.clear === true ||
            value === 'reset'
        const newOnly = context.options.conversation_rule?.newOnly === true

        try {
            const record =
                value == null && !clear
                    ? await ctx.chatluna.conversation.getManagedConstraint(
                          session
                      )
                    : await ctx.chatluna.conversation.updateManagedConstraint(
                          session,
                          clear
                              ? {
                                    activePresetLane: null,
                                    defaultPreset: null,
                                    fixedPreset: null
                                }
                              : newOnly
                                ? {
                                      defaultPreset: value,
                                      fixedPreset: null
                                  }
                                : {
                                      activePresetLane: value,
                                      fixedPreset: null
                                  }
                      )

            context.message = session.text(
                'chatluna.conversation.messages.rule_preset_status',
                [
                    formatPresetLane(session, record?.activePresetLane),
                    record?.defaultPreset ?? 'reset'
                ]
            )
        } catch (error) {
            context.message = formatConversationError(session, error, 'preset')
        }

        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_rule_share', async (session, context) => {
        const share = context.options.conversation_rule?.share

        if (share == null) {
            const resolved =
                await ctx.chatluna.conversation.resolveContext(session)
            context.message = session.text(
                'chatluna.conversation.messages.rule_share_status',
                [resolved.constraint.routeMode]
            )
            return ChainMiddlewareRunStatus.STOP
        }

        const routeMode =
            share === 'reset'
                ? null
                : share === 'shared' || share === 'personal'
                  ? share
                  : undefined

        if (routeMode === undefined) {
            context.message = session.text(
                'chatluna.conversation.messages.rule_share_failed',
                [session.text('chatluna.conversation.messages.rule_share_hint')]
            )
            return ChainMiddlewareRunStatus.STOP
        }

        try {
            await ctx.chatluna.conversation.updateManagedConstraint(session, {
                routeMode
            })
            const resolved =
                await ctx.chatluna.conversation.resolveContext(session)

            context.message = session.text(
                'chatluna.conversation.messages.rule_share_status',
                [resolved.constraint.routeMode]
            )
        } catch (error) {
            context.message = formatConversationError(session, error, 'share')
        }

        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_rule_lock', async (session, context) => {
        const raw = context.options.conversation_rule?.lock

        let lock: boolean | null | undefined
        if (raw === 'reset') {
            lock = null
        } else if (raw === 'true' || raw === 'on' || raw === 'lock') {
            lock = true
        } else if (raw === 'false' || raw === 'off' || raw === 'unlock') {
            lock = false
        } else if (raw === 'toggle') {
            const current =
                await ctx.chatluna.conversation.getManagedConstraint(session)
            lock = !(current?.lockConversation === true)
        } else {
            context.message = session.text(
                'chatluna.conversation.messages.rule_lock_failed',
                [session.text('chatluna.conversation.messages.rule_lock_hint')]
            )
            return ChainMiddlewareRunStatus.STOP
        }

        try {
            const record =
                await ctx.chatluna.conversation.updateManagedConstraint(
                    session,
                    { lockConversation: lock }
                )

            context.message = session.text(
                'chatluna.conversation.messages.rule_lock_success',
                [formatLockState(record.lockConversation)]
            )
        } catch (error) {
            context.message = formatConversationError(session, error, 'lock')
        }

        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_rule_show', async (session, context) => {
        const resolved = await ctx.chatluna.conversation.resolveContext(
            session,
            { presetLane: context.options.conversation_manage?.presetLane }
        )
        const current =
            await ctx.chatluna.conversation.getManagedConstraint(session)

        context.message = [
            session.text('chatluna.conversation.messages.rule_show_header'),
            session.text('chatluna.conversation.conversation_scope', [
                formatRouteScope(resolved.bindingKey)
            ]),
            session.text('chatluna.conversation.messages.rule_share_status', [
                resolved.constraint.routeMode
            ]),
            session.text('chatluna.conversation.messages.rule_model_status', [
                current?.defaultModel ?? 'reset',
                current?.fixedModel ?? 'reset'
            ]),
            session.text('chatluna.conversation.messages.rule_preset_status', [
                formatPresetLane(
                    session,
                    current?.activePresetLane ??
                        resolved.constraint.activePresetLane
                ),
                current?.defaultPreset ?? 'reset'
            ]),
            session.text('chatluna.conversation.messages.rule_mode_status', [
                current?.defaultChatMode ?? 'reset',
                current?.fixedChatMode ?? 'reset'
            ]),
            session.text('chatluna.conversation.rule_lock', [
                formatLockState(current?.lockConversation)
            ])
        ].join('\n')
        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_compress', async (session, context) => {
        const key =
            context.options.i18n_base ?? 'commands.chatluna.compress.messages'
        const presetLane = context.options.conversation_manage?.presetLane
        const resolved = await ctx.chatluna.conversation.resolveContext(
            session,
            { presetLane, conversationId: context.options.conversationId }
        )
        const targetConversation = pickConversationTarget(
            context,
            resolved.conversation
        )
        const conversation =
            targetConversation != null
                ? await ctx.chatluna.conversation.resolveTargetConversation(
                      session,
                      {
                          presetLane,
                          allPresetLanes: presetLane == null,
                          targetConversation,
                          conversationId: context.options.conversationId,
                          permission: 'manage',
                          includeArchived:
                              context.options.conversation_manage
                                  ?.includeArchived === true
                      }
                  )
                : null

        if (conversation == null) {
            context.message = session.text(`${key}.no_conversation`)
            return ChainMiddlewareRunStatus.STOP
        }

        const target =
            await ctx.chatluna.conversation.getManagedConstraintByBindingKey(
                conversation.bindingKey
            )

        if (target?.lockConversation ?? resolved.constraint.lockConversation) {
            context.message = session.text(`${key}.failed`, [
                conversation.title,
                conversation.id,
                session.text('chatluna.conversation.messages.action_locked', [
                    session.text('chatluna.conversation.action.compress')
                ])
            ])
            return ChainMiddlewareRunStatus.STOP
        }

        try {
            const result =
                await ctx.chatluna.conversationRuntime.compressConversation(
                    conversation,
                    context.options.force === true
                )

            context.message = session.text(
                result.compressed ? `${key}.success` : `${key}.skipped`,
                [
                    result.inputTokens,
                    result.outputTokens,
                    result.reducedPercent.toFixed(2)
                ]
            )
        } catch (error) {
            ctx.logger.error(error)
            context.message = session.text(`${key}.failed`, [
                conversation.title,
                conversation.id,
                formatConversationError(session, error, 'compress')
            ])
        }

        return ChainMiddlewareRunStatus.STOP
    })
}

function pickConversationTarget(
    context: ChainMiddlewareContext,
    current?: ConversationRecord | null
) {
    return (
        context.options.conversation_manage?.targetConversation ??
        context.options.conversationId ??
        current?.id
    )
}

function formatConversationStatus(
    session: Session,
    conversation: ConversationRecord,
    activeConversationId?: string | null
) {
    if (conversation.id === activeConversationId) {
        return session.text('chatluna.conversation.active')
    }

    if (conversation.status === 'active') {
        return null
    }

    return session.text(
        'chatluna.conversation.status_value.' + conversation.status
    )
}

function formatRouteScope(bindingKey: string) {
    if (bindingKey.includes(':preset:')) {
        return bindingKey
    }

    const [mode, platform, selfId, scope, userId] = bindingKey.split(':')

    if (mode !== 'shared' && mode !== 'personal') {
        return bindingKey
    }

    if (platform == null || selfId == null || scope == null) {
        return bindingKey
    }

    if (mode === 'shared') {
        return `${mode} ${platform}/${selfId}/${scope}`
    }

    if (userId == null) {
        return bindingKey
    }

    return `${mode} ${platform}/${selfId}/${scope}/${userId}`
}

function formatConversationError(
    session: Session,
    error: Error,
    action?: string
) {
    if (error.message === 'Conversation not found.') {
        return session.text('chatluna.conversation.messages.target_not_found')
    }

    if (error.message === 'Conversation target is ambiguous.') {
        return session.text('chatluna.conversation.messages.target_ambiguous')
    }

    if (error.message === 'Conversation does not belong to current route.') {
        return session.text(
            'chatluna.conversation.messages.target_outside_route'
        )
    }

    if (
        error.message ===
        'Conversation management requires administrator permission.'
    ) {
        return session.text('chatluna.conversation.messages.admin_required')
    }

    const locked = error.message.match(
        /^Conversation (.+) is locked by constraint\.$/
    )
    if (locked) {
        return session.text('chatluna.conversation.messages.action_locked', [
            session.text(`chatluna.conversation.action.${locked[1]}`)
        ])
    }

    const disabled = error.message.match(
        /^Conversation (.+) is disabled by constraint\.$/
    )
    if (disabled) {
        return session.text('chatluna.conversation.messages.action_disabled', [
            session.text(`chatluna.conversation.action.${disabled[1]}`)
        ])
    }

    const fixedModel = error.message.match(/^Model is fixed to (.+)\.$/)
    if (fixedModel) {
        return session.text('chatluna.conversation.messages.fixed_model', [
            fixedModel[1]
        ])
    }

    const fixedPreset = error.message.match(/^Preset is fixed to (.+)\.$/)
    if (fixedPreset) {
        return session.text('chatluna.conversation.messages.fixed_preset', [
            fixedPreset[1]
        ])
    }

    const fixedMode = error.message.match(/^Chat mode is fixed to (.+)\.$/)
    if (fixedMode) {
        return session.text('chatluna.conversation.messages.fixed_chat_mode', [
            fixedMode[1]
        ])
    }

    if (action != null) {
        return session.text('chatluna.conversation.messages.action_failed', [
            session.text(`chatluna.conversation.action.${action}`),
            error.message
        ])
    }

    return error.message
}

function formatConversationLine(
    session: Session,
    conversation: ConversationRecord,
    resolved: ResolvedConversationContext,
    showLane = false,
    seq: number | string = conversation.seq ?? '-'
) {
    const status = formatConversationStatus(
        session,
        conversation,
        resolved.binding?.activeConversationId
    )
    const effectiveModel =
        resolved.constraint.fixedModel ??
        conversation.model ??
        resolved.constraint.defaultModel ??
        '-'
    const effectivePreset =
        resolved.constraint.fixedPreset ??
        conversation.preset ??
        resolved.constraint.defaultPreset ??
        '-'
    const lane = formatPresetLane(
        session,
        getPresetLane(conversation.bindingKey)
    )

    if (!showLane && status == null) {
        return session.text('chatluna.conversation.conversation_line', [
            seq,
            conversation.title,
            effectiveModel,
            effectivePreset
        ])
    }

    if (!showLane) {
        return session.text(
            'chatluna.conversation.conversation_line_with_status',
            [seq, conversation.title, effectiveModel, effectivePreset, status]
        )
    }

    if (status == null) {
        return session.text(
            'chatluna.conversation.conversation_line_with_lane',
            [seq, conversation.title, effectiveModel, effectivePreset, lane]
        )
    }

    return session.text(
        'chatluna.conversation.conversation_line_with_lane_status',
        [seq, conversation.title, effectiveModel, effectivePreset, lane, status]
    )
}

function formatLockState(lock: boolean | null | undefined) {
    return lock == null ? 'reset' : lock ? 'locked' : 'unlocked'
}

function formatPresetLane(session: Session, presetLane?: string | null) {
    return presetLane == null
        ? session.text('chatluna.conversation.main_lane')
        : presetLane
}

declare module '../../chains/chain' {
    interface ChainMiddlewareName {
        conversation_new: never
        conversation_switch: never
        conversation_list: never
        conversation_current: never
        conversation_rename: never
        conversation_delete: never
        conversation_use_model: never
        conversation_use_preset: never
        conversation_use_mode: never
        conversation_archive: never
        conversation_restore: never
        conversation_export: never
        conversation_compress: never
        conversation_rule_model: never
        conversation_rule_preset: never
        conversation_rule_mode: never
        conversation_rule_share: never
        conversation_rule_lock: never
        conversation_rule_show: never
    }
}
