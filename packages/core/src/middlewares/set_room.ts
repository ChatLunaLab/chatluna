import { Context, Session } from 'koishi'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import {
    ChainMiddlewareContext,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../chains/chain'
import { checkAdmin, getAllJoinedConversationRoom } from '../chains/rooms'
import { Config } from '../config'
import { ConversationRoom } from '../types'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const service = ctx.chatluna.platform

    chain
        .middleware('set_room', async (session, context) => {
            let {
                command,
                // eslint-disable-next-line @typescript-eslint/naming-convention
                options: { room_resolve, room }
            } = context

            if (command !== 'set_room') return ChainMiddlewareRunStatus.SKIPPED

            if (room == null && context.options.room_resolve != null) {
                // 尝试完整搜索一次

                const rooms = await getAllJoinedConversationRoom(
                    ctx,
                    session,
                    true
                )

                const roomId = parseInt(context.options.room_resolve?.name)

                room = rooms.find(
                    (room) =>
                        room.roomName === context.options.room_resolve?.name ||
                        room.roomId === roomId
                )
            }

            if (room == null) {
                context.message = session.text('.room_not_found')
                return ChainMiddlewareRunStatus.STOP
            }

            if (
                room.roomMasterId !== session.userId &&
                !(await checkAdmin(session))
            ) {
                context.message = session.text('.not_room_master')
                return ChainMiddlewareRunStatus.STOP
            }

            const oldPreset = room.preset

            if (
                Object.values(room_resolve).filter((value) => value != null)
                    .length > 0 &&
                room_resolve.visibility !== 'template'
            ) {
                await context.send(session.text('.confirm_update'))

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                }

                if (result === 'Y') {
                    if (
                        (!session.isDirect || room.visibility !== 'private') &&
                        room_resolve.password != null
                    ) {
                        context.message = session.text('.no_password_in_public')
                        return ChainMiddlewareRunStatus.STOP
                    }
                    room.preset = room_resolve.preset ?? room.preset
                    room.roomName = room_resolve.name ?? room.roomName
                    room.chatMode = room_resolve.chatMode ?? room.chatMode
                    room.password = room_resolve.password ?? room.password
                    room.visibility =
                        (room_resolve.visibility as ConversationRoom['visibility']) ??
                        room.visibility
                    room.model = room_resolve.model ?? room.model

                    if (
                        !(await checkRoomAvailability(
                            context,
                            session,
                            ctx,
                            room
                        ))
                    ) {
                        context.message = session.text('.failed', [
                            room.roomName
                        ])
                        return ChainMiddlewareRunStatus.STOP
                    }

                    await ctx.database.upsert('chathub_room', [room])

                    if (room.preset !== oldPreset) {
                        await ctx.chatluna.clearChatHistory(room)
                        context.message = session.text('.success_with_clear', [
                            room.roomName
                        ])
                    } else {
                        await ctx.chatluna.clearCache(room)
                        context.message = session.text('.success', [
                            room.roomName
                        ])
                    }

                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'N') {
                    context.message = session.text('.cancelled')
                    return ChainMiddlewareRunStatus.STOP
                }
            }

            // 交互式创建

            let {
                model,
                preset,
                roomName: name,
                chatMode,
                password,
                visibility
            } = room

            // 1. 输入房间名

            await context.send(
                session.text('.change_or_keep', [
                    session.text('.field.name'),
                    name
                ])
            )

            const result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = session.text('.timeout')
                return ChainMiddlewareRunStatus.STOP
            } else if (result === 'Q') {
                context.message = session.text('.cancelled')
                return ChainMiddlewareRunStatus.STOP
            } else if (result !== 'N') {
                name = result.trim()
                room.roomName = name
            }

            // 2. 选择模型

            while (true) {
                await context.send(
                    session.text('.change_or_keep', [
                        session.text('.field.model'),
                        model
                    ])
                )

                const result = (await session.prompt(1000 * 30))?.trim()

                if (!result) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'Q') {
                    context.message = session.text('.cancelled')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N') {
                    break
                }

                const findModel = service
                    .getAllModels(ModelType.llm)
                    .find((searchModel) => searchModel === result)

                if (findModel == null) {
                    await context.send(
                        session.text('.model_not_found', [result])
                    )
                    continue
                }

                model = result
                room.model = model

                break
            }

            // 3. 选择预设

            const presetInstance = ctx.chatluna.preset

            while (true) {
                await context.send(
                    session.text('.change_or_keep', [
                        session.text('.field.preset'),
                        preset
                    ])
                )

                const result = (await session.prompt(1000 * 30))?.trim()

                if (!result) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'Q') {
                    context.message = session.text('.cancelled')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N') {
                    break
                }

                try {
                    await presetInstance.getPreset(result)
                    room.preset = preset = result
                    break
                } catch (e) {
                    await context.send(
                        session.text('.preset_not_found', [result])
                    )
                    continue
                }
            }

            // 4. 可见性
            while (true) {
                await context.send(
                    session.text('.change_or_keep', [
                        session.text('.field.visibility'),
                        visibility
                    ])
                )

                const result = (await session.prompt(1000 * 30))?.trim()

                if (!result) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'Q') {
                    context.message = session.text('.cancelled')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N') {
                    break
                }

                if (result === 'private' || result === 'public') {
                    visibility = room.visibility = result
                    break
                }

                await context.send(
                    session.text('.invalid_visibility', [result])
                )
            }

            // 5. 聊天模式

            while (true) {
                if (chatMode == null) {
                    await context.send(session.text('.enter_chat_mode'))

                    const result = await session.prompt(1000 * 30)

                    if (result == null) {
                        context.message = session.text('.timeout')
                        return ChainMiddlewareRunStatus.STOP
                    } else if (result === 'Q') {
                        context.message = session.text('.cancelled')
                        return ChainMiddlewareRunStatus.STOP
                    } else if (result === 'N') {
                        room.chatMode = 'chat'
                    } else {
                        room.chatMode = result.trim()
                    }
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.field.chat_mode'),
                            chatMode
                        ])
                    )

                    const result = await session.prompt(1000 * 30)

                    if (result == null) {
                        context.message = session.text('.timeout')
                        return ChainMiddlewareRunStatus.STOP
                    } else if (result === 'Q') {
                        context.message = session.text('.cancelled')
                        return ChainMiddlewareRunStatus.STOP
                    } else if (result !== 'N') {
                        room.chatMode = result.trim()
                    }
                }

                chatMode = room.chatMode

                const availableChatModes = ctx.chatluna.platform
                    .getChatChains()
                    .map((chain) => chain.name)

                if (availableChatModes.includes(chatMode)) {
                    break
                }

                await context.send(
                    session.text('.invalid_chat_mode', [
                        visibility,
                        availableChatModes.join(', ')
                    ])
                )
            }

            // 6. 密码
            if (
                session.isDirect &&
                visibility === 'private' &&
                password == null
            ) {
                await context.send(session.text('.enter_password'))

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'Q') {
                    context.message = session.text('.cancelled')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N') {
                    room.password = null
                } else {
                    room.password = result.trim()
                }
            }

            // 7. 更新房间

            await ctx.database.upsert('chathub_room', [room])

            if (room.preset !== oldPreset) {
                await ctx.chatluna.clearChatHistory(room)
                context.message = session.text('.success_with_clear', [
                    room.roomName
                ])
            } else {
                await ctx.chatluna.clearCache(room)
                context.message = session.text('.success', [room.roomName])
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

async function checkRoomAvailability(
    context: ChainMiddlewareContext,
    session: Session,
    ctx: Context,
    room: ConversationRoom
) {
    const availableChatModes = ctx.chatluna.platform
        .getChatChains()
        .map((chain) => chain.name)

    if (!availableChatModes.includes(room.chatMode)) {
        await context.send(
            session.text('.invalid_chat_mode', [
                room.chatMode,
                availableChatModes.join(', ')
            ])
        )
        return false
    }

    const findModel = ctx.chatluna.platform
        .getAllModels(ModelType.llm)
        .find((searchModel) => searchModel === room.model)

    if (findModel == null) {
        await context.send(session.text('.model_not_found', [room.model]))
        return false
    }

    try {
        await ctx.chatluna.preset.getPreset(room.preset)
    } catch (e) {
        await context.send(session.text('.preset_not_found', [room.preset]))
        return false
    }

    const visibility = room.visibility
    if (visibility === 'private' || visibility === 'public') {
        return true
    }

    await context.send(session.text('.invalid_visibility', [visibility]))
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        set_room: never
    }
}
