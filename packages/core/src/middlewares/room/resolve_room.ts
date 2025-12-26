/* eslint-disable operator-linebreak */
import { Context, h, Logger, Session } from 'koishi'
import { Config } from '../../config'

import { ConversationRoom } from '../../types'
import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ChainMiddlewareRunStatus, ChatChain } from '../../chains/chain'
import {
    createConversationRoom,
    getAllJoinedConversationRoom,
    getConversationRoomCount as getMaxConversationRoomId,
    getTemplateConversationRoom,
    queryJoinedConversationRoom,
    queryPublicConversationRoom,
    switchConversationRoom
} from '../../chains/rooms'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { randomUUID } from 'crypto'

let logger: Logger

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    logger = createLogger(ctx)
    const selectRoomForSession = async (
        session: Session,
        joinedRooms: ConversationRoom[]
    ) => pickContextualRoom(ctx, session, config, joinedRooms)

    chain
        .middleware('resolve_room', async (session, context) => {
            if (context.options.room != null) {
                return ChainMiddlewareRunStatus.CONTINUE
            }

            let joinRoom = await queryJoinedConversationRoom(
                ctx,
                session,
                context.options?.room_resolve?.name
            )

            if (config.allowChatWithRoomName) {
                const needContinue = context.command == null

                const rawMessageContent = context.message

                const messageContent =
                    typeof rawMessageContent === 'string'
                        ? rawMessageContent
                        : h
                              .select(rawMessageContent as h[], 'text')
                              .join('')
                              .trimStart()

                // split the chat content
                const splitContent = messageContent.split(' ')

                let matchedRoom: ConversationRoom

                // the first word is the room name
                if (splitContent.length > 1) {
                    matchedRoom = await queryJoinedConversationRoom(
                        ctx,
                        session,
                        splitContent.shift()
                    )
                }

                if (matchedRoom == null || !needContinue) {
                    return ChainMiddlewareRunStatus.STOP
                }

                if (matchedRoom != null) {
                    joinRoom = matchedRoom

                    context.options.inputMessage =
                        await ctx.chatluna.messageTransformer.transform(
                            session,
                            [h.text(splitContent.concat(' '))],
                            matchedRoom.model,
                            undefined,
                            {
                                quote: false,
                                includeQuoteReply: config.includeQuoteReply
                            }
                        )
                }
            }

            if (joinRoom == null) {
                const joinedRooms = await getAllJoinedConversationRoom(
                    ctx,
                    session
                )

                if (joinedRooms.length > 0) {
                    joinRoom = await selectRoomForSession(session, joinedRooms)
                }

                if (joinRoom != null) {
                    await switchConversationRoom(ctx, session, joinRoom.roomId)

                    logger.success(
                        session.text('chatluna.room.auto_switch', [
                            session.userId,
                            joinRoom.roomName
                        ])
                    )
                }
            }

            if (
                joinRoom == null &&
                config.autoCreateRoomFromUser !== true &&
                !session.isDirect &&
                (context.command?.length ?? 0) < 1
            ) {
                joinRoom = await queryPublicConversationRoom(ctx, session)
                if (joinRoom != null) {
                    logger.success(
                        session.text('chatluna.room.auto_switch', [
                            session.userId,
                            joinRoom.roomName
                        ])
                    )
                }
            }

            if (joinRoom == null && (context.command?.length ?? 0) < 1) {
                // 尝试基于模板房间创建模版克隆房间

                if (
                    (config.defaultModel === '无' ||
                        (config.defaultModel?.trim()?.length || 0) < 1) &&
                    ctx.chatluna.platform.listAllModels(ModelType.llm).value
                        .length < 1
                ) {
                    return session.text('chatluna.not_available_model')
                }

                const templateRoom = await getTemplateConversationRoom(
                    ctx,
                    config
                )

                if (templateRoom == null) {
                    // 没有就算了。后面需要房间的中间件直接报错就完事。
                    return ChainMiddlewareRunStatus.SKIPPED
                }

                const cloneRoom = structuredClone(templateRoom)

                cloneRoom.conversationId = randomUUID()

                // 私聊或者总是主动创建
                if (config.autoCreateRoomFromUser || session.isDirect) {
                    // 如果是群聊的公共房间，那么就房主直接设置为聊天者，否则就是私聊
                    cloneRoom.roomMasterId = session.userId

                    cloneRoom.visibility = 'private'

                    cloneRoom.roomId = (await getMaxConversationRoomId(ctx)) + 1

                    cloneRoom.roomName = session.text(
                        'chatluna.room.room_name',
                        [
                            session.isDirect
                                ? `${session.username ?? session.userId}`
                                : `${
                                      session.event.guild.name ??
                                      session.username ??
                                      session.event.guild.id.toString()
                                  }`
                        ]
                    )

                    logger.success(
                        session.text('chatluna.room.auto_create', [
                            session.userId,
                            cloneRoom.roomName
                        ])
                    )
                } else {
                    // 如果是群聊的公共房间，那么就房主直接设置为聊天者，否则就是私聊
                    cloneRoom.roomMasterId = session.userId

                    cloneRoom.visibility = 'template_clone'

                    cloneRoom.roomId = (await getMaxConversationRoomId(ctx)) + 1

                    cloneRoom.roomName = session.text(
                        'chatluna.room.template_clone_room_name',
                        [
                            session.isDirect
                                ? `${session.username ?? session.userId}`
                                : `${
                                      session.event.guild.name ??
                                      session.username ??
                                      session.event.guild.id.toString()
                                  }`
                        ]
                    )

                    logger.success(
                        session.text('chatluna.room.auto_create_template', [
                            session.userId,
                            cloneRoom.roomName
                        ])
                    )
                }

                // 如果设置不关闭，则跟随更新
                cloneRoom.autoUpdate =
                    config.autoUpdateRoomMode !== 'disable' ||
                    cloneRoom.visibility === 'template_clone'

                await createConversationRoom(ctx, session, cloneRoom)

                joinRoom = cloneRoom
            }

            if (
                joinRoom != null &&
                joinRoom.autoUpdate !== true &&
                config.autoUpdateRoomMode === 'all'
            ) {
                joinRoom.autoUpdate = true
            }

            if (joinRoom?.autoUpdate === true) {
                // 直接从配置里面复制

                // 对于 preset，chatModel 的变更，我们需要写入数据库
                let needUpdate = false
                if (
                    joinRoom.preset !== config.defaultPreset ||
                    joinRoom.chatMode !== config.defaultChatMode ||
                    joinRoom.model !== config.defaultModel
                ) {
                    needUpdate = true
                }

                joinRoom.model = config.defaultModel
                joinRoom.preset = config.defaultPreset
                joinRoom.chatMode = config.defaultChatMode

                if (joinRoom.preset !== config.defaultPreset) {
                    logger.debug(
                        `The room ${joinRoom.roomName} preset changed to ${joinRoom.preset}. Clearing chat history.`
                    )
                    // 需要提前清空聊天记录
                    await ctx.chatluna.clearChatHistory(joinRoom)
                }

                if (needUpdate) {
                    await ctx.chatluna.clearCache(joinRoom)

                    await ctx.database.upsert('chathub_room', [joinRoom])

                    logger.debug(
                        session.text('chatluna.room.config_changed', [
                            joinRoom.roomName
                        ])
                    )
                }
            }

            context.options.room = joinRoom

            return ChainMiddlewareRunStatus.CONTINUE
        })
        .after('lifecycle-prepare')
    //  .before("lifecycle-request_model")
}

