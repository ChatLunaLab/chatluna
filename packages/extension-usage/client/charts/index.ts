import { Context } from '@koishijs/client'
import ModelPie from './model-pie'
import TokenLine from './token-line'
import ModelLine from './model-line'
import SourceBar from './source-bar'

export default (ctx: Context) => {
    ctx.plugin(ModelPie)
    ctx.plugin(TokenLine)
    ctx.plugin(ModelLine)
    ctx.plugin(SourceBar)
}
