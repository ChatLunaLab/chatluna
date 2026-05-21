import { Context } from '@koishijs/client'
import tokenLine from './token-line'
import './index.scss'

export default (ctx: Context) => {
    ctx.plugin(tokenLine)
}
