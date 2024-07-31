import { Decimal } from 'decimal.js'
import { Context, Service, Session } from 'koishi'
import {
    ChatLunaError,
    ChatLunaErrorCode
} from 'koishi-plugin-chatluna/utils/error'
import { ChatHubAuthGroup, ChatHubAuthUser } from './types'

export class ChatLunaAuthService extends Service {
    constructor(
        public readonly ctx: Context,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        public config: any
    ) {
        super(ctx, 'chatluna_auth')

        ctx.on('ready', async () => {
            await this._defineDatabase()
        })
    }

    async getUser(
        session: Session,
        userId: string = session.userId
    ): Promise<ChatHubAuthUser> {
        const list = await this.ctx.database.get('chathub_auth_user', {
            userId
        })

        if (list.length === 0) {
            return this._createUser(session, userId)
        } else if (list.length > 1) {
            throw new ChatLunaError(ChatLunaErrorCode.USER_NOT_FOUND)
        }

        return list[0]
    }

    private async _createUser(
        session: Session,
        userId: string = session.userId
    ): Promise<ChatHubAuthUser> {
        const user = await this.ctx.database.getUser(session.platform, userId)

        if (user == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.USER_NOT_FOUND,
                new Error(`
                user not found in platform ${session.platform} and id ${userId}`)
            )
        }

        const resolveAuthType = (authType: number) =>
            authType > 2 ? 'admin' : authType > 1 ? 'user' : 'guest'

        const copyOfSession = session?.bot?.session(session.event) ?? session
        copyOfSession.userId = userId

        let [rawAuthType, balance, authGroup] = (await copyOfSession.resolve(
            this.config.authUserDefaultGroup
        )) ?? [0, 0, 'guest']

        const authType = resolveAuthType(
            user.authority > rawAuthType ? user.authority : rawAuthType
        )

        if (authType === 'admin') {
            authGroup = authType
        }

        const authUser: ChatHubAuthUser = {
            userId,
            balance:
                balance === 0
                    ? authType === 'admin'
                        ? 10000
                        : authType === 'user'
                          ? 10
                          : 1
                    : balance,
            authType
        }

        await this.ctx.database.upsert('chathub_auth_user', [authUser])

        await this.addUserToGroup(authUser, authGroup)

