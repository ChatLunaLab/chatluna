import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chain';

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    ctx.command("chathub.listPreset", "列出所有目前支持的预设")
        .alias("预设列表")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "listPreset"
            )
        })

    ctx.command("chathub.setPreset <preset>", "设置当前使用的预设")
        .alias("切换预设")
        .option("model", "-m <model> 切换的目标模型")
        .action(async ({ session }, preset, model) => {
            await chain.receiveCommand(
                session, "setPreset", {
                setPreset: preset,
                setModel: model,
                reset: {
                    trigger: true,
                    sendMessage: false
                }
            }
            )
        })

}