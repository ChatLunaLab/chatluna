import { Context, Logger, Session } from 'koishi';
import { Config } from './config';
import { Chat, buildTextElement, checkBasicCanReply, checkCooldownTime, createConversationConfigWithLabelAndPrompts, createSenderInfo, readChatMessage, replyMessage, runPromiseByQueue } from './chat';
import { lookup } from 'dns';
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

            if (await checkAdapterName(options.adapter, ctx, session)) return

            const { senderId } = createSenderInfo(session, config)

            try {
                const deletedMessagesLength = await chat.clear(senderId, options.adapter)


                if (deletedMessagesLength == null) {
                    await replyMessage(ctx, session, buildTextElement(`重置会话失败，可能是没找到目标模型适配器`))
                    return
                }

                await replyMessage(ctx, session, buildTextElement(`已重置会话，删除了${deletedMessagesLength}条消息`))
            } catch (e) {
                await replyMessage(ctx, session, buildTextElement(`重置会话失败，可能是没找到你想要的适配器，${e.message}`))
            }
        })

    ctx.command('chathub.setPersona <persona:text>', '设置会话人格', {
        authority: 1,
    }).alias("设置会话人格")
        .option('adapter', '-a [adapterName]', {
            authority: 1,
        })
        .action(async ({ options, session }, persona) => {

            if (await checkAdapterName(options.adapter, ctx, session)) return

            const { senderId } = createSenderInfo(session, config)

            try {
                await chat.setBotIdentity(senderId, persona, options.adapter)

                replyMessage(ctx, session, buildTextElement(`已设置会话人格成功！试着回复bot一句吧。`))
            } catch (e) {
                replyMessage(ctx, session, buildTextElement(`设置会话人格失败，可能是没找稻你想要的适配器，${e.message}`))
            }
        })


    ctx.command('chathub.chat <message:text>', '与bot聊天', {
        authority: 1,
    }).alias("聊天")
        .option('adapter', '-a <adapterName:string>', {
            authority: 1,
        })
        .option("inject", "-i <inject:boolean>", {
            authority: 1,
        })
        .action(async ({ options, session }, message) => {

            if (await checkAdapterName(options.adapter, ctx, session)) return

            //直接cv 懒得复合用
            if (!checkBasicCanReply(ctx, session, config)) return

            if (!checkCooldownTime(ctx,session, config)) return

            // 检测输入是否能聊起来
            let input = message

            logger.debug(`[chat-input] ${session.userId}(${session.username}): ${input}`)

            if (input.trim() === '') return

            const senderInfo = createSenderInfo(session, config)
            const { senderId, senderName } = senderInfo

            const conversationConfig = createConversationConfigWithLabelAndPrompts(config, options.adapter ?? "empty", [config.botIdentity])


            const chatLimitResult = await chat.withChatLimit(async () => {

                logger.debug(`[chat] ${senderName}(${senderId}): ${input}`)

                try {
                    const result = await chat.chat(input, config, senderId, senderName, options.inject, conversationConfig)

                    return result
                } catch (e) {
                    logger.error(e)
                }

                return null
            }, session, senderInfo, conversationConfig)

            if (chatLimitResult == null) {
                logger.debug(`[chat-limit] ${senderName}(${senderId}): ${input}`)
                return
            }


            await runPromiseByQueue(chatLimitResult.map((result) => replyMessage(ctx, session, result)))


        })

    ctx.command('chathub.resetPersona', '重置会话人格', {
        authority: 1
    })
        .option('adapter', '-a [adapterName]', {
            authority: 1,
        })
        .alias("重置会话人格")
        .action(async ({ options, session }) => {
            const { senderId } = createSenderInfo(session, config)

            await chat.setBotIdentity(senderId, null, options.adapter)

            replyMessage(ctx, session, buildTextElement(`已重置会话人格！`))
        })


    ctx.command('chathub.listAdapter', '列出所有适配器', {
        authority: 1
    })
        .action(async ({ session }) => {
            const llmService = ctx.llmchat
            const builder = ["以下是目前可用的适配器：\n"]
            llmService.getAllAdapters().forEach((adapter) => {
                builder.push(`${adapter.label} - ${adapter.description}`)
            })

            builder.push("\n使用 chathub.chat -a <adapterName> <message> 来使用适配器")
            await replyMessage(ctx, session, buildTextElement(builder.join("\n")))
        })
}

async function checkAdapterName(adapterName: string | null, context: Context, session: Session) {
    if (adapterName != null && adapterName !== "empty") {
        const matchAdapters = context.llmchat.findAdapterByLabel(adapterName)

        if (matchAdapters.length > 1) {
            await replyMessage(context, session, buildTextElement(`找到多个适配器${adapterName}，请检查配置`))
            return true
        }

        if (matchAdapters.length === 0) {
            await replyMessage(context, session, buildTextElement(`没有找到适配器${adapterName}，请检查配置`))
            return true
        }

        return false

    }
}