import { Context, h, Session } from 'koishi'
import { Config } from '../config'
import {
    ChainMiddlewareContext,
    ChainMiddlewareContextOptions,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../chains/chain'
import { createLogger } from '../utils/logger'
import {
    createConversationRoom,
    getConversationRoomCount,
    getTemplateConversationRoom
} from '../chains/rooms'
import { ConversationRoom } from '../types'
import { randomUUID } from 'crypto'
import { ModelType } from '../llm-core/platform/types'

const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const service = ctx.chathub.platform

    chain
        .middleware('create_room', async (session, context) => {
            const {
                command,
                options: { room_resolve }
            } = context

            if (command !== 'create_room') return ChainMiddlewareRunStatus.SKIPPED

            if (!room_resolve) return ChainMiddlewareRunStatus.SKIPPED

            let { model, preset, name, chatMode, password, visibility } = room_resolve

            logger.debug(
                `[create_room] model: ${model}, length: ${
                    Object.values(room_resolve).filter((value) => value != null).length
                }, visibility: ${visibility}`
            )

            if (
                Object.values(room_resolve).filter((value) => value != null).length > 0 &&
                model != null &&
                visibility !== 'template'
            ) {
                await context.send(
                    '你目前已提供基础参数，是否直接创建房间？如需直接创建房间请回复 Y，如需进入交互式创建请回复 N，其他回复将视为取消。'
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建房间。'
                    return ChainMiddlewareRunStatus.STOP
                }

                if (result === 'Y') {
                    room_resolve.preset = room_resolve.preset ?? 'chatgpt'
                    room_resolve.name = room_resolve.name ?? '未命名房间'
                    room_resolve.chatMode = room_resolve.chatMode ?? 'chat'
                    room_resolve.password = room_resolve.password ?? null
                    room_resolve.visibility = room_resolve.visibility ?? 'private'
                    room_resolve.model = room_resolve.model ?? null

                    await createRoom(ctx, context, session, context.options)

                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'N') {
                    context.message = '你已取消创建房间。'
                    return ChainMiddlewareRunStatus.STOP
                }
            }

            // 交互式创建

            // 1. 输入房间名

            if (name == null) {
                await context.send('请输入你需要使用的房间名，如：' + '我的房间')

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建房间。'
                    return ChainMiddlewareRunStatus.STOP
                }

                name = result.trim()
                room_resolve.name = name
            } else {
                await context.send(
                    `你已经输入了房间名：${name}，是否需要更换？如需更换请回复更换后的房间名，否则回复 N。`
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建房间。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'N') {
                    name = result.trim()

                    room_resolve.name = name
                }
            }

            // 2. 选择模型

            while (true) {
                if (model == null) {
                    await context.send('请输入你需要使用的模型，如：' + 'openai/gpt-3.5-turbo')

                    const result = await session.prompt(1000 * 30)

                    if (result == null) {
                        context.message = '你超时未回复，已取消创建房间。'
                        return ChainMiddlewareRunStatus.STOP
                    }

                    model = result.trim()
                    room_resolve.model = model
                } else {
                    await context.send(
                        `你已经选择了模型：${model}，是否需要更换？如需更换请回复更换后的模型，否则回复 N。`
                    )

                    const result = await session.prompt(1000 * 30)

                    if (result == null) {
                        context.message = '你超时未回复，已取消创建房间。'
                        return ChainMiddlewareRunStatus.STOP
                    } else if (result !== 'N') {
                        model = result.trim()

                        room_resolve.model = model
                    }
                }

                model = room_resolve.model

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
                if (preset == null) {
                    await context.send(
                        '请输入你需要使用的预设，如：chatgpt。如果不输入预设请回复 N（则使用默认 chatgpt 预设）。否则回复你需要使用的预设。'
                    )

                    const result = await session.prompt(1000 * 30)

                    if (result == null) {
                        context.message = '你超时未回复，已取消创建房间。'
                        return ChainMiddlewareRunStatus.STOP
                    } else if (result === 'N') {
                        room_resolve.preset = 'chatgpt'
                    } else {
                        room_resolve.preset = result.trim()
                    }
                } else {
                    await context.send(
                        `你已经选择了预设：${preset}，是否需要更换？如需更换请回复更换后的预设，否则回复 N。`
                    )

                    const result = await session.prompt(1000 * 30)

                    if (result == null) {
                        context.message = '你超时未回复，已取消创建房间。'
                        return ChainMiddlewareRunStatus.STOP
                    } else if (result !== 'N') {
                        room_resolve.preset = result.trim()
                    }
                }

                preset = room_resolve.preset

                try {
                    await presetInstance.getPreset(preset)
                    break
                } catch {
                    await context.send(`无法找到预设：${preset}，请重新输入。`)
                    room_resolve.preset = null
                    continue
                }
            }

            // 4. 可见性
            while (true) {
                if (visibility == null) {
                    await context.send(
                        '请输入你需要使用的可见性，如：private。如果不输入可见性请回复 N（则使用默认 private 可见性）。否则回复你需要使用的可见性。(目前支持 public, private)'
                    )

                    const result = await session.prompt(1000 * 30)

                    if (result == null) {
                        context.message = '你超时未回复，已取消创建房间。'
                        return ChainMiddlewareRunStatus.STOP
                    } else if (result === 'N') {
                        room_resolve.visibility = 'private'
                    } else {
                        room_resolve.visibility = result.trim()
                    }
                } else {
                    await context.send(
                        `你已经选择了可见性：${visibility}，是否需要更换？如需更换请回复更换后的可见性(目前支持 public, private, template)，否则回复 N。`
                    )

                    const result = await session.prompt(1000 * 30)

                    if (result == null) {
                        context.message = '你超时未回复，已取消创建房间。'
                        return ChainMiddlewareRunStatus.STOP
                    } else if (result !== 'N') {
                        room_resolve.visibility = result.trim()
                    }
                }

                visibility = room_resolve.visibility

                if (visibility === 'private' || visibility === 'public') {
                    break
                }

                await context.send(`无法识别可见性：${visibility}，请重新输入。`)
            }

            // 5. 聊天模式

            if (chatMode == null) {
                await context.send(
                    '请输入你需要使用的聊天模式，如：chat。如果不输入聊天模式请回复 N（则使用默认 chat 聊天模式）。否则回复你需要使用的聊天模式。'
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建房间。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N') {
                    room_resolve.chatMode = 'chat'
                } else {
                    room_resolve.chatMode = result.trim()
                }
            } else {
                await context.send(
                    `你已经选择了聊天模式：${chatMode}，是否需要更换？如需更换请回复更换后的聊天模式，否则回复 N。`
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建房间。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'N') {
                    room_resolve.chatMode = result.trim()
                }
            }

            chatMode = room_resolve.chatMode

            // 6. 密码
            if (session.isDirect && visibility === 'private' && password == null) {
                await context.send(
                    '请输入你需要使用的密码，如：123456。如果不输入密码请回复 N（则不设置密码）。否则回复你需要使用的密码。'
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建房间。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N') {
                    room_resolve.password = null
                } else {
                    room_resolve.password = result.trim()
                }
            }

            // 7. 创建房间
            await createRoom(ctx, context, session, context.options)

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

async function createRoom(
    ctx: Context,
    context: ChainMiddlewareContext,
    session: Session,
    options: ChainMiddlewareContextOptions
) {
    const { conversationId, model, preset, name, chatMode, id, password, visibility } =
        options.room_resolve

    const createRoom: ConversationRoom = {
        conversationId: randomUUID(),
        model,
        preset,
        roomName: name ?? '未命名房间',
        roomMasterId: session.userId,
        roomId: (await getConversationRoomCount(ctx)) + 1,
        visibility: visibility as any,
        chatMode,
        password
    }

    await createConversationRoom(ctx, session, createRoom)

    if (visibility === 'template') {
        context.message = `模板房间创建成功。`
    } else {
        context.message = `房间创建成功，房间号为：${createRoom.roomId}，房间名为：${createRoom.roomName}。`
    }
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        create_room: never
    }
    interface ChainMiddlewareContextOptions {
        room_resolve?: {
            conversationId?: string
            model?: string
            preset?: string
            name?: string
            chatMode?: string
            id?: string
            password?: string
            visibility?: string
        }
    }
}
