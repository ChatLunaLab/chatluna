## koishi-plugin-chatluna-multimodal-service

ChatLuna 多模态支持服务，提供上下文图像描述、GIF 帧处理、`read_files` 文件读取，以及语音消息转码注入能力。

### MiMo 音频理解

MiMo 官方 OpenAI 兼容接口中，`mimo-v2.5` 与 `mimo-v2-omni` 支持音频理解。服务会将 QQ/OneBot 语音先下载到本地内存，必要时通过 `ffmpeg` 转成 MP3，再以 Base64 data URL 注入 `input_audio`：

- 避免 QQ CDN 直链过期导致模型侧晚读失败。
- 规避 AMR、Silk 等上游模型不稳定支持的格式。
- 遵循 MiMo Base64 单音频 50 MB 上限；URL 输入的官方上限是单文件 100 MB。

MiMo 官方列出的音频格式为 MP3、WAV、FLAC、M4A、OGG。实际变体较多，服务默认把语音消息转成 MP3 以提高稳定性。

`read_files` 也会沿用这条路线：工具调用层如果把 `files` 传成 JSON 字符串，会先容错解析；音频 URL 即使被缓存服务误标为 MP3，也会按文件头识别 AMR/Silk 等实际格式，并在模型注入前通过 `ffmpeg` 转成 MP3。

### MiMo 图片理解

`mimo-v2.5` 与 `mimo-v2-omni` 也支持图片理解。即使 OpenAI 兼容适配器暂未在模型元数据中声明 `ImageInput`，服务也会把这两个 MiMo 模型视为原生图片输入模型，并使用标准 OpenAI 兼容 `image_url` 内容块注入 Base64 data URL。

- 支持 JPEG、PNG、GIF、WebP、BMP。
- MiMo Base64 单图片上限为 50 MB；URL 单图片官方上限同样为 50 MB。
- 多图输入受模型上下文和 token 长度限制。

音频消息转码需要启用：

- `enableAudioFfmpegConversion`
- `koishi-plugin-ffmpeg-path`
- 官方 Bot/QQ Silk 语音还需要 `koishi-plugin-ffmpeg-path` 提供的 `silk` 服务
