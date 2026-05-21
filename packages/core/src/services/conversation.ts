import { createHash, randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { Context, Session } from 'koishi'
import type { PlatformService } from 'koishi-plugin-chatluna/llm-core/platform/service'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { parseRawModelName } from 'koishi-plugin-chatluna/llm-core/utils/count_tokens'
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
    AdminRequiredError,
    applyPresetLane,
    ArchiveRecord,
    BindingRecord,
    computeBaseBindingKey,
    ConstraintAction,
    ConstraintDisabledError,
    ConstraintFixedError,
    ConstraintFixedField,
    ConstraintLockedError,
    ConstraintPermission,
    ConstraintRecord,
    ConversationCompressionRecord,
    ConversationListEntry,
    ConversationNotFoundError,
    ConversationRecord,
    ConversationResolution,
    ConversationResolutionError,
    getBaseBindingKey,
    getPresetLane,
    InvalidChatModeError,
    MessageRecord,
    ResolveConversationOptions,
    ResolvedConstraint,
    ResolvedConversationContext,
    RouteMode
} from '../conversation_types'
import {
    ArchiveManifest,
    ConversationArchivePayload,
    ListConversationsOptions
} from './types'
import type { ConversationRuntime } from './conversation_runtime'

const EMPTY_MODEL_NAMES = new Set(['', '无', 'empty'])

const FIXED_FIELDS: readonly {
    key: 'model' | 'preset' | 'chatMode'
    constraintKey: keyof Pick<
        ConstraintRecord,
        'fixedModel' | 'fixedPreset' | 'fixedChatMode'
    >
    label: ConstraintFixedField
}[] = [
    { key: 'model', constraintKey: 'fixedModel', label: 'model' },
    { key: 'preset', constraintKey: 'fixedPreset', label: 'preset' },
    { key: 'chatMode', constraintKey: 'fixedChatMode', label: 'chatMode' }
]

export class ConversationService {
    private readonly _bindingLocks = new Map<string, ObjectLock>()
    private readonly _titleLocks = new Map<string, ObjectLock>()

    constructor(
        private readonly ctx: Context,
        private readonly config: Config,
        private readonly runtime: ConversationRuntime,
        private readonly platform: PlatformService
    ) {}

    async getConversation(id: string) {
        return this.firstRow('chatluna_conversation', { id }) as Promise<
            ConversationRecord | undefined
        >
    }

    async getBinding(bindingKey: string) {
        return this.firstRow('chatluna_binding', { bindingKey }) as Promise<
            BindingRecord | undefined
        >
    }

    async getArchive(id: string) {
        return this.firstRow('chatluna_archive', { id }) as Promise<
            ArchiveRecord | undefined
        >
    }

    async getArchiveByConversationId(conversationId: string) {
        return this.firstRow('chatluna_archive', { conversationId }) as Promise<
            ArchiveRecord | undefined
        >
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
        let bindingKey = this.normalizeBindingKey(
            baseKey,
            options.bindingKey,
            options.presetLane
        )

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

    private normalizeBindingKey(
        baseKey: string,
        explicit?: string,
        presetLane?: string
    ): string {
        if (explicit == null) {
            return applyPresetLane(baseKey, presetLane)
        }

        return explicit.includes(':preset:')
            ? explicit
            : applyPresetLane(explicit, presetLane)
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
        const allowed =
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

        return this.buildContext(
            constraint,
            bindingKey,
            binding ?? null,
            allowed
        )
    }

    async resolveConversation(
        session: Session,
        options: ResolveConversationOptions = {}
    ): Promise<ConversationResolution> {
        const mode = options.mode ?? 'context'
        const resolved = await this.resolveConversationContext(session, options)

        if (mode === 'context') {
            return {
                ...resolved,
                mode,
                conversationId: resolved.conversation?.id ?? null
            }
        }

        if (mode === 'active') {
            return this.resolveActiveMode(session, resolved, options)
        }

        return this.resolveTargetMode(session, resolved, options)
    }

    private async resolveActiveMode(
        session: Session,
        initial: ResolvedConversationContext,
        options: ResolveConversationOptions
    ): Promise<ConversationResolution> {
        let current = initial

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
                current = this.buildContext(
                    current.constraint,
                    current.bindingKey,
                    current.binding,
                    conversation
                )
            }
        }

