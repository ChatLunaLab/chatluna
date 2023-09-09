import { Callbacks } from 'langchain/callbacks'
import { BaseOutputParser } from 'langchain/schema/output_parser'

export class ChatHubBrowsingActionOutputParser extends BaseOutputParser<ChatHubBrowsingAction> {
    lc_namespace: string[] = ['llm-core', 'chain']

    async parse(text: string, callbacks?: Callbacks): Promise<ChatHubBrowsingAction> {
        let parsed: ChatHubBrowsingAction

        try {
            parsed = JSON.parse(text)

            if (parsed.tool && parsed.args) {
                parsed.args = JSON.stringify(parsed.args)
                return parsed
            } else {
                return {
                    tool: 'ERROR',
                    args: `Could not parse invalid json: ${text}`
                }
            }
        } catch (e) {
            return {
                tool: 'ERROR',
                args: `Could not parse invalid json: ${text}, error: ${e}`
            }
        }
    }

    getFormatInstructions(): string {
        throw new Error('Method not implemented.')
    }
}

export interface ChatHubBrowsingAction {
    tool?: string
    args?: string
}
