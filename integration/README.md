# ChatLuna Koishi Integration Harness

This directory contains an independent integration harness. It starts a real
Koishi `Context` with the memory database, server, console, ChatLuna core,
ChatLuna Agent, and the official Koishi mock adapter.

The default profile is local and deterministic. It builds the participating
workspace packages, creates a temporary Koishi `baseDir`, sends a private probe
through the official `MockBot` and `MessageClient`, resolves a real ChatLuna
conversation, verifies its memory-database record, prints a JSON summary, and
removes the temporary directory.

```sh
yarn integration
```

Build the packages used by the harness without running it:

```sh
yarn integration:build
```

The live profile loads the real OpenAI-compatible ChatLuna adapter, declares
the requested model without model discovery, and sends one real private prompt:

```sh
CHATLUNA_LIVE_API_KEY=... \
CHATLUNA_LIVE_BASE_URL=https://example.com/v1 \
CHATLUNA_LIVE_MODEL=model-name \
CHATLUNA_LIVE_PLATFORM=provider-name \
CHATLUNA_LIVE_PROMPT='Reply with a short integration response.' \
yarn integration:live
```

All five live variables are required. The harness never prints the API key or
includes it in the JSON summary.

The local backend scope probe uses no model and no test framework:

```sh
yarn integration:scope
```

On macOS, local commands use the production `sandbox-exec` profile with the
configured scope, read-only roots, and session-private temporary directory. On
Linux, the local API checks still enforce scope and symlink containment, while
the existing bubblewrap backend remains a read-only host bind with writable
scope and temporary mounts. It does not yet provide macOS-equivalent process
filesystem isolation and requires `bwrap` to be installed.

The stream idle probe feeds raw SSE responses through the shared adapter,
without a live model or test framework. It covers buffered reasoning traffic,
raw silence, retry limits, partial stalls, and parent aborts:

```sh
yarn integration:stream-idle
```

`@koishijs/plugin-mock` is used only as the official bot transport. The
`Context`, database, `ChatLunaService`, `ConversationService`, and
`ChatLunaAgentService` are real plugin services; the harness does not replace
or imitate them and does not use a test framework.

## Koishi References

- [Writing Tests](https://koishi.chat/en-US/cookbook/practice/testing.html)
- [Official Mock plugin](https://koishi.chat/en-US/plugins/develop/mock.html)
- [Bot API](https://koishi.chat/en-US/api/core/bot.html)
- [Session API](https://koishi.chat/en-US/api/core/session.html)
- [Plugin lifecycle](https://koishi.chat/en-US/guide/plugin/lifecycle.html)
