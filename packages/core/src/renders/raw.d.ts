import { Message, RenderMessage, RenderOptions } from '../types'
import { Renderer } from './default'
import { Schema } from 'koishi'
export declare class RawRenderer extends Renderer {
    render(message: Message, options: RenderOptions): Promise<RenderMessage>
    schema: Schema<'raw', 'raw'>
}
