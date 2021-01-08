import SKU from 'tf2-sku-2';
import pluralize from 'pluralize';
import Bot from '../../../../Bot';
import { DupedItems, Meta } from 'steam-tradeoffer-manager';

export default function duped(meta: Meta, bot: Bot): { note: string; name: string[] } {
    const opt = bot.options.discordWebhook.offerReview;

    const wrong = meta.reasons;
    const dupedItemsNameOur: string[] = [];
    const dupedItemsNameTheir: string[] = [];
    const duped = wrong.filter(el => el.reason.includes('🟫_DUPED_ITEMS')) as DupedItems[];

    duped.forEach(el => {
        if (opt.enable && opt.url !== '') {
            // if Discord Webhook for review offer enabled, then make it link the item name to the backpack.tf item history page.
            dupedItemsNameOur.push(
                `_${bot.schema.getName(SKU.fromString(el.sku), false)}_ - [history page](https://backpack.tf/item/${
                    el.assetid
                })`
            );
        } else {
            // else Discord Webhook for review offer disabled, make the link to backpack.tf item history page separate with name.
            dupedItemsNameOur.push(
                `${bot.schema.getName(SKU.fromString(el.sku), false)} - history page: https://backpack.tf/item/${
                    el.assetid
                }`
            );
        }
        dupedItemsNameTheir.push(
            `${bot.schema.getName(SKU.fromString(el.sku), false)}, history page: https://backpack.tf/item/${el.assetid}`
        );
    });

    return {
        note: bot.options.manualReview.duped.note
            ? `🟫_DUPED_ITEMS - ${bot.options.manualReview.duped.note}`
                  .replace(/%itemsName%/g, dupedItemsNameTheir.join(', '))
                  .replace(/%isOrAre%/g, pluralize('is', dupedItemsNameTheir.length))
            : `🟫_DUPED_ITEMS - ${dupedItemsNameTheir.join(', ')} ${pluralize(
                  'is',
                  dupedItemsNameTheir.length
              )} appeared to be duped.`,
        // Default note: %itemsName% is|are appeared to be duped.
        name: dupedItemsNameOur
    };
}