export type ChatMode = 'plugin' | 'chat' | 'browsing'
async function pickContextualRoom(
    ctx: Context,
    session: Session,
    config: Config,
    joinedRooms: ConversationRoom[]
) {
    if (joinedRooms.length === 0) {
        return undefined
    }

    if (!session.isDirect && config.autoCreateRoomFromUser !== true) {
        // Only consider rooms scoped to the current guild to avoid leaking DM rooms.
        const groupRooms = await ctx.database.get('chathub_room_group_member', {
            groupId: session.guildId,
            roomId: { $in: joinedRooms.map((room) => room.roomId) }
        })

        if (groupRooms.length > 0) {
            const scopedRoomIds = new Set(groupRooms.map((room) => room.roomId))

            const findScopedRoom = (
                matcher?: (room: ConversationRoom) => boolean
            ) =>
                joinedRooms.find((room) => {
                    if (!scopedRoomIds.has(room.roomId)) {
                        return false
                    }
                    return matcher ? matcher(room) : true
                })

            return (
                findScopedRoom(
                    (room) => room.visibility === 'template_clone'
                ) ?? findScopedRoom()
            )
        }

        // No group-specific rooms exist yet. Let the caller create a clone for this guild.
        return undefined
    }

    // DM sessions (and auto-create mode) still prefer private rooms owned by the user.
    return (
        joinedRooms.find(
            (room) =>
                room.visibility === 'private' &&
                room.roomMasterId === session.userId
        ) ??
        joinedRooms.find((room) => room.visibility === 'private') ??
        joinedRooms.find((room) => room.visibility !== 'template_clone') ??
        joinedRooms[0]
    )
}

declare module '../../chains/chain' {
    export interface ChainMiddlewareContextOptions {
        room?: ConversationRoom
    }

    interface ChainMiddlewareName {
        resolve_room: never
    }
}
