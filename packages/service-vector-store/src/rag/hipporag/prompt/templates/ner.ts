/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable max-len */
import { ChatPromptTemplate } from '@langchain/core/prompts'
import { addPromptTemplate } from '../PromptManager'

const ner_system = `Your task is to extract named entities from the given paragraph.
Respond with a JSON list of entities.
`

export const one_shot_ner_paragraph = `Radio City
Radio City is India's first private FM radio station and was started on 3 July 2001.
It plays Hindi, English and regional songs.
Radio City recently forayed into New Media in May 2008 with the launch of a music portal - PlanetRadiocity.com that offers music related news, videos, songs, and other music-related features.`

export const one_shot_ner_output = `{{"named_entities":
    ["Radio City", "India", "3 July 2001", "Hindi", "English", "May 2008", "PlanetRadiocity.com"]
}}
`

addPromptTemplate(
    'ner',
    ChatPromptTemplate.fromMessages([
        ['system', ner_system],
        ['user', one_shot_ner_paragraph],
        ['assistant', one_shot_ner_output],
        ['user', '{passage}']
    ])
)
