import { Context } from '@koishijs/client'
import type {} from 'koishi-plugin-chatluna-usage'
import Charts from './charts'
import Home from './home.vue'

export default (ctx: Context) => {
    ctx.plugin(Charts)

    ctx.slot({
        type: 'home',
        component: Home,
        order: -1000
    })
}
