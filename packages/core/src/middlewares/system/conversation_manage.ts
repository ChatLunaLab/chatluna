import { Context, h, Session } from 'koishi'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../../chains/chain'
import { Config } from '../../config'
import {
    AdminRequiredError,
    ConstraintDisabledError,
    ConstraintFixedError,
    ConstraintLockedError,
    ConversationListEntry,
    ConversationNotFoundError,
    ConversationRecord,
    ConversationResolutionError,
    getBaseBindingKey,
    InvalidChatModeError,
    ResolvedConversationContext
} from '../../types'
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
            .after('resolve_conversation')
            .before('lifecycle-request_conversation')
    }

    middleware('conversation_new', async (session, context) => {
        const presetLane = context.options.presetLane
        const resolved = context.options.conversation
        const create = context.options.conversation_create

        if (resolved == null) {
            context.message = session.text(
                'chatluna.conversation.messages.target_not_found'
            )
            return ChainMiddlewareRunStatus.STOP
        }

        if (
            resolved.constraint.manageMode === 'admin' &&
            resolved.constraint.routeMode !== 'personal' &&
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
            context.message = actionLocked(session, 'create')
            return ChainMiddlewareRunStatus.STOP
        }

        for (const field of ['model', 'preset', 'chatMode'] as const) {
            const value = create?.[field]
            const fixed = resolved.constraint[FIXED_FIELD_KEY[field]]
            if (value != null && fixed != null && value !== fixed) {
                context.message = session.text(
                    `chatluna.conversation.messages.${FIXED_FIELD_MSG_KEY[field]}`,
                    [fixed]
                )
                return ChainMiddlewareRunStatus.STOP
            }
        }

        if (!resolved.constraint.allowNew) {
            context.message = actionDisabled(session, 'create')
            return ChainMiddlewareRunStatus.STOP
        }

        const conversation = await ctx.chatluna.conversation.createConversation(
            session,
            {
                bindingKey: resolved.bindingKey,
                title:
                    create?.title ??
                    presetLane ??
                    session.text('chatluna.conversation.default_title'),
                model:
                    create?.model ??
                    ctx.chatluna.conversation.pickModel(
                        resolved.constraint,
                        resolved.conversation
                    ) ??
                    config.defaultModel,
                preset:
                    create?.preset ??
                    resolved.effectivePreset ??
                    config.defaultPreset,
                chatMode:
                    create?.chatMode ??
                    resolved.effectiveChatMode ??
                    config.defaultChatMode
            }
        )

        context.message = session.text(
            'chatluna.conversation.messages.new_success',
            conversationSummary(conversation)
        )
        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_switch', async (session, context) => {
        const presetLane = context.options.conversation_manage?.presetLane
        const conversationId = resolvedConversationId(context)

        if (conversationId == null) {
            context.message = session.text(
                'chatluna.conversation.messages.target_required'
            )
            return ChainMiddlewareRunStatus.STOP
        }

        try {
            const conversation =
                await ctx.chatluna.conversation.switchConversation(session, {
                    conversationId,
                    presetLane,
                    allPresetLanes: presetLane == null
                })

            context.message = session.text(
                'chatluna.conversation.messages.switch_success',
                conversationSummary(conversation)
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
        const { presetLane, includeArchived, allPresetLanes } =
            getManageOptions(context)
        const resolved = context.options.conversation

        if (resolved == null) {
            context.message = session.text(
                'chatluna.conversation.messages.list_empty'
            )
            return ChainMiddlewareRunStatus.STOP
        }

        const conversations =
            await ctx.chatluna.conversation.listConversationEntries(session, {
                presetLane,
                allPresetLanes,
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
                    ctx,
                    session,
                    item.conversation,
                    resolved,
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

        const scope =
            presetLane == null
                ? getBaseBindingKey(resolved.bindingKey)
                : resolved.bindingKey
        const key = `${scope}:${includeArchived === true ? 'all' : 'active'}`
        await pagination.push(conversations, key)
        context.message = await pagination.getFormattedPage(page, limit, key)
        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_current', async (session, context) => {
        const resolved = context.options.conversation

        if (resolved == null || resolved.conversation == null) {
            context.message = session.text(
                'chatluna.conversation.messages.current_empty'
            )
            return ChainMiddlewareRunStatus.STOP
        }

        context.message = [
            session.text('chatluna.conversation.messages.current_header'),
            formatConversationLine(
                ctx,
                session,
                resolved.conversation,
                resolved
            )
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
                    conversationId: resolvedConversationId(context),
                    presetLane: context.options.conversation_manage?.presetLane,
                    title
                })

            context.message = session.text(
                'chatluna.conversation.messages.rename_success',
                conversationSummary(conversation)
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
            const { presetLane, includeArchived, allPresetLanes } =
                getManageOptions(context)
            const seqs =
                context.options.conversation_manage?.targetConversationSeqs

            if (seqs != null) {
                context.message = await deleteBySeqs(ctx, session, seqs, {
                    presetLane,
                    includeArchived,
                    allPresetLanes
                })
                return ChainMiddlewareRunStatus.STOP
            }

            const conversation =
                await ctx.chatluna.conversation.deleteConversation(session, {
                    conversationId: resolvedConversationId(context),
                    presetLane,
                    includeArchived,
                    allPresetLanes
                })

            context.message = session.text(
                'chatluna.conversation.messages.delete_success',
                conversationSummary(conversation)
            )
        } catch (error) {
            context.message = session.text(
                'chatluna.conversation.messages.delete_failed',
                [formatConversationError(session, error, 'delete')]
            )
        }

        return ChainMiddlewareRunStatus.STOP
    })

    for (const { cmd, field, successKey, failKey } of USE_FIELDS) {
        middleware(cmd, async (session, context) => {
            try {
                const conversation =
                    await ctx.chatluna.conversation.updateConversationUsage(
                        session,
                        {
                            conversationId: resolvedConversationId(context),
                            presetLane:
                                context.options.conversation_manage?.presetLane,
                            [field]: context.options.conversation_use?.[field]
                        }
                    )

                context.message = session.text(
                    `chatluna.conversation.messages.${successKey}`,
                    [conversation[field], conversation.title, conversation.id]
                )
            } catch (error) {
                context.message = session.text(
                    `chatluna.conversation.messages.${failKey}`,
                    [formatConversationError(session, error, 'update')]
                )
            }

            return ChainMiddlewareRunStatus.STOP
        })
    }

    middleware('conversation_archive', async (session, context) => {
        const conversation = requireConversation(session, context, 'archive')

        if (conversation == null) {
            return ChainMiddlewareRunStatus.STOP
        }

        try {
            const { presetLane, includeArchived, allPresetLanes } =
                getManageOptions(context)
            const result = await ctx.chatluna.conversation.archiveConversation(
                session,
                {
                    conversationId: conversation.id,
                    presetLane,
                    includeArchived,
                    allPresetLanes
                }
            )

            context.message = session.text(
                'chatluna.conversation.messages.archive_success',
                [...conversationSummary(result.conversation), result.archive.id]
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
        const current = requireConversation(session, context, 'restore')

        if (current == null) {
            return ChainMiddlewareRunStatus.STOP
        }

        try {
            const { presetLane, includeArchived, allPresetLanes } =
                getManageOptions(context)
            const conversation =
                await ctx.chatluna.conversation.reopenConversation(session, {
                    conversationId: current.id,
                    presetLane,
                    allPresetLanes,
                    includeArchived
                })

            context.message = session.text(
                'chatluna.conversation.messages.restore_success',
                conversationSummary(conversation)
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
        const conversation = requireConversation(session, context, 'export')

        if (conversation == null) {
            return ChainMiddlewareRunStatus.STOP
        }

        try {
            const { presetLane, includeArchived, allPresetLanes } =
                getManageOptions(context)
            const result = await ctx.chatluna.conversation.exportConversation(
                session,
                {
                    conversationId: conversation.id,
                    presetLane,
                    allPresetLanes,
                    includeArchived
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
                    ...conversationSummary(result.conversation),
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

    for (const {
        cmd,
        field,
        defaultKey,
        constraintKey,
        msgKey
    } of RULE_FIELDS) {
        middleware(cmd, async (session, context) => {
            const value = context.options.conversation_rule?.[field]
            const clear =
                context.options.conversation_rule?.clear === true ||
                value === 'reset'
            const force = context.options.conversation_rule?.force === true

            try {
                const patch = clear
                    ? { [defaultKey]: null, [constraintKey]: null }
                    : force
                      ? { [constraintKey]: value }
                      : { [defaultKey]: value }
                const record =
                    value == null && !clear
                        ? await ctx.chatluna.conversation.getManagedConstraint(
                              session
                          )
                        : await ctx.chatluna.conversation.updateManagedConstraint(
                              session,
                              patch
                          )

                context.message = session.text(
                    `chatluna.conversation.messages.${msgKey}`,
                    [
                        record?.[defaultKey] ?? 'reset',
                        record?.[constraintKey] ?? 'reset'
                    ]
                )
            } catch (error) {
                context.message = formatConversationError(session, error, field)
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
            const patch = clear
                ? {
                      activePresetLane: null,
                      defaultPreset: null,
                      fixedPreset: null
                  }
                : newOnly
                  ? { defaultPreset: value, fixedPreset: null }
                  : { activePresetLane: value, fixedPreset: null }
            const record =
                value == null && !clear
                    ? await ctx.chatluna.conversation.getManagedConstraint(
                          session
                      )
                    : await ctx.chatluna.conversation.updateManagedConstraint(
                          session,
                          patch
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
        const resolved = context.options.conversation

        if (resolved == null) {
            context.message = session.text(
                'chatluna.conversation.messages.target_not_found'
            )
            return ChainMiddlewareRunStatus.STOP
        }

        if (share == null) {
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
            const current =
                await ctx.chatluna.conversation.updateManagedConstraint(
                    session,
                    { routeMode }
                )
            const nextRouteMode =
                current.routeMode ??
                (await ctx.chatluna.conversation.resolveConstraint(session))
                    .routeMode

            context.message = session.text(
                'chatluna.conversation.messages.rule_share_status',
                [nextRouteMode]
            )
        } catch (error) {
            context.message = formatConversationError(session, error, 'share')
        }

        return ChainMiddlewareRunStatus.STOP
    })

    middleware('conversation_rule_lock', async (session, context) => {
        const lock = parseLockOption(context.options.conversation_rule?.lock)
        if (lock === undefined) {
            context.message = session.text(
                'chatluna.conversation.messages.rule_lock_failed',
                [session.text('chatluna.conversation.messages.rule_lock_hint')]
            )
            return ChainMiddlewareRunStatus.STOP
        }

        try {
            const next =
                lock === 'toggle'
                    ? !(
                          (
                              await ctx.chatluna.conversation.getManagedConstraint(
                                  session
                              )
                          )?.lockConversation === true
                      )
                    : lock
            const record =
                await ctx.chatluna.conversation.updateManagedConstraint(
                    session,
                    { lockConversation: next }
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
        const resolved = context.options.conversation

        if (resolved == null) {
            context.message = session.text(
                'chatluna.conversation.messages.target_not_found'
            )
            return ChainMiddlewareRunStatus.STOP
        }

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
        const resolved = context.options.conversation
        const conversation = resolved?.conversation ?? null

        if (resolved == null || conversation == null) {
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
                actionLocked(session, 'compress')
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

function resolvedConversationId(context: ChainMiddlewareContext) {
    return (
        context.options.conversation?.conversationId ??
        context.options.conversation?.conversation?.id
    )
}

function getManageOptions(context: ChainMiddlewareContext) {
    const presetLane = context.options.conversation_manage?.presetLane
    return {
        presetLane,
        includeArchived:
            context.options.conversation_manage?.includeArchived === true ||
            undefined,
        allPresetLanes: presetLane == null
    }
}

function requireConversation(
    session: Session,
    context: ChainMiddlewareContext,
    action: string
) {
    const conversation = context.options.conversation?.conversation
    if (conversation == null) {
        context.message = session.text(
            `chatluna.conversation.messages.${action}_failed`,
            [session.text('chatluna.conversation.messages.target_not_found')]
        )
    }
    return conversation
}

async function deleteBySeqs(
    ctx: Context,
    session: Session,
    seqs: number[],
    opts: ReturnType<typeof getManageOptions>
) {
    const entries = await ctx.chatluna.conversation.listConversationEntries(
        session,
        opts
    )
    const targets = entries.filter((item) => seqs.includes(item.displaySeq))
    if (targets.length !== seqs.length) {
        return session.text('chatluna.conversation.messages.target_not_found')
    }

    const deleted: ConversationRecord[] = []
    for (const target of targets) {
        deleted.push(
            await ctx.chatluna.conversation.deleteConversation(session, {
                conversationId: target.conversation.id,
                ...opts
            })
        )
    }

    return session.text('chatluna.conversation.messages.delete_success_multi', [
        deleted.map((item) => item.title).join('\n')
    ])
}

function conversationSummary(conversation: ConversationRecord) {
    return [
        conversation.title,
        conversation.seq ?? conversation.id,
        conversation.id
    ]
}

function actionLocked(session: Session, action: string) {
    return session.text('chatluna.conversation.messages.action_locked', [
        session.text(`chatluna.conversation.action.${action}`)
    ])
}

function actionDisabled(session: Session, action: string) {
    return session.text('chatluna.conversation.messages.action_disabled', [
        session.text(`chatluna.conversation.action.${action}`)
    ])
}

function parseLockOption(
    raw: string | undefined
): boolean | null | 'toggle' | undefined {
    if (raw === 'reset') return null
    if (raw === 'true' || raw === 'on' || raw === 'lock') return true
    if (raw === 'false' || raw === 'off' || raw === 'unlock') return false
    if (raw === 'toggle') return 'toggle'
    return undefined
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
    if (error instanceof ConversationResolutionError) {
        return session.text(
            error.code === 'ambiguous_target'
                ? 'chatluna.conversation.messages.target_ambiguous'
                : 'chatluna.conversation.messages.target_outside_route'
        )
    }

    if (error instanceof ConversationNotFoundError) {
        return session.text('chatluna.conversation.messages.target_not_found')
    }

    if (error instanceof AdminRequiredError) {
        return session.text('chatluna.conversation.messages.admin_required')
    }

    if (error instanceof ConstraintLockedError) {
        return actionLocked(session, error.action)
    }

    if (error instanceof ConstraintDisabledError) {
        return actionDisabled(session, error.action)
    }

    if (error instanceof ConstraintFixedError) {
        return session.text(
            `chatluna.conversation.messages.${FIXED_FIELD_MSG_KEY[error.field]}`,
            [error.value]
        )
    }

    if (error instanceof InvalidChatModeError) {
        return session.text(
            'chatluna.conversation.messages.invalid_chat_mode',
            [error.mode]
        )
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
    ctx: Context,
    session: Session,
    conversation: ConversationRecord,
    resolved: ResolvedConversationContext,
    seq: number | string = conversation.seq ?? '-'
) {
    const status = formatConversationStatus(
        session,
        conversation,
        resolved.binding?.activeConversationId
    )
    const model =
        ctx.chatluna.conversation.pickModel(
            resolved.constraint,
            conversation
        ) ?? '-'
    const preset =
        resolved.constraint.fixedPreset ??
        conversation.preset ??
        resolved.constraint.defaultPreset ??
        '-'

    if (status == null) {
        return session.text('chatluna.conversation.conversation_line', [
            seq,
            conversation.title,
            model,
            preset
        ])
    }

    return session.text('chatluna.conversation.conversation_line_with_status', [
        seq,
        conversation.title,
        model,
        preset,
        status
    ])
}

function formatLockState(lock: boolean | null | undefined) {
    return lock == null ? 'reset' : lock ? 'locked' : 'unlocked'
}

function formatPresetLane(session: Session, presetLane?: string | null) {
    return presetLane == null
        ? session.text('chatluna.conversation.main_lane')
        : presetLane
}

const USE_FIELDS = [
    {
        cmd: 'conversation_use_model' as const,
        field: 'model' as const,
        successKey: 'use_model_success',
        failKey: 'use_model_failed'
    },
    {
        cmd: 'conversation_use_preset' as const,
        field: 'preset' as const,
        successKey: 'use_preset_success',
        failKey: 'use_preset_failed'
    },
    {
        cmd: 'conversation_use_mode' as const,
        field: 'chatMode' as const,
        successKey: 'use_mode_success',
        failKey: 'use_mode_failed'
    }
] as const

const RULE_FIELDS = [
    {
        cmd: 'conversation_rule_model' as const,
        field: 'model' as const,
        defaultKey: 'defaultModel' as const,
        constraintKey: 'fixedModel' as const,
        msgKey: 'rule_model_status'
    },
    {
        cmd: 'conversation_rule_mode' as const,
        field: 'chatMode' as const,
        defaultKey: 'defaultChatMode' as const,
        constraintKey: 'fixedChatMode' as const,
        msgKey: 'rule_mode_status'
    }
] as const

const FIXED_FIELD_KEY = {
    model: 'fixedModel',
    preset: 'fixedPreset',
    chatMode: 'fixedChatMode'
} as const

const FIXED_FIELD_MSG_KEY = {
    model: 'fixed_model',
    preset: 'fixed_preset',
    chatMode: 'fixed_chat_mode'
} as const

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
