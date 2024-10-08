import { Context, Session } from 'koishi'
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

export function apply(ctx: Context, config: Config, chain: ChatChain) {
    const service = ctx.chatluna.platform
    const authService = ctx.chatluna_auth

    chain
        .middleware('create_auth_group', async (session, context) => {
            const {
                command,
                options: { auth_group_resolve: authGroupResolve }
            } = context

            if (command !== 'create_auth_group')
                return ChainMiddlewareRunStatus.SKIPPED

            if (!authGroupResolve) return ChainMiddlewareRunStatus.SKIPPED

            let {
                name,
                supportModels,
                requestPreDay,
                requestPreMin,
                platform,
                priority,
                costPerToken: constPerToken
            } = authGroupResolve

            if (
                Object.values(authGroupResolve).filter((value) => value != null)
                    .length > 0 &&
                name != null &&
                requestPreDay != null &&
                requestPreMin != null
            ) {
                await context.send(session.text('.confirm_create'))

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                }

                if (result === 'Y') {
                    authGroupResolve.priority = priority == null ? 0 : priority

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

                    await createAuthGroup(
                        ctx,
                        context,
                        session,
                        context.options
                    )

                    return ChainMiddlewareRunStatus.STOP
                } else if (result !== 'N') {
                    context.message = session.text('.cancelled')
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
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (
                    (await checkAuthGroupName(authService, result)) === false
                ) {
                    context.message = session.text('.name_exists')
                    continue
                } else if (result === 'N' && name != null) {
                    break
                } else if (result !== 'N') {
                    name = result.trim()
                    authGroupResolve.name = name
                    break
                }
            }

            // 2. 输入每分钟限额

            while (true) {
                if (requestPreMin == null) {
                    await context.send(session.text('.enter_limit_per_min'))
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.action.set'),
                            session.text('.field.limit_per_min'),
                            requestPreMin.toString()
                        ])
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && requestPreMin != null) {
                    break
                } else if (isNaN(Number(result)) || Number(result) <= 0) {
                    await context.send(
                        session.text('.invalid_input', [
                            session.text('.field.limit_per_min')
                        ])
                    )
                    continue
                }

                requestPreMin = Number(result)
                authGroupResolve.requestPreMin = requestPreMin
                break
            }

            // 3. 输入每天限额

            while (true) {
                if (requestPreDay == null) {
                    await context.send(session.text('.enter_limit_per_day'))
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.action.set'),
                            session.text('.field.limit_per_day'),
                            requestPreDay.toString()
                        ])
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && requestPreDay != null) {
                    break
                } else if (
                    isNaN(Number(result)) ||
                    Number(result) < requestPreMin
                ) {
                    await context.send(
                        session.text('.invalid_input', [
                            session.text('.field.limit_per_day')
                        ])
                    )
                    continue
                }

                requestPreDay = Number(result)
                authGroupResolve.requestPreDay = requestPreDay
                break
            }

            // 4. 输入平台标识符

            if (platform == null) {
                await context.send(session.text('.enter_platform'))
            } else {
                await context.send(
                    session.text('.change_or_keep', [
                        session.text('.action.select'),
                        session.text('.field.platform'),
                        platform
                    ])
                )
            }

            const result = await session.prompt(1000 * 30)

            if (result == null) {
                context.message = session.text('.timeout')
                return ChainMiddlewareRunStatus.STOP
            } else if (result !== 'N') {
                platform = result
                authGroupResolve.platform = platform
            }

            // 5. 输入优先级

            while (true) {
                if (priority == null) {
                    await context.send(session.text('.enter_priority'))
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.action.input'),
                            session.text('.field.priority'),
                            priority.toString()
                        ])
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && priority != null) {
                    break
                } else if (isNaN(Number(result))) {
                    await context.send(
                        session.text('.invalid_input', [
                            session.text('.field.priority')
                        ])
                    )
                    continue
                }

                priority = Number(result)
                authGroupResolve.priority = priority
                break
            }

            // 6. 输入费用

            while (true) {
                if (constPerToken == null) {
                    await context.send(session.text('.enter_cost'))
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.action.input'),
                            session.text('.field.cost'),
                            constPerToken.toString()
                        ])
                    )
                }

                const result = await session.prompt(1000 * 30)

                if (result == null) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N' && constPerToken != null) {
                    break
                } else if (isNaN(Number(result))) {
                    await context.send(
                        session.text('.invalid_input', [
                            session.text('.field.cost')
                        ])
                    )
                    continue
                }

                constPerToken = Number(result)
                authGroupResolve.costPerToken = constPerToken
                break
            }

            // 7. 输入支持模型列表

            while (true) {
                if (supportModels == null) {
                    await context.send(session.text('.enter_models'))
                } else {
                    await context.send(
                        session.text('.change_or_keep', [
                            session.text('.action.input'),
                            session.text('.field.models'),
                            supportModels.join(',')
                        ])
                    )
                }

                const result = await session.prompt(1000 * 30)

                const parsedResult = result
                    ?.split(',')
                    ?.map((item) => item.trim())

                if (result == null) {
                    context.message = session.text('.timeout')
                    return ChainMiddlewareRunStatus.STOP
                } else if (result === 'N') {
                    break
                } else if (checkModelList(service, parsedResult)) {
                    await context.send(session.text('.invalid_models'))
                    continue
                } else {
                    supportModels = parsedResult
                    authGroupResolve.supportModels = parsedResult
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
    const authGroup = await service.getAuthGroup(name, false)
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

        costPerToken: resolve.costPerToken,
        id: null,
        supportModels: resolve.supportModels ?? null
    }

    delete group.id

    if (resolve.supportModels == null) {
        delete resolve.supportModels
    }

    await ctx.chatluna_auth.createAuthGroup(session, group)

    context.message = session.text('.success', [group.name])
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
