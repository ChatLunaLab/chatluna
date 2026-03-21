import { Context } from 'koishi'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import { Config } from '../../config'
import {
    ConversationCompressionRecord,
    ConversationRecord,
    ResolvedConversationContext
} from '../../services/conversation_types'
import { Pagination } from '../../utils/pagination'
import { checkAdmin } from '../../utils/koishi'

function pickConversationTarget(
    context: import('../../chains/chain').ChainMiddlewareContext,
    current?: ConversationRecord | null
) {
    return (
        context.options.conversation_manage?.targetConversation ??
        context.options.conversationId ??
        current?.id ??
        undefined
    )
}

async function resolveManagedConversation(
    ctx: Context,
    session: import('koishi').Session,
    context: import('../../chains/chain').ChainMiddlewareContext
) {
    const presetLane = context.options.conversation_manage?.presetLane
    const resolved = await ctx.chatluna.conversation.resolveContext(session, {
        presetLane,
        conversationId: context.options.conversationId
    })
    const targetConversation = pickConversationTarget(
        context,
        resolved.conversation
    )

    return {
        presetLane,
        resolved,
        targetConversation,
        conversation:
            targetConversation != null
                ? await ctx.chatluna.conversation.resolveTargetConversation(
                      session,
                      {
                          presetLane,
                          targetConversation,
                          conversationId: context.options.conversationId,
                          permission: 'manage',
                          includeArchived:
                              context.options.conversation_manage
                                  ?.includeArchived === true
                      }
                  )
                : null
    }
}

function formatConversationStatus(
    session: import('koishi').Session,
    conversation: ConversationRecord,
    activeConversationId?: string | null
) {
    const labels = [session.text('.status_value.' + conversation.status)]

    if (conversation.id === activeConversationId) {
        labels.push(session.text('.active'))
    }

    return labels.join(' · ')
}

function parseCompression(value?: string | null) {
    if (value == null || value.length === 0) {
        return null
    }

    try {
        return JSON.parse(value) as ConversationCompressionRecord
    } catch {
        return null
    }
}

function formatRouteScope(bindingKey: string) {
    const [mode, platform, selfId, scope, userId] = bindingKey.split(':')

    if (bindingKey.includes(':preset:')) {
        return bindingKey
    }

    if (mode === 'shared') {
        return `${mode} ${platform}/${selfId}/${scope}`
    }

    return `${mode} ${platform}/${selfId}/${scope}/${userId}`
}

function formatRuleState(value?: string | null, fallback = 'reset') {
    return value ?? fallback
}

function formatConversationError(
    session: import('koishi').Session,
    error: Error,
    action?: string
) {
    if (error.message === 'Conversation not found.') {
        return session.text('.messages.target_not_found')
    }

    if (error.message === 'Conversation target is ambiguous.') {
        return session.text('.messages.target_ambiguous')
    }

    if (error.message === 'Conversation does not belong to current route.') {
        return session.text('.messages.target_outside_route')
    }

    if (
        error.message ===
        'Conversation management requires administrator permission.'
    ) {
        return session.text('.messages.admin_required')
    }

    const locked = error.message.match(
        /^Conversation (.+) is locked by constraint\.$/
    )
    if (locked) {
        return session.text('.messages.action_locked', [
            session.text(`.action.${locked[1]}`)
        ])
    }

    const disabled = error.message.match(
        /^Conversation (.+) is disabled by constraint\.$/
    )
    if (disabled) {
        return session.text('.messages.action_disabled', [
            session.text(`.action.${disabled[1]}`)
        ])
    }

    const fixedModel = error.message.match(/^Model is fixed to (.+)\.$/)
    if (fixedModel) {
        return session.text('.messages.fixed_model', [fixedModel[1]])
    }

    const fixedPreset = error.message.match(/^Preset is fixed to (.+)\.$/)
    if (fixedPreset) {
        return session.text('.messages.fixed_preset', [fixedPreset[1]])
    }

    const fixedMode = error.message.match(/^Chat mode is fixed to (.+)\.$/)
    if (fixedMode) {
        return session.text('.messages.fixed_chat_mode', [fixedMode[1]])
    }

    if (action != null) {
        return session.text('.messages.action_failed', [
            session.text(`.action.${action}`),
            error.message
        ])
    }

    return error.message
}

