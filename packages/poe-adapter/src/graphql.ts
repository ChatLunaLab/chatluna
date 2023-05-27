import { readFileSync } from 'fs';

// parent -> graphql
const graphqlDir = __dirname + '/graphql';

export default {
    // as string
    subscriptionsMessageAddedSubscription: readFileSync(graphqlDir + '/SubscriptionsMessageAddedSubscription.graphql').toString("utf-8"),
    addMessageBreakEdgeMutation: readFileSync(graphqlDir + '/AddMessageBreakEdgeMutation.graphql').toString("utf-8"),
    subscriptionsViewerStateUpdatedSubscription: readFileSync(graphqlDir + '/ViewerStateUpdatedSubscription.graphql').toString("utf-8"),
    subscriptionsMutation: readFileSync(graphqlDir + "/SubscriptionsMutation.graphql").toString("utf-8"),
    sendMessageMutation: readFileSync(graphqlDir + "/SendMessageMutation.graphql").toString("utf-8"),
    chatPaginationQuery: readFileSync(graphqlDir + "/ChatPaginationQuery.graphql").toString("utf-8"),
}