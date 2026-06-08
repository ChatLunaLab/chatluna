import { Context } from '@koishijs/client'
import type {} from 'koishi-plugin-chatluna-usage'
import charts from './charts'
import home from './home.vue'

export default (ctx: Context) => {
    ctx.plugin(charts)

    ctx.slot({
        type: 'home',
        component: home,
        order: -1000
    })
}
