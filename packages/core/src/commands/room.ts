import { Context } from 'koishi';
import { Config } from '../config';
import { ChatChain } from '../chains/chain';
import { RenderType } from '../types';
import { ChatMode } from '../middlewares/resolve_room';

export function apply(ctx: Context, config: Config, chain: ChatChain) {


    ctx.command('chathub.room', 'chathub 房间相关指令', {
        authority: 1,
    })

    ctx.command("chathub.room.create", "创建一个新房间")
        .alias("创建房间")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "createRoom"
            )
        })

    ctx.command("chathub.room.delete", "删除一个房间")
        .alias("删除房间")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "deleteRoom"
            )
        })

    ctx.command("chathub.room.kick <arg:user>", "踢出某个人员在你当前的房间")
        .alias("踢出房间")
        .action(async ({ session }, user) => {
            await chain.receiveCommand(
                session, "kickMember"
            )
        })

    ctx.command("chathub.room.invite <...arg:user>", "邀请进入房间")
        .alias("邀请进房")
        .action(async ({ session }, ...user) => {
            await chain.receiveCommand(
                session, "invite"
            )
        })

    ctx.command("chathub.room.join <id:string>", "加入某个房间")
        .alias("加入房间")
        .action(async ({ session }, name) => {
            await chain.receiveCommand(
                session, "joinRoom"
            )
        })

    ctx.command("chathub.room.leave", "离开当前房间")
        .alias("离开房间")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "leaveRoom"
            )
        })

    ctx.command("chathub.room.list", "列出所有你加入的房间")
        .alias("房间列表")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "listRoom"
            )
        })

    ctx.command("chathub.room.info", "查看当前房间的信息")
        .alias("房间信息")
        .action(async ({ session }) => {
            await chain.receiveCommand(
                session, "roomInfo"
            )
        })

    ctx.command("chathub.room.switch <name:string>", "切换到你已经加入了的房间")
        .alias("切换房间")
        .action(async ({ session }, name) => {
            await chain.receiveCommand(
                session, "switchRoom"
            )
        })

        ctx.command("chathub.room.permission <user:user>", "修改房间里某人的权限")
        .alias("房间信息")
        .action(async ({ session },user) => {
            await chain.receiveCommand(
                session, "roomPermission"
            )
        })

        ctx.command("chathub.room.mute <user:user>", "禁言某个用户，不让其发言")
        .alias("禁言用户")
        .action(async ({ session }, name) => {
            await chain.receiveCommand(
                session, "muteUser"
            )
        })
}