function formatConversationBlock(
    session: import('koishi').Session,
    resolved: ResolvedConversationContext,
    conversation: ConversationRecord
) {
    const compression = parseCompression(conversation.compression)
    const updatedAt = conversation.lastChatAt ?? conversation.updatedAt
    const effectiveModel =
        resolved.constraint.fixedModel ??
        conversation.model ??
        resolved.constraint.defaultModel ??
        '-'
    const effectivePreset =
        resolved.presetLane ??
        resolved.constraint.fixedPreset ??
        conversation.preset ??
        resolved.constraint.defaultPreset ??
        '-'
    const effectiveChatMode =
        resolved.constraint.fixedChatMode ??
        conversation.chatMode ??
        resolved.constraint.defaultChatMode ??
        '-'

    return [
        session.text('.conversation_scope', [
            formatRouteScope(resolved.bindingKey)
        ]),
        session.text('.conversation_base_scope', [
            formatRouteScope(resolved.constraint.baseKey)
        ]),
        session.text('.conversation_route_mode', [
            resolved.constraint.routeMode
        ]),
        session.text('.conversation_active', [
            resolved.binding?.activeConversationId ?? '-'
        ]),
        session.text('.conversation_last', [
            resolved.binding?.lastConversationId ?? '-'
        ]),
        session.text('.conversation_seq', [conversation.seq ?? '-']),
        session.text('.conversation_title', [conversation.title]),
        session.text('.conversation_id', [conversation.id]),
        session.text('.conversation_status', [
            formatConversationStatus(
                session,
                conversation,
                resolved.binding?.activeConversationId
            )
        ]),
        session.text('.conversation_model', [conversation.model]),
        session.text('.conversation_preset', [conversation.preset]),
        session.text('.conversation_chat_mode', [conversation.chatMode]),
        session.text('.conversation_effective_model', [effectiveModel]),
        session.text('.conversation_effective_preset', [effectivePreset]),
        session.text('.conversation_effective_chat_mode', [effectiveChatMode]),
        session.text('.conversation_default_model', [
            resolved.constraint.defaultModel ?? '-'
        ]),
        session.text('.conversation_default_preset', [
            resolved.constraint.defaultPreset ?? '-'
        ]),
        session.text('.conversation_default_chat_mode', [
            resolved.constraint.defaultChatMode ?? '-'
        ]),
        session.text('.conversation_fixed_model', [
            resolved.constraint.fixedModel ?? '-'
        ]),
        session.text('.conversation_fixed_preset', [
            resolved.constraint.fixedPreset ?? '-'
        ]),
        session.text('.conversation_fixed_chat_mode', [
            resolved.constraint.fixedChatMode ?? '-'
        ]),
        session.text('.conversation_lock', [
            resolved.constraint.lockConversation ? 'locked' : 'unlocked'
        ]),
        session.text('.conversation_allow_new', [
            resolved.constraint.allowNew ? 'enabled' : 'disabled'
        ]),
        session.text('.conversation_allow_switch', [
            resolved.constraint.allowSwitch ? 'enabled' : 'disabled'
        ]),
        session.text('.conversation_allow_archive', [
            resolved.constraint.allowArchive ? 'enabled' : 'disabled'
        ]),
        session.text('.conversation_allow_export', [
            resolved.constraint.allowExport ? 'enabled' : 'disabled'
        ]),
        session.text('.conversation_manage_mode', [
            resolved.constraint.manageMode
        ]),
        session.text('.conversation_preset_lane', [resolved.presetLane ?? '-']),
        session.text('.conversation_compression_count', [
            compression?.count ?? 0
        ]),
        session.text('.conversation_updated_at', [updatedAt.toISOString()]),
        ''
    ].join('\n')
}

