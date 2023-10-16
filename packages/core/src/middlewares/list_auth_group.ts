import { Context } from 'koishi'
import { Config } from '../config'
import { ChainMiddlewareRunStatus, ChatChain } from '../chains/chain'
import { Pagination } from '../utils/pagination'
import { ChatHubAuthGroup } from '../authorization/types'

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const pagination = new Pagination<ChatHubAuthGroup>({
        formatItem: (value) => formatAuthGroup(value),
        formatString: {
            top: '以下是查询到目前可用的配额组列表：\n',
            bottom: '你可以使用 chathub.auth.join <name/id> 来加入某个配额组。'
        }
    })

    chain
        .middleware('list_auth_group', async (session, context) => {
            const {
                command,
                options: { page, limit, authPlatform }
            } = context

            if (command !== 'list_auth_group')
                return ChainMiddlewareRunStatus.SKIPPED

            const authGroups =
                await ctx.chathub_auth.getAuthGroups(authPlatform)

            await pagination.push(authGroups)

            context.message = await pagination.getFormattedPage(page, limit)

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

export function formatAuthGroup(group: ChatHubAuthGroup) {
    const buffer: string[] = []

    buffer.push(`名称：${group.name}`)
    buffer.push(`适用模型平台：${group.platform ?? '通用'}`)
    buffer.push(`计费：${group.costPerToken} / 1000 token`)
    buffer.push(`优先级: ${group.priority}`)
    buffer.push(`限制模型：${group.supportModels?.join(', ') ?? '通用'}`)
    buffer.push(`并发限制每 ${group.limitPerMin} 条消息/分`)
    buffer.push(`并发限制每 ${group.limitPerDay} 条消息/天`)

    buffer.push('\n')

    return buffer.join('\n')
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        list_auth_group: never
    }

    interface ChainMiddlewareContextOptions {
        authPlatform?: string
    }
}
