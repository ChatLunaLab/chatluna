import { v4 as uuidv4 } from "uuid"
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from 'langchain/schema'
import TurndownService from 'turndown'

export async function formatMessages(messages: BaseMessage[],
    tokenCounter?: (text: string) => Promise<number>, maxTokenCount?: number) {
    const formatMessages: BaseMessage[] = [
        ...messages]

    const result: string[] = []

    const systemPrompt = "\nThe following is a friendly conversation between a user and an ai. The ai is talkative and provides lots of specific details from its context. The ai use the ai prefix. \n\n"

    let tokenCount = 0

    tokenCount += await tokenCounter(systemPrompt)

    const userSystemPrompt = formatMessages.shift()

    if (userSystemPrompt) {
        tokenCount += await tokenCounter(formatMessage(userSystemPrompt))
    }

    for (const message of formatMessages.reverse()) {
        const formattedMessage = formatMessage(message)
        const formattedTokenCount = await tokenCounter(formattedMessage)

        if (tokenCount + formattedTokenCount > maxTokenCount) {
            break
        }

        result.unshift(formattedMessage)

        tokenCount += formattedTokenCount
    }

    result.unshift(formatMessage(userSystemPrompt))

    result.unshift(systemPrompt)


    return result.join("\n\n")
}

function formatMessage(message: BaseMessage) {
    const roleType = message._getType() === "human" ? 'user' : message._getType()
    return `${roleType}: ${message.content}`

}

export function generateSessionHash() {
    // https://stackoverflow.com/a/12502559/325241
    return Math.random().toString(36).substring(2)
}

export function serial(object: any): string {
    return JSON.stringify(object)
}

const turndownService = new TurndownService()

export function html2md(html: string) {
    return turndownService.turndown(html)
}