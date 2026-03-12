import { Context } from 'koishi'
import { AgentConfig } from '../types'

export class ChatLunaAgentSubAgentService {
    constructor(
        public ctx: Context,
        public config: AgentConfig
    ) {}

    getStatus() {
        return {
            enabled: false,
            agents: {}
        }
    }

    async reload() {}
}
