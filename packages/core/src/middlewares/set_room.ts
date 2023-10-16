import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { checkAdmin, getAllJoinedConversationRoom } from '../chains/rooms'
import { ModelType } from '../llm-core/platform/types'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const service = ctx.chathub.platform

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
                context.message = '未找到指定的房间。'
                return ChainMiddlewareRunStatus.STOP
            }

            if (
                room.roomMasterId !== session.userId &&
                !(await checkAdmin(session))
            ) {
                context.message = '你不是房间的房主，无法设置房间的属性。'
                return ChainMiddlewareRunStatus.STOP
            }

            const oldPreset = room.preset

            if (
                Object.values(room_resolve).filter((value) => value != null)
                    .length > 0 &&
                room_resolve.visibility !== 'template'
            ) {
                await context.send(
                    '你目前已设置参数，是否直接更新房间属性？如需直接更新请回复 Y，如需进入交互式创建请回复 N，其他回复将视为取消。'
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消设置房间属性。'
                    return ChainMiddlewareRunStatus.STOP
                }

                if (result === 'Y') {
                    if (
                        (!session.isDirect || room.visibility !== 'private') &&
                        room_resolve.password != null
                    ) {
                        context.message = '你无法在非私有房间或群聊中设置密码。'
                        return ChainMiddlewareRunStatus.STOP
                    }
                    room.preset = room_resolve.preset ?? room.preset
                    room.roomName = room_resolve.name ?? room.roomName
                    room.chatMode = room_resolve.chatMode ?? room.chatMode
                    room.password = room_resolve.password ?? room.password

                    room.visibility =
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        (room_resolve.visibility as any) ?? room.visibility
                    room.model = room_resolve.model ?? room.model

                    await ctx.database.upsert('chathub_room', [room])

                    if (room.preset !== oldPreset) {
                        await ctx.chathub.clearChatHistory(room)
                        context.message = `房间 ${room.roomName} 已更新，聊天记录已被清空。`
                    } else {
                        await ctx.chathub.clearCache(room)
                        context.message = `房间 ${room.roomName} 已更新。`
                    }

                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'N') {
                    context.message = '你已取消设置房间属性。'
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
                `你已经选择了房间名：${name}，是否需要更换？如无须更改请回复 N，否则回复更换后的房间名。`
            )

            let result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = '你超时未回复，已取消设置房间属性'
                return ChainMiddlewareRunStatus.STOP
            } else if (result !== 'N') {
                name = result.trim()
                room.roomName = name
            }

            // 2. 选择模型

            while (true) {
                await context.send(
                    `你已经选择了模型：${model}，是否需要更换？如需更换请回复更换后的模型，否则回复 N。`
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消设置房间属性。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'N') {
                    model = result.trim()

                    room.model = model
                }

                model = room.model

                const findModel = service
                    .getAllModels(ModelType.llm)
                    .find((searchModel) => searchModel === model)

                if (findModel == null) {
                    await context.send(`无法找到模型：${model}，请重新输入。`)
                    room_resolve.model = null
                    continue
                } else {
                    await context.send(`你已确认使用模型：${model}。`)
                    break
                }
            }

            // 3. 选择预设

            const presetInstance = ctx.chathub.preset

            while (true) {
                await context.send(
                    `你已经选择了预设：${preset}，是否需要更换？如需更换请回复更换后的预设，否则回复 N。`
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消设置房间属性。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'N') {
                    room.preset = result.trim()
                }

                preset = room.preset

                try {
                    await presetInstance.getPreset(preset)
                    break
                } catch (e) {
                    await context.send(`无法找到预设：${preset}，请重新输入。`)
                    room.preset = null
                    continue
                }
            }

            // 4. 可见性
            while (true) {
                await context.send(
                    `你已经选择了可见性：${visibility}，是否需要更换？如需更换请回复更换后的可见性，否则回复 N。`
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消设置房间属性。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'N') {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    room.visibility = result.trim() as any
                }

                visibility = room.visibility

                if (visibility === 'private' || visibility === 'public') {
                    break
                }

                await context.send(
                    `无法识别可见性：${visibility}，请重新输入。`
                )
            }

            // 5. 聊天模式

            await context.send(
                `你已经选择了聊天模式：${chatMode}，是否需要更换？如需更换请回复更换后的聊天模式，否则回复 N。`
            )

            result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = '你超时未回复，已取消设置房间属性。'
                return ChainMiddlewareRunStatus.STOP
            } else if (result !== 'N') {
                room.chatMode = result.trim()
            }

            chatMode = room.chatMode

            // 6. 密码
            if (
                session.isDirect &&
                visibility === 'private' &&
                password == null
            ) {
                await context.send(
                    '请输入你需要使用的密码，如：123456。如果不输入密码请回复 N（则不设置密码）。否则回复你需要使用的密码。'
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消设置房间属性。'
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
                await ctx.chathub.clearChatHistory(room)
                context.message = `房间 ${room.roomName} 已更新，聊天记录已被清空。`
            } else {
                await ctx.chathub.clearCache(room)
                context.message = `房间 ${room.roomName} 已更新。`
            }

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        set_room: never
    }
}
