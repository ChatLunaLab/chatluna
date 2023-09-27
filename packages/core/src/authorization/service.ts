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

        const authType =
            user.authority > 2 ? 'admin' : user.authority > 1 ? 'user' : 'guest'

        const authUser: ChatHubAuthUser = {
            userId: session.userId,
            balance:
                authType === 'admin' ? 10000 : authType === 'user' ? 100 : 10,
            authType
        }

        await this.ctx.database.upsert('chathub_auth_user', [authUser])

        return authUser
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
    }
}
