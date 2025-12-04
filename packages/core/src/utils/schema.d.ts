import { Context } from 'koishi'
/**
 * Sets up the model selection schema by automatically watching for model changes
 * in the platform service and updating the 'model' schema.
 * Registers all available LLM model names to the {@link SchemaService} for use in configuration UI.
 * @param ctx - Koishi context object
 */
export declare function modelSchema(
    ctx: Context,
    createNotification?: boolean
): void
/**
 * Sets up the embeddings model selection schema by automatically watching for embedding model changes
 * in the platform service and updating the 'embeddings' schema.
 * Registers all available embedding model names to the {@link SchemaService} for use in configuration UI.
 * @param ctx - Koishi context object
 */
export declare function embeddingsSchema(ctx: Context): void
/**
 * Sets up the chat chain mode selection schema by automatically watching for chat chain changes
 * in the platform service and updating the 'chat-mode' schema.
 * Registers all available chat chain names and descriptions to the {@link SchemaService} for use in configuration UI.
 * @param ctx - Koishi context object
 */
export declare function chatChainSchema(ctx: Context): void
/**
 * Sets up the vector store selection schema by automatically watching for vector store changes
 * in the platform service and updating the 'vector-store' schema.
 * Registers all available vector store names to the {@link SchemaService} for use in configuration UI.
 * @param ctx - Koishi context object
 */
export declare function vectorStoreSchema(ctx: Context): void
