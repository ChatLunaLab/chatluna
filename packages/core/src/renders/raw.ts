
import { RenderMessage, RenderOptions, SimpleMessage } from '../types';
import { buildTextElement } from '../chat';
import { Renderer } from '../render';

export default class RawRenderer extends Renderer {

    async render(message: SimpleMessage, options: RenderOptions): Promise<RenderMessage> {

        return {
            element: buildTextElement(message.content),
        }
    }
}