import { Context } from '@koishijs/client'
import type {} from 'koishi-plugin-chatluna-agent'
import Dashboard from './dashboard.vue'

export default (ctx: Context) => {
    ctx.page({
        name: 'chatluna-agent',
        path: '/chatluna-agent',
        fields: ['chatluna_agent_webui'],
        component: Dashboard
    })
}
