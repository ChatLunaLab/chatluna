import { BaseMessage } from 'langchain/schema'

export const HEADERS = {
    'Content-Type': 'application/json',
    Host: 'claude.ai',
    Origin: 'https://claude.ai',
    'Upgrade-Insecure-Requests': '1',
    Referer: 'https://claude.ai/chats',
    Connection: 'keep-alive',
    //  "User-Agent": this._ua,
    Accept: '*/*',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8,en-GB;q=0.7,en-US;q=0.6'
    /*  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0", */
}

export async function formatMessages(messages: BaseMessage[]) {
    const formatMessages: BaseMessage[] = [...messages]

    const result: string[] = []

    const systemPrompt
        = '\nThe following is a friendly conversation between a user and an ai. The ai is talkative and provides lots of specific details from its context. The ai use the ai prefix. \n\n'

    const userSystemPrompt = formatMessages.shift()

    for (const message of formatMessages.reverse()) {
        const formattedMessage = formatMessage(message)

        result.unshift(formattedMessage)
    }

    result.unshift(formatMessage(userSystemPrompt))

    result.unshift(systemPrompt)

    return result.join('\n\n')
}

function formatMessage(message: BaseMessage) {
    const roleType = message._getType() === 'human' ? 'user' : message._getType()
    return `${roleType}: ${message.content}`
}
