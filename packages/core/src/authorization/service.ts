import { Context, Service, Session } from 'koishi'
import { Config } from '../config'
import { ChatHubAuthUser } from './types'
import { ChatHubError, ChatHubErrorCode } from '../utils/error'
/* import { createLogger } from '../utils/logger'

const logger = createLogger() */

export class ChatHubAuthService extends Service {
    constructor(
        public readonly ctx: Context,
        public config: Config
    ) {
        super(ctx, 'chathub_auth')

        ctx.on('ready', async () => {
            await this._defineDatabase()
        })
    }

    async getAccount(session: Session): Promise<ChatHubAuthUser> {
        const list = await this.ctx.database.get('chathub_auth_user', {
            userId: session.userId
        })

        if (list.length === 0) {
            return this._createAccount(session)
        } else if (list.length > 1) {
            throw new ChatHubError(ChatHubErrorCode.USER_NOT_FOUND)
        }

        return list[0]
    }

    private async _createAccount(session: Session): Promise<ChatHubAuthUser> {
        const user = await this.ctx.database.getUser(
            session.platform,
            session.userId
        )

        // TODO: automatic grant of user type
        const authType =
            user.authority > 2 ? 'admin' : user.authority > 1 ? 'user' : 'guest'

        const authUser: ChatHubAuthUser = {
            userId: session.userId,
            balance:
                authType === 'admin' ? 10000 : authType === 'user' ? 100 : 1,
            authType
        }

        await this.ctx.database.upsert('chathub_auth_user', [authUser])

        await this.addUserToGroup(authUser, authType)

        return authUser
    }

    private async _getAuthUser(session: Session): Promise<ChatHubAuthUser> {
        return (
            await this.ctx.database.get('chathub_auth_user', {
                userId: session.userId
            })
        )[0]
    }

    async getBalance(session: Session): Promise<number> {
        return (await this._getAuthUser(session)).balance
    }

    async modifyBalance(session: Session, amount: number): Promise<number> {
        const user = await this._getAuthUser(session)

        user.balance += amount

        await this.ctx.database.upsert('chathub_auth_user', [user])

        return user.balance
    }

    async addUserToGroup(user: ChatHubAuthUser, groupName: string) {
        const group = (
            await this.ctx.database.get('chathub_auth_group', {
                name: groupName
            })
        )?.[0]

        if (group == null) {
            throw new ChatHubError(ChatHubErrorCode.AUTH_GROUP_NOT_FOUND)
        }

        await this.ctx.database.upsert('chathub_auth_joined_user', [
            {
                userId: user.userId,
                groupId: group.id,
                groupName: group.name
            }
        ])
    }

    private async _initAuthGroup() {
        // init guest group

        let guestGroup = (
            await this.ctx.database.get('chathub_auth_group', {
                name: 'guest'
            })
        )?.[0]

        if (guestGroup == null) {
            guestGroup = {
                name: 'guest',

                limitPerMin: 10,
                limitPerDay: 2000,

                // 1000 token / 0.3
                constPerToken: 0.3,
                id: undefined,
                supportModels: undefined
            }

            await this.ctx.database.upsert('chathub_auth_group', [guestGroup])
        }

        let userGroup = (
            await this.ctx.database.get('chathub_auth_group', { name: 'user' })
        )?.[0]

        if (userGroup == null) {
            userGroup = {
                name: 'user',

                limitPerMin: 1000,
                limitPerDay: 200000,

                // 1000 token / 0.01
                constPerToken: 0.01,
                id: undefined,
                supportModels: undefined
            }
        }

        let adminGroup = (
            await this.ctx.database.get('chathub_auth_group', {
                name: 'admin'
            })
        )?.[0]

        if (adminGroup == null) {
            adminGroup = {
                name: 'admin',
                limitPerMin: 10000,
                limitPerDay: 20000000,

                // 1000 token / 0.001
                constPerToken: 0.001,
                id: undefined,
                supportModels: undefined
            }

            await this.ctx.database.upsert('chathub_auth_group', [adminGroup])
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
                    type: 'decimal'
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
                platform: {
                    type: 'char',
                    length: 255,
                    nullable: true
                },
                constPerToken: {
                    type: 'integer'
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
