import { createLogger } from '@dingyi222666/chathub-llm-core/lib/utils/logger'
import BingChatPlugin from '.'


const logger = createLogger('@dingyi222666/chathub-newbing-adapter/api')

/**
 * https://stackoverflow.com/a/58326357
 * @param {number} size
 */
const genRanHex = (size) => [...Array(size)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')


export class Api {

    private _cookie: string

    constructor(private readonly _config: BingChatPlugin.Config) { }
}