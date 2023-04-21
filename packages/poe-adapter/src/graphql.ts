import { readFileSync } from 'fs';

// parent -> graphql
const graphqlDir = __dirname + '/graphql';

export default {
    // as string
    messageAddedSubscription: readFileSync(graphqlDir + '/MessageAddedSubscription.graphql').toString("utf-8"),
    chatViewQuery: readFileSync(graphqlDir + '/ChatViewQuery.graphql').toString("utf-8"),
    addMessageBreakMutation: readFileSync(graphqlDir + '/AddMessageBreakMutation.graphql').toString("utf-8"),
    addHumanMessageMutation: readFileSync(graphqlDir + '/AddHumanMessageMutation.graphql').toString("utf-8"),
    viewerStateUpdatedSubscription: readFileSync(graphqlDir + '/ViewerStateUpdatedSubscription.graphql').toString("utf-8"),
    subscriptionsMutation: readFileSync(graphqlDir + "/SubscriptionsMutation.graphql").toString("utf-8"),
}