import { Context, Logger, Session } from 'koishi';
import { Config } from './config';
import { Chat, checkBasicCanReply, checkCooldownTime, createConversationConfigWithLabelAndPrompts, createSenderInfo, readChatMessage, replyMessage } from './chat';
import { lookup } from 'dns';
import { createLogger } from './logger';
import { runPromiseByQueue } from './utils';


const logger = createLogger('@dingyi222666/chathub/commands');

export default function apply(ctx: Context, config: Config, chat: Chat) {
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
                    await replyMessage(session, `重置会话失败，可能是没找到目标模型适配器`)
                    return
                }

                await replyMessage(session, `已重置会话，删除了${deletedMessagesLength}条消息`)
            } catch (e) {
                await replyMessage(session, `重置会话失败，可能是没找到你想要的适配器，${e.message}`)
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

                replyMessage(session, `已设置会话人格成功！试着回复bot一句吧。`)
            } catch (e) {
                replyMessage(session, `设置会话人格失败，可能是没找稻你想要的适配器，${e.message}`)
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
            if (!checkCooldownTime(session, config)) return

            if (!checkBasicCanReply(ctx, session, config)) return

            // 检测输入是否能聊起来
            let input = message

            logger.debug(`[chat-input] ${session.userId}(${session.username}): ${input}`)

            if (input.trim() === '') return

            const { senderId, senderName } = createSenderInfo(session, config)

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
            }, session, senderId, conversationConfig)

            if (chatLimitResult == null) {
                logger.debug(`[chat-limit] ${senderName}(${senderId}): ${input}`)
                return
            }


            await runPromiseByQueue(chatLimitResult.map((result) => replyMessage(session, result)))

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

            replyMessage(session, `已重置会话人格！`)
        })
}

async function checkAdapterName(adapterName: string | null, context: Context, session: Session) {
    if (adapterName != null && adapterName !== "empty") {
        const matchAdapters = context.llmchat.findAdapterByLabel(adapterName)

        if (matchAdapters.length > 1) {
            await replyMessage(session, `找到多个适配器${adapterName}，请检查配置`)
            return true
        }

        if (matchAdapters.length === 0) {
            await replyMessage(session, `没有找到适配器${adapterName}，请检查配置`)
            return true
        }

        return false

    }
}