        if (current.conversation != null) {
            if (current.conversation.status !== 'archived') {
                return {
                    ...current,
                    mode: 'active',
                    conversationId: current.conversation.id
                }
            }

            await assertManageAllowed(session, current.constraint)
            if (!current.constraint.allowArchive) {
                throw new ConstraintDisabledError('restore')
            }

            const restored = await this.restoreConversation(session, {
                conversationId: current.conversation.id
            })
            const refreshed = this.buildContext(
                current.constraint,
                current.bindingKey,
                current.binding,
                restored
            )
            return {
                ...refreshed,
                mode: 'active',
                conversationId: restored.id
            }
        }

        if (!current.constraint.allowNew) {
            throw new ConstraintDisabledError('create')
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
            mode: 'active',
            conversation,
            conversationId: conversation.id
        }
    }

    private async resolveTargetMode(
        session: Session,
        resolved: ResolvedConversationContext,
        options: ResolveConversationOptions
    ): Promise<ConversationResolution> {
        const mode = 'target' as const
        const finalize = (conversation: ConversationRecord | null) =>
            ({
                ...resolved,
                mode,
                conversation,
                conversationId: conversation?.id ?? null
            }) as ConversationResolution

        const promoteTarget = async (conversation: ConversationRecord) => {
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
                conversation: target.conversation ?? conversation,
                conversationId: conversation.id
            } as ConversationResolution
        }

        if (options.conversationId != null) {
            const conversation = await this.getConversation(
                options.conversationId
            )
            if (
                conversation == null ||
                conversation.status === 'deleted' ||
                conversation.status === 'broken'
            ) {
                return finalize(null)
            }

            const inLookupKeys =
                options.allPresetLanes === true &&
                getLookupKeys(
                    session,
                    resolved.constraint.bindingKey,
                    true
                ).includes(getBaseBindingKey(conversation.bindingKey))

            if (
                !inLookupKeys &&
                !(await hasConversationPermission(
                    this.ctx,
                    session,
                    conversation,
                    options.permission ?? 'view',
                    resolved.bindingKey
                ))
            ) {
                throw new ConversationResolutionError('target_outside_route')
            }

            return promoteTarget(conversation)
        }

        if (options.targetConversation == null) {
            return {
                ...resolved,
                mode,
                conversationId: resolved.conversation?.id ?? null
            }
        }

        const target = options.targetConversation.trim()
        if (target.length === 0) {
            return finalize(null)
        }

        const entries = await this.listConversationEntries(session, {
            presetLane: options.presetLane,
            allPresetLanes: options.allPresetLanes,
            includeArchived: options.includeArchived
        })
        const normalized = target.toLocaleLowerCase()
        const local = matchTargetConversation(
            target,
            normalized,
            entries.map((item) => item.conversation),
            entries
        )
        if (local != null) {
            return promoteTarget(local)
        }

        const global = await this.findAccessibleConversations(session, {
            ...options,
            bindingKey: resolved.bindingKey,
            includeArchived: options.includeArchived,
            query: normalized,
            exactId: target
        })
        const remote = matchTargetConversation(target, normalized, global)
        if (remote != null) {
            return promoteTarget(remote)
        }

        return finalize(null)
    }

    private buildContext(
        constraint: ResolvedConstraint,
        bindingKey: string,
        binding: BindingRecord | null,
        conversation: ConversationRecord | null
    ): ResolvedConversationContext {
        const effectiveModel = this.pickModel(constraint, conversation)
        const withModel =
            conversation != null && effectiveModel != null
                ? { ...conversation, model: effectiveModel }
                : conversation
        return {
            bindingKey,
            presetLane: getPresetLane(bindingKey),
            binding,
            conversation: withModel,
            effectiveModel,
            effectivePreset:
                constraint.fixedPreset ??
                conversation?.preset ??
                getPresetLane(bindingKey) ??
                constraint.defaultPreset ??
                this.config.defaultPreset,
            effectiveChatMode:
                constraint.fixedChatMode ??
                conversation?.chatMode ??
                constraint.defaultChatMode ??
                this.config.defaultChatMode,
            constraint
        }
    }

    private async resolveBindingForKey(session: Session, bindingKey: string) {
        const binding = await this.getBinding(bindingKey)
        if (binding != null) {
            return { bindingKey, binding }
        }

        for (const key of getFallbackBindingKeys(session, bindingKey)) {
            const legacyBinding = await this.getBinding(key)
            if (legacyBinding != null) {
                return { bindingKey: key, binding: legacyBinding }
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
            setActive?: boolean
        }
    ) {
        this.checkChatMode(options.chatMode)

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
            if (options.setActive !== false) {
                await this.setActiveConversation(
                    options.bindingKey,
                    conversation.id
                )
            }
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
        await this.ctx.root.parallel('chatluna/after-binding-update', {
            binding: payload,
            previousConversationId: prev ?? null
        })
        return payload
    }

    async touchConversation(
        conversationId: string,
        patch: Partial<ConversationRecord> = {}
    ) {
        const update: Partial<ConversationRecord> = {
            updatedAt: patch.updatedAt ?? new Date()
        }
        for (const key in patch) {
            const value = patch[key as keyof ConversationRecord]
            if (value !== undefined) {
                update[key as keyof ConversationRecord] = value as never
            }
        }

        await this.ctx.database.set(
            'chatluna_conversation',
            { id: conversationId },
            update
        )
        return this.getConversation(conversationId)
    }

    async claimAutoTitle(conversationId: string) {
        return runLock(this._titleLocks, conversationId, async () => {
            const conversation = await this.getConversation(conversationId)
            if (conversation == null || !conversation.autoTitle) {
                return false
            }

            await this.touchConversation(conversationId, { autoTitle: false })
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
        const all = (await this.ctx.database.get(
            'chatluna_conversation',
            options.allPresetLanes
                ? {}
                : { bindingKey: keys.length === 1 ? keys[0] : { $in: keys } }
        )) as ConversationRecord[]

        const conversations = options.allPresetLanes
            ? all.filter((c) =>
                  keys.some(
                      (key) =>
                          c.bindingKey === key ||
                          c.bindingKey.startsWith(key + ':preset:')
                  )
              )
            : all

        const filtered = conversations.filter(
            (c) =>
                c.status !== 'deleted' &&
                c.status !== 'broken' &&
                (options.includeArchived || c.status !== 'archived')
        )
        const merged = new Set(filtered.map((c) => c.bindingKey)).size > 1

        return filtered.sort((a, b) => {
            if (merged) {
                const key = a.bindingKey.localeCompare(b.bindingKey)
                if (key !== 0) return key
            }
            const seq = (a.seq ?? 0) - (b.seq ?? 0)
            if (seq !== 0) return seq
            const created = a.createdAt.getTime() - b.createdAt.getTime()
            if (created !== 0) return created
            return a.id.localeCompare(b.id)
        })
    }

    async listConversationEntries(
        session: Session,
        options: ListConversationsOptions = {}
    ): Promise<ConversationListEntry[]> {
        const conversations = await this.listConversations(session, options)
        const merged = new Set(conversations.map((c) => c.bindingKey)).size > 1

        return conversations.map((conversation, idx) => ({
            conversation,
            displaySeq: merged ? idx + 1 : (conversation.seq ?? 0)
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
            throw new ConversationNotFoundError()
        }

        const managed = await this.getManagedConstraintByBindingKey(
            conversation.bindingKey
        )

        if (managed != null) {
            await assertManageAllowed(session, managed)
        }

        return { resolved, conversation, managed }
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

        assertActionAllowed('switch', resolved, managed, {
            needsAllow: 'switch'
        })

        const previousConversation = current.binding?.activeConversationId
            ? await this.getConversation(current.binding.activeConversationId)
            : null
        const sameRoute =
            options.allPresetLanes === true &&
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
        if (current.bindingKey !== bindingKey) {
            await this.setActiveConversation(
                current.bindingKey,
                conversation.id
            )
        }
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
            throw new ConstraintLockedError('restore')
        }

        if (conversation.status !== 'archived') {
            if (!(managed?.allowSwitch ?? resolved.constraint.allowSwitch)) {
                throw new ConstraintDisabledError('switch')
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
            this.ctx.database.get('chatluna_message', { conversationId })
        ])
        const records = messages as MessageRecord[]

        if (records.length < 2) {
            return records
        }

        const sortByCreatedAt = () =>
            [...records].sort(
                (a, b) =>
                    (a.createdAt?.getTime() ?? 0) -
                    (b.createdAt?.getTime() ?? 0)
            )

        if (conversation?.latestMessageId == null) {
            return sortByCreatedAt()
        }

        const map = new Map(records.map((m) => [m.id, m]))
        const ordered: MessageRecord[] = []
        const seen = new Set<string>()
        let currentId: string | null | undefined = conversation.latestMessageId

        while (currentId != null && !seen.has(currentId)) {
            const message = map.get(currentId)
            if (message == null) break
            ordered.unshift(message)
            seen.add(currentId)
            currentId = message.parentId
        }

        return ordered.length === records.length ? ordered : sortByCreatedAt()
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
            records.map((record) => ({ conversationId, ...record }))
        )
        return this.listAcl(conversationId)
    }

    async replaceAcl(
        conversationId: string,
        records: Omit<ACLRecord, 'conversationId'>[]
    ) {
        await this.ctx.database.remove('chatluna_acl', { conversationId })
        return this.upsertAcl(conversationId, records)
    }

    async removeAcl(
        conversationId: string,
        records?: Partial<Omit<ACLRecord, 'conversationId'>>[]
    ) {
        if (records == null || records.length === 0) {
            await this.ctx.database.remove('chatluna_acl', { conversationId })
            return [] as ACLRecord[]
        }

        const current = await this.listAcl(conversationId)
        const matches = (item: ACLRecord) =>
            records.some(
                (record) =>
                    (record.principalType == null ||
                        record.principalType === item.principalType) &&
                    (record.principalId == null ||
                        record.principalId === item.principalId) &&
                    (record.permission == null ||
                        record.permission === item.permission)
            )

        for (const item of current.filter(matches)) {
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
            throw new ConstraintDisabledError('export')
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
            throw new ConstraintLockedError('archive')
        }

        if (!(managed?.allowArchive ?? resolved.constraint.allowArchive)) {
            throw new ConstraintDisabledError('archive')
        }

        return this.archiveConversationById(conversation.id)
    }

    async archiveConversationById(
        conversationId: string,
        inactiveBefore?: Date
    ) {
        const conversation = await this.getConversation(conversationId)
        if (conversation == null) {
            throw new ConversationNotFoundError()
        }

        return this.runtime.withConversationSync(conversation, async () => {
            const current = await this.getConversation(conversationId)
            if (current == null) {
                throw new ConversationNotFoundError()
            }

            if (
                inactiveBefore != null &&
                (current.status !== 'active' ||
                    current.updatedAt.getTime() >= inactiveBefore.getTime())
            ) {
                return null
            }

            if (current.status === 'archived' && current.archiveId != null) {
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
                { conversation: current }
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
            const messageBuffer = await gzipEncode(
                payload.messages
                    .map((message) => JSON.stringify(message))
                    .join('\n')
            )
            const checksum = createHash('sha256')
                .update(messageBuffer)
                .digest('hex')
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
                path.join(archiveDir, 'conversation.json'),
                JSON.stringify(payload.conversation, null, 2),
                'utf8'
            )
            await fs.writeFile(
                path.join(archiveDir, 'messages.jsonl.gz'),
                messageBuffer
            )
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

            const updated = (await this.getConversation(current.id)) ?? current
            await this.runtime.clearConversationInterfaceLocked(updated)
            await this.ctx.root.parallel(
                'chatluna/after-conversation-archive',
                { conversation: updated, archive, path: archiveDir }
            )

            return { conversation: updated, archive, path: archiveDir }
        })
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
            throw new ConstraintLockedError('restore')
        }

        if (!(managed?.allowArchive ?? resolved.constraint.allowArchive)) {
            throw new ConstraintDisabledError('restore')
        }

        return this.runtime.withConversationSync(conversation, async () => {
            const current = await this.getConversation(conversation.id)
            if (current == null) {
                throw new ConversationNotFoundError()
            }

            await this.ctx.root.parallel(
                'chatluna/before-conversation-restore',
                { conversation: current, archive }
            )

            await this.ctx.database.upsert('chatluna_archive', [
                { ...archive, state: 'restoring' }
            ])

            try {
                const payload = await readArchivePayload(archive.path)
                const restored = deserializeConversation(payload.conversation)
                const restoredMessages = payload.messages.map((message) => ({
                    ...deserializeMessage(message),
                    conversationId: current.id
                }))

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
                        ...restored,
                        id: current.id,
                        status: 'active',
                        archivedAt: null,
                        archiveId: null,
                        updatedAt: new Date()
                    }
                ])
                await this.ctx.database.upsert('chatluna_archive', [
                    { ...archive, state: 'ready', restoredAt: new Date() }
                ])

                const updated = await this.getConversation(current.id)
                if (updated == null) {
                    throw new Error('Conversation restore failed.')
                }

                if (
                    options.allPresetLanes &&
                    getLookupKeys(
                        session,
                        resolved.constraint.bindingKey,
                        true
                    ).includes(getBaseBindingKey(updated.bindingKey))
                ) {
                    await this.updateManagedConstraint(session, {
                        activePresetLane:
                            getPresetLane(updated.bindingKey) ?? null
                    })
                }

                await this.setActiveConversation(updated.bindingKey, updated.id)
                await this.runtime.clearConversationInterfaceLocked(updated)
                await this.ctx.root.parallel(
                    'chatluna/after-conversation-restore',
                    { conversation: updated, archive }
                )

                return updated
            } catch (error) {
                await this.ctx.database.upsert('chatluna_archive', [
                    { ...archive, state: 'broken' }
                ])
                throw error
            }
        })
    }

    async exportMarkdown(conversation: ConversationRecord) {
        const messages = await this.loadMessagesForExport(conversation)

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

    private async loadMessagesForExport(conversation: ConversationRecord) {
        if (
            conversation.status !== 'archived' ||
            conversation.archiveId == null
        ) {
            return this.listMessages(conversation.id)
        }

        const archive = await this.getArchive(conversation.archiveId)
        if (archive == null) {
            return this.listMessages(conversation.id)
        }

        const payload = await readArchivePayload(archive.path)
        return payload.messages.map((message) => ({
            ...deserializeMessage(message),
            conversationId: conversation.id
        }))
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
            throw new ConstraintLockedError('rename')
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
            throw new ConstraintLockedError('delete')
        }

        return this.runtime.withConversationSync(conversation, async () => {
            const current = await this.getConversation(conversation.id)
            if (current == null) {
                throw new ConversationNotFoundError()
            }

            await this.ctx.root.parallel(
                'chatluna/before-conversation-delete',
                { conversation: current }
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
            await this.runtime.clearConversationInterfaceLocked(
                updated ?? current
            )
            await this.ctx.root.parallel('chatluna/after-conversation-delete', {
                conversation: updated ?? current
            })
            return updated ?? current
        })
    }

    async updateConversationUsage(
        session: Session,
        options: ResolveConversationOptions & {
            model?: string
            preset?: string
            chatMode?: string
        }
    ) {
        const lookupMode = options.conversationId == null ? 'active' : 'target'
        const lookupOptions: ResolveConversationOptions = {
            ...options,
            ...(lookupMode === 'target' ? { permission: 'manage' } : {}),
            mode: lookupMode
        }
        const resolved = await this.resolveConversation(session, lookupOptions)
        await assertManageAllowed(session, resolved.constraint)

        const conversation = resolved.conversation
        if (conversation == null) {
            throw new ConversationNotFoundError()
        }

        const target = await this.getManagedConstraintByBindingKey(
            conversation.bindingKey
        )

        if (target != null) {
            await assertManageAllowed(session, target)
        }

        for (const { key, constraintKey, label } of FIXED_FIELDS) {
            const fixed =
                target?.[constraintKey] ?? resolved.constraint[constraintKey]
            if (options[key] != null && fixed != null) {
                throw new ConstraintFixedError(label, fixed)
            }
        }

        if (target?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new ConstraintLockedError('update')
        }

        this.checkChatMode(options.chatMode)

        const updated = await this.touchConversation(conversation.id, {
            model: options.model,
            preset: options.preset,
            chatMode: options.chatMode
        })

        if (updated == null) {
            throw new ConversationNotFoundError()
        }

        await this.runtime.clearConversationInterface(updated)
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
                { conversationId, name: 'infinite_context' },
                { limit: 1, sort: { createdAt: 'desc' } }
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
        const name = buildManagedConstraintName(session)
        return this.firstRow('chatluna_constraint', { name }) as Promise<
            ConstraintRecord | undefined
        >
    }

    async getManagedConstraintByBindingKey(bindingKey: string) {
        const name = managedNameFromBindingKey(bindingKey)
        if (name == null) {
            return undefined
        }

        return this.firstRow('chatluna_constraint', { name }) as Promise<
            ConstraintRecord | undefined
        >
    }

    async updateManagedConstraint(
        session: Session,
        patch: Partial<ConstraintRecord>
    ) {
        this.checkChatMode(patch.defaultChatMode)
        this.checkChatMode(patch.fixedChatMode)

        const current = await this.getManagedConstraint(session)
        const now = new Date()
        const guildId = session.isDirect
            ? null
            : (session.guildId ?? session.channelId ?? null)
        const record: ConstraintRecord = {
            id: current?.id,
            name: buildManagedConstraintName(session),
            enabled: true,
            priority: 1000,
            createdBy: session.userId,
            createdAt: now,
            platform: session.platform,
            selfId: session.selfId,
            guildId,
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
        await this.ctx.root.parallel('chatluna/after-constraint-update', {
            constraint: record
        })
        return (await this.getManagedConstraint(session)) ?? record
    }

    pickModel(
        constraint: ResolvedConstraint,
        conversation?: ConversationRecord | null
    ) {
        const candidates = [
            constraint.fixedModel,
            conversation?.model,
            constraint.defaultModel,
            this.config.defaultModel
        ]

        for (const model of candidates) {
            if (model == null) continue
            const trimmed = model.trim()
            if (EMPTY_MODEL_NAMES.has(trimmed)) continue

            const [platform, name] = parseRawModelName(model)
            if (platform == null || name == null) continue

            const models = this.platform.listPlatformModels(
                platform,
                ModelType.llm
            ).value
            if (models.length > 0 && models.some((m) => m.name === name)) {
                return model
            }
        }

        return null
    }

    private async firstRow(
        table: 'chatluna_conversation',
        query: Partial<ConversationRecord>
    ): Promise<ConversationRecord | undefined>

    private async firstRow(
        table: 'chatluna_binding',
        query: Partial<BindingRecord>
    ): Promise<BindingRecord | undefined>

    private async firstRow(
        table: 'chatluna_archive',
        query: Partial<ArchiveRecord>
    ): Promise<ArchiveRecord | undefined>

    private async firstRow(
        table: 'chatluna_constraint',
        query: Partial<ConstraintRecord>
    ): Promise<ConstraintRecord | undefined>

    private async firstRow(
        table:
            | 'chatluna_conversation'
            | 'chatluna_binding'
            | 'chatluna_archive'
            | 'chatluna_constraint',
        query:
            | Partial<ConversationRecord>
            | Partial<BindingRecord>
            | Partial<ArchiveRecord>
            | Partial<ConstraintRecord>
    ) {
        if (table === 'chatluna_conversation') {
            return (
                await this.ctx.database.get(
                    'chatluna_conversation',
                    query as Partial<ConversationRecord>
                )
            )[0]
        }
        if (table === 'chatluna_binding') {
            return (
                await this.ctx.database.get(
                    'chatluna_binding',
                    query as Partial<BindingRecord>
                )
            )[0]
        }
        if (table === 'chatluna_archive') {
            return (
                await this.ctx.database.get(
                    'chatluna_archive',
                    query as Partial<ArchiveRecord>
                )
            )[0]
        }
        return (
            await this.ctx.database.get(
                'chatluna_constraint',
                query as Partial<ConstraintRecord>
            )
        )[0]
    }

    private getDefaultRouteMode(session: Session): RouteMode {
        if (session.isDirect) {
            return 'personal'
        }
        return this.config.defaultGroupRouteMode ?? 'shared'
    }

    private checkChatMode(mode?: string | null) {
        if (
            mode != null &&
            !this.platform.chatChains.value.some((chain) => chain.name === mode)
        ) {
            throw new InvalidChatModeError(mode)
        }
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

            const filter = options.seq != null ? { seq: options.seq } : {}
            const conversations = (await this.ctx.database.get(
                'chatluna_conversation',
                filter
            )) as ConversationRecord[]
            return conversations.filter(matched)
        }

        const ids = await this.collectAclConversationIds(
            session,
            options.permission ?? 'view'
        )

        const matches: ConversationRecord[] = []
        for (let i = 0; i < ids.length; i += 200) {
            const slice = ids.slice(i, i + 200)
            const conversations = (await this.ctx.database.get(
                'chatluna_conversation',
                { id: { $in: slice } }
            )) as ConversationRecord[]
            matches.push(...conversations.filter(matched))
        }

        return matches
    }

    private async collectAclConversationIds(
        session: Session,
        required: ConstraintPermission
    ) {
        const acl: ACLRecord[] = []
        const fetch = async (
            principalType: 'user' | 'guild',
            principalId: string,
            permission: ConstraintPermission
        ) => {
            acl.push(
                ...((await this.ctx.database.get('chatluna_acl', {
                    principalType,
                    principalId,
                    permission
                })) as ACLRecord[])
            )
        }

        await fetch('user', session.userId, 'manage')
        if (required === 'view') {
            await fetch('user', session.userId, 'view')
        }

        const guildId = session.guildId ?? session.channelId
        if (guildId != null) {
            await fetch('guild', guildId, 'manage')
            if (required === 'view') {
                await fetch('guild', guildId, 'view')
            }
        }

        return Array.from(new Set(acl.map((item) => item.conversationId)))
    }

    private async ensureDataDir(name: string) {
        const target = path.resolve(this.ctx.baseDir, 'data/chatluna', name)
        await fs.mkdir(target, { recursive: true })
        return target
    }
}

