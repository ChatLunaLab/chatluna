import { readFileSync, readSync } from 'fs';


const graphqlDir = process.cwd() + '/graphql';

export default {
    // as string
    chatViewQuery: readFileSync(graphqlDir + '/ChatViewQuery.graphql'),
    addMessageBreakMutation: readFileSync(graphqlDir + '/AddMessageBreakMutation.graphql'),
    addHumanMessageMutation: readFileSync(graphqlDir + '/AddHumanMessageMutation.graphql'),
}