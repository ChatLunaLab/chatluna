import { createHash, randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { Context, Session } from 'koishi'
import type { Config } from '../config'
import {
    deserializeConversation,
    deserializeMessage,
    readArchivePayload,
    removeArchive,
    serializeConversation,
    serializeMessage,
    unbindConversation
} from '../utils/archive'
import { gzipDecode, gzipEncode } from '../utils/compression'
import {
    getFallbackBindingKeys,
    getLookupKeys,
    pickBindingKey
} from '../utils/conversation'
import {
    isMessageContentAudio,
    isMessageContentFileUrl,
    isMessageContentImageUrl,
    isMessageContentText,
    isMessageContentVideo
    // Don't change this line!!!!!!!!!!
} from 'koishi-plugin-chatluna/utils/langchain'
import { getMessageContent } from '../utils/message_content'
import { checkAdmin } from 'koishi-plugin-chatluna/utils/koishi'
import { ObjectLock } from 'koishi-plugin-chatluna/utils/lock'
import {
    ACLRecord,
    applyPresetLane,
    ArchiveRecord,
    BindingRecord,
    computeBaseBindingKey,
    ConversationResolution,
    ConstraintPermission,
    ConstraintRecord,
    ConversationCompressionRecord,
    ConversationListEntry,
    ConversationRecord,
    getBaseBindingKey,
    getPresetLane,
    MessageRecord,
    ResolveConversationOptions,
    ResolvedConstraint,
    ResolvedConversationContext,
    RouteMode
} from './conversation_types'
import {
    ArchiveManifest,
    ConversationArchivePayload,
    ListConversationsOptions
} from './types'

export class ConversationService {
    private readonly _bindingLocks = new Map<string, ObjectLock>()
    private readonly _titleLocks = new Map<string, ObjectLock>()

    constructor(
        private readonly ctx: Context,
        private readonly config: Config
    ) {}

    async getConversation(id: string) {
        return (
            await this.ctx.database.get('chatluna_conversation', { id })
        )[0] as ConversationRecord | undefined
    }

    async getBinding(bindingKey: string) {
        return (
            await this.ctx.database.get('chatluna_binding', { bindingKey })
        )[0] as BindingRecord | undefined
    }

    async getArchive(id: string) {
        return (await this.ctx.database.get('chatluna_archive', { id }))[0] as
            | ArchiveRecord
            | undefined
    }

    async getArchiveByConversationId(conversationId: string) {
        return (
            await this.ctx.database.get('chatluna_archive', { conversationId })
        )[0] as ArchiveRecord | undefined
    }

    async listConstraints() {
        return (
            (await this.ctx.database.get(
                'chatluna_constraint',
                {}
            )) as ConstraintRecord[]
        )
            .filter((c) => c.enabled !== false)
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    }

    async resolveConstraint(
        session: Session,
        options: ResolveConversationOptions = {}
    ): Promise<ResolvedConstraint> {
        let constraints = (await this.listConstraints()).filter((c) =>
            isConstraintMatched(c, session)
        )
        const routed = constraints.find((c) => c.routeMode != null)
        let routeMode = routed?.routeMode ?? this.getDefaultRouteMode(session)
        let baseKey = computeBaseBindingKey(
            session,
            routeMode,
            routed?.routeKey
        )
        let bindingKey =
            options.bindingKey == null
                ? applyPresetLane(baseKey, options.presetLane)
                : options.bindingKey.includes(':preset:')
                  ? options.bindingKey
                  : applyPresetLane(options.bindingKey, options.presetLane)

        if (options.bindingKey != null) {
            constraints = constraints.filter(
                (c) => !c.name.startsWith('managed:')
            )

            const managed =
                await this.getManagedConstraintByBindingKey(bindingKey)

            if (managed != null) {
                constraints.unshift(managed)
            }

            baseKey = getBaseBindingKey(bindingKey)
            routeMode = baseKey.startsWith('shared:')
                ? 'shared'
                : baseKey.startsWith('personal:')
                  ? 'personal'
                  : 'custom'
        }

        const activePresetLane = firstDefined(constraints, 'activePresetLane')
        const presetLane =
            options.presetLane ??
            (options.useRoutePresetLane ? activePresetLane : undefined)

        if (
            options.bindingKey == null ||
            !options.bindingKey.includes(':preset:')
        ) {
            bindingKey = applyPresetLane(baseKey, presetLane)
        }

        const lane = getPresetLane(bindingKey)

        return {
            routeMode,
            baseKey,
            bindingKey,
            constraints,
            activePresetLane,
            defaultModel:
                firstDefined(constraints, 'defaultModel') ??
                this.config.defaultModel,
            defaultPreset:
                lane ??
                firstDefined(constraints, 'defaultPreset') ??
                this.config.defaultPreset,
            defaultChatMode:
                firstDefined(constraints, 'defaultChatMode') ??
                this.config.defaultChatMode,
            fixedModel: firstDefined(constraints, 'fixedModel'),
            fixedPreset: firstDefined(constraints, 'fixedPreset'),
            fixedChatMode: firstDefined(constraints, 'fixedChatMode'),
            lockConversation: firstBoolean(
                constraints,
                'lockConversation',
                false
            ),
            allowNew: firstBoolean(constraints, 'allowNew', true),
            allowSwitch: firstBoolean(constraints, 'allowSwitch', true),
            allowArchive: firstBoolean(constraints, 'allowArchive', true),
            allowExport: firstBoolean(constraints, 'allowExport', true),
            manageMode: firstDefined(constraints, 'manageMode') ?? 'admin'
        }
    }

    private async resolveConversationContext(
        session: Session,
        options: ResolveConversationOptions = {}
    ): Promise<ResolvedConversationContext> {
        const constraint = await this.resolveConstraint(session, options)
        const matched =
            options.bindingKey == null
                ? await this.resolveBindingForKey(
                      session,
                      constraint.bindingKey
                  )
                : {
                      bindingKey: constraint.bindingKey,
                      binding: await this.getBinding(constraint.bindingKey)
                  }
        const binding = matched?.binding
        const bindingKey = matched?.bindingKey ?? constraint.bindingKey
        const conversation = options.conversationId
            ? await this.getConversation(options.conversationId)
            : binding?.activeConversationId
              ? await this.getConversation(binding.activeConversationId)
              : undefined
        const allowedConversation =
            conversation != null &&
            (await hasConversationPermission(
                this.ctx,
                session,
                conversation,
                'view',
                bindingKey
            ))
                ? conversation
                : null

        return {
            bindingKey,
            presetLane: getPresetLane(bindingKey),
            binding: binding ?? null,
            conversation: allowedConversation,
            effectiveModel:
                constraint.fixedModel ??
                allowedConversation?.model ??
                constraint.defaultModel ??
                this.config.defaultModel,
            effectivePreset:
                constraint.fixedPreset ??
                allowedConversation?.preset ??
                getPresetLane(bindingKey) ??
                constraint.defaultPreset ??
                this.config.defaultPreset,
            effectiveChatMode:
                constraint.fixedChatMode ??
                allowedConversation?.chatMode ??
                constraint.defaultChatMode ??
                this.config.defaultChatMode,
            constraint
        }
    }

    async resolveConversation(
        session: Session,
        options: ResolveConversationOptions = {}
    ): Promise<ConversationResolution> {
        const mode = options.mode ?? 'current'
        const resolved = await this.resolveConversationContext(session, options)
        const resolveTarget = async (conversation: ConversationRecord) => {
            const target = await this.resolveConversationContext(session, {
                ...options,
                bindingKey: conversation.bindingKey,
                conversationId: conversation.id,
                presetLane: getPresetLane(conversation.bindingKey),
                useRoutePresetLane: false
            })

            return {
                ...target,
                mode,
                conversation,
                conversationId: conversation.id
            }
        }

        if (mode === 'context' || mode === 'current') {
            return {
                ...resolved,
                mode,
                conversationId: resolved.conversation?.id ?? null
            }
        }

        if (mode === 'active') {
            let current = resolved

            if (
                current.constraint.lockConversation &&
                current.binding?.activeConversationId != null
            ) {
                const conversation = await this.getConversation(
                    current.binding.activeConversationId
                )

                if (
                    conversation != null &&
                    conversation.status !== 'deleted' &&
                    conversation.status !== 'broken' &&
                    (await hasConversationPermission(
                        this.ctx,
                        session,
                        conversation,
                        'view',
                        current.bindingKey
                    ))
                ) {
                    current = {
                        ...current,
                        conversation,
                        effectiveModel:
                            current.constraint.fixedModel ?? conversation.model,
                        effectivePreset:
                            current.constraint.fixedPreset ??
                            conversation.preset,
                        effectiveChatMode:
                            current.constraint.fixedChatMode ??
                            conversation.chatMode
                    }
                }
            }

            if (current.conversation != null) {
                if (current.conversation.status === 'archived') {
                    await assertManageAllowed(session, current.constraint)

                    if (!current.constraint.allowArchive) {
                        throw new Error(
                            'Conversation restore is disabled by constraint.'
                        )
                    }

                    const conversation = await this.restoreConversation(
                        session,
                        {
                            conversationId: current.conversation.id
                        }
                    )

                    return {
                        ...current,
                        mode,
                        conversation,
                        conversationId: conversation.id,
                        effectiveModel: conversation.model,
                        effectivePreset: conversation.preset,
                        effectiveChatMode: conversation.chatMode
                    }
                }

                return {
                    ...current,
                    mode,
                    conversationId: current.conversation.id
                }
            }

            if (!current.constraint.allowNew) {
                throw new Error(
                    'Conversation creation is disabled by constraint.'
                )
            }

            const conversation = await this.createConversation(session, {
                bindingKey: current.bindingKey,
                preset: current.effectivePreset,
                model: current.effectiveModel,
                chatMode: current.effectiveChatMode,
                title: current.presetLane ?? 'New Conversation'
            })

            return {
                ...current,
                mode,
                conversation,
                conversationId: conversation.id
            }
        }

        let conversation: ConversationRecord | null = null

        if (options.conversationId != null) {
            conversation =
                (await this.getConversation(options.conversationId)) ?? null

            if (conversation == null) {
                return {
                    ...resolved,
                    mode,
                    conversationId: options.conversationId,
                    conversation: null
                }
            }

            if (
                conversation.status === 'deleted' ||
                conversation.status === 'broken'
            ) {
                return {
                    ...resolved,
                    mode,
                    conversationId: options.conversationId,
                    conversation: null
                }
            }

            if (
                conversation.status === 'archived' &&
                !options.includeArchived &&
                mode !== 'target'
            ) {
                return {
                    ...resolved,
                    mode,
                    conversationId: options.conversationId,
                    conversation: null
                }
            }

            if (
                !(
                    options.allPresetLanes === true &&
                    getLookupKeys(
                        session,
                        resolved.constraint.bindingKey,
                        true
                    ).includes(getBaseBindingKey(conversation.bindingKey))
                ) &&
                !(await hasConversationPermission(
                    this.ctx,
                    session,
                    conversation,
                    options.permission ?? 'view',
                    resolved.bindingKey
                ))
            ) {
                throw new Error(
                    'Conversation does not belong to current route.'
                )
            }

            return resolveTarget(conversation)
        }

        const hasTarget = options.targetConversation != null
        const target = options.targetConversation?.trim()

        if (hasTarget && (target == null || target.length === 0)) {
            return {
                ...resolved,
                mode,
                conversation: null,
                conversationId: null
            }
        }

        if (!hasTarget) {
            return {
                ...resolved,
                mode,
                conversationId: resolved.conversation?.id ?? null
            }
        }

        const entries = await this.listConversationEntries(session, {
            presetLane: options.presetLane,
            allPresetLanes: options.allPresetLanes,
            includeArchived: options.includeArchived
        })
        const conversations = entries.map((item) => item.conversation)

        conversation = conversations.find((c) => c.id === target) ?? null
        if (conversation != null) {
            return resolveTarget(conversation)
        }

        if (/^\d+$/.test(target)) {
            const seq = Number(target)
            const bySeq = entries
                .filter((item) => item.displaySeq === seq)
                .map((item) => item.conversation)
            if (bySeq.length === 1) {
                return resolveTarget(bySeq[0])
            }

            if (bySeq.length > 1) {
                throw new Error('Conversation target is ambiguous.')
            }
        }

        const normalized = target.toLocaleLowerCase()
        const exactTitle = conversations.filter(
            (c) => c.title.toLocaleLowerCase() === normalized
        )
        if (exactTitle.length === 1) {
            return resolveTarget(exactTitle[0])
        }

        if (exactTitle.length > 1) {
            throw new Error('Conversation target is ambiguous.')
        }

        const partialMatches = conversations.filter((c) =>
            c.title.toLocaleLowerCase().includes(normalized)
        )

        if (partialMatches.length === 1) {
            return resolveTarget(partialMatches[0])
        }

        if (partialMatches.length > 1) {
            throw new Error('Conversation target is ambiguous.')
        }

        const globalMatches = await this.findAccessibleConversations(session, {
            ...options,
            bindingKey: resolved.bindingKey,
            query: normalized,
            exactId: target
        })

        conversation = globalMatches.find((c) => c.id === target) ?? null
        if (conversation != null) {
            return resolveTarget(conversation)
        }

        const globalExactTitle = globalMatches.filter(
            (c) => c.title.toLocaleLowerCase() === normalized
        )
        if (globalExactTitle.length === 1) {
            return resolveTarget(globalExactTitle[0])
        }

        if (globalExactTitle.length > 1) {
            throw new Error('Conversation target is ambiguous.')
        }

        const globalPartialMatches = globalMatches.filter((c) =>
            c.title.toLocaleLowerCase().includes(normalized)
        )

        if (globalPartialMatches.length === 1) {
            return resolveTarget(globalPartialMatches[0])
        }

        if (globalPartialMatches.length > 1) {
            throw new Error('Conversation target is ambiguous.')
        }

        if (!options.includeArchived) {
            const archivedEntries = (
                await this.listConversationEntries(session, {
                    presetLane: options.presetLane,
                    allPresetLanes: options.allPresetLanes,
                    includeArchived: true
                })
            ).filter((item) => item.conversation.status === 'archived')
            const archivedConversations = archivedEntries.map(
                (item) => item.conversation
            )

            conversation =
                archivedConversations.find((c) => c.id === target) ?? null
            if (conversation != null) {
                return resolveTarget(conversation)
            }

            const archivedExactTitle = archivedConversations.filter(
                (c) => c.title.toLocaleLowerCase() === normalized
            )
            if (archivedExactTitle.length === 1) {
                return resolveTarget(archivedExactTitle[0])
            }

            if (archivedExactTitle.length > 1) {
                throw new Error('Conversation target is ambiguous.')
            }

            const archivedPartialMatches = archivedConversations.filter((c) =>
                c.title.toLocaleLowerCase().includes(normalized)
            )

            if (archivedPartialMatches.length === 1) {
                return resolveTarget(archivedPartialMatches[0])
            }

            if (archivedPartialMatches.length > 1) {
                throw new Error('Conversation target is ambiguous.')
            }

            const globalArchivedMatches = (
                await this.findAccessibleConversations(session, {
                    ...options,
                    bindingKey: resolved.bindingKey,
                    includeArchived: true,
                    query: normalized,
                    exactId: target
                })
            ).filter((c) => c.status === 'archived')

            conversation =
                globalArchivedMatches.find((c) => c.id === target) ?? null
            if (conversation != null) {
                return resolveTarget(conversation)
            }

            const globalArchivedExactTitle = globalArchivedMatches.filter(
                (c) => c.title.toLocaleLowerCase() === normalized
            )
            if (globalArchivedExactTitle.length === 1) {
                return resolveTarget(globalArchivedExactTitle[0])
            }

            if (globalArchivedExactTitle.length > 1) {
                throw new Error('Conversation target is ambiguous.')
            }

            const globalArchivedPartialMatches = globalArchivedMatches.filter(
                (c) => c.title.toLocaleLowerCase().includes(normalized)
            )

            if (globalArchivedPartialMatches.length === 1) {
                return resolveTarget(globalArchivedPartialMatches[0])
            }

            if (globalArchivedPartialMatches.length > 1) {
                throw new Error('Conversation target is ambiguous.')
            }
        }

        return {
            ...resolved,
            mode,
            conversation: null,
            conversationId: null
        }
    }

    private async resolveBindingForKey(session: Session, bindingKey: string) {
        const binding = await this.getBinding(bindingKey)

        if (binding != null) {
            return {
                bindingKey,
                binding
            }
        }

        for (const key of getFallbackBindingKeys(session, bindingKey)) {
            const legacyBinding = await this.getBinding(key)
            if (legacyBinding != null) {
                return {
                    bindingKey: key,
                    binding: legacyBinding
                }
            }
        }

        return null
    }

    async ensureActiveConversation(
        session: Session,
        options: ResolveConversationOptions = {}
    ): Promise<ConversationResolution & { conversation: ConversationRecord }> {
        const resolved = await this.resolveConversation(session, {
            ...options,
            mode: 'active'
        })

        return resolved as ConversationResolution & {
            conversation: ConversationRecord
        }
    }

    async createConversation(
        session: Session,
        options: {
            bindingKey: string
            title: string
            model: string
            preset: string
            chatMode: string
        }
    ) {
        return runLock(this._bindingLocks, options.bindingKey, async () => {
            const now = new Date()
            const conversation: ConversationRecord = {
                id: randomUUID(),
                seq: await this.allocateConversationSeq(options.bindingKey),
                bindingKey: options.bindingKey,
                title: options.title,
                model: options.model,
                preset: options.preset,
                chatMode: options.chatMode,
                createdBy: session.userId,
                createdAt: now,
                updatedAt: now,
                lastChatAt: now,
                status: 'active',
                latestMessageId: null,
                additional_kwargs: null,
                compression: null,
                archivedAt: null,
                archiveId: null,
                legacyRoomId: null,
                legacyMeta: null,
                autoTitle: true
            }

            await this.ctx.root.parallel(
                'chatluna/before-conversation-create',
                {
                    conversation,
                    bindingKey: options.bindingKey
                }
            )
            await this.ctx.database.create(
                'chatluna_conversation',
                conversation
            )
            await this.setActiveConversation(
                options.bindingKey,
                conversation.id
            )
            await this.ctx.root.parallel('chatluna/after-conversation-create', {
                conversation,
                bindingKey: options.bindingKey
            })
            return conversation
        })
    }

    async setActiveConversation(bindingKey: string, conversationId: string) {
        const current = await this.getBinding(bindingKey)
        const prev = current?.activeConversationId
        const payload: BindingRecord = {
            bindingKey,
            activeConversationId: conversationId,
            lastConversationId:
                prev != null && prev !== conversationId
                    ? prev
                    : (current?.lastConversationId ?? null),
            updatedAt: new Date()
        }

        await this.ctx.database.upsert('chatluna_binding', [payload])
        return payload
    }

    async touchConversation(
        conversationId: string,
        patch: Partial<ConversationRecord> = {}
    ) {
        const current = await this.getConversation(conversationId)
        if (current == null) {
            return undefined
        }

        const updated = {
            ...current,
            updatedAt: patch.updatedAt ?? new Date()
        } as ConversationRecord

        for (const key in patch) {
            const value = patch[key as keyof ConversationRecord]
            if (value !== undefined) {
                updated[key as keyof ConversationRecord] = value as never
            }
        }

        await this.ctx.database.upsert('chatluna_conversation', [updated])
        return updated
    }

    async claimAutoTitle(conversationId: string) {
        return runLock(this._titleLocks, conversationId, async () => {
            const conversation = await this.getConversation(conversationId)
            if (conversation == null || !conversation.autoTitle) {
                return false
            }

            await this.touchConversation(conversationId, {
                autoTitle: false
            })
            return true
        })
    }

    async listConversations(
        session: Session,
        options: ListConversationsOptions = {}
    ) {
        const resolved = await this.resolveConversation(session, {
            ...options,
            mode: 'context'
        })
        const keys = getLookupKeys(
            session,
            resolved.constraint.bindingKey,
            options.allPresetLanes
        )
        const conversations = options.allPresetLanes
            ? (
                  (await this.ctx.database.get(
                      'chatluna_conversation',
                      {}
                  )) as ConversationRecord[]
              ).filter((conversation) => {
                  return keys.some((key) => {
                      return (
                          conversation.bindingKey === key ||
                          conversation.bindingKey.startsWith(key + ':preset:')
                      )
                  })
              })
            : ((await this.ctx.database.get('chatluna_conversation', {
                  bindingKey: keys.length === 1 ? keys[0] : { $in: keys }
              })) as ConversationRecord[])

        return conversations
            .filter(
                (conversation) =>
                    conversation.status !== 'deleted' &&
                    conversation.status !== 'broken' &&
                    (options.includeArchived ||
                        conversation.status !== 'archived')
            )
            .sort((a, b) => {
                const left = a.lastChatAt ?? a.updatedAt
                const right = b.lastChatAt ?? b.updatedAt
                return right.getTime() - left.getTime()
            })
    }

    async listConversationEntries(
        session: Session,
        options: ListConversationsOptions = {}
    ): Promise<ConversationListEntry[]> {
        const conversations = await this.listConversations(session, options)
        return conversations.map((conversation, idx) => ({
            conversation,
            displaySeq: idx + 1
        }))
    }

    private async getTarget(
        session: Session,
        options: ResolveConversationOptions,
        permission: ConstraintPermission,
        includeArchived = false
    ) {
        const resolved = await this.resolveConversation(session, {
            ...options,
            includeArchived,
            permission,
            mode: 'target'
        })
        await assertManageAllowed(session, resolved.constraint)

        const conversation = resolved.conversation
        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        const managed = await this.getManagedConstraintByBindingKey(
            conversation.bindingKey
        )

        if (managed != null) {
            await assertManageAllowed(session, managed)
        }

        return {
            resolved,
            conversation,
            managed
        }
    }

    async switchConversation(
        session: Session,
        options: ResolveConversationOptions
    ) {
        const { resolved, conversation, managed } = await this.getTarget(
            session,
            options,
            'manage'
        )
        const current = options.allPresetLanes
            ? await this.resolveConversation(session, {
                  useRoutePresetLane: true,
                  mode: 'context'
              })
            : resolved

        if (managed?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation switch is locked by constraint.')
        }

        if (!(managed?.allowSwitch ?? resolved.constraint.allowSwitch)) {
            throw new Error('Conversation switch is disabled by constraint.')
        }

        const previousConversation = current.binding?.activeConversationId
            ? await this.getConversation(current.binding.activeConversationId)
            : null
        const sameRoute =
            options.allPresetLanes &&
            getLookupKeys(
                session,
                resolved.constraint.bindingKey,
                true
            ).includes(getBaseBindingKey(conversation.bindingKey))
        const bindingKey = pickBindingKey(resolved, conversation)

        if (sameRoute) {
            await this.updateManagedConstraint(session, {
                activePresetLane: getPresetLane(conversation.bindingKey) ?? null
            })
        }

        await this.ctx.root.parallel('chatluna/before-conversation-switch', {
            bindingKey,
            conversation,
            previousConversation
        })
        await this.setActiveConversation(bindingKey, conversation.id)
        await this.ctx.root.parallel('chatluna/after-conversation-switch', {
            bindingKey,
            conversation,
            previousConversation
        })

        return conversation
    }

    async reopenConversation(
        session: Session,
        options: ResolveConversationOptions
    ) {
        const { resolved, conversation, managed } = await this.getTarget(
            session,
            options,
            'manage',
            true
        )

        if (managed?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation restore is locked by constraint.')
        }

        if (conversation.status !== 'archived') {
            if (!(managed?.allowSwitch ?? resolved.constraint.allowSwitch)) {
                throw new Error(
                    'Conversation switch is disabled by constraint.'
                )
            }

            if (
                options.allPresetLanes &&
                getLookupKeys(
                    session,
                    resolved.constraint.bindingKey,
                    true
                ).includes(getBaseBindingKey(conversation.bindingKey))
            ) {
                await this.updateManagedConstraint(session, {
                    activePresetLane:
                        getPresetLane(conversation.bindingKey) ?? null
                })
            }

            await this.setActiveConversation(
                pickBindingKey(resolved, conversation),
                conversation.id
            )
            return conversation
        }

        return this.restoreConversation(session, {
            ...options,
            conversationId: conversation.id
        })
    }

    async listMessages(conversationId: string) {
        const [conversation, messages] = await Promise.all([
            this.getConversation(conversationId),
            this.ctx.database.get('chatluna_message', {
                conversationId
            })
        ])
        const records = messages as MessageRecord[]

        if (records.length < 2) {
            return records
        }

        if (conversation?.latestMessageId == null) {
            return records.sort((a, b) => {
                const left = a.createdAt?.getTime() ?? 0
                const right = b.createdAt?.getTime() ?? 0
                return left - right
            })
        }

        const map = new Map(records.map((message) => [message.id, message]))
        const ordered: MessageRecord[] = []
        const seen = new Set<string>()
        let currentId: string | null | undefined = conversation.latestMessageId

        while (currentId != null) {
            if (seen.has(currentId)) {
                break
            }

            const message = map.get(currentId)
            if (message == null) {
                break
            }

            ordered.unshift(message)
            seen.add(currentId)
            currentId = message.parentId
        }

        if (ordered.length === records.length) {
            return ordered
        }

        return records.sort((a, b) => {
            const left = a.createdAt?.getTime() ?? 0
            const right = b.createdAt?.getTime() ?? 0
            return left - right
        })
    }

    async listAcl(conversationId: string) {
        return (await this.ctx.database.get('chatluna_acl', {
            conversationId
        })) as ACLRecord[]
    }

    async upsertAcl(
        conversationId: string,
        records: Omit<ACLRecord, 'conversationId'>[]
    ) {
        if (records.length === 0) {
            return [] as ACLRecord[]
        }

        await this.ctx.database.upsert(
            'chatluna_acl',
            records.map((record) => ({
                conversationId,
                ...record
            }))
        )

        return this.listAcl(conversationId)
    }

    async replaceAcl(
        conversationId: string,
        records: Omit<ACLRecord, 'conversationId'>[]
    ) {
        await this.ctx.database.remove('chatluna_acl', {
            conversationId
        })

        return this.upsertAcl(conversationId, records)
    }

    async removeAcl(
        conversationId: string,
        records?: Partial<Omit<ACLRecord, 'conversationId'>>[]
    ) {
        if (records == null || records.length === 0) {
            await this.ctx.database.remove('chatluna_acl', {
                conversationId
            })
            return [] as ACLRecord[]
        }

        const current = await this.listAcl(conversationId)
        const removed = current.filter((item) =>
            records.some(
                (record) =>
                    (record.principalType == null ||
                        record.principalType === item.principalType) &&
                    (record.principalId == null ||
                        record.principalId === item.principalId) &&
                    (record.permission == null ||
                        record.permission === item.permission)
            )
        )

        for (const item of removed) {
            await this.ctx.database.remove('chatluna_acl', item)
        }

        return this.listAcl(conversationId)
    }

    async exportConversation(
        session: Session,
        options: ResolveConversationOptions & {
            outputPath?: string
        } = {}
    ) {
        const { resolved, conversation, managed } = await this.getTarget(
            session,
            options,
            'view',
            true
        )

        if (!(managed?.allowExport ?? resolved.constraint.allowExport)) {
            throw new Error('Conversation export is disabled by constraint.')
        }

        const markdown = await this.exportMarkdown(conversation)
        const outputPath =
            options.outputPath ??
            path.join(
                await this.ensureDataDir('export'),
                `${conversation.id}-${Date.now()}.md`
            )

        await fs.writeFile(outputPath, markdown, 'utf8')

        return {
            conversation,
            path: outputPath,
            size: Buffer.byteLength(markdown)
        }
    }

    async archiveConversation(
        session: Session,
        options: ResolveConversationOptions = {}
    ) {
        const { conversation, managed, resolved } = await this.getTarget(
            session,
            options,
            'manage'
        )

        if (managed?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation archive is locked by constraint.')
        }

        if (!(managed?.allowArchive ?? resolved.constraint.allowArchive)) {
            throw new Error('Conversation archive is disabled by constraint.')
        }

        return this.archiveConversationById(conversation.id)
    }

    async archiveConversationById(
        conversationId: string,
        inactiveBefore?: Date
    ) {
        const conversation = await this.getConversation(conversationId)
        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        return this.ctx.chatluna.conversationRuntime.withConversationSync(
            conversation,
            async () => {
                const current = await this.getConversation(conversationId)
                if (current == null) {
                    throw new Error('Conversation not found.')
                }

                if (
                    inactiveBefore != null &&
                    (current.status !== 'active' ||
                        current.updatedAt.getTime() >= inactiveBefore.getTime())
                ) {
                    return null
                }

                if (
                    current.status === 'archived' &&
                    current.archiveId != null
                ) {
                    const archive = await this.getArchive(current.archiveId)
                    if (archive != null) {
                        return {
                            conversation: current,
                            archive,
                            path: archive.path
                        }
                    }
                }

                await this.ctx.root.parallel(
                    'chatluna/before-conversation-archive',
                    {
                        conversation: current
                    }
                )

                const archiveDir = await this.ensureDataDir(
                    path.join('archive', current.id)
                )
                const messages = await this.listMessages(current.id)
                const payload: ConversationArchivePayload = {
                    formatVersion: 1,
                    exportedAt: new Date().toISOString(),
                    conversation: serializeConversation(current),
                    messages: messages.map(serializeMessage)
                }
                const messageLines = payload.messages
                    .map((message) => JSON.stringify(message))
                    .join('\n')
                const messageBuffer = await gzipEncode(messageLines)
                const checksum = createHash('sha256')
                    .update(messageBuffer)
                    .digest('hex')

                await fs.writeFile(
                    path.join(archiveDir, 'conversation.json'),
                    JSON.stringify(payload.conversation, null, 2),
                    'utf8'
                )
                await fs.writeFile(
                    path.join(archiveDir, 'messages.jsonl.gz'),
                    messageBuffer
                )

                const now = new Date()
                const manifest: ArchiveManifest = {
                    format: 'chatluna-archive',
                    formatVersion: payload.formatVersion,
                    conversationId: current.id,
                    messageCount: payload.messages.length,
                    checksum,
                    size: messageBuffer.byteLength,
                    createdAt: now.toISOString()
                }
                await fs.writeFile(
                    path.join(archiveDir, 'manifest.json'),
                    JSON.stringify(manifest, null, 2),
                    'utf8'
                )

                const archive: ArchiveRecord = {
                    id: randomUUID(),
                    conversationId: manifest.conversationId,
                    path: archiveDir,
                    formatVersion: manifest.formatVersion,
                    messageCount: manifest.messageCount,
                    checksum: manifest.checksum,
                    size: manifest.size,
                    state: 'ready',
                    createdAt: now,
                    restoredAt: null
                }

                await this.ctx.database.upsert('chatluna_archive', [archive])
                await this.touchConversation(current.id, {
                    status: 'archived',
                    archivedAt: now,
                    archiveId: archive.id
                })
                await unbindConversation(this.ctx, current.id)
                await this.ctx.database.remove('chatluna_message', {
                    conversationId: current.id
                })

                const updatedConversation = await this.getConversation(
                    current.id
                )
                await this.ctx.chatluna.conversationRuntime.clearConversationInterfaceLocked(
                    updatedConversation ?? current
                )
                await this.ctx.root.parallel(
                    'chatluna/after-conversation-archive',
                    {
                        conversation: updatedConversation ?? current,
                        archive,
                        path: archiveDir
                    }
                )

                return {
                    conversation: updatedConversation ?? current,
                    archive,
                    path: archiveDir
                }
            }
        )
    }

    async restoreConversation(
        session: Session,
        options: ResolveConversationOptions & {
            archiveId?: string
        } = {}
    ) {
        const { resolved, conversation, managed } = await this.getTarget(
            session,
            options,
            'manage',
            true
        )

        const archive = options.archiveId
            ? await this.getArchive(options.archiveId)
            : conversation.archiveId
              ? await this.getArchive(conversation.archiveId)
              : await this.getArchiveByConversationId(conversation.id)

        if (archive == null) {
            throw new Error('Archive not found.')
        }

        if (archive.conversationId !== conversation.id) {
            throw new Error('Archive does not belong to conversation.')
        }

        if (managed?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation restore is locked by constraint.')
        }

        if (!(managed?.allowArchive ?? resolved.constraint.allowArchive)) {
            throw new Error('Conversation restore is disabled by constraint.')
        }

        return this.ctx.chatluna.conversationRuntime.withConversationSync(
            conversation,
            async () => {
                const current = await this.getConversation(conversation.id)
                if (current == null) {
                    throw new Error('Conversation not found.')
                }

                await this.ctx.root.parallel(
                    'chatluna/before-conversation-restore',
                    {
                        conversation: current,
                        archive
                    }
                )

                await this.ctx.database.upsert('chatluna_archive', [
                    {
                        ...archive,
                        state: 'restoring'
                    }
                ])

                try {
                    const payload = await readArchivePayload(archive.path)
                    const restoredConversation = deserializeConversation(
                        payload.conversation
                    )
                    const restoredMessages = payload.messages.map(
                        (message) => ({
                            ...deserializeMessage(message),
                            conversationId: current.id
                        })
                    )

                    await this.ctx.database.remove('chatluna_message', {
                        conversationId: current.id
                    })

                    if (restoredMessages.length > 0) {
                        await this.ctx.database.upsert(
                            'chatluna_message',
                            restoredMessages
                        )
                    }

                    await this.ctx.database.upsert('chatluna_conversation', [
                        {
                            ...current,
                            ...restoredConversation,
                            id: current.id,
                            status: 'active',
                            archivedAt: null,
                            archiveId: null,
                            updatedAt: new Date()
                        }
                    ])
                    await this.ctx.database.upsert('chatluna_archive', [
                        {
                            ...archive,
                            state: 'ready',
                            restoredAt: new Date()
                        }
                    ])

                    const updatedConversation = await this.getConversation(
                        current.id
                    )
                    if (updatedConversation == null) {
                        throw new Error('Conversation restore failed.')
                    }

                    if (
                        options.allPresetLanes &&
                        getLookupKeys(
                            session,
                            resolved.constraint.bindingKey,
                            true
                        ).includes(
                            getBaseBindingKey(updatedConversation.bindingKey)
                        )
                    ) {
                        await this.updateManagedConstraint(session, {
                            activePresetLane:
                                getPresetLane(updatedConversation.bindingKey) ??
                                null
                        })
                    }

                    await this.setActiveConversation(
                        updatedConversation.bindingKey,
                        updatedConversation.id
                    )
                    await this.ctx.chatluna.conversationRuntime.clearConversationInterfaceLocked(
                        updatedConversation
                    )
                    await this.ctx.root.parallel(
                        'chatluna/after-conversation-restore',
                        {
                            conversation: updatedConversation,
                            archive
                        }
                    )

                    return updatedConversation
                } catch (error) {
                    await this.ctx.database.upsert('chatluna_archive', [
                        {
                            ...archive,
                            state: 'broken'
                        }
                    ])
                    throw error
                }
            }
        )
    }

    async exportMarkdown(conversation: ConversationRecord) {
        let messages: MessageRecord[]

        if (conversation.status === 'archived' && conversation.archiveId) {
            const archive = await this.getArchive(conversation.archiveId)
            if (archive != null) {
                const payload = await readArchivePayload(archive.path)
                messages = payload.messages.map((message) => ({
                    ...deserializeMessage(message),
                    conversationId: conversation.id
                }))
            } else {
                messages = await this.listMessages(conversation.id)
            }
        } else {
            messages = await this.listMessages(conversation.id)
        }

        return [
            `# ${conversation.title}`,
            '',
            `- ID: ${conversation.id}`,
            `- Seq: ${conversation.seq ?? '-'}`,
            `- Route: ${conversation.bindingKey}`,
            `- Model: ${conversation.model}`,
            `- Preset: ${conversation.preset}`,
            `- Chat Mode: ${conversation.chatMode}`,
            `- Status: ${conversation.status}`,
            `- Updated At: ${conversation.updatedAt.toISOString()}`,
            '',
            ...(
                await Promise.all(
                    messages.map(async (message) => [
                        `## ${message.role} ${message.name ? `(${message.name})` : ''}`.trim(),
                        '',
                        await formatMessage(message),
                        ''
                    ])
                )
            ).flat()
        ].join('\n')
    }

    async renameConversation(
        session: Session,
        options: ResolveConversationOptions & {
            title: string
        }
    ) {
        const { resolved, conversation, managed } = await this.getTarget(
            session,
            options,
            'manage'
        )
        if (managed?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation rename is locked by constraint.')
        }

        const updated = await this.touchConversation(conversation.id, {
            title: options.title.trim(),
            autoTitle: false
        })
        return updated!
    }

    async deleteConversation(
        session: Session,
        options: ResolveConversationOptions = {}
    ) {
        const { resolved, conversation, managed } = await this.getTarget(
            session,
            options,
            'manage',
            true
        )
        if (managed?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation delete is locked by constraint.')
        }

        return this.ctx.chatluna.conversationRuntime.withConversationSync(
            conversation,
            async () => {
                const current = await this.getConversation(conversation.id)
                if (current == null) {
                    throw new Error('Conversation not found.')
                }

                await this.ctx.root.parallel(
                    'chatluna/before-conversation-delete',
                    {
                        conversation: current
                    }
                )

                await removeArchive(this.ctx, current.archiveId)

                const updated = await this.touchConversation(current.id, {
                    status: 'deleted',
                    archivedAt: null,
                    archiveId: null
                })
                await unbindConversation(this.ctx, current.id)
                await this.ctx.database.remove('chatluna_message', {
                    conversationId: current.id
                })
                await this.removeAcl(current.id)
                await this.ctx.chatluna.conversationRuntime.clearConversationInterfaceLocked(
                    updated ?? current
                )
                await this.ctx.root.parallel(
                    'chatluna/after-conversation-delete',
                    {
                        conversation: updated ?? current
                    }
                )
                return updated ?? current
            }
        )
    }

    async updateConversationUsage(
        session: Session,
        options: ResolveConversationOptions & {
            model?: string
            preset?: string
            chatMode?: string
        }
    ) {
        const resolved = await this.resolveConversation(session, {
            ...options,
            mode: 'context'
        })
        await assertManageAllowed(session, resolved.constraint)

        const conversation =
            options.conversationId == null
                ? (
                      await this.resolveConversation(session, {
                          ...options,
                          mode: 'active'
                      })
                  ).conversation
                : (
                      await this.resolveConversation(session, {
                          ...options,
                          permission: 'manage',
                          mode: 'target'
                      })
                  ).conversation

        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        const target = await this.getManagedConstraintByBindingKey(
            conversation.bindingKey
        )

        if (target != null) {
            await assertManageAllowed(session, target)
        }

        for (const [key, fixedKey, label] of [
            ['model', 'fixedModel', 'Model'],
            ['preset', 'fixedPreset', 'Preset'],
            ['chatMode', 'fixedChatMode', 'Chat mode']
        ] as const) {
            const fixed = target?.[fixedKey] ?? resolved.constraint[fixedKey]

            if (options[key] != null && fixed != null) {
                throw new Error(`${label} is fixed to ${fixed}.`)
            }
        }

        if (target?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation update is locked by constraint.')
        }

        const updated = await this.touchConversation(conversation.id, {
            model: options.model,
            preset: options.preset,
            chatMode: options.chatMode
        })

        if (updated == null) {
            throw new Error('Conversation not found.')
        }

        await this.ctx.chatluna.conversationRuntime.clearConversationInterface(
            updated
        )
        return updated
    }

    async recordCompression(
        conversationId: string,
        result: {
            compressed: boolean
            inputTokens: number
            outputTokens: number
            reducedTokens: number
            reducedPercent: number
            originalMessageCount: number
            remainingMessageCount: number
        }
    ) {
        const conversation = await this.getConversation(conversationId)
        if (!result.compressed) {
            return conversation
        }

        if (conversation == null) {
            return undefined
        }

        const current = JSON.parse(
            conversation.compression ?? 'null'
        ) as ConversationCompressionRecord

        const summaryMessage = (
            (await this.ctx.database.get(
                'chatluna_message',
                {
                    conversationId,
                    name: 'infinite_context'
                },
                {
                    limit: 1,
                    sort: {
                        createdAt: 'desc'
                    }
                }
            )) as MessageRecord[]
        )[0]
        const summary =
            summaryMessage == null ? undefined : await readText(summaryMessage)

        const updated = await this.touchConversation(conversationId, {
            compression: JSON.stringify({
                ...current,
                count: (current?.count ?? 0) + 1,
                compressedAt: new Date().toISOString(),
                summary: summary ?? current?.summary,
                originalMessageCount: result.originalMessageCount,
                remainingMessageCount: result.remainingMessageCount,
                tokenUsage: result.outputTokens,
                inputTokens: result.inputTokens,
                outputTokens: result.outputTokens,
                reducedTokens: result.reducedTokens,
                reducedPercent: result.reducedPercent
            } satisfies ConversationCompressionRecord)
        })

        if (updated != null) {
            await this.ctx.root.parallel('chatluna/conversation-compressed', {
                conversation: updated,
                result
            })
        }

        return updated
    }

    async getManagedConstraint(session: Session) {
        const route = session.isDirect
            ? `direct:${session.userId}`
            : `guild:${session.guildId ?? session.channelId ?? 'unknown'}`
        const name = `managed:${session.platform}:${session.selfId}:${route}`
        const matched = await this.ctx.database.get('chatluna_constraint', {
            name
        })
        return matched[0] as ConstraintRecord | undefined
    }

    async getManagedConstraintByBindingKey(bindingKey: string) {
        const target = bindingKey.includes(':preset:')
            ? bindingKey.slice(0, bindingKey.indexOf(':preset:'))
            : bindingKey
        const parts = target.split(':')

        let name: string | undefined

        if (parts[0] === 'shared' && parts.length >= 4) {
            name = `managed:${parts[1]}:${parts[2]}:guild:${parts[3]}`
        } else if (
            parts[0] === 'personal' &&
            parts.length >= 5 &&
            parts[3] === 'direct'
        ) {
            name = `managed:${parts[1]}:${parts[2]}:direct:${parts[4]}`
        } else if (parts[0] === 'personal' && parts.length >= 5) {
            name = `managed:${parts[1]}:${parts[2]}:guild:${parts[3]}`
        }

        if (name == null) {
            return undefined
        }

        return (
            await this.ctx.database.get('chatluna_constraint', {
                name
            })
        )[0] as ConstraintRecord | undefined
    }

    async updateManagedConstraint(
        session: Session,
        patch: Partial<ConstraintRecord>
    ) {
        const current = await this.getManagedConstraint(session)
        const now = new Date()
        const route = session.isDirect
            ? `direct:${session.userId}`
            : `guild:${session.guildId ?? session.channelId ?? 'unknown'}`
        const record: ConstraintRecord = {
            id: current?.id,
            name: `managed:${session.platform}:${session.selfId}:${route}`,
            enabled: true,
            priority: 1000,
            createdBy: session.userId,
            createdAt: now,
            platform: session.platform,
            selfId: session.selfId,
            guildId: session.isDirect
                ? null
                : (session.guildId ?? session.channelId ?? null),
            channelId: null,
            direct: session.isDirect,
            users: session.isDirect ? JSON.stringify([session.userId]) : null,
            excludeUsers: null,
            routeMode: null,
            routeKey: null,
            activePresetLane: null,
            defaultModel: null,
            defaultPreset: null,
            defaultChatMode: null,
            fixedModel: null,
            fixedPreset: null,
            fixedChatMode: null,
            lockConversation: null,
            allowNew: null,
            allowSwitch: null,
            allowArchive: null,
            allowExport: null,
            manageMode: 'admin',
            ...current,
            ...patch,
            updatedAt: now
        }

        await this.ctx.database.upsert('chatluna_constraint', [record])
        return (await this.getManagedConstraint(session)) ?? record
    }

    private getDefaultRouteMode(session: Session): RouteMode {
        if (session.isDirect) {
            return 'personal'
        }

        return this.config.defaultGroupRouteMode ?? 'shared'
    }

    private async allocateConversationSeq(bindingKey: string) {
        const [latest] = (await this.ctx.database.get(
            'chatluna_conversation',
            { bindingKey },
            { sort: { seq: 'desc' }, limit: 1 }
        )) as ConversationRecord[]
        return (latest?.seq ?? 0) + 1
    }

    private async findAccessibleConversations(
        session: Session,
        options: ResolveConversationOptions & {
            bindingKey: string
            query: string
            exactId: string
            seq?: number
        }
    ) {
        const required = options.permission ?? 'view'
        const matched = (conversation: ConversationRecord) => {
            if (
                conversation.bindingKey === options.bindingKey ||
                conversation.status === 'deleted' ||
                conversation.status === 'broken' ||
                (!options.includeArchived && conversation.status === 'archived')
            ) {
                return false
            }

            const title = conversation.title.toLocaleLowerCase()
            return (
                conversation.id === options.exactId ||
                (options.seq != null && conversation.seq === options.seq) ||
                title === options.query ||
                title.includes(options.query)
            )
        }

        if (await checkAdmin(session)) {
            if (options.exactId.length > 0) {
                const exact = await this.getConversation(options.exactId)
                if (exact != null && matched(exact)) {
                    return [exact]
                }
            }

            if (options.seq != null) {
                const conversations = (await this.ctx.database.get(
                    'chatluna_conversation',
                    {
                        seq: options.seq
                    }
                )) as ConversationRecord[]
                return conversations.filter(matched)
            }

            const conversations = (await this.ctx.database.get(
                'chatluna_conversation',
                {}
            )) as ConversationRecord[]
            return conversations.filter(matched)
        }

        const acl = [
            ...((await this.ctx.database.get('chatluna_acl', {
                principalType: 'user',
                principalId: session.userId,
                permission: 'manage'
            })) as ACLRecord[])
        ]

        if (required === 'view') {
            acl.push(
                ...((await this.ctx.database.get('chatluna_acl', {
                    principalType: 'user',
                    principalId: session.userId,
                    permission: 'view'
                })) as ACLRecord[])
            )
        }

        const guildId = session.guildId ?? session.channelId

        if (guildId != null) {
            acl.push(
                ...((await this.ctx.database.get('chatluna_acl', {
                    principalType: 'guild',
                    principalId: guildId,
                    permission: 'manage'
                })) as ACLRecord[])
            )

            if (required === 'view') {
                acl.push(
                    ...((await this.ctx.database.get('chatluna_acl', {
                        principalType: 'guild',
                        principalId: guildId,
                        permission: 'view'
                    })) as ACLRecord[])
                )
            }
        }

        const conversationIds = Array.from(
            new Set(acl.map((item) => item.conversationId))
        )

        const matches: ConversationRecord[] = []

        for (let i = 0; i < conversationIds.length; i += 200) {
            const ids = conversationIds.slice(i, i + 200)
            const conversations = (await this.ctx.database.get(
                'chatluna_conversation',
                {
                    id: {
                        $in: ids
                    }
                }
            )) as ConversationRecord[]

            matches.push(...conversations.filter(matched))
        }

        return matches
    }

    private async ensureDataDir(name: string) {
        const target = path.resolve(this.ctx.baseDir, 'data/chatluna', name)
        await fs.mkdir(target, { recursive: true })
        return target
    }
}

function isConstraintMatched(constraint: ConstraintRecord, session: Session) {
    if (
        constraint.platform != null &&
        constraint.platform !== session.platform
    ) {
        return false
    }
    if (constraint.selfId != null && constraint.selfId !== session.selfId) {
        return false
    }
    if (constraint.guildId != null && constraint.guildId !== session.guildId) {
        return false
    }
    if (
        constraint.channelId != null &&
        constraint.channelId !== session.channelId
    ) {
        return false
    }
    if (constraint.direct != null && constraint.direct !== session.isDirect) {
        return false
    }

    const users =
        constraint.users === null ? null : JSON.parse(constraint.users)
    if (users != null && !users.includes(session.userId)) {
        return false
    }

    const excludeUsers =
        constraint.excludeUsers === null
            ? null
            : JSON.parse(constraint.excludeUsers)
    if (excludeUsers != null && excludeUsers.includes(session.userId)) {
        return false
    }

    return true
}

async function assertManageAllowed(
    session: Session,
    constraint: ResolvedConstraint | ConstraintRecord
) {
    if (constraint.manageMode !== 'admin') {
        return
    }

    if (await checkAdmin(session)) {
        return
    }

    throw new Error(
        'Conversation management requires administrator permission.'
    )
}

async function hasConversationPermission(
    ctx: Context,
    session: Session,
    conversation: ConversationRecord,
    permission: ConstraintPermission,
    bindingKey: string
) {
    if (conversation.bindingKey === bindingKey) {
        return true
    }

    if (await checkAdmin(session)) {
        return true
    }

    const acl = (await ctx.database.get('chatluna_acl', {
        conversationId: conversation.id
    })) as ACLRecord[]
    if (acl.length === 0) {
        return false
    }

    const principalIds = [
        ['user', session.userId],
        ['guild', session.guildId ?? session.channelId]
    ] as const
    const required = permission === 'view' ? ['view', 'manage'] : ['manage']

    return acl.some((item) => {
        if (!required.includes(item.permission)) {
            return false
        }

        return principalIds.some(
            ([type, id]) =>
                id != null &&
                item.principalType === type &&
                item.principalId === id
        )
    })
}

async function readText(message: MessageRecord) {
    const content = await JSON.parse(await gzipDecode(message.content))

    if (content == null) {
        return message.text ?? ''
    }

    if (typeof content === 'string') {
        return content
    }

    return getMessageContent(content)
}

function formatUrl(url: string) {
    return url.length > 120 ? url.slice(0, 117) + '...' : url
}

async function formatMessage(message: MessageRecord) {
    const content = await JSON.parse(await gzipDecode(message.content))

    const text =
        content == null
            ? (message.text ?? '').trim()
            : typeof content === 'string'
              ? content.trim()
              : getMessageContent(content).trim()
    const media =
        content != null && Array.isArray(content)
            ? content
                  .map((part) => {
                      if (isMessageContentText(part)) {
                          return null
                      }

                      if (isMessageContentImageUrl(part)) {
                          const url =
                              typeof part.image_url === 'string'
                                  ? part.image_url
                                  : part.image_url.url
                          return `[image] ${formatUrl(url)}`
                      }

                      if (isMessageContentFileUrl(part)) {
                          const url =
                              typeof part.file_url === 'string'
                                  ? part.file_url
                                  : part.file_url.url
                          return `[file] ${formatUrl(url)}`
                      }

                      if (isMessageContentAudio(part)) {
                          const url =
                              typeof part.audio_url === 'string'
                                  ? part.audio_url
                                  : part.audio_url.url
                          return `[audio] ${formatUrl(url)}`
                      }

                      if (isMessageContentVideo(part)) {
                          const url =
                              typeof part.video_url === 'string'
                                  ? part.video_url
                                  : part.video_url.url
                          return `[video] ${formatUrl(url)}`
                      }

                      return `[${part.type}]`
                  })
                  .filter((line) => line != null)
            : []
    const parts: string[] = []

    if (message.role === 'tool') {
        if (message.tool_call_id != null && message.tool_call_id.length > 0) {
            parts.push(`Call ID: \`${message.tool_call_id}\``)
        }

        const body =
            text.length > 0
                ? text
                : media.length > 0
                  ? media.join('\n')
                  : (message.text ?? '')

        if (body.length > 0) {
            let block = body
            let lang = 'text'

            try {
                const parsed = JSON.parse(body)
                block = JSON.stringify(parsed, null, 2)
                lang = 'json'
            } catch {}

            if (parts.length > 0) {
                parts.push('')
            }

            parts.push('```' + lang)
            parts.push(block)
            parts.push('```')
        }
    } else {
        if (text.length > 0) {
            parts.push(text)
        }

        if (media.length > 0) {
            if (parts.length > 0) {
                parts.push('')
            }

            parts.push('Attachments:')
            parts.push(...media.map((line) => `- ${line}`))
        }
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        if (parts.length > 0) {
            parts.push('')
        }

        parts.push('Tool calls:')

        for (let i = 0; i < message.tool_calls.length; i++) {
            const tool = message.tool_calls[i] as Record<string, unknown>
            const fn = tool.function as Record<string, unknown> | undefined
            const name =
                typeof tool.name === 'string'
                    ? tool.name
                    : typeof fn?.name === 'string'
                      ? fn.name
                      : 'unknown'
            const id = typeof tool.id === 'string' ? tool.id : ''
            const raw = tool.args ?? fn?.arguments ?? {}

            let block: string
            let lang = 'json'

            if (typeof raw === 'string') {
                block = raw
                try {
                    block = JSON.stringify(JSON.parse(raw), null, 2)
                } catch {
                    lang = 'text'
                }
            } else {
                block = JSON.stringify(raw, null, 2)
            }

            if (i > 0) {
                parts.push('')
            }

            parts.push(`- \`${name}\`${id.length > 0 ? ` (\`${id}\`)` : ''}`)
            parts.push('```' + lang)
            parts.push(block.length > 0 ? block : '{}')
            parts.push('```')
        }
    }

    if (parts.length > 0) {
        return parts.join('\n')
    }

    if (content != null && typeof content === 'string') {
        return content
    }

    return message.text ?? ''
}

function firstDefined<T extends keyof ConstraintRecord>(
    constraints: ConstraintRecord[],
    key: T
): ConstraintRecord[T] | undefined {
    for (const constraint of constraints) {
        if (constraint[key] != null) {
            return constraint[key]
        }
    }
    return undefined
}

function firstBoolean<T extends keyof ConstraintRecord>(
    constraints: ConstraintRecord[],
    key: T,
    fallback: boolean
) {
    for (const constraint of constraints) {
        const value = constraint[key]
        if (typeof value === 'boolean') {
            return value
        }
    }
    return fallback
}

async function runLock<T>(
    locks: Map<string, ObjectLock>,
    key: string,
    fn: () => Promise<T>
) {
    let lock = locks.get(key)
    if (lock == null) {
        lock = new ObjectLock()
        locks.set(key, lock)
    }

    try {
        return await lock.runLocked(fn)
    } finally {
        if (!lock.isLocked) {
            locks.delete(key)
        }
    }
}