function buildManagedConstraintName(session: Session) {
    const route = session.isDirect
        ? `direct:${session.userId}`
        : `guild:${session.guildId ?? session.channelId ?? 'unknown'}`
    return `managed:${session.platform}:${session.selfId}:${route}`
}

function managedNameFromBindingKey(bindingKey: string): string | undefined {
    const target = bindingKey.includes(':preset:')
        ? bindingKey.slice(0, bindingKey.indexOf(':preset:'))
        : bindingKey
    const parts = target.split(':')

    if (parts[0] === 'shared' && parts.length >= 4) {
        return `managed:${parts[1]}:${parts[2]}:guild:${parts[3]}`
    }

    if (parts[0] === 'personal' && parts.length >= 5) {
        const scope =
            parts[3] === 'direct' ? `direct:${parts[4]}` : `guild:${parts[3]}`
        return `managed:${parts[1]}:${parts[2]}:${scope}`
    }

    return undefined
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

    const users = constraint.users == null ? null : JSON.parse(constraint.users)
    if (users != null && !users.includes(session.userId)) {
        return false
    }

    const excludeUsers =
        constraint.excludeUsers == null
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
    throw new AdminRequiredError()
}

function assertActionAllowed(
    action: ConstraintAction,
    resolved: { constraint: ResolvedConstraint },
    managed: ConstraintRecord | null | undefined,
    options: {
        needsAllow?: 'switch' | 'archive' | 'export' | 'new'
    } = {}
) {
    if (managed?.lockConversation ?? resolved.constraint.lockConversation) {
        throw new ConstraintLockedError(action)
    }
    if (options.needsAllow == null) {
        return
    }

    const allowKey =
        options.needsAllow === 'switch'
            ? 'allowSwitch'
            : options.needsAllow === 'archive'
              ? 'allowArchive'
              : options.needsAllow === 'export'
                ? 'allowExport'
                : 'allowNew'
    if (!(managed?.[allowKey] ?? resolved.constraint[allowKey])) {
        throw new ConstraintDisabledError(action)
    }
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

    const principals: readonly (readonly [
        'user' | 'guild',
        string | undefined
    ])[] = [
        ['user', session.userId],
        ['guild', session.guildId ?? session.channelId]
    ]
    const required = permission === 'view' ? ['view', 'manage'] : ['manage']

    return acl.some(
        (item) =>
            required.includes(item.permission) &&
            principals.some(
                ([type, id]) =>
                    id != null &&
                    item.principalType === type &&
                    item.principalId === id
            )
    )
}

