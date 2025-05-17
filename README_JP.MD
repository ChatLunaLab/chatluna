<div align="center">

<img src="./logo.png" alt="プロジェクトロゴ" title="プロジェクトロゴ" width="300"/>

[中文](./README.MD) | [English](./README_EN.MD) | 日本語

#

_多プラットフォームモデルの統合、拡張性、多様な出力形式を提供するLLMチャットサービスのボットプラグイン。_

[![npm](https://img.shields.io/npm/v/koishi-plugin-chatluna)](https://www.npmjs.com/package/koishi-plugin-chatluna) [![npm](https://img.shields.io/npm/dm/koishi-plugin-chatluna)](https://www.npmjs.com/package/koishi-plugin-chatluna) ![node version](https://img.shields.io/badge/node-%3E=18-green) ![github top language](https://img.shields.io/github/languages/top/ChatLunaLab/chatluna?logo=github)

[![Telegram](https://img.shields.io/badge/Join-Telegram_Group-blue)](https://t.me/koishi_chatluna) [![QQ](https://img.shields.io/badge/Join-QQ_Group-ff69b4)](http://qm.qq.com/cgi-bin/qm/qr?_wv=1027&k=eEBVq6GK7HYX2y61x55WD6hnXTIRop-0&authKey=i4pG5%2BJ%2FY8auWprBubhremTkn3vroPigQq5m9RENGBLrLmlj%2BSu3G%2BqllK7Wts2M&noverify=0&group_code=282381753) [![doc](https://img.shields.io/badge/See-Document(WIP)-green)](https://chatluna.chat/)

**プロジェクトのステータス：1.0 公式リリース（緩やかな開発、v2バージョンの準備中）**

</div>

## 📸 スクリーンショット

| プリセット | プラグインモード & ストリーミング出力 | 画像レンダリング  |
|---------------------|--------------------------|--------------------|
| ![preset](https://s2.loli.net/2024/10/17/hfyoKXtJC5dV2Lg.webp) | ![plugin](https://s2.loli.net/2024/10/17/pcDjSIVMkB1aO6L.webp) | ![code](https://s2.loli.net/2024/10/17/7TBlbDsPM95iwdr.gif) |

## ✨ 特徴

- 🚀 高度に拡張可能（LangChain & Koishi API）
- 🎭 カスタム会話プリセット
- 🛡️ レート制限 & ブラックリストシステム
- 🎨 多形式出力（テキスト、音声、画像、混合）
- 🧠 [長期記憶](./packages/long-memory/README.md)によるコンテキスト認識
- 🔀 3つのモード：チャット、ブラウジング、プラグイン
- 🔒 [Koishi検閲](https://censor.koishi.chat/)によるコンテンツモデレーション

## 📝 ロードマップ

- [x] ルームベースの会話システム
- [x] コンテンツモデレーション
- [x] TTSサポート（[vitsサービス](https://github.com/initialencounter/2022-12-24/blob/neat/plugins/Tool/vits/readme.md)経由）
- [x] 返信の画像レンダリング
- [x] 複数モデルの統合
- [x] プリセットシステム
- [x] ~~会話のインポート/エクスポート~~（廃止）
- [x] v1リファクタリング
- [x] ストリーミング応答
- [x] 画像マルチモーダル入力サポート
- [x] [MCPプロトコルクライアントサポート](./packages/mcp-client/README.md)
- [x] i18nサポート

## 🚀 クイックスタート

基本機能を使用するためにKoishiにプラグインをインストールします。詳細なセットアップについては、[ドキュメント](https://chatluna.chat/guide/getting-started.html)を参照してください。

## 🔌 サポートされているモデル

| モデル/プラットフォーム | 統合 | 特徴 | 備考 |
|:---------------|:------------|:---------|:------|
| [OpenAI](./packages/openai-adapter/README.md) | 公式API | カスタマイズ可能、プラグイン/ブラウジングモード | 有料API |
| [Azure OpenAI](./packages/azure-openai-adapter/README.md) | 公式API | OpenAIに類似 | 有料API |
| [Google Gemini](./packages/gemini-adapter/README.md) | 公式API | 高速、GPT-3.5を上回る性能 | アカウントが必要、料金が発生する可能性 |
| [Claude API](./packages/claude-adapter) | 公式API | 大きなコンテキスト、GPT-3.5を上回ることが多い | 有料、Function Callなし |
| [Deepseek](./packages/deepseek-adapter/) | 公式API | 国内有名モデル | GPT-4oに近いかそれを超える性能 |
| [Tongyi Qianwen](./packages/qwen-adapter/README.md) | 公式API | 無料クォータあり | Zhipuよりやや優れている |
| [Zhipu](./packages/zhipu-adapter/README.md) | 公式API | 新規ユーザーに無料トークン | Xunfei Sparkより優れている |
| [Xunfei Spark](./packages/spark-adapter/README.md) | 公式API | 新規ユーザーに無料クォータ | GPT-3.5に類似 |
| [Wenxin Yiyan](./packages/wenxin-adapter/README.md) | 公式API | Baiduのモデル | Xunfei Sparkよりやや劣る |
| [Hunyuan](./packages/hunyuan-adapter/README.md) | 公式API | Tencentのモデル | Wenxin Yiyanより優れている |
| [Ollama](./packages/ollama-adapter/README.md) | 自己ホスト | オープンソース、CPU/GPUサポート | バックエンドのセットアップが必要 |
| [GPT Free](./packages/gptfree-adapter/README.md) | 非公式 | 他のウェブサイトのGPTモデルを使用 | 不安定、失敗する可能性 |
| [ChatGLM](./packages/chatglm-adapter/README.md) | 自己ホスト | 自己ホスト可能 | バックエンドが必要、性能が最適でない |
| [RWKV](./packages/rwkv-adapter/README.md) | 自己ホスト | オープンソースモデル | バックエンドのセットアップが必要 |

[ウェブ検索サポート](/packages/search-service/README.md):

- Google (API)
- Bing (API & Web)
- DuckDuckGO (Lite)
- Tavily (API)

## 🎭 プリセット

`1.0.0-alpha.10`から、よりカスタマイズ可能なプリセットを使用します。デフォルトのプリセット: [catgirl.yml](/packages/core/resources/presets/catgirl.yml)

プリセットフォルダ: `<koishi_dir>/data/chathub/presets`

詳細については、[プリセットシステムドキュメント](https://chatluna.chat/guide/preset-system/introduction.html)を参照してください。

## 🔧 開発

リポジトリをクローンします:

```bash
# yarn
yarn clone ChatLunaLab/chatluna
# npm
npm run clone ChatLunaLab/chatluna
```

`tsconfig.json`を更新します:

``` json
{
  "extends": "./tsconfig.base",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "koishi-plugin-chatluna-*": ["external/chatluna/packages/*/src"]
    }
  }
}
```

プロジェクトをビルドします:

``` bash
# yarn
yarn workspace @root/chatluna-koishi build
# npm
npm run build -w @root/chatluna-koishi
```

`yarn dev`または`npm run dev`で開発を開始します。

> 注: HMRは完全に互換性がない場合があります。問題が発生した場合は、再ビルドして再起動してください。

## 🆘 貢献

以下の分野での支援が必要です:

- [ ] Web UI
- [ ] HTTPサーバー
- [x] プロジェクトドキュメント

PRやディスカッションを歓迎します！

## 👥 貢献者

<a href="https://github.com/ChatLunaLab/chatluna/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=ChatLunaLab/chatluna" />
</a>

![Alt](https://repobeats.axiom.co/api/embed/d92b5a9398ee02a797355ed9b866aa93231c25b3.svg "Repobeats analytics image")

[![Star History Chart](https://api.star-history.com/svg?repos=ChatLunaLab/chatluna&type=Date)](https://star-history.com/#ChatLunaLab/chatluna)

## 📢 使用上の注意

[ChatLunaLab](https://github.com/ChatLunaLab)によって開発されました。

ChatLunaはLLMベースのチャットボットフレームワークです。私たちはオープンソースコミュニティと協力してLLM技術を進歩させています。ユーザーはオープンソースの合意を遵守し、このプロジェクトを潜在的に有害な目的や評価されていないサービスに使用しないようにする必要があります。

このプロジェクトはAIサービスを直接提供しません。ユーザーはAIサービスプロバイダーからAPIアクセスを取得する必要があります。

ユーザーは現地の法律を遵守し、現地で利用可能なAIサービスを使用する責任があります。

プロジェクトはアルゴリズム生成結果に対して責任を負いません。すべての結果と操作はユーザーの責任です。

ユーザーは独自のデータストレージを構成します。プロジェクトは直接のデータストレージを提供しません。

プロジェクトは、ユーザーが引き起こしたデータセキュリティ問題、世論リスク、またはモデルの誤用に対して責任を負いません。

## 🙏 謝辞

以下のプロジェクトに感謝します:

[koishi-plugin-openai](https://github.com/TomLBZ/koishi-plugin-openai)

[node-chatgpt-api](https://github.com/waylaidwanderer/node-chatgpt-api)

[poe-api](https://github.com/ading2210/poe-api)

[Bard](https://github.com/muhiris/wgpt)

[chathub](https://github.com/chathub-dev/chathub)
