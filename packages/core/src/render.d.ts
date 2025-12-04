import { Context } from 'koishi'
import { Config } from './config'
import { Message, RenderMessage, RenderOptions } from './types'
import { Renderer } from './renders/default'
export declare class DefaultRenderer {
    protected readonly ctx: Context
    protected readonly config: Config
    defaultOptions: RenderOptions
    private renderers
    constructor(ctx: Context, config: Config)
    render(message: Message, options?: RenderOptions): Promise<RenderMessage[]>
    addRenderer(
        type: string,
        renderer: (ctx: Context, config: Config) => Renderer
    ): () => void

    removeRenderer(type: string): void
    getRenderer(type: string): Promise<Renderer>
    updateSchema(): void
    private _getAllRendererScheme
    get rendererTypeList(): string[]
}
export * from './renders/default'
