import { Context } from 'koishi'
import { ChatChain } from './chains/chain'
import { Config } from './config'

// import start
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
import { apply as request_conversation } from './middlewares/conversation/request_conversation'
import { apply as resolve_conversation } from './middlewares/conversation/resolve_conversation'
import { apply as list_all_embeddings } from './middlewares/model/list_all_embeddings'
import { apply as list_all_model } from './middlewares/model/list_all_model'
import { apply as list_all_tool } from './middlewares/model/list_all_tool'
import { apply as list_all_vectorstore } from './middlewares/model/list_all_vectorstore'
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
import { apply as conversation_manage } from './middlewares/system/conversation_manage'
import { apply as lifecycle } from './middlewares/system/lifecycle'
import { apply as restart } from './middlewares/system/restart'
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
            request_conversation,
            resolve_conversation,
            list_all_embeddings,
            list_all_model,
            list_all_tool,
            list_all_vectorstore,
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
            conversation_manage,
            lifecycle,
            restart,
            wipe
        ] // middleware end

    for (const middleware of middlewares) {
        await middleware(ctx, config, ctx.chatluna.chatChain)
    }
}
