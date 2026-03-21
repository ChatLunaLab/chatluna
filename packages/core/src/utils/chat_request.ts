import { randomUUID } from 'crypto'
import type { Session } from 'koishi'

const requestIdCache = new Map<string, string>()

function getRequestCacheKey(session: Session, conversationId: string) {
    return session.userId + '-' + (session.guildId ?? '') + '-' + conversationId
}

export function getRequestId(session: Session, conversationId: string) {
    return requestIdCache.get(getRequestCacheKey(session, conversationId))
}

export function createRequestId(
    session: Session,
    conversationId: string,
    requestId: string = randomUUID()
) {
    requestIdCache.set(getRequestCacheKey(session, conversationId), requestId)

    return requestId
}

export function deleteRequestId(session: Session, conversationId: string) {
    requestIdCache.delete(getRequestCacheKey(session, conversationId))
}
