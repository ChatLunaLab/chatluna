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

    ctx.command("chathub.setPreset <preset:string>", "设置当前使用的预设")
        .alias("切换预设")
        .option("model", "-m <model:string> 切换的目标模型")
        .action(async ({ options,session }, preset) => {
            await chain.receiveCommand(
                session, "setPreset", {
                setPreset: preset,
                setModel: options.model,
                reset: {
                    trigger: true,
                    sendMessage: false
                }
            }
            )
        })

        ctx.command("chathub.resetPreset [model:string]", "重置为默认使用的预设（猫娘预设）")
        .alias("重置预设")
        .action(async ({ session }, model) => {
            await chain.receiveCommand(
                session, "resetPreset", {
                setModel: model,
                reset: {
                    trigger: true,
                    sendMessage: false
                }
            }
            )
        })   

}