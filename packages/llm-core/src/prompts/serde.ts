import type { TemplateFormat } from "./template.js";

export type SerializedPromptTemplate = {
  _type?: "prompt";
  input_variables: string[];
  template_format?: TemplateFormat;
  template?: string;
};

export type SerializedMessagePromptTemplate = {
  _type: "message";
  input_variables: string[];
  [key: string]: unknown;
};

/** Serialized Chat prompt template */
export type SerializedChatPromptTemplate = {
  _type?: "chat_prompt";
  input_variables: string[];
  template_format?: TemplateFormat;
  prompt_messages: SerializedMessagePromptTemplate[];
};

export type SerializedBasePromptTemplate =
  | SerializedPromptTemplate
  | SerializedChatPromptTemplate;