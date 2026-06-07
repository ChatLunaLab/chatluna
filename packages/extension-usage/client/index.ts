import { Context, send, socket, useColorMode } from '@koishijs/client'
import { watch } from 'vue'
import type {} from 'koishi-plugin-chatluna-usage'
import charts from './charts'
import home from './home.vue'

export default (ctx: Context) => {
    const mode = useColorMode()

    ctx.effect(() =>
        watch(
            [mode, socket],
            () => {
                if (socket.value) send('chatluna-usage/theme', mode.value)
            },
            { immediate: true }
        )
    )

    ctx.plugin(charts)

    ctx.slot({
        type: 'home',
        component: home,
        order: -1000
    })
}
