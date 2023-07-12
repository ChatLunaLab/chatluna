import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';
import { ChatMode } from '../middlewares/resolve_conversation_info';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command("chathub.reset [model:string]", "重置会话记录（注意不会清除长期记忆）")
        .alias("重置会话")
        .option("chatMode", "-c <chatMode:string> 选择聊天模式", {
            authority: 1,
        })
        .action(async ({ session, options }, model) => {
            await chain.receiveCommand(
                session, "reset", {
                reset: {
                    trigger: true,
                },
                chatMode: (options.chatMode ?? config.chatMode) as ChatMode,
                setModel: model
            }
            )
        })

    ctx.command("chathub.queryconverstion [model:string]", "查询会话列表")
        .alias("会话列表")
        .option("model", "-m <model:string> 选择模型", {
            authority: 1,
        })
        .option("chatMode", "-c <chatMode:string> 选择聊天模式", {
            authority: 1,
        })
        .action(async ({ session, options }, model) => {
            await chain.receiveCommand(
                session, "query_converstion", {
                reset: {
                    trigger: true,
                },
                chatMode: options.chatMode as ChatMode,
                setModel: options.model
            }
            )
        })

    ctx.command("chathub.deleteconverstaion <id:string>", "删除会话")
        .alias("删除会话")
        .action(async ({ session }, id) => {
            await chain.receiveCommand(
                session, "delete_converstaion", {
                converstaionId: id
            }
            )
        })

    ctx.command("chathub.deleteallconverstaion <id:string>", "删除和你相关的所有会话", {
        authority: 3
    }).alias("删除所有会话")

        .action(async ({ session }, id) => {
            await chain.receiveCommand(
                session, "delete_all_converstaion", {
            }
            )
        })

}