import { Context } from 'koishi'
import { ChatChain } from './chains/chain'
import { Config } from './config'

// import start
import { apply as add_user_to_auth_group } from './middlewares/auth/add_user_to_auth_group'
import { apply as black_list } from './middlewares/auth/black_list'
import { apply as create_auth_group } from './middlewares/auth/create_auth_group'
import { apply as kick_user_form_auth_group } from './middlewares/auth/kick_user_form_auth_group'
import { apply as list_auth_group } from './middlewares/auth/list_auth_group'
import { apply as mute_user } from './middlewares/auth/mute_user'
import { apply as set_auth_group } from './middlewares/auth/set_auth_group'
import { apply as allow_reply } from './middlewares/chat/allow_reply'
import { apply as censor } from './middlewares/chat/censor'
import { apply as chat_time_limit_check } from './middlewares/chat/chat_time_limit_check'
import { apply as chat_time_limit_save } from './middlewares/chat/chat_time_limit_save'
import { apply as cooldown_time } from './middlewares/chat/cooldown_time'
import { apply as message_delay } from './middlewares/chat/message_delay'
import { apply as read_chat_message } from './middlewares/chat/read_chat_message'
import { apply as render_message } from './middlewares/chat/render_message'
import { apply as rollback_chat } from './middlewares/chat/rollback_chat'
import { apply as stop_chat } from './middlewares/chat/stop_chat'
import { apply as thinking_message_recall } from './middlewares/chat/thinking_message_recall'
import { apply as thinking_message_send } from './middlewares/chat/thinking_message_send'
import { apply as list_all_embeddings } from './middlewares/model/list_all_embeddings'
import { apply as list_all_model } from './middlewares/model/list_all_model'
import { apply as list_all_tool } from './middlewares/model/list_all_tool'
import { apply as list_all_vectorstore } from './middlewares/model/list_all_vectorstore'
import { apply as request_model } from './middlewares/model/request_model'
import { apply as resolve_model } from './middlewares/model/resolve_model'
import { apply as search_model } from './middlewares/model/search_model'
import { apply as set_default_embeddings } from './middlewares/model/set_default_embeddings'
import { apply as set_default_vectorstore } from './middlewares/model/set_default_vectorstore'
import { apply as test_model } from './middlewares/model/test_model'
import { apply as add_preset } from './middlewares/preset/add_preset'
import { apply as clone_preset } from './middlewares/preset/clone_preset'
import { apply as delete_preset } from './middlewares/preset/delete_preset'
import { apply as list_all_preset } from './middlewares/preset/list_all_preset'
import { apply as set_preset } from './middlewares/preset/set_preset'
import { apply as check_room } from './middlewares/room/check_room'
import { apply as clear_room } from './middlewares/room/clear_room'
import { apply as create_room } from './middlewares/room/create_room'
import { apply as delete_room } from './middlewares/room/delete_room'
import { apply as invite_room } from './middlewares/room/invite_room'
import { apply as join_room } from './middlewares/room/join_room'
import { apply as kick_member } from './middlewares/room/kick_member'
import { apply as leave_room } from './middlewares/room/leave_room'
import { apply as list_room } from './middlewares/room/list_room'
import { apply as resolve_room } from './middlewares/room/resolve_room'
import { apply as room_info } from './middlewares/room/room_info'
import { apply as room_permission } from './middlewares/room/room_permission'
import { apply as set_auto_update_room } from './middlewares/room/set_auto_update_room'
import { apply as set_room } from './middlewares/room/set_room'
import { apply as switch_room } from './middlewares/room/switch_room'
import { apply as transfer_room } from './middlewares/room/transfer_room'
import { apply as clear_balance } from './middlewares/system/clear_balance'
import { apply as lifecycle } from './middlewares/system/lifecycle'
import { apply as query_balance } from './middlewares/system/query_balance'
import { apply as restart } from './middlewares/system/restart'
import { apply as set_balance } from './middlewares/system/set_balance'
import { apply as wipe } from './middlewares/system/wipe' // import end
export async function middleware(ctx: Context, config: Config) {
    type Middleware = (
        ctx: Context,
        config: Config,
        chain: ChatChain
    ) => PromiseLike<void> | void

    const middlewares: Middleware[] =
        // middleware start
        [
            add_user_to_auth_group,
            black_list,
            create_auth_group,
            kick_user_form_auth_group,
            list_auth_group,
            mute_user,
            set_auth_group,
            allow_reply,
            censor,
            chat_time_limit_check,
            chat_time_limit_save,
            cooldown_time,
            message_delay,
            read_chat_message,
            render_message,
            rollback_chat,
            stop_chat,
            thinking_message_recall,
            thinking_message_send,
            list_all_embeddings,
            list_all_model,
            list_all_tool,
            list_all_vectorstore,
            request_model,
            resolve_model,
            search_model,
            set_default_embeddings,
            set_default_vectorstore,
            test_model,
            add_preset,
            clone_preset,
            delete_preset,
            list_all_preset,
            set_preset,
            check_room,
            clear_room,
            create_room,
            delete_room,
            invite_room,
            join_room,
            kick_member,
            leave_room,
            list_room,
            resolve_room,
            room_info,
            room_permission,
            set_auto_update_room,
            set_room,
            switch_room,
            transfer_room,
            clear_balance,
            lifecycle,
            query_balance,
            restart,
            set_balance,
            wipe
        ] // middleware end

    for (const middleware of middlewares) {
        await middleware(ctx, config, ctx.chatluna.chatChain)
    }
}
