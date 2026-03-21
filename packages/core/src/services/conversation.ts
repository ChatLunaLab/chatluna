import { createHash, randomUUID } from 'crypto'
import fs from 'fs/promises'
import path from 'path'
import type { Session } from 'koishi'
import type { Config } from '../config'
import {
    bufferToArrayBuffer,
    gzipDecode,
    gzipEncode
} from '../utils/compression'
import {
    ACLRecord,
    applyPresetLane,
    ArchiveRecord,
    BindingRecord,
    ConversationCompressionRecord,
    computeBaseBindingKey,
    ConstraintRecord,
    ConversationRecord,
    MessageRecord,
    ConstraintPermission,
    ResolveConversationContextOptions,
    ResolvedConstraint,
    ResolvedConversationContext,
    RouteMode
} from './conversation_types'

interface ListConversationsOptions extends ResolveConversationContextOptions {
    includeArchived?: boolean
}

interface ResolveTargetConversationOptions extends ResolveConversationContextOptions {
    targetConversation?: string
    includeArchived?: boolean
    permission?: ConstraintPermission
}

interface SerializedMessageRecord extends Omit<
    MessageRecord,
    'content' | 'additional_kwargs_binary' | 'createdAt'
> {
    content?: string | null
    additional_kwargs_binary?: string | null
    createdAt?: string | null
}

interface ConversationArchivePayload {
    formatVersion: number
    exportedAt: string
    conversation: Omit<
        ConversationRecord,
        'createdAt' | 'updatedAt' | 'lastChatAt' | 'archivedAt'
    > & {
        createdAt: string
        updatedAt: string
        lastChatAt?: string | null
        archivedAt?: string | null
    }
    messages: SerializedMessageRecord[]
}

interface ArchiveManifest {
    format: 'chatluna-archive'
    formatVersion: number
    conversationId: string
    messageCount: number
    checksum?: string | null
    size: number
    createdAt: string
}

export class ConversationService {
    constructor(
        private readonly ctx: import('koishi').Context,
        private readonly config: Config
    ) {}

    async getConversation(id: string) {
        return (
            await this.ctx.database.get('chatluna_conversation', {
                id
            })
        )[0] as ConversationRecord | undefined
    }

    async getBinding(bindingKey: string) {
        return (
            await this.ctx.database.get('chatluna_binding', {
                bindingKey
            })
        )[0] as BindingRecord | undefined
    }

    async getArchive(id: string) {
        return (
            await this.ctx.database.get('chatluna_archive', {
                id
            })
        )[0] as ArchiveRecord | undefined
    }

    async getArchiveByConversationId(conversationId: string) {
        return (
            await this.ctx.database.get('chatluna_archive', {
                conversationId
            })
        )[0] as ArchiveRecord | undefined
    }

    async listConstraints() {
        const constraints = (await this.ctx.database.get(
            'chatluna_constraint',
            {}
        )) as ConstraintRecord[]

        return constraints
            .filter((constraint) => constraint.enabled !== false)
            .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
    }

    async matchConstraints(session: Session) {
        const constraints = await this.listConstraints()
        return constraints.filter((constraint) =>
            this.isConstraintMatched(constraint, session)
        )
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
        if (users && !users.includes(session.userId)) {
            return false
        }

        const excludeUsers = parseJsonArray(constraint.excludeUsers)
        if (excludeUsers && excludeUsers.includes(session.userId)) {
            return false
        }

        return true
    }

