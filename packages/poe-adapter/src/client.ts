import { createLogger } from '@dingyi222666/koishi-plugin-chathub';
import PoeAdapter from './index';
import { Context } from 'koishi';

const logger = createLogger('@dingyi222666/chathub-poe-adapter/client')

export class PoeClient {
    constructor(
        public config: PoeAdapter.Config,
        public ctx: Context
    ) {

    }

}