import { ChatMessage } from '../common';

export type InputValues = Record<string, any>;
export type OutputValues = Record<string, any>;
export type MemoryVariables = Record<string, any>;

export abstract class BaseMemory {
  abstract get memoryKeys(): string[];

  abstract loadMemoryVariables(values: InputValues): Promise<MemoryVariables>;

  abstract saveContext(
    inputValues: InputValues,
    outputValues: OutputValues
  ): Promise<void>;
}

/**
 * This function is used by memory classes to select the input value
 * to use for the memory. If there is only one input value, it is used.
 * If there are multiple input values, the inputKey must be specified.
 */
export const getInputValue = (inputValues: InputValues, inputKey?: string) => {
  if (inputKey !== undefined) {
    return inputValues[inputKey];
  }
  const keys = Object.keys(inputValues);
  if (keys.length === 1) {
    return inputValues[keys[0]];
  }
  throw new Error(
    `input values have multiple keys, memory only supported when one key currently: ${keys}`
  );
};

/**
 * This function is used by memory classes to get a string representation
 * of the chat message history, based on the message content and role.
 */
export function getBufferString(
  messages: ChatMessage[],
  humanPrefix = "Human",
  aiPrefix = "AI"
): string {
  const string_messages: string[] = [];
  for (const m of messages) {
    let role: string;
    if (m.type === "human") {
      role = humanPrefix;
    } else if (m.type === "ai") {
      role = aiPrefix;
    } else if (m.type === "system") {
      role = "System";
    } else if (m.type === "generic") {
      role = (m as ChatMessage).role;
    } else {
      throw new Error(`Got unsupported message type: ${m}`);
    }
    string_messages.push(`${role}: ${m.text}`);
  }
  return string_messages.join("\n");
}