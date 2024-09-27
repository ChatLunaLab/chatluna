import { Context, Session } from 'koishi'
// import { createLogger } from 'koishi-plugin-chatluna/utils/logger'
import { ModelType } from 'koishi-plugin-chatluna/llm-core/platform/types'
import { ChatLunaAuthService } from '../authorization/service'
import { ChatHubAuthGroup } from '../authorization/types'
import {
    ChainMiddlewareContext,
    ChainMiddlewareContextOptions,
    ChainMiddlewareRunStatus,
    ChatChain
} from '../chains/chain'
import { Config } from '../config'
import { PlatformService } from '../llm-core/platform/service'

// const logger = createLogger()

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const service = ctx.chatluna.platform
    const authService = ctx.chatluna_auth

    chain
        .middleware('set_auth_group', async (session, context) => {
            const {
                command,
                // eslint-disable-next-line @typescript-eslint/naming-convention
                options: { auth_group_resolve }
            } = context

            if (command !== 'set_auth_group')
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

            let currentAuthGroupName = 'guest'

            while (true) {
                // 修改模型

                await context.send(
                    session.text('.change_or_keep', [
                        session.text('.action.select'),
                        session.text('.field.name'),
                        currentAuthGroupName
                    ])
                )

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout_cancel')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N') {
                    break
                } else if (result === 'Q') {
                    context.message = session.text('.cancel_set')
                    return ChainMiddlewareRunStatus.STOP
                } else if (
                    (await ctx.chatluna_auth.getAuthGroup(
                        currentAuthGroupName,
                        false
                    )) == null
                ) {
                    await context.send(session.text('.invalid_name'))
                    continue
                } else {
                    currentAuthGroupName = result.trim()
                    break
                }
            }

            if (
                Object.values(auth_group_resolve).filter(
                    (value) => value != null
                ).length > 0 &&
                name != null &&
                requestPreDay != null &&
                requestPreMin != null
            ) {
                await context.send(session.text('.confirm_set'))

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout_cancel')
                    return ChainMiddlewareRunStatus.STOP
                }

                if (result === 'Y') {
                    auth_group_resolve.priority =
                        priority == null ? 0 : priority

                    if (
                        (await checkAuthGroupName(authService, name)) === false
                    ) {
                        context.message = session.text('.name_exists')
                        return ChainMiddlewareRunStatus.STOP
                    }

                    if (
                        supportModels != null &&
                        !checkModelList(service, supportModels)
                    ) {
                        context.message = session.text('.invalid_models')
                        return ChainMiddlewareRunStatus.STOP
                    }

                    await setAuthGroup(
                        ctx,
                        session,
                        context,
                        currentAuthGroupName,
                        context.options
                    )

                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'N') {
                    context.message = session.text('.cancel_set')
                    return ChainMiddlewareRunStatus.STOP
                }
            }

            // 交互式创建

            // 1. 输入配额组名

            while (true) {
                if (name == null) {
                    await context.send(session.text('.enter_name'))
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.action.input'),
                            session.text('.field.name'),
                            name
                        ])
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout_cancel')
                    return ChainMiddlewareRunStatus.STOP
                } else if (
                    (await checkAuthGroupName(authService, result)) === false
                ) {
                    await context.send(session.text('.name_exists'))
                    continue
                } else if (result === 'Q') {
                    context.message = session.text('.cancel_set')
                    return ChainMiddlewareRunStatus.STOP
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
                    await context.send(session.text('.enter_requestPreMin'))
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.action.input'),
                            session.text('.field.requestPreMin'),
                            requestPreMin
                        ])
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout_cancel')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && requestPreMin != null) {
                    break
                } else if (result === 'Q') {
                    context.message = session.text('.cancel_set')
                    return ChainMiddlewareRunStatus.STOP
                } else if (isNaN(Number(result)) && Number(result) !== 0) {
                    await context.send(session.text('.invalid_requestPreMin'))
                    continue
                }

                requestPreMin = Number(result)
                auth_group_resolve.requestPreMin = requestPreMin

                break
            }

            // 3. 选择预设

            while (true) {
                if (requestPreDay == null) {
                    await context.send(session.text('.enter_requestPreDay'))
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.action.input'),
                            session.text('.field.requestPreDay'),
                            requestPreDay
                        ])
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout_cancel')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && requestPreDay != null) {
                    break
                } else if (result === 'Q') {
                    context.message = session.text('.cancel_set')
                    return ChainMiddlewareRunStatus.STOP
                } else if (
                    isNaN(Number(result)) ||
                    Number(result) < requestPreMin
                ) {
                    await context.send(session.text('.invalid_requestPreDay'))
                    continue
                }

                requestPreDay = Number(result)
                auth_group_resolve.requestPreDay = requestPreDay

                break
            }

            // 4. 平台

            if (platform == null) {
                await context.send(session.text('.enter_platform'))
            } else {
                await context.send(
                    session.text('.change_or_keep', [
                        session.text('.action.input'),
                        session.text('.field.platform'),
                        platform
                    ])
                )
            }

            const result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = session.text('.timeout_cancel')
                return ChainMiddlewareRunStatus.STOP
            } else if (result !== 'N') {
                platform = result
                auth_group_resolve.platform = platform
            }

            // 5. 优先级

            while (true) {
                if (priority == null) {
                    await context.send(session.text('.enter_priority'))
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.action.input'),
                            session.text('.field.priority'),
                            priority
                        ])
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout_cancel')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'Q') {
                    context.message = session.text('.cancel_set')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && priority != null) {
                    break
                } else if (isNaN(Number(result))) {
                    await context.send(session.text('.invalid_priority'))
                    continue
                }

                priority = Number(result)
                auth_group_resolve.priority = priority

                break
            }

            // 6. 费用

            while (true) {
                if (constPerToken == null) {
                    await context.send(session.text('.enter_costPerToken'))
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.action.input'),
                            session.text('.field.costPerToken'),
                            constPerToken
                        ])
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout_cancel')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && constPerToken != null) {
                    break
                } else if (result === 'Q') {
                    context.message = session.text('.cancel_set')
                    return ChainMiddlewareRunStatus.STOP
                } else if (isNaN(Number(result))) {
                    await context.send(session.text('.invalid_costPerToken'))
                    continue
                }

                constPerToken = Number(result)
                auth_group_resolve.costPerToken = constPerToken

                break
            }

            while (true) {
                // 7. 支持模型
                if (supportModels == null) {
                    await context.send(session.text('.enter_models'))
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.action.input'),
                            session.text('.field.models'),
                            supportModels.join(', ')
                        ])
                    )
                }

                const result = await session.prompt(1000 * 30)

                const parsedResult = result
                    ?.split(',')
                    ?.map((item) => item.trim())

                if (result == null) {
                    context.message = session.text('.timeout_cancel')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N') {
                    break
                } else if (result === 'Q') {
                    context.message = session.text('.cancel_set')
                    return ChainMiddlewareRunStatus.STOP
                } else if (checkModelList(service, parsedResult)) {
                    await context.send(session.text('.invalid_models'))
                    continue
                } else {
                    supportModels = parsedResult
                    auth_group_resolve.supportModels = parsedResult
                    break
                }
            }

            // 8. 创建配额组
            await setAuthGroup(
                ctx,
                session,
                context,
                currentAuthGroupName,
                context.options
            )

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

async function setAuthGroup(
    ctx: Context,
    session: Session,
    context: ChainMiddlewareContext,
    oldAuthGroupName: string,
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
        id: null,
        supportModels: resolve.supportModels ?? null
    }

    delete group.id

    if (resolve.supportModels == null) {
        delete resolve.supportModels
    }

    for (const key in group) {
        if (group[key] == null) {
            delete group[key]
        }
    }

    await ctx.chatluna_auth.setAuthGroup(oldAuthGroupName, group)

    context.message = session.text('.success', [group.name])
}

declare module '../chains/chain' {
    interface ChainMiddlewareName {
        set_auth_group: never
    }
}
