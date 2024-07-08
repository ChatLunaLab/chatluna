import { Tool } from '@langchain/core/tools'
import { Config } from '..'
import { WebBrowser } from '../webbrowser'
import { ChatLunaPlugin } from 'koishi-plugin-chatluna/services/chat'

export abstract class SearchTool extends Tool {
    name = 'search'

    // eslint-disable-next-line max-len
    description = `a search engine. useful for when you need to answer questions about current events. input should be a raw string of keyword. About Search Keywords, you should cut what you are searching for into several keywords and separate them with spaces. For example, "What is the weather in Beijing today?" would be "Beijing weather today"`

    constructor(
        protected config: Config,
        protected _webBrowser: WebBrowser,
        protected _plugin: ChatLunaPlugin
    ) {
        super({})
    }
}