function formatConversationLine(
    session: import('koishi').Session,
    conversation: ConversationRecord,
    resolved: ResolvedConversationContext
) {
    return formatConversationBlock(session, resolved, conversation)
}

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const pagination = new Pagination<ConversationRecord>({
        formatItem: () => '',
        formatString: {
            top: '',
            bottom: '',
            pages: ''
        }
    })

    chain
        .middleware('conversation_new', async (session, context) => {
            if (context.command !== 'conversation_new') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const presetLane = context.options.conversation_create?.preset
            const resolved = await ctx.chatluna.conversation.resolveContext(
                session,
                {
                    presetLane
                }
            )

            if (
                resolved.constraint.manageMode === 'admin' &&
                !(await checkAdmin(session))
            ) {
                context.message = session.text('.messages.admin_required')
                return ChainMiddlewareRunStatus.STOP
            }

            if (
                resolved.constraint.lockConversation &&
                resolved.binding?.activeConversationId != null
            ) {
                context.message = session.text('.messages.action_locked', [
                    session.text('.action.create')
                ])
                return ChainMiddlewareRunStatus.STOP
            }

            if (
                context.options.conversation_create?.model != null &&
                resolved.constraint.fixedModel != null &&
                context.options.conversation_create?.model !==
                    resolved.constraint.fixedModel
            ) {
                context.message = session.text('.messages.fixed_model', [
                    resolved.constraint.fixedModel
                ])
                return ChainMiddlewareRunStatus.STOP
            }

            if (
                context.options.conversation_create?.chatMode != null &&
                resolved.constraint.fixedChatMode != null &&
                context.options.conversation_create?.chatMode !==
                    resolved.constraint.fixedChatMode
            ) {
                context.message = session.text('.messages.fixed_chat_mode', [
                    resolved.constraint.fixedChatMode
                ])
                return ChainMiddlewareRunStatus.STOP
            }

            if (!resolved.constraint.allowNew) {
                context.message = session.text('.messages.action_disabled', [
                    session.text('.action.create')
                ])
                return ChainMiddlewareRunStatus.STOP
            }

            const conversation =
                await ctx.chatluna.conversation.createConversation(session, {
                    bindingKey: resolved.bindingKey,
                    title:
                        context.options.conversation_create?.title ??
                        presetLane ??
                        session.text('.default_title'),
                    model:
                        context.options.conversation_create?.model ??
                        resolved.effectiveModel ??
                        config.defaultModel,
                    preset: resolved.effectivePreset ?? config.defaultPreset,
                    chatMode:
                        context.options.conversation_create?.chatMode ??
                        resolved.effectiveChatMode ??
                        config.defaultChatMode
                })

            context.options.conversationId = conversation.id
            context.message = session.text('.messages.new_success', [
                conversation.title,
                conversation.seq ?? conversation.id,
                conversation.id
            ])
            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_switch', async (session, context) => {
            if (context.command !== 'conversation_switch') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const targetConversation =
                context.options.conversation_manage?.targetConversation

            if (targetConversation == null) {
                context.message = session.text('.messages.target_required')
                return ChainMiddlewareRunStatus.STOP
            }

            try {
                const conversation =
                    await ctx.chatluna.conversation.switchConversation(
                        session,
                        {
                            targetConversation,
                            presetLane:
                                context.options.conversation_manage?.presetLane
                        }
                    )

                context.options.conversationId = conversation.id
                context.message = session.text('.messages.switch_success', [
                    conversation.title,
                    conversation.seq ?? conversation.id,
                    conversation.id
                ])
            } catch (error) {
                context.message = session.text('.messages.switch_failed', [
                    formatConversationError(session, error, 'switch')
                ])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_list', async (session, context) => {
            if (context.command !== 'conversation_list') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const page = context.options.page ?? 1
            const limit = context.options.limit ?? 5
            const presetLane = context.options.conversation_manage?.presetLane
            const includeArchived =
                context.options.conversation_manage?.includeArchived === true
            const resolved =
                await ctx.chatluna.conversation.getCurrentConversation(
                    session,
                    { presetLane }
                )
            const conversations =
                await ctx.chatluna.conversation.listConversations(session, {
                    presetLane,
                    includeArchived
                })

            if (conversations.length === 0) {
                context.message = session.text('.messages.list_empty')
                return ChainMiddlewareRunStatus.STOP
            }

            pagination.updateFormatString({
                top: session.text('.messages.list_header') + '\n',
                bottom: '',
                pages: '\n' + session.text('.messages.list_pages')
            })
            pagination.updateFormatItem((conversation) =>
                formatConversationLine(session, conversation, resolved)
            )

            const key = `${resolved.bindingKey}:${session.userId}`
            await pagination.push(conversations, key)
            context.message = await pagination.getFormattedPage(
                page,
                limit,
                key
            )
            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_current', async (session, context) => {
            if (context.command !== 'conversation_current') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const resolved =
                await ctx.chatluna.conversation.getCurrentConversation(
                    session,
                    {
                        presetLane:
                            context.options.conversation_manage?.presetLane
                    }
                )

            if (resolved.conversation == null) {
                context.message = session.text('.messages.current_empty')
                return ChainMiddlewareRunStatus.STOP
            }

            context.message = [
                session.text('.messages.current_header'),
                formatConversationLine(session, resolved.conversation, resolved)
            ].join('\n')
            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_rename', async (session, context) => {
            if (context.command !== 'conversation_rename') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const title = context.options.conversation_manage?.title
            if (title == null) {
                context.message = session.text('.messages.title_required')
                return ChainMiddlewareRunStatus.STOP
            }

            try {
                const conversation =
                    await ctx.chatluna.conversation.renameConversation(
                        session,
                        {
                            conversationId: context.options.conversationId,
                            targetConversation:
                                context.options.conversation_manage
                                    ?.targetConversation,
                            presetLane:
                                context.options.conversation_manage?.presetLane,
                            title
                        }
                    )

                context.message = session.text('.messages.rename_success', [
                    conversation.title,
                    conversation.seq ?? conversation.id,
                    conversation.id
                ])
            } catch (error) {
                context.message = session.text('.messages.rename_failed', [
                    formatConversationError(session, error, 'rename')
                ])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_delete', async (session, context) => {
            if (context.command !== 'conversation_delete') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            try {
                const conversation =
                    await ctx.chatluna.conversation.deleteConversation(
                        session,
                        {
                            conversationId: context.options.conversationId,
                            targetConversation:
                                context.options.conversation_manage
                                    ?.targetConversation,
                            presetLane:
                                context.options.conversation_manage?.presetLane
                        }
                    )

                context.message = session.text('.messages.delete_success', [
                    conversation.title,
                    conversation.seq ?? conversation.id,
                    conversation.id
                ])
            } catch (error) {
                context.message = session.text('.messages.delete_failed', [
                    formatConversationError(session, error, 'delete')
                ])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_use_model', async (session, context) => {
            if (context.command !== 'conversation_use_model') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            try {
                const conversation =
                    await ctx.chatluna.conversation.updateConversationUsage(
                        session,
                        {
                            conversationId: context.options.conversationId,
                            presetLane:
                                context.options.conversation_manage?.presetLane,
                            model: context.options.conversation_use?.model
                        }
                    )

                context.message = session.text('.messages.use_model_success', [
                    conversation.model,
                    conversation.title,
                    conversation.id
                ])
            } catch (error) {
                context.message = session.text('.messages.use_model_failed', [
                    formatConversationError(session, error, 'update')
                ])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_use_preset', async (session, context) => {
            if (context.command !== 'conversation_use_preset') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            try {
                const conversation =
                    await ctx.chatluna.conversation.updateConversationUsage(
                        session,
                        {
                            conversationId: context.options.conversationId,
                            presetLane:
                                context.options.conversation_manage?.presetLane,
                            preset: context.options.conversation_use?.preset
                        }
                    )

                context.message = session.text('.messages.use_preset_success', [
                    conversation.preset,
                    conversation.title,
                    conversation.id
                ])
            } catch (error) {
                context.message = session.text('.messages.use_preset_failed', [
                    formatConversationError(session, error, 'update')
                ])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_use_mode', async (session, context) => {
            if (context.command !== 'conversation_use_mode') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            try {
                const conversation =
                    await ctx.chatluna.conversation.updateConversationUsage(
                        session,
                        {
                            conversationId: context.options.conversationId,
                            presetLane:
                                context.options.conversation_manage?.presetLane,
                            chatMode: context.options.conversation_use?.chatMode
                        }
                    )

                context.message = session.text('.messages.use_mode_success', [
                    conversation.chatMode,
                    conversation.title,
                    conversation.id
                ])
            } catch (error) {
                context.message = session.text('.messages.use_mode_failed', [
                    formatConversationError(session, error, 'update')
                ])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_archive', async (session, context) => {
            if (context.command !== 'conversation_archive') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const targetConversation = pickConversationTarget(context)

            if (targetConversation == null) {
                context.message = session.text('.messages.archive_empty')
                return ChainMiddlewareRunStatus.STOP
            }

            try {
                const result =
                    await ctx.chatluna.conversation.archiveConversation(
                        session,
                        {
                            targetConversation,
                            presetLane:
                                context.options.conversation_manage?.presetLane
                        }
                    )

                context.message = session.text('.messages.archive_success', [
                    result.conversation.title,
                    result.conversation.seq ?? result.conversation.id,
                    result.conversation.id,
                    result.archive.id
                ])
            } catch (error) {
                context.message = session.text('.messages.archive_failed', [
                    formatConversationError(session, error, 'archive')
                ])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_restore', async (session, context) => {
            if (context.command !== 'conversation_restore') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const targetConversation = pickConversationTarget(context)

            if (targetConversation == null) {
                context.message = session.text('.messages.restore_empty')
                return ChainMiddlewareRunStatus.STOP
            }

            try {
                const conversation =
                    await ctx.chatluna.conversation.reopenConversation(
                        session,
                        {
                            targetConversation,
                            presetLane:
                                context.options.conversation_manage?.presetLane,
                            includeArchived: true
                        }
                    )

                context.options.conversationId = conversation.id
                context.message = session.text('.messages.restore_success', [
                    conversation.title,
                    conversation.seq ?? conversation.id,
                    conversation.id
                ])
            } catch (error) {
                context.message = session.text('.messages.restore_failed', [
                    formatConversationError(session, error, 'restore')
                ])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_export', async (session, context) => {
            if (context.command !== 'conversation_export') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const targetConversation = pickConversationTarget(context)

            if (targetConversation == null) {
                context.message = session.text('.messages.export_empty')
                return ChainMiddlewareRunStatus.STOP
            }

            try {
                const result =
                    await ctx.chatluna.conversation.exportConversation(
                        session,
                        {
                            targetConversation,
                            presetLane:
                                context.options.conversation_manage?.presetLane,
                            includeArchived: true
                        }
                    )

                context.message = session.text('.messages.export_success', [
                    result.conversation.title,
                    result.conversation.seq ?? result.conversation.id,
                    result.conversation.id,
                    result.path,
                    result.size,
                    result.checksum
                ])
            } catch (error) {
                context.message = session.text('.messages.export_failed', [
                    formatConversationError(session, error, 'export')
                ])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_rule_model', async (session, context) => {
            if (context.command !== 'conversation_rule_model') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const value = context.options.conversation_rule?.model
            const record =
                await ctx.chatluna.conversation.updateManagedConstraint(
                    session,
                    {
                        fixedModel: value === 'reset' ? null : value
                    }
                )

            context.message = session.text('.messages.rule_model_success', [
                formatRuleState(record.fixedModel)
            ])
            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_rule_preset', async (session, context) => {
            if (context.command !== 'conversation_rule_preset') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const value = context.options.conversation_rule?.preset
            const record =
                await ctx.chatluna.conversation.updateManagedConstraint(
                    session,
                    {
                        fixedPreset: value === 'reset' ? null : value
                    }
                )

            context.message = session.text('.messages.rule_preset_success', [
                formatRuleState(record.fixedPreset)
            ])
            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_rule_mode', async (session, context) => {
            if (context.command !== 'conversation_rule_mode') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const value = context.options.conversation_rule?.chatMode
            const record =
                await ctx.chatluna.conversation.updateManagedConstraint(
                    session,
                    {
                        fixedChatMode: value === 'reset' ? null : value
                    }
                )

            context.message = session.text('.messages.rule_mode_success', [
                formatRuleState(record.fixedChatMode)
            ])
            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_rule_share', async (session, context) => {
            if (context.command !== 'conversation_rule_share') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const share = context.options.conversation_rule?.share
            const routeMode =
                share === 'reset'
                    ? null
                    : share === 'shared' || share === 'personal'
                      ? share
                      : undefined

            if (routeMode === undefined) {
                context.message = session.text('.messages.rule_share_failed', [
                    'share must be personal, shared, or reset.'
                ])
                return ChainMiddlewareRunStatus.STOP
            }

            const record =
                await ctx.chatluna.conversation.updateManagedConstraint(
                    session,
                    {
                        routeMode
                    }
                )

            context.message = session.text('.messages.rule_share_success', [
                formatRuleState(record.routeMode)
            ])
            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_rule_lock', async (session, context) => {
            if (context.command !== 'conversation_rule_lock') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const current =
                await ctx.chatluna.conversation.getManagedConstraint(session)
            const raw = context.options.conversation_rule?.lock
            const lock =
                raw === 'reset'
                    ? null
                    : raw === 'true' || raw === 'on' || raw === 'lock'
                      ? true
                      : raw === 'false' || raw === 'off' || raw === 'unlock'
                        ? false
                        : raw === 'toggle'
                          ? !(current?.lockConversation === true)
                          : undefined

            if (lock === undefined) {
                context.message = session.text('.messages.rule_lock_failed', [
                    'lock must be on, off, reset, or toggle.'
                ])
                return ChainMiddlewareRunStatus.STOP
            }

            const record =
                await ctx.chatluna.conversation.updateManagedConstraint(
                    session,
                    {
                        lockConversation: lock
                    }
                )

            context.message = session.text('.messages.rule_lock_success', [
                record.lockConversation == null
                    ? 'reset'
                    : record.lockConversation
                      ? 'locked'
                      : 'unlocked'
            ])
            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_rule_show', async (session, context) => {
            if (context.command !== 'conversation_rule_show') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const current =
                await ctx.chatluna.conversation.getManagedConstraint(session)
            const resolved = await ctx.chatluna.conversation.resolveContext(
                session,
                {
                    presetLane: context.options.conversation_manage?.presetLane
                }
            )

            context.message = [
                session.text('.messages.rule_show_header'),
                session.text('.conversation_scope', [
                    formatRouteScope(resolved.bindingKey)
                ]),
                session.text('.rule_share', [
                    formatRuleState(current?.routeMode)
                ]),
                session.text('.rule_model', [
                    formatRuleState(current?.fixedModel)
                ]),
                session.text('.rule_preset', [
                    formatRuleState(current?.fixedPreset)
                ]),
                session.text('.rule_mode', [
                    formatRuleState(current?.fixedChatMode)
                ]),
                session.text('.rule_lock', [
                    current?.lockConversation == null
                        ? 'reset'
                        : current.lockConversation
                          ? 'locked'
                          : 'unlocked'
                ])
            ].join('\n')
            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')

    chain
        .middleware('conversation_compress', async (session, context) => {
            if (context.command !== 'conversation_compress') {
                return ChainMiddlewareRunStatus.SKIPPED
            }

            const key =
                context.options.i18n_base ??
                'commands.chatluna.compress.messages'
            const { conversation, resolved } = await resolveManagedConversation(
                ctx,
                session,
                context
            )

            if (conversation == null) {
                context.message = session.text(`${key}.no_conversation`)
                return ChainMiddlewareRunStatus.STOP
            }

            if (resolved.constraint.lockConversation) {
                context.message = session.text(`${key}.failed`, [
                    conversation.title,
                    conversation.id,
                    session.text(
                        'chatluna.conversation.messages.action_locked',
                        [session.text('chatluna.conversation.action.compress')]
                    )
                ])
                return ChainMiddlewareRunStatus.STOP
            }

            try {
                const result =
                    await ctx.chatluna.conversationRuntime.compressConversation(
                        conversation,
                        context.options.force === true
                    )
                const args = [
                    result.inputTokens,
                    result.outputTokens,
                    result.reducedPercent.toFixed(2)
                ]

                context.message = session.text(
                    result.compressed ? `${key}.success` : `${key}.skipped`,
                    args
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
        .after('lifecycle-handle_command')
        .before('lifecycle-request_conversation')
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
