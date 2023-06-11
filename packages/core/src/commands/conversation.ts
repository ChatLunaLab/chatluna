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


}