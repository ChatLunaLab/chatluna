import { ChatPromptTemplate } from '@langchain/core/prompts'
import { addPromptTemplate } from '../PromptManager'

/* eslint-disable max-len */
const oneShotIrcotDemoDocs = `Wikipedia Title: Milk and Honey (album)
Milk and Honey is an album by John Lennon and Yoko Ono released in 1984. Following the compilation "The John Lennon Collection", it is Lennon's eighth and final studio album, and the first posthumous release of new Lennon music, having been recorded in the last months of his life during and following the sessions for their 1980 album "Double Fantasy". It was assembled by Yoko Ono in association with the Geffen label.

Wikipedia Title: John Lennon Museum
John Lennon Museum (ジョン・レノン・ミュージアム , Jon Renon Myūjiamu ) was a museum located inside the Saitama Super Arena in Chūō-ku, Saitama, Saitama Prefecture, Japan. It was established to preserve knowledge of John Lennon's life and musical career. It displayed Lennon's widow Yoko Ono's collection of his memorabilia as well as other displays. The museum opened on October 9, 2000, the 60th anniversary of Lennon's birth, and closed on September 30, 2010, when its exhibit contract with Yoko Ono expired. A tour of the museum began with a welcoming message and short film narrated by Yoko Ono (in Japanese with English headphones available), and ended at an avant-garde styled "reflection room" full of chairs facing a slide show of moving words and images. After this room there was a gift shop with John Lennon memorabilia available.

Wikipedia Title: Walls and Bridges
Walls and Bridges is the fifth studio album by English musician John Lennon. It was issued by Apple Records on 26 September 1974 in the United States and on 4 October in the United Kingdom. Written, recorded and released during his 18-month separation from Yoko Ono, the album captured Lennon in the midst of his "Lost Weekend". "Walls and Bridges" was an American "Billboard" number-one album and featured two hit singles, "Whatever Gets You thru the Night" and "#9 Dream". The first of these was Lennon's first number-one hit in the United States as a solo artist, and his only chart-topping single in either the US or Britain during his lifetime.

Wikipedia Title: Nobody Loves You (When You're Down and Out)
"Nobody Loves You (When You're Down and Out)" is a song written by John Lennon released on his 1974 album "Walls and Bridges". The song is included on the 1986 compilation "Menlove Ave.", the 1990 boxset "Lennon", the 1998 boxset "John Lennon Anthology", the 2005 two-disc compilation "", and the 2010 boxset "Gimme Some Truth".

Wikipedia Title: Give Peace a Chance
"Give Peace a Chance" is an anti-war song written by John Lennon (credited to Lennon–McCartney), and performed with Yoko Ono in Montreal, Quebec, Canada. Released as a single in 1969 by the Plastic Ono Band on Apple Records (catalogue Apple 13 in the United Kingdom, Apple 1809 in the United States), it is the first solo single issued by Lennon, released when he was still a member of the Beatles, and became an anthem of the American anti-war movement during the 1970s. It peaked at number 14 on the "Billboard" Hot 100 and number 2 on the British singles chart.
`

const oneShotIrcotDemo = `${oneShotIrcotDemoDocs}

Question: Nobody Loves You was written by John Lennon and released on what album that was issued by Apple Records, and was written, recorded, and released during his 18 month separation from Yoko Ono?
Thought: The album issued by Apple Records, and written, recorded, and released during John Lennon's 18 month separation from Yoko Ono is Walls and Bridges. Nobody Loves You was written by John Lennon on Walls and Bridges album. So the answer is: Walls and Bridges.

`

const ircotSystem = `You serve as an intelligent assistant, adept at facilitating users through complex, multi-hop reasoning across multiple documents. This task is illustrated through demonstrations, each consisting of a document set paired with a relevant question and its multi-hop reasoning thoughts. Your task is to generate one thought for current step, DON'T generate the whole thoughts at once! If you reach what you believe to be the final step, start with "So the answer is:".

${oneShotIrcotDemo}`

addPromptTemplate(
    'ircot_hotpotqa',
    ChatPromptTemplate.fromMessages([
        ['system', ircotSystem],
        ['user', '{prompt_user}']
    ])
)
