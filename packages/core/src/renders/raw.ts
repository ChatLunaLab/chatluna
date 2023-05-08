
import { RenderMessage, RenderOptions, SimpleMessage } from '../types';
import { Renderer } from '../render';
import { h } from 'koishi';

export default class RawRenderer extends Renderer {

    async render(message: SimpleMessage, options: RenderOptions): Promise<RenderMessage> {

        return {
            element: h.text(message.text),
        }
    }
}