import { createHash, randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { Context, Session } from 'koishi'
import type { Config } from '../config'
import {
    bufferToArrayBuffer,
    gzipDecode,
    gzipEncode
} from '../utils/compression'
import { checkAdmin } from 'koishi-plugin-chatluna/utils/koishi'
import { ObjectLock } from 'koishi-plugin-chatluna/utils/lock'
import {
    ACLRecord,
    applyPresetLane,
    ArchiveRecord,
    BindingRecord,
    computeBaseBindingKey,
    ConstraintPermission,
    ConstraintRecord,
    ConversationCompressionRecord,
    ConversationRecord,
    MessageRecord,
    ResolveConversationContextOptions,
    ResolvedConstraint,
    ResolvedConversationContext,
    RouteMode
} from './conversation_types'
import {
    ArchiveManifest,
    ConversationArchivePayload,
    ListConversationsOptions,
    ResolveTargetConversationOptions,
    SerializedMessageRecord
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

    isConstraintMatched(constraint: ConstraintRecord, session: Session) {
        if (
            constraint.platform != null &&
            constraint.platform !== session.platform
        ) {
            return false
        }
        if (constraint.selfId != null && constraint.selfId !== session.selfId) {
            return false
        }
        if (
            constraint.guildId != null &&
            constraint.guildId !== session.guildId
        ) {
            return false
        }
        if (
            constraint.channelId != null &&
            constraint.channelId !== session.channelId
        ) {
            return false
        }
        if (
            constraint.direct != null &&
            constraint.direct !== session.isDirect
        ) {
            return false
        }

        const users = parseJsonArray(constraint.users)
        if (users != null && !users.includes(session.userId)) {
            return false
        }

        const excludeUsers = parseJsonArray(constraint.excludeUsers)
        if (excludeUsers != null && excludeUsers.includes(session.userId)) {
            return false
        }

        return true
    }

    async resolveConstraint(
        session: Session,
        options: ResolveConversationContextOptions = {}
    ): Promise<ResolvedConstraint> {
        let constraints = (await this.listConstraints()).filter((c) =>
            this.isConstraintMatched(c, session)
        )
        const routed = constraints.find((c) => c.routeMode != null)
        let routeMode = routed?.routeMode ?? this.getDefaultRouteMode(session)
        let baseKey = computeBaseBindingKey(
            session,
            routeMode,
            routed?.routeKey
        )
        const bindingKey =
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

            baseKey = bindingKey.includes(':preset:')
                ? bindingKey.slice(0, bindingKey.indexOf(':preset:'))
                : bindingKey
            routeMode = baseKey.startsWith('shared:')
                ? 'shared'
                : baseKey.startsWith('personal:')
                  ? 'personal'
                  : 'custom'
        }

        return {
            routeMode,
            baseKey,
            bindingKey,
            constraints,
            defaultModel:
                firstDefined(constraints, 'defaultModel') ??
                this.config.defaultModel,
            defaultPreset:
                options.presetLane ??
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

    async resolveContext(
        session: Session,
        options: ResolveConversationContextOptions = {}
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
            (await this.hasConversationPermission(
                session,
                conversation,
                'view',
                bindingKey
            ))
                ? conversation
                : null

        return {
            bindingKey,
            presetLane: options.presetLane,
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
                options.presetLane ??
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

    private async resolveBindingForKey(session: Session, bindingKey: string) {
        const binding = await this.getBinding(bindingKey)

        if (binding != null) {
            return {
                bindingKey,
                binding
            }
        }

        const idx = bindingKey.indexOf(':preset:')
        const suffix = idx >= 0 ? bindingKey.slice(idx) : ''

        if (bindingKey.startsWith('custom:')) {
            return null
        }

        const guildOrChannel = session.guildId ?? session.channelId ?? 'unknown'
        const keys = session.isDirect
            ? [`personal:legacy:legacy:direct:${session.userId}${suffix}`]
            : bindingKey.startsWith('shared:')
              ? [
                    `shared:legacy:legacy:${guildOrChannel}${suffix}`,
                    `personal:legacy:legacy:${guildOrChannel}:${session.userId}${suffix}`
                ]
              : [
                    `personal:legacy:legacy:${guildOrChannel}:${session.userId}${suffix}`,
                    `shared:legacy:legacy:${guildOrChannel}${suffix}`
                ]

        for (const key of keys) {
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
        options: ResolveConversationContextOptions = {}
    ) {
        const resolved = await this.resolveContext(session, options)

        if (
            resolved.constraint.lockConversation &&
            resolved.binding?.activeConversationId != null
        ) {
            return resolved as ResolvedConversationContext & {
                conversation: ConversationRecord
            }
        }

        if (resolved.conversation != null) {
            if (resolved.conversation.status === 'archived') {
                await this.assertManageAllowed(session, resolved.constraint)

                if (!resolved.constraint.allowArchive) {
                    throw new Error(
                        'Conversation restore is disabled by constraint.'
                    )
                }

                const conversation = await this.restoreConversation(session, {
                    conversationId: resolved.conversation.id
                })

                return {
                    ...resolved,
                    conversation,
                    effectiveModel: conversation.model,
                    effectivePreset: conversation.preset,
                    effectiveChatMode: conversation.chatMode
                }
            }

            return resolved as ResolvedConversationContext & {
                conversation: ConversationRecord
            }
        }

        await this.assertManageAllowed(session, resolved.constraint)

        if (!resolved.constraint.allowNew) {
            throw new Error('Conversation creation is disabled by constraint.')
        }

        const conversation = await this.createConversation(session, {
            bindingKey: resolved.bindingKey,
            preset: resolved.effectivePreset,
            model: resolved.effectiveModel,
            chatMode: resolved.effectiveChatMode,
            title: options.presetLane ?? 'New Conversation'
        })

        return {
            ...resolved,
            conversation
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
        return getLock(this._bindingLocks, options.bindingKey).runLocked(
            async () => {
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
                    'chatluna/conversation-before-create',
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
                await this.ctx.root.parallel(
                    'chatluna/conversation-after-create',
                    {
                        conversation,
                        bindingKey: options.bindingKey
                    }
                )
                return conversation
            }
        )
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
        return getLock(this._titleLocks, conversationId).runLocked(async () => {
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
        const resolved = await this.resolveContext(session, options)
        const conversations = (await this.ctx.database.get(
            'chatluna_conversation',
            {
                bindingKey: resolved.bindingKey
            }
        )) as ConversationRecord[]

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

    async switchConversation(
        session: Session,
        options: ResolveTargetConversationOptions
    ) {
        const resolved = await this.resolveContext(session, options)
        await this.assertManageAllowed(session, resolved.constraint)

        const conversation = await this.resolveTargetConversation(session, {
            ...options,
            permission: 'manage'
        })

        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        const target = await this.getManagedConstraintByBindingKey(
            conversation.bindingKey
        )

        if (target != null) {
            await this.assertManageAllowed(session, target)
        }

        if (target?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation switch is locked by constraint.')
        }

        if (!(target?.allowSwitch ?? resolved.constraint.allowSwitch)) {
            throw new Error('Conversation switch is disabled by constraint.')
        }

        const previousConversation = resolved.binding?.activeConversationId
            ? await this.getConversation(resolved.binding.activeConversationId)
            : null
        const targetBinding =
            conversation.bindingKey === resolved.bindingKey
                ? resolved.binding
                : await this.getBinding(conversation.bindingKey)
        const targetPreviousConversation = targetBinding?.activeConversationId
            ? await this.getConversation(targetBinding.activeConversationId)
            : null

        await this.ctx.root.parallel('chatluna/conversation-before-switch', {
            bindingKey: resolved.bindingKey,
            conversation,
            previousConversation
        })
        await this.setActiveConversation(
            conversation.bindingKey,
            conversation.id
        )
        await this.ctx.root.parallel('chatluna/conversation-after-switch', {
            bindingKey: conversation.bindingKey,
            conversation,
            previousConversation: targetPreviousConversation
        })

        return conversation
    }

    async getCurrentConversation(
        session: Session,
        options: ResolveConversationContextOptions = {}
    ) {
        return this.resolveContext(session, options)
    }

    async reopenConversation(
        session: Session,
        options: ResolveTargetConversationOptions
    ) {
        const resolved = await this.resolveContext(session, options)
        await this.assertManageAllowed(session, resolved.constraint)

        const conversation = await this.resolveTargetConversation(session, {
            ...options,
            includeArchived: true,
            permission: 'manage'
        })

        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        const target = await this.getManagedConstraintByBindingKey(
            conversation.bindingKey
        )

        if (target != null) {
            await this.assertManageAllowed(session, target)
        }

        if (target?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation restore is locked by constraint.')
        }

        if (conversation.status !== 'archived') {
            await this.setActiveConversation(
                conversation.bindingKey,
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
        return (await this.ctx.database.get('chatluna_message', {
            conversationId
        })) as MessageRecord[]
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
        options: ResolveTargetConversationOptions & {
            outputPath?: string
        } = {}
    ) {
        const resolved = await this.resolveContext(session, options)
        await this.assertManageAllowed(session, resolved.constraint)
        const conversation = await this.resolveTargetConversation(session, {
            ...options,
            includeArchived: true,
            permission: 'view'
        })

        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        const target = await this.getManagedConstraintByBindingKey(
            conversation.bindingKey
        )

        if (target != null) {
            await this.assertManageAllowed(session, target)
        }

        if (!(target?.allowExport ?? resolved.constraint.allowExport)) {
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
        options: ResolveTargetConversationOptions = {}
    ) {
        const resolved = await this.resolveContext(session, options)
        await this.assertManageAllowed(session, resolved.constraint)

        const conversation = await this.resolveTargetConversation(session, {
            ...options,
            permission: 'manage'
        })

        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        const target = await this.getManagedConstraintByBindingKey(
            conversation.bindingKey
        )

        if (target != null) {
            await this.assertManageAllowed(session, target)
        }

        if (target?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation archive is locked by constraint.')
        }

        if (!(target?.allowArchive ?? resolved.constraint.allowArchive)) {
            throw new Error('Conversation archive is disabled by constraint.')
        }

        return this.archiveConversationById(conversation.id)
    }

    async archiveConversationById(conversationId: string) {
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
                    'chatluna/conversation-before-archive',
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
                await this.unbindConversation(current.id)
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
                    'chatluna/conversation-after-archive',
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
        options: ResolveConversationContextOptions & {
            archiveId?: string
        } = {}
    ) {
        const resolved = await this.resolveContext(session, options)
        const conversation = options.conversationId
            ? ((await this.getConversation(options.conversationId)) ??
              resolved.conversation)
            : resolved.conversation

        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

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

        await this.assertManageAllowed(session, resolved.constraint)

        const target = await this.getManagedConstraintByBindingKey(
            conversation.bindingKey
        )

        if (target != null) {
            await this.assertManageAllowed(session, target)
        }

        if (target?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation restore is locked by constraint.')
        }

        if (!(target?.allowArchive ?? resolved.constraint.allowArchive)) {
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
                    'chatluna/conversation-before-restore',
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
                    const payload = await this.readArchivePayload(archive.path)
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

                    await this.setActiveConversation(
                        updatedConversation.bindingKey,
                        updatedConversation.id
                    )
                    await this.ctx.chatluna.conversationRuntime.clearConversationInterfaceLocked(
                        updatedConversation
                    )
                    await this.ctx.root.parallel(
                        'chatluna/conversation-after-restore',
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
                try {
                    const payload = await this.readArchivePayload(archive.path)
                    messages = payload.messages.map((msg) => ({
                        ...msg,
                        createdAt: new Date(msg.createdAt),
                        conversationId: conversation.id
                    })) as unknown as MessageRecord[]
                } catch {
                    messages = await this.listMessages(conversation.id)
                }
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
            ...messages.flatMap((message) => [
                `## ${message.role} ${message.name ? `(${message.name})` : ''}`.trim(),
                '',
                message.text ?? '',
                ''
            ])
        ].join('\n')
    }

    async renameConversation(
        session: Session,
        options: ResolveTargetConversationOptions & {
            title: string
        }
    ) {
        const resolved = await this.resolveContext(session, options)
        await this.assertManageAllowed(session, resolved.constraint)

        const conversation = await this.resolveTargetConversation(session, {
            ...options,
            permission: 'manage'
        })
        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        const target = await this.getManagedConstraintByBindingKey(
            conversation.bindingKey
        )
        if (target != null) {
            await this.assertManageAllowed(session, target)
        }
        if (target?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation rename is locked by constraint.')
        }

        const updated = await this.touchConversation(conversation.id, {
            title: options.title.trim()
        })
        return updated!
    }

    async deleteConversation(
        session: Session,
        options: ResolveTargetConversationOptions = {}
    ) {
        const resolved = await this.resolveContext(session, options)
        await this.assertManageAllowed(session, resolved.constraint)

        const conversation = await this.resolveTargetConversation(session, {
            ...options,
            includeArchived: true,
            permission: 'manage'
        })
        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        const target = await this.getManagedConstraintByBindingKey(
            conversation.bindingKey
        )
        if (target != null) {
            await this.assertManageAllowed(session, target)
        }
        if (target?.lockConversation ?? resolved.constraint.lockConversation) {
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
                    'chatluna/conversation-before-delete',
                    {
                        conversation: current
                    }
                )

                const updated = await this.touchConversation(current.id, {
                    status: 'deleted',
                    archivedAt: null
                })
                await this.unbindConversation(current.id)
                await this.ctx.database.remove('chatluna_message', {
                    conversationId: current.id
                })
                await this.removeAcl(current.id)
                await this.ctx.chatluna.conversationRuntime.clearConversationInterfaceLocked(
                    updated ?? current
                )
                await this.ctx.root.parallel(
                    'chatluna/conversation-after-delete',
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
        options: ResolveConversationContextOptions & {
            model?: string
            preset?: string
            chatMode?: string
        }
    ) {
        const resolved = await this.ensureActiveConversation(session, options)
        await this.assertManageAllowed(session, resolved.constraint)

        for (const [key, fixedKey] of [
            ['model', 'fixedModel'],
            ['preset', 'fixedPreset'],
            ['chatMode', 'fixedChatMode']
        ] as const) {
            if (options[key] != null && resolved.constraint[fixedKey] != null) {
                throw new Error(
                    `${key} is fixed to ${resolved.constraint[fixedKey]}.`
                )
            }
        }

        const target = await this.getManagedConstraintByBindingKey(
            resolved.conversation.bindingKey
        )
        if (target?.lockConversation ?? resolved.constraint.lockConversation) {
            throw new Error('Conversation update is locked by constraint.')
        }

        const updated = await this.touchConversation(resolved.conversation.id, {
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

        const current = parseCompressionRecord(conversation.compression)
        const summary = (
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
        )[0]?.text

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

    async resolveTargetConversation(
        session: Session,
        options: ResolveTargetConversationOptions = {}
    ) {
        const resolved = await this.resolveContext(session, options)

        if (options.conversationId != null) {
            const conversation = await this.getConversation(
                options.conversationId
            )

            if (conversation == null) {
                return null
            }

            if (
                conversation.status === 'deleted' ||
                conversation.status === 'broken'
            ) {
                return null
            }

            if (
                conversation.status === 'archived' &&
                !options.includeArchived
            ) {
                return null
            }

            if (
                !(await this.hasConversationPermission(
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

            return conversation
        }

        const target = options.targetConversation?.trim()

        if (target == null || target.length === 0) {
            return resolved.conversation ?? null
        }

        const conversations = await this.listConversations(session, {
            presetLane: options.presetLane,
            includeArchived: options.includeArchived
        })

        const byId = conversations.find((c) => c.id === target)
        if (byId != null) {
            return byId
        }

        if (/^\d+$/.test(target)) {
            const seq = Number(target)
            const bySeq = conversations.find((c) => c.seq === seq)
            if (bySeq != null) {
                return bySeq
            }
        }

        const normalized = target.toLocaleLowerCase()
        const exactTitle = conversations.find(
            (c) => c.title.toLocaleLowerCase() === normalized
        )
        if (exactTitle != null) {
            return exactTitle
        }

        const partialMatches = conversations.filter((c) =>
            c.title.toLocaleLowerCase().includes(normalized)
        )

        if (partialMatches.length === 1) {
            return partialMatches[0]
        }

        if (partialMatches.length > 1) {
            throw new Error('Conversation target is ambiguous.')
        }

        const globalMatches = await this.findAccessibleConversations(session, {
            ...options,
            bindingKey: resolved.bindingKey,
            query: normalized,
            exactId: target,
            seq: /^\d+$/.test(target) ? Number(target) : undefined
        })

        const globalById = globalMatches.find((c) => c.id === target)
        if (globalById != null) {
            return globalById
        }

        const globalExactTitle = globalMatches.find(
            (c) => c.title.toLocaleLowerCase() === normalized
        )
        if (globalExactTitle != null) {
            return globalExactTitle
        }

        const globalPartialMatches = globalMatches.filter((c) =>
            c.title.toLocaleLowerCase().includes(normalized)
        )

        if (globalPartialMatches.length === 1) {
            return globalPartialMatches[0]
        }

        if (globalPartialMatches.length > 1) {
            throw new Error('Conversation target is ambiguous.')
        }

        return null
    }

    private async findAccessibleConversations(
        session: Session,
        options: ResolveTargetConversationOptions & {
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

    async resolveCommandConversation(
        session: Session,
        options: ResolveTargetConversationOptions = {}
    ) {
        return this.resolveTargetConversation(session, options)
    }

    private async readArchivePayload(archivePath: string) {
        const stat = await fs.stat(archivePath)

        if (stat.isDirectory()) {
            const manifest = JSON.parse(
                await fs.readFile(
                    path.join(archivePath, 'manifest.json'),
                    'utf8'
                )
            ) as ArchiveManifest
            const conversation = JSON.parse(
                await fs.readFile(
                    path.join(archivePath, 'conversation.json'),
                    'utf8'
                )
            ) as ConversationArchivePayload['conversation']
            const messagesRaw = await gzipDecode(
                await fs.readFile(path.join(archivePath, 'messages.jsonl.gz'))
            )
            const messages = messagesRaw
                .split('\n')
                .filter((line) => line.length > 0)
                .map((line) => JSON.parse(line) as SerializedMessageRecord)

            return {
                formatVersion: manifest.formatVersion,
                exportedAt: manifest.createdAt,
                conversation,
                messages
            }
        }

        // Legacy format: single gzip file containing the full payload JSON
        const compressed = await fs.readFile(archivePath)
        const content = await gzipDecode(compressed)
        return JSON.parse(content) as ConversationArchivePayload
    }

    private async ensureDataDir(name: string) {
        const target = path.resolve(this.ctx.baseDir, 'data/chatluna', name)
        await fs.mkdir(target, { recursive: true })
        return target
    }

    private async unbindConversation(conversationId: string) {
        const [active, last] = await Promise.all([
            this.ctx.database.get('chatluna_binding', {
                activeConversationId: conversationId
            }),
            this.ctx.database.get('chatluna_binding', {
                lastConversationId: conversationId
            })
        ])
        const bindings = Array.from(
            new Map(
                [
                    ...(active as BindingRecord[]),
                    ...(last as BindingRecord[])
                ].map((item) => [item.bindingKey, item])
            ).values()
        )

        for (const binding of bindings) {
            await this.ctx.database.upsert('chatluna_binding', [
                {
                    bindingKey: binding.bindingKey,
                    activeConversationId:
                        binding.activeConversationId === conversationId
                            ? null
                            : binding.activeConversationId,
                    lastConversationId:
                        binding.lastConversationId === conversationId
                            ? null
                            : binding.lastConversationId,
                    updatedAt: new Date()
                }
            ])
        }
    }

    private async assertManageAllowed(
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

    private async hasConversationPermission(
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

        const acl = await this.listAcl(conversation.id)
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
}

function serializeConversation(
    conversation: ConversationRecord
): ConversationArchivePayload['conversation'] {
    return {
        ...conversation,
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
        lastChatAt: conversation.lastChatAt
            ? conversation.lastChatAt.toISOString()
            : null,
        archivedAt: conversation.archivedAt
            ? conversation.archivedAt.toISOString()
            : null
    }
}

function deserializeConversation(
    conversation: ConversationArchivePayload['conversation']
): ConversationRecord {
    return {
        ...conversation,
        createdAt: new Date(conversation.createdAt),
        updatedAt: new Date(conversation.updatedAt),
        lastChatAt: conversation.lastChatAt
            ? new Date(conversation.lastChatAt)
            : null,
        archivedAt: conversation.archivedAt
            ? new Date(conversation.archivedAt)
            : null
    }
}

function serializeMessage(message: MessageRecord): SerializedMessageRecord {
    return {
        ...message,
        content: serializeBinary(message.content),
        additional_kwargs_binary: serializeBinary(
            message.additional_kwargs_binary
        ),
        createdAt: message.createdAt?.toISOString() ?? null
    }
}

function deserializeMessage(message: SerializedMessageRecord): MessageRecord {
    return {
        ...message,
        content: deserializeBinary(message.content),
        additional_kwargs_binary: deserializeBinary(
            message.additional_kwargs_binary
        ),
        createdAt: message.createdAt ? new Date(message.createdAt) : null
    }
}

function serializeBinary(value?: ArrayBuffer | null) {
    if (value == null) {
        return null
    }

    return Buffer.from(value).toString('base64')
}

function deserializeBinary(value?: string | null) {
    if (value == null || value.length === 0) {
        return null
    }

    return bufferToArrayBuffer(Buffer.from(value, 'base64'))
}

function parseJsonArray(value?: string | null) {
    if (value == null || value.length === 0) {
        return null
    }

    try {
        const parsed = JSON.parse(value)
        return Array.isArray(parsed) ? parsed.map(String) : null
    } catch {
        return null
    }
}

function parseCompressionRecord(value?: string | null) {
    if (value == null || value.length === 0) {
        return null
    }

    try {
        return JSON.parse(value) as ConversationCompressionRecord
    } catch {
        return null
    }
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

function getLock(locks: Map<string, ObjectLock>, key: string) {
    let lock = locks.get(key)
    if (lock == null) {
        lock = new ObjectLock()
        locks.set(key, lock)
    }
    return lock
}
