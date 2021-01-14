import Currencies from 'tf2-currencies';

import { genScrapAdjustment } from './userSettings';

import Bot from '../Bot';
import { EntryData, PricelistChangedSource } from '../Pricelist';

import log from '../../lib/logger';

export default function updateToBuy(minKeys: number, maxKeys: number, bot: Bot): void {
    const optSA = bot.options.autokeys.scrapAdjustment;
    const optD = bot.options.details;
    const keyPrices = bot.pricelist.getKeyPrices;
    const scrapAdjustment = genScrapAdjustment(optSA.value, optSA.enable);

    const entry: EntryData = {
        sku: '5021;6',
        enabled: true,
        autoprice: true,
        min: minKeys,
        max: maxKeys,
        intent: 0,
        note: {
            buy: '[𝐀𝐮𝐭𝐨𝐤𝐞𝐲𝐬] ' + optD.buy,
            sell: '[𝐀𝐮𝐭𝐨𝐤𝐞𝐲𝐬] ' + optD.sell
        }
    };

    if (keyPrices.src === 'manual' && !scrapAdjustment.enabled) {
        entry.autoprice = false;
        entry.buy = {
            keys: 0,
            metal: keyPrices.buy.metal
        };
        entry.sell = {
            keys: 0,
            metal: keyPrices.sell.metal
        };
    } else if (scrapAdjustment.enabled) {
        entry.autoprice = false;
        entry.buy = {
            keys: 0,
            metal: Currencies.toRefined(keyPrices.buy.toValue() + scrapAdjustment.value)
        };
        entry.sell = {
            keys: 0,
            metal: Currencies.toRefined(keyPrices.sell.toValue() + scrapAdjustment.value)
        };
    }

    bot.pricelist
        .updatePrice(entry, true, PricelistChangedSource.Autokeys)
        .then(() => {
            log.debug(`✅ Automatically update Mann Co. Supply Crate Key to buy.`);
        })
        .catch((err: Error) => {
            log.warn(`❌ Failed to update Mann Co. Supply Crate Key to buy automatically: ${err.message}`);
        });
}
