export interface DocumentInput<
  Metadata extends Record<string, any> = Record<string, any>
> {
  pageContent: string;

  metadata?: Metadata;
}

/**
 * 用于与文档交互
 */
export class Document<
  Metadata extends Record<string, any> = Record<string, any>
> implements DocumentInput
{
  pageContent: string;

  metadata: Metadata;

  constructor(fields: DocumentInput<Metadata>) {
    this.pageContent = fields.pageContent
      ? fields.pageContent.toString()
      : this.pageContent;
    this.metadata = fields.metadata ?? ({} as Metadata);
  }
}