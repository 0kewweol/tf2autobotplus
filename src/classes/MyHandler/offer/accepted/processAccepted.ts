/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unsafe-call */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */

import { TradeOffer } from 'steam-tradeoffer-manager';
import SKU from 'tf2-sku-2';
import { UnknownDictionary } from '../../../../types/common';

import { itemList } from '../../utils/export-utils';

import Bot from '../../../Bot';

import {
    pure,
    valueDiff,
    summarize,
    timeNow,
    convertTime,
    generateLinks,
    listItems
} from '../../../../lib/tools/export';

import { sendTradeSummary } from '../../../../lib/DiscordWebhook/export';

export default function processAccepted(
    offer: TradeOffer,
    autokeys: { isEnabled: boolean; isActive: boolean; isBuying: boolean; isBanking: boolean },
    bot: Bot,
    isTradingKeys: boolean,
    processTime: number
): { theirHighValuedItems: string[]; isDisableSKU: string[] } {
    const opt = bot.options;

    const isDisableSKU: string[] = [];
    const theirHighValuedItems: string[] = [];

    const pureStock = pure.stock(bot);
    const timeWithEmojis = timeNow(opt.timezone, opt.customTimeFormat, opt.timeAdditionalNotes);
    const links = generateLinks(offer.partner.toString());
    const itemsList = itemList(offer);
    const currentItems = bot.inventoryManager.getInventory().getTotalItems();

    const timeTaken = convertTime(processTime);

    const accepted: {
        invalidItems: string[];
        overstocked: string[];
        understocked: string[];
        highValue: string[];
        isMention: boolean;
    } = {
        invalidItems: [],
        overstocked: [],
        understocked: [],
        highValue: [],
        isMention: false
    };

    const offerReceived: { reason: string; meta: UnknownDictionary<any> } = offer.data('action');
    const offerSent: { skus: string[]; names: string[]; isMention: boolean } = offer.data('highValue');

    if (offerReceived) {
        // doing this because if an offer is being made by bot (from command), then this is undefined
        if (offerReceived.reason === 'VALID_WITH_OVERPAY' || offerReceived.reason === 'MANUAL') {
            // only for accepted overpay with INVALID_ITEMS/OVERSTOCKED/UNDERSTOCKED or MANUAL offer
            if (offerReceived.meta) {
                // doing this because if an offer needs a manual review because of the failed for checking
                // for banned and escrow, then this is undefined.
                if (offerReceived.meta.uniqueReasons.includes('🟨_INVALID_ITEMS')) {
                    // doing this so it will only executed if includes 🟨_INVALID_ITEMS reason.

                    const invalid = offerReceived.meta.reasons.filter(el => el.reason.includes('🟨_INVALID_ITEMS'));
                    invalid.forEach(el => {
                        const name = bot.schema.getName(SKU.fromString(el.sku), false);
                        accepted.invalidItems.push(`${name} - ${el.price as string}`);
                    });
                }

                if (offerReceived.meta.uniqueReasons.includes('🟦_OVERSTOCKED')) {
                    // doing this so it will only executed if includes 🟦_OVERSTOCKED reason.

                    const invalid = offerReceived.meta.reasons.filter(el => el.reason.includes('🟦_OVERSTOCKED'));
                    invalid.forEach(el => {
                        const name = bot.schema.getName(SKU.fromString(el.sku), false);
                        accepted.overstocked.push(`${name} (amount can buy was ${el.amountCanTrade as number})`);
                    });
                }

                if (offerReceived.meta.uniqueReasons.includes('🟩_UNDERSTOCKED')) {
                    // doing this so it will only executed if includes 🟩_UNDERSTOCKED reason.

                    const invalid = offerReceived.meta.reasons.filter(el => el.reason.includes('🟩_UNDERSTOCKED'));
                    invalid.forEach(el => {
                        const name = bot.schema.getName(SKU.fromString(el.sku), false);
                        accepted.understocked.push(`${name} (amount can sell was ${el.amountCanTrade as number})`);
                    });
                }
            }
        }

        if (offerReceived.meta && offerReceived.meta.highValue) {
            if (offerReceived.meta.highValue.has.their) {
                // doing this to check if their side have any high value items, if so, push each name into accepted.highValue const.
                offerReceived.meta.highValue.items.their.names.forEach(name => {
                    accepted.highValue.push(name);
                    theirHighValuedItems.push(name);
                });

                if (offerReceived.meta.highValue.isMention.their) {
                    offerReceived.meta.highValue.items.their.skus.forEach(sku => isDisableSKU.push(sku));

                    if (!bot.isAdmin(offer.partner)) {
                        accepted.isMention = true;
                    }
                }
            }

            if (offerReceived.meta.highValue.has.our) {
                // doing this to check if our side have any high value items, if so, push each name into accepted.highValue const.
                offerReceived.meta.highValue.items.our.names.forEach(name => accepted.highValue.push(name));

                if (offerReceived.meta.highValue.isMention.our) {
                    if (!bot.isAdmin(offer.partner)) {
                        accepted.isMention = true;
                    }
                }
            }
        }
    } else if (offerSent) {
        // This is for offer that bot created from commands
        if (offerSent.names.length > 0) {
            offerSent.names.forEach(name => {
                accepted.highValue.push(name);
                theirHighValuedItems.push(name);
            });
        }

        if (offerSent.isMention) {
            offerSent.skus.forEach(sku => isDisableSKU.push(sku));
            accepted.isMention = true;
        }
    }

    const keyPrices = bot.pricelist.getKeyPrices();
    const value = valueDiff(offer, keyPrices, isTradingKeys, opt.showOnlyMetal);

    if (opt.discordWebhook.tradeSummary.enable && opt.discordWebhook.tradeSummary.url.length > 0) {
        sendTradeSummary(
            offer,
            autokeys,
            currentItems,
            accepted,
            keyPrices,
            value,
            itemsList,
            links,
            timeWithEmojis.time,
            bot,
            timeTaken
        );
    } else {
        const isShowChanges = bot.options.tradeSummary.showStockChanges;
        const slots = bot.tf2.backpackSlots;
        const itemsName = {
            invalid: accepted.invalidItems, // 🟨_INVALID_ITEMS
            overstock: accepted.overstocked, // 🟦_OVERSTOCKED
            understock: accepted.understocked, // 🟩_UNDERSTOCKED
            duped: [],
            dupedFailed: [],
            highValue: accepted.highValue // 🔶_HIGH_VALUE_ITEMS
        };
        const itemList = listItems(itemsName, true);

        bot.messageAdmins(
            'trade',
            `/me Trade #${offer.id} with ${offer.partner.getSteamID64()} is accepted. ✅` +
                summarize(
                    isShowChanges
                        ? offer.summarizeWithStockChanges(bot.schema, 'summary')
                        : offer.summarize(bot.schema),
                    value,
                    keyPrices,
                    true
                ) +
                '\n\n' +
                itemList +
                `\n\n🔑 Key rate: ${keyPrices.buy.metal.toString()}/${keyPrices.sell.metal.toString()} ref` +
                ` (${keyPrices.src === 'manual' ? 'manual' : 'prices.tf'})` +
                `${
                    autokeys.isEnabled
                        ? ' | Autokeys: ' +
                          (autokeys.isActive
                              ? '✅' +
                                (autokeys.isBanking ? ' (banking)' : autokeys.isBuying ? ' (buying)' : ' (selling)')
                              : '🛑')
                        : ''
                }` +
                `\n💰 Pure stock: ${pureStock.join(', ').toString()}` +
                `\n🎒 Total items: ${`${currentItems}${slots !== undefined ? `/${slots}` : ''}`}` +
                `\n⏱ Time taken: ${timeTaken}` +
                `\n\nVersion ${process.env.BOT_VERSION}`,
            []
        );
    }

    return { theirHighValuedItems, isDisableSKU };
}