async function readText(message: MessageRecord) {
    const content = JSON.parse(await gzipDecode(message.content))

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

function formatMediaPart(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    part: any
): string | null {
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
}

function formatToolBlock(body: string): string[] {
    let block = body
    let lang = 'text'
    try {
        block = JSON.stringify(JSON.parse(body), null, 2)
        lang = 'json'
    } catch {}
    return ['```' + lang, block, '```']
}

function formatToolCalls(toolCalls: unknown[]): string[] {
    const parts: string[] = ['Tool calls:']

    toolCalls.forEach((entry, index) => {
        const tool = entry as Record<string, unknown>
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

        if (index > 0) parts.push('')
        parts.push(`- \`${name}\`${id.length > 0 ? ` (\`${id}\`)` : ''}`)
        parts.push('```' + lang)
        parts.push(block.length > 0 ? block : '{}')
        parts.push('```')
    })

    return parts
}

async function formatMessage(message: MessageRecord) {
    const content = JSON.parse(await gzipDecode(message.content))

    const text =
        content == null
            ? (message.text ?? '').trim()
            : typeof content === 'string'
              ? content.trim()
              : getMessageContent(content).trim()
    const media =
        content != null && Array.isArray(content)
            ? content
                  .map(formatMediaPart)
                  .filter((line): line is string => line != null)
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
            if (parts.length > 0) parts.push('')
            parts.push(...formatToolBlock(body))
        }
    } else {
        if (text.length > 0) {
            parts.push(text)
        }
        if (media.length > 0) {
            if (parts.length > 0) parts.push('')
            parts.push('Attachments:')
            parts.push(...media.map((line) => `- ${line}`))
        }
    }

    if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        if (parts.length > 0) parts.push('')
        parts.push(...formatToolCalls(message.tool_calls))
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

function matchTargetConversation(
    target: string,
    normalized: string,
    conversations: ConversationRecord[],
    entries?: ConversationListEntry[]
) {
    const pick = (matches: ConversationRecord[]) => {
        const active = matches.filter((c) => c.status !== 'archived')
        if (active.length === 1) return active[0]
        if (active.length > 1) {
            throw new ConversationResolutionError('ambiguous_target')
        }
        if (matches.length === 1) return matches[0]
        if (matches.length > 1) {
            throw new ConversationResolutionError('ambiguous_target')
        }
        return null
    }

    const byId = conversations.find((c) => c.id === target)
    if (byId != null) return byId

    if (entries != null && /^\d+$/.test(target)) {
        const seq = Number(target)
        const bySeq = entries
            .filter((item) => item.displaySeq === seq)
            .map((item) => item.conversation)
        const match = pick(bySeq)
        if (match != null) return match
    }

    const exact = pick(
        conversations.filter((c) => c.title.toLocaleLowerCase() === normalized)
    )
    if (exact != null) return exact

    return pick(
        conversations.filter((c) =>
            c.title.toLocaleLowerCase().includes(normalized)
        )
    )
}
