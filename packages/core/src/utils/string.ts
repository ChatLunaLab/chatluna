import { BaseMessage } from '@langchain/core/messages'

export function fuzzyQuery(source: string, keywords: string[]): boolean {
    for (const keyword of keywords) {
        const match = source.includes(keyword)
        // 如果距离小于等于最大距离，说明匹配成功，返回 true
        if (match) {
            return true
        }
    }
    // 如果遍历完所有关键词都没有匹配成功，返回 false
    return false
}

export function getMessageContent(message: BaseMessage['content']) {
    if (typeof message === 'string') {
        return message
    }

    if (message == null) {
        return ''
    }

    const buffer = []
    for (const part of message) {
        if (part.type === 'text') {
            buffer.push(part.text)
        }
    }
    return buffer.join('')
}

export function getNotEmptyString(...texts: (string | undefined)[]): string {
    for (const text of texts) {
        if (text && text?.length > 0) {
            return text
        }
    }
}

export function getCurrentWeekday() {
    const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const currentDate = new Date();
    return daysOfWeek[currentDate.getDay()];
}