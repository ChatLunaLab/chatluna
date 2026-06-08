import { defineAsyncComponent } from 'vue'
import { Context, store } from '@koishijs/client'
import type {} from 'koishi-plugin-chatluna-usage'

export default (ctx: Context) => {
    ctx.slot({
        type: 'home',
        component: defineAsyncComponent(async () => {
            const [home, charts] = await Promise.all([
                import('./home.vue'),
                import('./charts')
            ])
            ctx.plugin(charts.default)
            return home.default
        }),
        order: -1000,
        disabled: () => !store.chatluna_usage
    })
}
