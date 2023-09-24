import { Context, Service } from 'koishi'
import { Config } from '../config'
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
