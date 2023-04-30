import { Context, Session } from 'koishi';
import { Config } from './config';
import { Chat, buildTextElement, checkInBlackList, createConversationConfigWithLabelAndPrompts, createSenderInfo, replyMessage } from './chat';
import { createLogger } from './utils/logger';


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

    ctx.command('chathub.setPersona <persona:text>', '设置会话人格', {
        authority: 1,
    }).alias("设置会话人格")
        .option('adapter', '-a [adapterName]', {
            authority: 1,
        })
        .action(async ({ options, session }, persona) => {
            if (await checkInBlackList(ctx, session, config) === true) return


            if (await checkAdapterName(options.adapter, ctx, session)) return

            const { senderId } = createSenderInfo(session, config)

            try {
                await chat.setBotIdentity(senderId, persona, options.adapter)

                replyMessage(ctx, session, buildTextElement(`已设置会话人格为${persona}, 快来和我聊天吧`))
            } catch (e) {
                replyMessage(ctx, session, buildTextElement(`设置会话人格失败，可能是没找你想要的适配器，${e.message}`))
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

            const conversationConfig = createConversationConfigWithLabelAndPrompts(config, adapter, [config.botIdentity])

            await chat.chat({
                ctx,
                session,
                config,
                model: { conversationConfig }
            })

        })



    ctx.command(`test`)
        .action(async ({ session }) => {
            
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

            const conversationConfig = createConversationConfigWithLabelAndPrompts(config, adapter, [config.botIdentity])


            await chat.chat({
                ctx,
                session,
                config,
                model: { conversationConfig },
                render: {
                    type: "voice",
                    voice: {
                        speakerId: options.speaker
                    }
                }
            })

        })


    ctx.command('chathub.resetPersona', '重置会话人格', {
        authority: 1
    })
        .option('adapter', '-a [adapterName]', {
            authority: 1,
        })
        .alias("重置会话人格")
        .action(async ({ options, session }) => {
            if (await checkInBlackList(ctx, session, config) === true) return

            const { senderId } = createSenderInfo(session, config)

            await chat.setBotIdentity(senderId, null, options.adapter)

            replyMessage(ctx, session, buildTextElement(`已重置会话人格！`))
        })


    ctx.command('chathub.listAdapter', '列出所有适配器', {
        authority: 1
    })
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