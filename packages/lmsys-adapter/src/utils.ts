import { v4 as uuidv4 } from "uuid"
import { AIMessage, BaseMessage, HumanMessage, SystemMessage } from 'langchain/schema'
import TurndownService from 'turndown'

export async function formatMessages(messages: BaseMessage[],
  tokenCounter?: (text: string) => Promise<number>, maxTokenCount?: number) {
  const formatMessages: BaseMessage[] = [
    ...messages]

  const result: string[] = []

  let tokenCount = 0

  result.push("\nThe following is a friendly conversation between a user and an ai. The ai is talkative and provides lots of specific details from its context. The ai use the ai prefix. \n\n")

  tokenCount += await tokenCounter(result[result.length - 1])

  for (const message of formatMessages) {
    const roleType = message._getType() === "human" ? 'user' : message._getType()
    const formatted = `${roleType}: ${message.content}`

    const formattedTokenCount = await tokenCounter(formatted)

    if (tokenCount + formattedTokenCount > maxTokenCount) {
      break
    }

    result.push(formatted)

    tokenCount += formattedTokenCount
  }

  return result.join("\n\n")
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