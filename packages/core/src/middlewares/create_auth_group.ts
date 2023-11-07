import { Context, Session } from 'koishi'
import { Config } from '../config'
import {
    ChainMiddlewareContext,
    ChainMiddlewareContextOptions,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../chains/chain'
// import { createLogger } from '../utils/logger'

import { ModelType } from '../llm-core/platform/types'
import { ChatLunaAuthService } from '../authorization/service'
import { PlatformService } from '../llm-core/platform/service'
import { ChatHubAuthGroup } from '../authorization/types'

// const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const service = ctx.chatluna.platform
    const authService = ctx.chatluna_auth

    chain
        .middleware('create_auth_group', async (session, context) => {
            const {
                command,
                // eslint-disable-next-line @typescript-eslint/naming-convention
                options: { auth_group_resolve }
            } = context

            if (command !== 'create_auth_group')
                return ChainMiddlewareRunStatus.SKIPPED

            if (!auth_group_resolve) return ChainMiddlewareRunStatus.SKIPPED

            let {
                name,
                supportModels,
                requestPreDay,
                requestPreMin,
                platform,
                priority,
                costPerToken: constPerToken
            } = auth_group_resolve

            if (
                Object.values(auth_group_resolve).filter(
                    (value) => value != null
                ).length > 0 &&
                name != null &&
                requestPreDay != null &&
                requestPreMin != null
            ) {
                await context.send(
                    '你目前已提供基础参数，是否直接创建配额组？如需直接创建配额组请回复 Y，如需进入交互式创建请回复 N，其他回复将视为取消。'
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建配额组。'
                    return ChainMiddlewareRunStatus.STOP
                }

                if (result === 'Y') {
                    auth_group_resolve.priority =
                        priority == null ? 0 : priority

                    if (
                        (await checkAuthGroupName(authService, name)) === false
                    ) {
                        context.message = '该名称已存在，请重新输入。'
                        return ChainMiddlewareRunStatus.STOP
                    }

                    if (
                        supportModels != null &&
                        !checkModelList(service, supportModels)
                    ) {
                        context.message = '模型组里有不支持的模型，请重新输入。'
                        return ChainMiddlewareRunStatus.STOP
                    }

                    await createAuthGroup(
                        ctx,
                        context,
                        session,
                        context.options
                    )

                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'N') {
                    context.message = '你已取消创建配额组。'
                    return ChainMiddlewareRunStatus.STOP
                }
            }

            // 交互式创建

            // 1. 输入配额组名

            while (true) {
                if (name == null) {
                    await context.send(
                        '请输入你需要使用的配额组名，如：' + 'OpenAI配额组'
                    )
                } else {
                    await context.send(
                        `你已经输入了配额组名：${name}，是否需要更换？如需更换请回复更换后的配额组名，否则回复 N。`
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建配额组。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (
                    (await checkAuthGroupName(authService, result)) === false
                ) {
                    context.message = '你输入的配额组名已存在，请重新输入。'
                    continue
                } else if (result === 'N' && name != null) {
                    break
                } else if (result !== 'N') {
                    name = result.trim()

                    auth_group_resolve.name = name
                    break
                }
            }

            // 2. 选择模型

            while (true) {
                if (requestPreMin == null) {
                    await context.send(
                        '请输入配额组每分钟的限额条数，要求为数字并且大于 0。'
                    )
                } else {
                    await context.send(
                        `你已经设置了配额组每分钟限额条数：${requestPreMin}，是否需要更换？如需更换请回复更换后的值，否则回复 N。`
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建配额组。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && requestPreMin != null) {
                    break
                } else if (isNaN(Number(result)) && Number(result) !== 0) {
                    await context.send(
                        '你输入的配额组每分钟限额条数有误，请重新输入。'
                    )
                    continue
                }

                requestPreMin = Number(result)
                auth_group_resolve.requestPreMin = requestPreMin

                break
            }

            // 3. 选择预设

            while (true) {
                if (requestPreDay == null) {
                    await context.send(
                        '请输入配额组每天的限额条数，要求为数字并且大于每分钟的限额次数。'
                    )
                } else {
                    await context.send(
                        `你已经设置了配额组每天限额条数：${requestPreDay}，是否需要更换？如需更换请回复更换后的值，否则回复 N。`
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建配额组。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && requestPreDay != null) {
                    break
                } else if (
                    isNaN(Number(result)) ||
                    Number(result) < requestPreMin
                ) {
                    await context.send(
                        '你输入的配额组每天限额条数有误，请重新输入。'
                    )
                    continue
                }

                requestPreDay = Number(result)
                auth_group_resolve.requestPreDay = requestPreDay

                break
            }

            // 4. 平台

            if (platform == null) {
                await context.send(
                    '请输入对该配额组的模型平台标识符，如： openai。表示会优先在使用该平台模型时使用该配额组，如需不输入回复 N'
                )
            } else {
                await context.send(
                    `你已经选择了标识符：${platform}，是否需要更换？如需更换请回复更换后的标识符，否则回复 N。`
                )
            }

            const result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = '你超时未回复，已取消创建配额组。'
                return ChainMiddlewareRunStatus.STOP
            } else if (result !== 'N') {
                platform = result
                auth_group_resolve.platform = platform
            }

            // 5. 优先级

            while (true) {
                if (priority == null) {
                    await context.send(
                        '请输入配额组的优先级（数字，越大越优先）（这很重要，会决定配额组的使用顺序）'
                    )
                } else {
                    await context.send(
                        `你已经输入了优先级：${priority}，是否需要更换？如需更换请回复更换后的优先级，否则回复 N。`
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建配额组。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && priority != null) {
                    break
                } else if (isNaN(Number(result))) {
                    await context.send('你输入的优先级有误，请重新输入。')
                    continue
                }

                priority = Number(result)
                auth_group_resolve.priority = priority

                break
            }

            // 6. 费用

            while (true) {
                if (constPerToken == null) {
                    await context.send(
                        '请输入配额组的 token 费用（数字，按一千 token 计费，实际扣除用户余额'
                    )
                } else {
                    await context.send(
                        `你已经输入了费用：${priority}，是否需要更换？如需更换请回复更换后的费用，否则回复 N。`
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = '你超时未回复，已取消创建配额组。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && constPerToken != null) {
                    break
                } else if (isNaN(Number(result))) {
                    await context.send('你输入的费用有误，请重新输入。')
                    continue
                }

                constPerToken = Number(result)
                auth_group_resolve.costPerToken = constPerToken

                break
            }

            while (true) {
                // 7. 支持模型
                if (supportModels == null) {
                    await context.send(
                        '请输入该配额组可使用的模型列表（白名单机制），用英文逗号分割，如（openai/gpt-3.5-turbo, openai/gpt-4）。如果不输入请回复 N（则不设置模型列表）。'
                    )
                } else {
                    await context.send(
                        `你目前已经输入了模型列表：${supportModels.join(
                            ','
                        )}, 是否需要更换？如需更换请回复更换后的模型列表，否则回复 N。`
                    )
                }

                const result = await session.prompt(1000 * 30)

                const parsedResult = result
                    ?.split(',')
                    ?.map((item) => item.trim())

                if (result == null) {
                    context.message = '你超时未回复，已取消创建配额组。'
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N') {
                    break
                } else if (checkModelList(service, parsedResult)) {
                    await context.send('你输入的模型列表有误，请重新输入。')
                    continue
                } else {
                    supportModels = parsedResult
                    auth_group_resolve.supportModels = parsedResult
                    break
                }
            }

            // 8. 创建配额组
            await createAuthGroup(ctx, context, session, context.options)

            return ChainMiddlewareRunStatus.STOP
        })
        .after('lifecycle-handle_command')
}

async function checkAuthGroupName(service: ChatLunaAuthService, name: string) {
    const authGroup = await service.getAuthGroup(name)
    return authGroup == null
}

function checkModelList(service: PlatformService, models: string[]) {
    const availableModels = service.getAllModels(ModelType.llm)

    return models.some((model) => !availableModels.includes(model))
}

async function createAuthGroup(
    ctx: Context,
    context: ChainMiddlewareContext,
    session: Session,
    options: ChainMiddlewareContextOptions
) {
    const resolve = options.auth_group_resolve

    const group: ChatHubAuthGroup = {
        name: resolve.name,
        priority: resolve.priority ?? 0,

        limitPerMin: resolve.requestPreMin,
        limitPerDay: resolve.requestPreDay,

        // 1000 token / 0.3
        costPerToken: resolve.costPerToken,
        id: undefined,
        supportModels: resolve.supportModels
    }

    delete group.id

    if (resolve.supportModels == null) {
        delete resolve.supportModels
    }

    await ctx.chatluna_auth.createAuthGroup(session, group)

    context.message = `配额组创建成功，配额组名为：${group.name}。`
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        create_auth_group: never
    }
    interface ChainMiddlewareContextOptions {
        auth_group_resolve?: {
            name?: string
            requestPreMin?: number
            requestPreDay?: number
            costPerToken?: number
            supportModels?: string[]
            platform?: string
            priority?: number
        }
    }
}