    async resolveConstraint(
        session: Session,
        options: ResolveConversationContextOptions = {}
    ): Promise<ResolvedConstraint> {
        const constraints = await this.matchConstraints(session)
        const routed = constraints.find(
            (constraint) => constraint.routeMode != null
        )

        const routeMode = routed?.routeMode ?? this.getDefaultRouteMode(session)
        const baseKey = computeBaseBindingKey(
            session,
            routeMode,
            routed?.routeKey
        )
        const bindingKey = applyPresetLane(baseKey, options.presetLane)

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
        const matched = await this.resolveBindingForKey(
            session,
            constraint.bindingKey
        )
        const binding = matched?.binding
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
                matched?.bindingKey ?? constraint.bindingKey
            ))
                ? conversation
                : null

        return {
            bindingKey: matched?.bindingKey ?? constraint.bindingKey,
            presetLane: options.presetLane,
            binding: binding ?? null,
            conversation: allowedConversation,
            effectiveModel:
                constraint.fixedModel ??
                allowedConversation?.model ??
                constraint.defaultModel ??
                this.config.defaultModel,
            effectivePreset:
                options.presetLane ??
                constraint.fixedPreset ??
                allowedConversation?.preset ??
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

        const suffix = bindingKey.includes(':preset:')
            ? bindingKey.slice(bindingKey.indexOf(':preset:'))
            : ''

        if (bindingKey.startsWith('custom:')) {
            return null
        }

        const keys = session.isDirect
            ? [`personal:legacy:legacy:direct:${session.userId}${suffix}`]
            : bindingKey.startsWith('shared:')
              ? [
                    `shared:legacy:legacy:${session.guildId ?? session.channelId ?? 'unknown'}${suffix}`,
                    `personal:legacy:legacy:${session.guildId ?? session.channelId ?? 'unknown'}:${session.userId}${suffix}`
                ]
              : [
                    `personal:legacy:legacy:${session.guildId ?? session.channelId ?? 'unknown'}:${session.userId}${suffix}`,
                    `shared:legacy:legacy:${session.guildId ?? session.channelId ?? 'unknown'}${suffix}`
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

                if (resolved.constraint.lockConversation) {
                    throw new Error(
                        'Conversation restore is locked by constraint.'
                    )
                }

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
            preset: resolved.effectivePreset ?? this.config.defaultPreset,
            model: resolved.effectiveModel ?? this.config.defaultModel,
            chatMode: resolved.effectiveChatMode ?? this.config.defaultChatMode,
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
            legacyMeta: null
        }

        await this.ctx.root.parallel('chatluna/conversation-before-create', {
            conversation,
            bindingKey: options.bindingKey
        })
        await this.ctx.database.create('chatluna_conversation', conversation)
        await this.setActiveConversation(options.bindingKey, conversation.id)
        await this.ctx.root.parallel('chatluna/conversation-after-create', {
            conversation,
            bindingKey: options.bindingKey
        })
        return conversation
    }

    async setActiveConversation(bindingKey: string, conversationId: string) {
        const current = await this.getBinding(bindingKey)
        const payload: BindingRecord = {
            bindingKey,
            activeConversationId: conversationId,
            lastConversationId:
                current?.activeConversationId != null &&
                current.activeConversationId !== conversationId
                    ? current.activeConversationId
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

        const updated: ConversationRecord = {
            ...current,
            ...patch,
            id: current.id,
            updatedAt: patch.updatedAt ?? new Date()
        }

        await this.ctx.database.upsert('chatluna_conversation', [updated])
        return updated
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

        const includeArchived = options.includeArchived === true

        return conversations
            .filter(
                (conversation) =>
                    conversation.status !== 'deleted' &&
                    conversation.status !== 'broken' &&
                    (includeArchived || conversation.status !== 'archived')
            )
            .sort((a, b) => {
                const left = a.lastChatAt ?? a.updatedAt ?? a.createdAt
                const right = b.lastChatAt ?? b.updatedAt ?? b.createdAt
                return right.getTime() - left.getTime()
            })
    }

    async switchConversation(
        session: Session,
        options: ResolveTargetConversationOptions
    ) {
        const resolved = await this.resolveContext(session, options)
        await this.assertManageAllowed(session, resolved.constraint)

        if (resolved.constraint.lockConversation) {
            throw new Error('Conversation switch is locked by constraint.')
        }

        const conversation = await this.resolveTargetConversation(session, {
            ...options,
            permission: 'manage'
        })

        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        if (conversation.bindingKey !== resolved.bindingKey) {
            throw new Error('Conversation does not belong to current route.')
        }

        if (!resolved.constraint.allowSwitch) {
            throw new Error('Conversation switch is disabled by constraint.')
        }

        const previousConversation = resolved.binding?.activeConversationId
            ? await this.getConversation(resolved.binding.activeConversationId)
            : null

        await this.ctx.root.parallel('chatluna/conversation-before-switch', {
            bindingKey: resolved.bindingKey,
            conversation,
            previousConversation
        })
        await this.setActiveConversation(resolved.bindingKey, conversation.id)
        await this.ctx.root.parallel('chatluna/conversation-after-switch', {
            bindingKey: resolved.bindingKey,
            conversation,
            previousConversation
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

        if (resolved.constraint.lockConversation) {
            throw new Error('Conversation restore is locked by constraint.')
        }

        const conversation = await this.resolveTargetConversation(session, {
            ...options,
            includeArchived: true,
            permission: 'manage'
        })

        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        if (conversation.bindingKey !== resolved.bindingKey) {
            throw new Error('Conversation does not belong to current route.')
        }

        if (conversation.status !== 'archived') {
            await this.setActiveConversation(
                resolved.bindingKey,
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
        if (records.length < 1) {
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
        if (records == null || records.length < 1) {
            await this.ctx.database.remove('chatluna_acl', {
                conversationId
            })
            return [] as ACLRecord[]
        }

        const current = await this.listAcl(conversationId)
        const removed = current.filter((item) =>
            records.some((record) => {
                if (
                    record.principalType != null &&
                    record.principalType !== item.principalType
                ) {
                    return false
                }

                if (
                    record.principalId != null &&
                    record.principalId !== item.principalId
                ) {
                    return false
                }

                if (
                    record.permission != null &&
                    record.permission !== item.permission
                ) {
                    return false
                }

                return true
            })
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

        if (!resolved.constraint.allowExport) {
            throw new Error('Conversation export is disabled by constraint.')
        }

        const markdown = await this.exportMarkdown(conversation)
        const exportDir = await this.ensureDataDir('export')
        const outputPath =
            options.outputPath ??
            path.join(exportDir, `${conversation.id}-${Date.now()}.md`)

        await fs.writeFile(outputPath, markdown, 'utf8')

        const size = Buffer.byteLength(markdown)
        const checksum = createHash('sha256').update(markdown).digest('hex')

        return {
            conversation,
            path: outputPath,
            size,
            checksum
        }
    }

    async archiveConversation(
        session: Session,
        options: ResolveTargetConversationOptions = {}
    ) {
        const resolved = await this.resolveContext(session, options)
        await this.assertManageAllowed(session, resolved.constraint)

        if (resolved.constraint.lockConversation) {
            throw new Error('Conversation archive is locked by constraint.')
        }

        const conversation = await this.resolveTargetConversation(session, {
            ...options,
            permission: 'manage'
        })

        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        if (!resolved.constraint.allowArchive) {
            throw new Error('Conversation archive is disabled by constraint.')
        }

        return this.archiveConversationById(conversation.id)
    }

    async archiveConversationById(conversationId: string) {
        const conversation = await this.getConversation(conversationId)
        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        await this.ctx.root.parallel('chatluna/conversation-before-archive', {
            conversation
        })

        if (
            conversation.status === 'archived' &&
            conversation.archiveId != null
        ) {
            const archive = await this.getArchive(conversation.archiveId)
            if (archive != null) {
                return {
                    conversation,
                    archive,
                    path: archive.path
                }
            }
        }

        const archiveDir = path.resolve(
            this.ctx.baseDir,
            'data/chatluna/archive',
            conversation.id
        )
        await fs.mkdir(archiveDir, { recursive: true })

        const payload = await this.buildArchivePayload(conversation)
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

        const manifest: ArchiveManifest = {
            format: 'chatluna-archive',
            formatVersion: payload.formatVersion,
            conversationId: conversation.id,
            messageCount: payload.messages.length,
            checksum,
            size: messageBuffer.byteLength,
            createdAt: new Date().toISOString()
        }
        await fs.writeFile(
            path.join(archiveDir, 'manifest.json'),
            JSON.stringify(manifest, null, 2),
            'utf8'
        )

        const archive: ArchiveRecord = {
            id: randomUUID(),
            conversationId: conversation.id,
            path: archiveDir,
            formatVersion: payload.formatVersion,
            messageCount: payload.messages.length,
            checksum,
            size: messageBuffer.byteLength,
            state: 'ready',
            createdAt: new Date(),
            restoredAt: null
        }

        await this.ctx.database.upsert('chatluna_archive', [archive])
        await this.touchConversation(conversation.id, {
            status: 'archived',
            archivedAt: new Date(),
            archiveId: archive.id
        })
        await this.unbindConversation(conversation.id)
        await this.ctx.database.remove('chatluna_message', {
            conversationId: conversation.id
        })
        await this.ctx.chatluna.conversationRuntime.clearConversationInterface(
            conversation
        )

        const updatedConversation = await this.getConversation(conversation.id)

        await this.ctx.root.parallel('chatluna/conversation-after-archive', {
            conversation: updatedConversation ?? conversation,
            archive,
            path: archiveDir
        })

        return {
            conversation: updatedConversation ?? conversation,
            archive,
            path: archiveDir
        }
    }

    async restoreConversation(
        session: Session,
        options: ResolveConversationContextOptions & {
            archiveId?: string
        } = {}
    ) {
        const resolved = await this.resolveContext(session, options)
        const targetConversation = options.conversationId
            ? await this.getConversation(options.conversationId)
            : resolved.conversation
        const conversation = targetConversation ?? resolved.conversation

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

        await this.assertManageAllowed(session, resolved.constraint)

        if (resolved.constraint.lockConversation) {
            throw new Error('Conversation restore is locked by constraint.')
        }

        if (!resolved.constraint.allowArchive) {
            throw new Error('Conversation restore is disabled by constraint.')
        }

        await this.ctx.root.parallel('chatluna/conversation-before-restore', {
            conversation,
            archive
        })

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
            const restoredMessages = payload.messages.map(deserializeMessage)

            await this.ctx.database.remove('chatluna_message', {
                conversationId: conversation.id
            })

            if (restoredMessages.length > 0) {
                await this.ctx.database.upsert(
                    'chatluna_message',
                    restoredMessages
                )
            }

            await this.ctx.database.upsert('chatluna_conversation', [
                {
                    ...conversation,
                    ...restoredConversation,
                    id: conversation.id,
                    status: 'active',
                    archivedAt: null,
                    archiveId: null,
                    updatedAt: new Date()
                }
            ])

            await this.setActiveConversation(
                restoredConversation.bindingKey,
                conversation.id
            )
            await this.ctx.database.upsert('chatluna_archive', [
                {
                    ...archive,
                    state: 'ready',
                    restoredAt: new Date()
                }
            ])

            const updatedConversation = await this.getConversation(
                conversation.id
            )
            if (updatedConversation == null) {
                throw new Error('Conversation restore failed.')
            }

            await this.ctx.chatluna.conversationRuntime.clearConversationInterface(
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

    private async buildArchivePayload(
        conversation: ConversationRecord
    ): Promise<ConversationArchivePayload> {
        const messages = await this.listMessages(conversation.id)

        return {
            formatVersion: 1,
            exportedAt: new Date().toISOString(),
            conversation: serializeConversation(conversation),
            messages: messages.map(serializeMessage)
        }
    }

    async exportMarkdown(conversation: ConversationRecord) {
        const messages = await this.listMessages(conversation.id)

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

        if (resolved.constraint.lockConversation) {
            throw new Error('Conversation rename is locked by constraint.')
        }

        const conversation = await this.resolveTargetConversation(session, {
            ...options,
            permission: 'manage'
        })
        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        const updated = await this.touchConversation(conversation.id, {
            title: options.title.trim()
        })
        if (updated == null) {
            throw new Error('Conversation not found.')
        }
        return updated
    }

    async deleteConversation(
        session: Session,
        options: ResolveTargetConversationOptions = {}
    ) {
        const resolved = await this.resolveContext(session, options)
        await this.assertManageAllowed(session, resolved.constraint)

        if (resolved.constraint.lockConversation) {
            throw new Error('Conversation delete is locked by constraint.')
        }

        const conversation = await this.resolveTargetConversation(session, {
            ...options,
            includeArchived: true,
            permission: 'manage'
        })
        if (conversation == null) {
            throw new Error('Conversation not found.')
        }

        const updated = await this.touchConversation(conversation.id, {
            status: 'deleted',
            archivedAt: null
        })
        await this.ctx.root.parallel('chatluna/conversation-before-delete', {
            conversation
        })
        await this.unbindConversation(conversation.id)
        await this.ctx.database.remove('chatluna_message', {
            conversationId: conversation.id
        })
        await this.removeAcl(conversation.id)
        await this.ctx.chatluna.conversationRuntime.clearConversationInterface(
            conversation
        )
        await this.ctx.root.parallel('chatluna/conversation-after-delete', {
            conversation: updated ?? conversation
        })
        return updated ?? conversation
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

        if (resolved.constraint.lockConversation) {
            throw new Error('Conversation update is locked by constraint.')
        }

        if (options.model != null && resolved.constraint.fixedModel != null) {
            throw new Error(
                `Model is fixed to ${resolved.constraint.fixedModel}.`
            )
        }

        if (options.preset != null && resolved.constraint.fixedPreset != null) {
            throw new Error(
                `Preset is fixed to ${resolved.constraint.fixedPreset}.`
            )
        }

        if (
            options.chatMode != null &&
            resolved.constraint.fixedChatMode != null
        ) {
            throw new Error(
                `Chat mode is fixed to ${resolved.constraint.fixedChatMode}.`
            )
        }

        const updated = await this.touchConversation(resolved.conversation.id, {
            model: options.model ?? resolved.conversation.model,
            preset: options.preset ?? resolved.conversation.preset,
            chatMode: options.chatMode ?? resolved.conversation.chatMode
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
        if (!result.compressed) {
            return await this.getConversation(conversationId)
        }

        const conversation = await this.getConversation(conversationId)
        if (conversation == null) {
            return undefined
        }

        const current = parseCompressionRecord(conversation.compression)
        const messages = await this.listMessages(conversationId)
        const summary = messages.find(
            (message) => message.name === 'infinite_context'
        )?.text

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
            name:
                current?.name ??
                `managed:${session.platform}:${session.selfId}:${route}`,
            enabled: current?.enabled ?? true,
            priority: current?.priority ?? 1000,
            createdBy: current?.createdBy ?? session.userId,
            createdAt: current?.createdAt ?? now,
            updatedAt: now,
            platform: session.platform,
            selfId: session.selfId,
            guildId: session.isDirect
                ? null
                : (session.guildId ?? session.channelId ?? null),
            channelId: null,
            direct: session.isDirect,
            users: session.isDirect ? JSON.stringify([session.userId]) : null,
            excludeUsers: null,
            routeMode: current?.routeMode ?? null,
            routeKey: current?.routeKey ?? null,
            defaultModel: current?.defaultModel ?? null,
            defaultPreset: current?.defaultPreset ?? null,
            defaultChatMode: current?.defaultChatMode ?? null,
            fixedModel: current?.fixedModel ?? null,
            fixedPreset: current?.fixedPreset ?? null,
            fixedChatMode: current?.fixedChatMode ?? null,
            lockConversation: current?.lockConversation ?? null,
            allowNew: current?.allowNew ?? null,
            allowSwitch: current?.allowSwitch ?? null,
            allowArchive: current?.allowArchive ?? null,
            allowExport: current?.allowExport ?? null,
            manageMode: current?.manageMode ?? 'admin',
            ...patch
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
        const conversations = (await this.ctx.database.get(
            'chatluna_conversation',
            {
                bindingKey
            }
        )) as ConversationRecord[]

        const maxSeq = conversations.reduce((current, conversation) => {
            const seq = conversation.seq ?? 0
            return seq > current ? seq : current
        }, 0)

        return maxSeq + 1
    }

    async resolveTargetConversation(
        session: Session,
        options: ResolveTargetConversationOptions = {}
    ) {
        if (options.conversationId != null) {
            const resolved = await this.resolveContext(session, options)
            const conversation = await this.getConversation(
                options.conversationId
            )

            if (conversation == null) {
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

        const resolved = await this.resolveContext(session, options)
        const target = options.targetConversation?.trim()

        if (target == null || target.length === 0) {
            return resolved.conversation ?? null
        }

        const conversations = await this.listConversations(session, {
            presetLane: options.presetLane,
            includeArchived: options.includeArchived
        })

        const byId = conversations.find(
            (conversation) => conversation.id === target
        )
        if (byId != null) {
            return byId
        }

        if (/^\d+$/.test(target)) {
            const seq = Number(target)
            const bySeq = conversations.find(
                (conversation) => conversation.seq === seq
            )
            if (bySeq != null) {
                return bySeq
            }
        }

        const normalized = target.toLocaleLowerCase()
        const exactTitle = conversations.find(
            (conversation) =>
                conversation.title.toLocaleLowerCase() === normalized
        )
        if (exactTitle != null) {
            return exactTitle
        }

        const partialMatches = conversations.filter((conversation) =>
            conversation.title.toLocaleLowerCase().includes(normalized)
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

        const globalById = globalMatches.find(
            (conversation) => conversation.id === target
        )
        if (globalById != null) {
            return globalById
        }

        const globalExactTitle = globalMatches.find(
            (conversation) =>
                conversation.title.toLocaleLowerCase() === normalized
        )
        if (globalExactTitle != null) {
            return globalExactTitle
        }

        const globalPartialMatches = globalMatches.filter((conversation) =>
            conversation.title.toLocaleLowerCase().includes(normalized)
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
        const conversations = (await this.ctx.database.get(
            'chatluna_conversation',
            {}
        )) as ConversationRecord[]
        const required = options.permission ?? 'view'

        const matches: ConversationRecord[] = []

        for (const conversation of conversations) {
            if (
                conversation.bindingKey === options.bindingKey ||
                conversation.status === 'deleted' ||
                conversation.status === 'broken' ||
                (!options.includeArchived && conversation.status === 'archived')
            ) {
                continue
            }

            const title = conversation.title.toLocaleLowerCase()
            const matched =
                conversation.id === options.exactId ||
                (options.seq != null && conversation.seq === options.seq) ||
                title === options.query ||
                title.includes(options.query)

            if (!matched) {
                continue
            }

            if (
                !(await this.hasConversationPermission(
                    session,
                    conversation,
                    required,
                    options.bindingKey
                ))
            ) {
                continue
            }

            matches.push(conversation)
        }

        return matches
    }

    async resolveCommandConversation(
        session: Session,
        options: ResolveTargetConversationOptions = {}
    ) {
        return this.resolveTargetConversation(session, {
            ...options,
            permission: options.permission ?? 'view'
        })
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
        const bindings = (await this.ctx.database.get(
            'chatluna_binding',
            {}
        )) as BindingRecord[]

        for (const binding of bindings) {
            if (
                binding.activeConversationId !== conversationId &&
                binding.lastConversationId !== conversationId
            ) {
                continue
            }

            await this.ctx.database.upsert('chatluna_binding', [
                {
                    ...binding,
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
        constraint: ResolvedConstraint
    ) {
        if (constraint.manageMode !== 'admin') {
            return
        }

        if (await isAdmin(session)) {
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

        if (await isAdmin(session)) {
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
        lastChatAt: conversation.lastChatAt?.toISOString() ?? null,
        archivedAt: conversation.archivedAt?.toISOString() ?? null
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

async function isAdmin(session: Session) {
    if (
        (session as Session & { user?: { authority?: number } }).user
            ?.authority != null
    ) {
        return (
            ((session as Session & { user?: { authority?: number } }).user
                ?.authority ?? 0) >= 3
        )
    }

    if ((session as Session & { authority?: number }).authority != null) {
        return (
            ((session as Session & { authority?: number }).authority ?? 0) >= 3
        )
    }

    if (typeof session.getUser === 'function') {
        const user = await session.getUser(session.userId, ['authority'])
        return (user?.authority ?? 0) >= 3
    }

    return false
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