        return authUser
    }

    async createAuthGroup(session: Session, group: ChatHubAuthGroup) {
        const user = await this.getUser(session)

        await this.ctx.database.upsert('chathub_auth_group', [group])

        await this.addUserToGroup(user, group.name)
    }

    async resolveAuthGroup(
        session: Session,
        platform: string,
        userId: string = session.userId
    ): Promise<ChatHubAuthGroup> {
        // search platform

        const groups = (
            await this.ctx.database.get('chathub_auth_group', {
                platform: {
                    $or: [undefined, platform]
                }
            })
        ).sort((a, b) => {
            // prefer the same platform
            if (a.platform === platform) {
                return -1
            }
            if (b.platform === platform) {
                return 1
            }
            return b.priority - a.priority
        })

        // Here there will be no such thing as a user joining too many groups, so a query will work.
        const groupIds = groups.map((g) => g.id)

        const joinedGroups = (
            await this.ctx.database.get('chathub_auth_joined_user', {
                groupId: {
                    // max 50??
                    $in: groupIds
                },
                userId
            })
        ).sort(
            (a, b) => groupIds.indexOf(a.groupId) - groupIds.indexOf(b.groupId)
        )

        if (joinedGroups.length === 0) {
            throw new ChatLunaError(ChatLunaErrorCode.AUTH_GROUP_NOT_JOINED)
        }

        const result = groups.find((g) => g.id === joinedGroups[0].groupId)

        if (result == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.AUTH_GROUP_NOT_FOUND,
                new Error(`Group not found for user ${session.username} and platform
                ${platform}`)
            )
        }

        return result
    }

    async getAuthGroups(platform?: string) {
        const groups = await this.ctx.database.get('chathub_auth_group', {
            platform
        })

        return groups
    }

    async getAuthGroup(name: string, throwError: boolean = true) {
        const result = (
            await this.ctx.database.get('chathub_auth_group', { name })
        )?.[0]

        if (result == null && throwError) {
            throw new ChatLunaError(ChatLunaErrorCode.AUTH_GROUP_NOT_FOUND)
        }

        return result
    }

    async calculateBalance(
        session: Session,
        platform: string,
        usedTokenNumber: number,
        userId: string = session.userId
    ): Promise<number> {
        // TODO: use default balance checker
        // await this.getUser(session)

        const currentAuthGroup = await this.resolveAuthGroup(
            session,
            platform,
            userId
        )

        // 1k token per
        const usedBalance = new Decimal(0.001)
            .mul(currentAuthGroup.costPerToken)
            .mul(usedTokenNumber)

        return await this.modifyBalance(session, -usedBalance.toNumber())
    }

    async getBalance(
        session: Session,
        userId: string = session.userId
    ): Promise<number> {
        return (await this.getUser(session, userId)).balance
    }

    async modifyBalance(
        session: Session,
        amount: number,
        userId: string = session.userId
    ): Promise<number> {
        const user = await this.getUser(session, userId)

        user.balance = new Decimal(user.balance).add(amount).toNumber()

        await this.ctx.database.upsert('chathub_auth_user', [user])

        return user.balance
    }

    async setBalance(
        session: Session,
        amount: number,
        userId: string = session.userId
    ): Promise<number> {
        const user = await this.getUser(session, userId)

        user.balance = amount

        await this.ctx.database.upsert('chathub_auth_user', [user])

        return user.balance
    }

    private async _getAuthGroup(authGroupId: number) {
        const authGroup = (
            await this.ctx.database.get('chathub_auth_group', {
                id: authGroupId
            })
        )?.[0]

        if (authGroup == null) {
            throw new ChatLunaError(
                ChatLunaErrorCode.AUTH_GROUP_NOT_FOUND,
                new Error(`Auth group not found for id ${authGroupId}`)
            )
        }

        return authGroup
    }

    async resetAuthGroup(authGroupId: number) {
        const authGroup = await this._getAuthGroup(authGroupId)
        const currentTime = new Date()

        authGroup.lastCallTime = authGroup.lastCallTime ?? currentTime.getTime()

        const authGroupDate = new Date(authGroup.lastCallTime)

        const currentDayOfStart = new Date().setHours(0, 0, 0, 0)

        // If the last call time is not today, then all zeroed out

        if (authGroupDate.getTime() < currentDayOfStart) {
            authGroup.currentLimitPerDay = 0
            authGroup.currentLimitPerMin = 0
            authGroup.lastCallTime = currentTime.getTime()

            await this.ctx.database.upsert('chathub_auth_group', [authGroup])

            return authGroup
        }

        // Check to see if it's been more than a minute since the last call

        if (currentTime.getTime() - authGroup.lastCallTime >= 60000) {
            // clear

            authGroup.currentLimitPerMin = 0
            authGroup.lastCallTime = currentTime.getTime()

            await this.ctx.database.upsert('chathub_auth_group', [authGroup])

            return authGroup
        }

        return authGroup
    }

    async increaseAuthGroupCount(authGroupId: number) {
        const authGroup = await this._getAuthGroup(authGroupId)
        const currentTime = new Date()

        authGroup.lastCallTime = authGroup.lastCallTime ?? currentTime.getTime()

        const authGroupDate = new Date(authGroup.lastCallTime)

        const currentDayOfStart = new Date().setHours(0, 0, 0, 0)

        // If the last call time is not today, then all zeroed out

        if (authGroupDate.getTime() < currentDayOfStart) {
            authGroup.currentLimitPerDay = 1
            authGroup.currentLimitPerMin = 1
            authGroup.lastCallTime = currentTime.getTime()

            await this.ctx.database.upsert('chathub_auth_group', [authGroup])

            return
        }

        // Check to see if it's been more than a minute since the last call

        if (currentTime.getTime() - authGroup.lastCallTime >= 60000) {
            // clear

            authGroup.currentLimitPerDay += 1
            authGroup.currentLimitPerMin = 1
            authGroup.lastCallTime = currentTime.getTime()

            await this.ctx.database.upsert('chathub_auth_group', [authGroup])
        }

        authGroup.currentLimitPerDay += 1
        authGroup.currentLimitPerMin += 1

        await this.ctx.database.upsert('chathub_auth_group', [authGroup])
    }

    async addUserToGroup(user: ChatHubAuthUser, groupName: string) {
        const group = await this.getAuthGroup(groupName)

        const isJoined =
            (
                await this.ctx.database.get('chathub_auth_joined_user', {
                    groupName,
                    userId: user.userId
                })
            ).length === 1

        if (isJoined) {
            throw new ChatLunaError(ChatLunaErrorCode.AUTH_GROUP_ALREADY_JOINED)
        }

        await this.ctx.database.upsert('chathub_auth_joined_user', [
            {
                userId: user.userId,
                groupId: group.id,
                groupName: group.name
            }
        ])
    }

    async removeUserFormGroup(user: ChatHubAuthUser, groupName: string) {
        const group = await this.getAuthGroup(groupName)

        await this.ctx.database.remove('chathub_auth_joined_user', {
            userId: user.userId,
            groupName: group.name
        })
    }

    async setAuthGroup(groupName: string, group: Partial<ChatHubAuthGroup>) {
        await this.ctx.database.upsert('chathub_auth_group', [
            Object.assign({}, group, {
                name: groupName
            })
        ])
    }

    private async _initAuthGroup() {
        // init guest group

        const groups = await this.ctx.database.get('chathub_auth_group', {
            name: {
                $in: ['guest', 'user', 'admin']
            }
        })

        let currentGroup: Omit<ChatHubAuthGroup, 'id' | 'supportModels'>

        if (!groups.some((g) => g.name === 'guest')) {
            currentGroup = {
                name: 'guest',
                priority: 0,

                limitPerMin: 10,
                limitPerDay: 2000,

                // 1000 token / 0.3
                costPerToken: 0.3
            }

            await this.ctx.database.upsert('chathub_auth_group', [currentGroup])
        }

        if (!groups.some((g) => g.name === 'user')) {
            currentGroup = {
                name: 'user',
                priority: 1,
                limitPerMin: 1000,
                limitPerDay: 200000,

                // 1000 token / 0.01
                costPerToken: 0.01
            }

            await this.ctx.database.upsert('chathub_auth_group', [currentGroup])
        }

        if (!groups.some((g) => g.name === 'admin')) {
            currentGroup = {
                name: 'admin',
                priority: 2,
                limitPerMin: 10000,
                limitPerDay: 20000000,

                // 1000 token / 0.001
                costPerToken: 0.001
            }

            await this.ctx.database.upsert('chathub_auth_group', [currentGroup])
        }
    }

    private async _defineDatabase() {
        const ctx = this.ctx

        ctx.database.extend(
            'chathub_auth_user',
            {
                userId: {
                    type: 'string'
                },
                balance: {
                    type: 'decimal',
                    precision: 20,
                    scale: 10
                },
                authType: {
                    type: 'char',
                    length: 50
                }
            },
            {
                autoInc: false,
                primary: 'userId',
                unique: ['userId']
            }
        )

        ctx.database.extend(
            'chathub_auth_joined_user',
            {
                userId: 'string',
                groupId: 'integer',
                groupName: 'string',
                id: 'integer'
            },
            {
                autoInc: true,
                primary: 'id',
                unique: ['id']
            }
        )

        ctx.database.extend(
            'chathub_auth_group',
            {
                limitPerDay: {
                    type: 'integer',
                    nullable: false
                },
                limitPerMin: {
                    type: 'integer',
                    nullable: false
                },
                lastCallTime: {
                    type: 'integer',
                    length: 7,
                    nullable: true
                },
                currentLimitPerDay: {
                    type: 'integer',
                    nullable: true
                },
                currentLimitPerMin: {
                    type: 'integer',
                    nullable: true
                },
                supportModels: {
                    type: 'json',
                    nullable: true
                },
                priority: {
                    type: 'integer',
                    nullable: false,
                    initial: 0
                },
                platform: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                costPerToken: {
                    type: 'decimal',
                    precision: 8,
                    scale: 4
                },
                name: {
                    type: 'char',
                    length: 255
                },
                id: {
                    type: 'integer'
                }
            },
            {
                autoInc: true,
                primary: 'id',
                unique: ['id', 'name']
            }
        )

        await this._initAuthGroup()
    }
}
