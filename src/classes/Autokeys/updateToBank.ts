import Bot from '../Bot';
import { EntryData, PricelistChangedSource } from '../Pricelist';

import log from '../../lib/logger';

export default function updateToBank(minKeys: number, maxKeys: number, bot: Bot): void {
    const keyPrices = bot.pricelist.getKeyPrices();
    const opt = bot.options;
    let entry;

    if (keyPrices.src !== 'manual') {
        entry = {
            sku: '5021;6',
            enabled: true,
            autoprice: true,
            min: minKeys,
            max: maxKeys,
            intent: 2,
            note: {
                buy: '[𝐀𝐮𝐭𝐨𝐤𝐞𝐲𝐬] ' + opt.details.buy,
                sell: '[𝐀𝐮𝐭𝐨𝐤𝐞𝐲𝐬] ' + opt.details.sell
            }
        } as any;
    } else {
        entry = {
            sku: '5021;6',
            enabled: true,
            autoprice: false,
            sell: {
                keys: 0,
                metal: keyPrices.sell.metal
            },
            buy: {
                keys: 0,
                metal: keyPrices.buy.metal
            },
            min: minKeys,
            max: maxKeys,
            intent: 2,
            note: {
                buy: '[𝐀𝐮𝐭𝐨𝐤𝐞𝐲𝐬] ' + opt.details.buy,
                sell: '[𝐀𝐮𝐭𝐨𝐤𝐞𝐲𝐬] ' + opt.details.sell
            }
        } as any;
    }
    bot.pricelist
        .updatePrice(entry as EntryData, false, PricelistChangedSource.Autokeys)
        .then(data => {
            log.debug(`✅ Automatically updated Mann Co. Supply Crate Key to bank.`);
            bot.listings.checkBySKU(data.sku, data);
        })
        .catch(err => {
            log.warn(`❌ Failed to update Mann Co. Supply Crate Key to bank automatically: ${err.message}`);
        });
}
