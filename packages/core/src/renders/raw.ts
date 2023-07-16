
import { RenderMessage, RenderOptions, Message } from '../types';
import { Renderer } from '../render';
import { h } from 'koishi';

export default class RawRenderer extends Renderer {

    async render(message: Message, options: RenderOptions): Promise<RenderMessage> {

        return {
            element: h.text(message.content),
        }
    }
}