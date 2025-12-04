import { Context, Service, Session } from 'koishi'
import { ChatHubAuthGroup, ChatHubAuthUser } from './types'
export declare class ChatLunaAuthService extends Service {
    readonly ctx: Context
    config: any
    constructor(ctx: Context, config: any)
    getUser(session: Session, userId?: string): Promise<ChatHubAuthUser>
    private _createUser
    createAuthGroup(session: Session, group: ChatHubAuthGroup): Promise<void>
    resolveAuthGroup(
        session: Session,
        platform: string,
        userId?: string
    ): Promise<ChatHubAuthGroup>

    getAuthGroups(platform?: string): Promise<ChatHubAuthGroup[]>
    getAuthGroup(name: string, throwError?: boolean): Promise<ChatHubAuthGroup>
    calculateBalance(
        session: Session,
        platform: string,
        usedTokenNumber: number,
        userId?: string
    ): Promise<number>

    getBalance(session: Session, userId?: string): Promise<number>
    modifyBalance(
        session: Session,
        amount: number,
        userId?: string
    ): Promise<number>

    setBalance(
        session: Session,
        amount: number,
        userId?: string
    ): Promise<number>

    private _getAuthGroup
    resetAuthGroup(authGroupId: number): Promise<ChatHubAuthGroup>
    increaseAuthGroupCount(authGroupId: number): Promise<void>
    addUserToGroup(user: ChatHubAuthUser, groupName: string): Promise<void>
    removeUserFormGroup(user: ChatHubAuthUser, groupName: string): Promise<void>
    setAuthGroup(
        groupName: string,
        group: Partial<ChatHubAuthGroup>
    ): Promise<void>

    private _initAuthGroup
    private _defineDatabase
}
