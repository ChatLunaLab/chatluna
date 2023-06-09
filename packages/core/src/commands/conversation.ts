import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command("chathub.reset [model:string]", "重置会话记录（注意不会清除长期记忆）")
        .alias("重置会话")
        .action(async ({ session }, model) => {
            await chain.receiveCommand(
                session, "reset", {
                reset: {
                    trigger: true,
                },
                setModel: model
            }
            )
        })


}