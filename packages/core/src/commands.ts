import { Context, Session, h } from 'koishi';
import { Config } from './config';
import { Chat, buildTextElement, checkInBlackList, createSenderInfo, replyMessage } from './chat';
import { createLogger } from './utils/logger';
import { loadPreset } from "./preset"
import fs from "fs/promises"
import path from 'path';
import os from "os"



const logger = createLogger('@dingyi222666/chathub/commands');

export default function apply(ctx: Context, config: Config, chat: Chat) {

    ctx.command('chathub', 'chathub', {
        authority: 1,
    }).alias("chathub")

    ctx.command('chathub.reset', '重置会话', {
        authority: 1
    }).option('adapter', '-a [adapterName]', {
        authority: 1,
    }).alias("重置会话")
        .action(async ({ options, session }) => {
            if (await checkInBlackList(ctx, session, config) === true) return

            if (await checkAdapterName(options.adapter, ctx, session)) return

            const { senderId } = createSenderInfo(session, config)

            try {
                const deletedMessagesLength = await chat.clear(senderId, options.adapter)


                if (deletedMessagesLength == null) {
                    await replyMessage(ctx, session, buildTextElement(`重置会话失败了喵，可能是没找到你想要的适配器`))
                    return
                }

                await replyMessage(ctx, session, buildTextElement(`已重置会话了喵，共删除了${deletedMessagesLength}条消息`))
            } catch (e) {
                await replyMessage(ctx, session, buildTextElement(`重置会话失败了喵，可能是没找到你想要的适配器，${e.message}`))
            }
        })

    ctx.command('chathub.setPreset <preset:text>', '切换会话预设', {
        authority: 1,
    }).alias("切换预设")
        .option('adapter', '-a [adapterName]', {
            authority: 1,
        })
        .action(async ({ options, session }, preset) => {
            if (await checkInBlackList(ctx, session, config) === true) return


            if (await checkAdapterName(options.adapter, ctx, session)) return

            const { senderId } = createSenderInfo(session, config)

            try {
                await chat.setBotPreset(senderId, preset, options.adapter)

                replyMessage(ctx, session, buildTextElement(`已切换会话预设为${preset}, 快来和我聊天吧`))
            } catch (e) {
                logger.error(e)
                replyMessage(ctx, session, buildTextElement(`切换会话预设失败，可能是没找你想要的适配器或者预设配置，${e.message}`))
            }
        })


    ctx.command('chathub.chat [adapter:string] <message:text>', '与bot聊天', {
        authority: 1,
    }).alias("聊天")
        .option("inject", "-i <inject:string>", {
            authority: 1,
        })
        .action(async ({ options, session }, adapter, message) => {

            if (message == null) {
                message = adapter
                adapter = null
                logger.warn(`not found adapter name in message, use default adapter`)
            }


            if (await checkAdapterName(adapter, ctx, session)) return


            await chat.chat({
                ctx,
                session,
                config
            })

        })



    ctx.command('chathub.voice [adapter:string] <message:text>', '与bot语音聊天', {
        authority: 1,
    }).alias("语音聊天")
        .option("inject", "-i <inject:string>", {
            authority: 1,
        })
        .option("speaker", "-s <speakerId:number>", {
            authority: 1,
        })
        .action(async ({ options, session }, adapter, message) => {

            if (message == null) {
                message = adapter
                adapter = null
                logger.warn(`not found adapter name in message, use default adapter`)
            }

            if (await checkAdapterName(adapter, ctx, session)) return

            await chat.chat({
                ctx,
                session,
                config,
                render: {
                    type: "voice",
                    voice: {
                        speakerId: options.speaker
                    }
                }
            })

        })


    ctx.command('chathub.resetPreset', '重置预设', {
        authority: 1
    })
        .option('adapter', '-a [adapterName]', {
            authority: 1,
        })
        .alias("重置预设")
        .action(async ({ options, session }) => {
            if (await checkInBlackList(ctx, session, config) === true) return

            const { senderId } = createSenderInfo(session, config)

            const newConfig = await chat.setBotPreset(senderId, null, options.adapter)

            replyMessage(ctx, session, buildTextElement(`已重置会话预设为 ${newConfig.personalityId}, 快来和我聊天吧`))
        })


    ctx.command('chathub.listAdapter', '列出所有适配器', {
        authority: 1
    }).alias("列出适配器")
        .action(async ({ session }) => {
            if (await checkInBlackList(ctx, session, config) === true) return

            const llmService = ctx.llmchat
            const builder = ["以下是目前可用的适配器喵："]
            llmService.getAllAdapters().forEach((adapter) => {
                builder.push(`${adapter.label} - ${adapter.description}`)
            })

            builder.push("\n你可以使用chathub.chat -a [adapterName] [message]来指定适配器喵")
            await replyMessage(ctx, session, buildTextElement(builder.join("\n")))
        })


    ctx.command('chathub.listPreset', '列出所有会话预设', {
        authority: 1
    }).alias("列出预设")
        .action(async ({ session }) => {
            const builder = ["以下是目前可用的预设喵：\n"]

            const presets = await chat.getAllPresets()

            presets.forEach((preset) => {
                builder.push(preset)
            })

            builder.push("\n你可以使用chathub.setPreset [preset]来切换预设喵")

            await replyMessage(ctx, session, buildTextElement(builder.join("\n")))
        })

    ctx.command('chathub.exportConversation', '导出会话', {
        authority: 1
    }).alias("导出会话")
        .option('adapter', '-a [adapterName]', {
            authority: 1,
        })
        .option('type', '-t [type]', {
            authority: 1,
        })
        .action(async ({ options, session }) => {
            const { senderId } = createSenderInfo(session, config)


            const converstaion = await chat.resolveConversation(senderId, await chat.createConversationConfig(options.adapter))

            const type = options.type || "json"

            const data = converstaion.export(type)

            const fileName = `${converstaion.id}.${type}`

            const filePath = path.join(os.tmpdir(), fileName)

            try {
                await fs.mkdtemp(filePath)
                await fs.writeFile(filePath, data)
            } catch (e) {
                logger.error(e)
                await replyMessage(ctx, session, buildTextElement(`导出会话失败，${e.message}`))
            }

            await replyMessage(ctx, session, h.file(filePath))

            
        })


}

async function checkAdapterName(adapterName: string | null, context: Context, session: Session) {

    if (adapterName != null && adapterName !== "empty") {
        const matchAdapters = context.llmchat.findAdapterByLabel(adapterName)

        if (matchAdapters.length > 1) {
            await replyMessage(context, session, buildTextElement(`找到多个适配器${adapterName}呢，快去问问部署Bot的作者怎么绘世？`))
            return true
        }

        if (matchAdapters.length === 0) {
            await replyMessage(context, session, buildTextElement(`啊，没有找到适配器${adapterName}，要不咱们换个名字试试？`))
            return true
        }

        return false

    }
}