import { Context } from 'koishi';
import { Config } from './config';
import { Chat, createSenderInfo, replyMessage } from './chat';

export default function apply(ctx: Context, config: Config, chat: Chat) {
    ctx.command('chathub.reset', '重置会话', {
        authority: 1
    })
        .alias("重置会话")
        .action(async ({ session }) => {
            const { senderId } = createSenderInfo(session, config)

            const deletedMessagesLength = await chat.clear(senderId)

            replyMessage(session, `已重置会话，删除了${deletedMessagesLength}条消息`)
        })

    ctx.command('chathub.setPersona <persona:text>', '设置会话人格', {
        authority: 1,
    }).alias("设置会话人格")
        .action(async ({ session }, persona) => {
            const { senderId } = createSenderInfo(session, config)

            await chat.setBotIdentity(senderId, persona)

            replyMessage(session, `已设置会话人格成功！试着回复bot一句吧。`)
        })

    ctx.command('chathub.resetPersona', '重置会话人格', {
        authority: 1
    })
        .alias("重置会话人格")
        .action(async ({ session }) => {
            const { senderId } = createSenderInfo(session, config)

            await chat.setBotIdentity(senderId)

            replyMessage(session, `已重置会话人格！`)
        })
}