import IPricer, { PricerOptions } from '../../classes/IPricer';
import BackpackTFPricer from './bptf/bptf-pricer';

export function getPricer(options: PricerOptions): IPricer {
    return new BackpackTFPricer(options);
}
