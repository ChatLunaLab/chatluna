/* eslint-disable @typescript-eslint/naming-convention */
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { addPromptTemplate } from '../PromptManager'

const ner_system = "You're a very effective entity extraction system."

const query_prompt_one_shot_input = `Please extract all named entities that are important for solving the questions below.
Place the named entities in json format.

Question: Which magazine was started first Arthur's Magazine or First for Women?

`
const query_prompt_one_shot_output = `
{{"named_entities": ["First for Women", "Arthur's Magazine"]]}}
`

addPromptTemplate(
    'ner_query',
    ChatPromptTemplate.fromMessages([
        ['system', ner_system],
        ['user', query_prompt_one_shot_input],
        ['assistant', query_prompt_one_shot_output],
        ['user', `Question: {query}`]
    ])
)
