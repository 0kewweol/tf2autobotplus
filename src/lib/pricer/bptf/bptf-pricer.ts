import axios, { AxiosResponse } from 'axios';
import Currencies from '@tf2autobot/tf2-currencies';
import IPricer, {
    GetItemPriceResponse,
    GetPricelistResponse,
    Item,
    PricerOptions,
    RequestCheckResponse
} from '../../../classes/IPricer';
import SKU = require('@tf2autobot/tf2-sku');

interface PriceEntry {
    currency: string;
    value: number;
    value_raw?: number;
    value_high?: number;
    last_update?: number;
}

interface ItemData {
    defindex: number[];
    prices: Record<string, Record<string, Record<string, PriceEntry[] | Record<string, any>>>>;
}

interface BptfApiResponse {
    response: {
        success: number;
        current_time: number;
        items: Record<string, ItemData>;
    };
}

interface PriceCache {
    data: BptfApiResponse;
    timestamp: number;
    defindexMap: Map<number, string[]>;
}

interface PriceConfig {
    keyMargin: number;
    metalMargin: number;
    minKeyMargin: number;
    minMetalMargin: number;
}

const PRICE_CONFIGS: Record<string, PriceConfig> = {
    unusual: { keyMargin: 0.02, metalMargin: 0.02, minKeyMargin: 0.5, minMetalMargin: 0.33 },
    australium: { keyMargin: 0.03, metalMargin: 0.03, minKeyMargin: 0.25, minMetalMargin: 0.22 },
    killstreak: { keyMargin: 0.03, metalMargin: 0.03, minKeyMargin: 0.1, minMetalMargin: 0.11 },
    professional: { keyMargin: 0.04, metalMargin: 0.04, minKeyMargin: 0.1, minMetalMargin: 0.11 },
    default: { keyMargin: 0.0, metalMargin: 0.0, minKeyMargin: 0.05, minMetalMargin: 0.11 }
};

export default class BackpackTFPricer implements IPricer {
    private readonly apiKey: string;

    private readonly baseUrl = 'https://backpack.tf/api/IGetPrices/v4';

    private readonly cacheTimeout = 300000;

    private cache: PriceCache | null = null;

    static getPricer(options?: PricerOptions): IPricer {
        return new BackpackTFPricer(options);
    }

    constructor(private options?: PricerOptions) {
        const key = process.env.BPTF_API_KEY;
        if (!key) throw new Error('BPTF_API_KEY must be set');
        this.apiKey = key;
    }

    getOptions(): PricerOptions {
        return { pricerUrl: this.baseUrl, pricerApiToken: this.apiKey };
    }

    async requestCheck(sku: string): Promise<RequestCheckResponse> {
        try {
            SKU.fromString(sku);
            return { sku };
        } catch {
            return { sku, name: 'Invalid SKU' };
        }
    }

    private async fetchPrices(): Promise<BptfApiResponse> {
        const now = Date.now();

        if (this.cache && now - this.cache.timestamp < this.cacheTimeout) {
            return this.cache.data;
        }

        try {
            const response: AxiosResponse<BptfApiResponse> = await axios.get(this.baseUrl, {
                params: { key: this.apiKey, raw: 1 },
                timeout: 30000,
                headers: { 'Accept-Encoding': 'gzip' }
            });

            const defindexMap = new Map<number, string[]>();
            for (const [itemName, itemData] of Object.entries(response.data.response.items)) {
                for (const defindex of itemData.defindex) {
                    if (!defindexMap.has(defindex)) {
                        defindexMap.set(defindex, []);
                    }
                    defindexMap.get(defindex)!.push(itemName);
                }
            }

            this.cache = {
                data: response.data,
                timestamp: now,
                defindexMap
            };

            return response.data;
        } catch (error) {
            if (this.cache) {
                console.warn('BackpackTF API error, using cached data:', error);
                return this.cache.data;
            }
            throw error;
        }
    }

    private createCurrencies(value: number, currency: string): Currencies {
        return currency === 'keys'
            ? new Currencies({ keys: value, metal: 0 })
            : new Currencies({ keys: 0, metal: value });
    }

    private calculateSellPrice(buyValue: number, currency: string, valueHigh: number | null, parsed: any): number {
        if (valueHigh && valueHigh > buyValue) {
            return valueHigh;
        }

        let config: PriceConfig;
        if (parsed.quality === 5) {
            config = PRICE_CONFIGS.unusual;
        } else if (parsed.australium) {
            config = PRICE_CONFIGS.australium;
        } else if (parsed.killstreak === 3) {
            config = PRICE_CONFIGS.professional;
        } else if (parsed.killstreak > 0) {
            config = PRICE_CONFIGS.killstreak;
        } else {
            config = PRICE_CONFIGS.default;
        }

        const isKeys = currency === 'keys';
        const margin = isKeys ? config.keyMargin : config.metalMargin;
        const minMargin = isKeys ? config.minKeyMargin : config.minMetalMargin;

        return buyValue + Math.max(minMargin, buyValue * margin);
    }

    private buildPricePath(parsed: any): string[] {
        const quality = String(parsed.quality || 6);
        const tradable = parsed.tradable ? 'Tradable' : 'Non-Tradable';
        const craftable = parsed.craftable ? 'Craftable' : 'Non-Craftable';

        const path = [quality, tradable, craftable];

        if (parsed.killstreak > 0) {
            const killstreakNames = ['Normal', 'Killstreak', 'Specialized Killstreak', 'Professional Killstreak'];
            path.push(killstreakNames[parsed.killstreak] || 'Normal');
        } else {
            path.push('Normal');
        }

        path.push(parsed.quality2 === 11 ? 'Strange' : 'Normal');
        path.push(parsed.australium ? 'Australium' : 'Normal');
        path.push(parsed.festive ? 'Festive' : 'Normal');

        return path;
    }

    private findPriceInData(itemData: ItemData, path: string[], effect?: number): PriceEntry | null {
        let current: any = itemData.prices;

        for (const segment of path) {
            if (!current?.[segment]) {
                if (segment !== 'Normal' && current?.['Normal']) {
                    current = current['Normal'];
                } else {
                    return null;
                }
            } else {
                current = current[segment];
            }
        }

        if (effect !== undefined && current?.[effect]) {
            current = current[effect];
        }

        if (Array.isArray(current) && current.length > 0) {
            return current[0] as PriceEntry;
        }

        return null;
    }

    async getPrice(sku: string): Promise<GetItemPriceResponse> {
        try {
            const parsed = SKU.fromString(sku);

            if (parsed.quality < 0 || parsed.quality > 15) {
                return this.createErrorResponse(sku, 'Invalid quality');
            }

            const data = await this.fetchPrices();

            const itemNames = this.cache?.defindexMap.get(parsed.defindex);
            if (!itemNames?.length) {
                return this.createErrorResponse(sku, 'Item not found');
            }

            for (const itemName of itemNames) {
                const itemData = data.response.items[itemName];
                if (!itemData) continue;

                const path = this.buildPricePath(parsed);
                const priceEntry = this.findPriceInData(itemData, path, parsed.effect);

                if (priceEntry) {
                    return this.createPriceResponse(sku, priceEntry, parsed);
                }
            }

            return this.createErrorResponse(sku, 'Price not found');
        } catch (error) {
            console.error(`Error getting price for ${sku}:`, error);
            return this.createErrorResponse(sku, `Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private createPriceResponse(sku: string, priceEntry: PriceEntry, parsed: any): GetItemPriceResponse {
        const currency = priceEntry.currency;
        const buyValue = priceEntry.value_raw ?? priceEntry.value;
        const valueHigh = priceEntry.value_high ?? null;

        const buy = this.createCurrencies(buyValue, currency);
        const sellValue = this.calculateSellPrice(buyValue, currency, valueHigh, parsed);
        const sell = this.createCurrencies(sellValue, currency);

        return {
            sku,
            source: 'bptf',
            time: priceEntry.last_update ?? Math.floor(Date.now() / 1000),
            buy,
            sell
        };
    }

    private createErrorResponse(sku: string, message: string): GetItemPriceResponse {
        return {
            sku,
            source: 'bptf',
            time: Math.floor(Date.now() / 1000),
            buy: null,
            sell: null,
            message
        };
    }

    async getPricelist(): Promise<GetPricelistResponse> {
        try {
            const data = await this.fetchPrices();
            const items: Item[] = [];
            const processedSKUs = new Set<string>();

            for (const [itemName, itemData] of Object.entries(data.response.items)) {
                this.processItemData(itemData, items, processedSKUs, data.response.current_time);
            }

            console.log(`Loaded ${items.length} items from Backpack.tf`);
            return { items };
        } catch (error) {
            console.error('Error getting pricelist:', error);
            return { items: [] };
        }
    }

    private processItemData(itemData: ItemData, items: Item[], processedSKUs: Set<string>, currentTime: number): void {
        for (const defindex of itemData.defindex) {
            this.processQualityData(itemData.prices, defindex, items, processedSKUs, currentTime);
        }
    }

    private processQualityData(
        qualityData: Record<string, any>,
        defindex: number,
        items: Item[],
        processedSKUs: Set<string>,
        currentTime: number
    ): void {
        for (const [qualityId, tradableData] of Object.entries(qualityData)) {
            const quality = parseInt(qualityId);

            for (const [tradableKey, craftableData] of Object.entries(tradableData)) {
                const tradable = tradableKey === 'Tradable';

                for (const [craftableKey, priceData] of Object.entries(craftableData)) {
                    const craftable = craftableKey === 'Craftable';

                    this.extractPricesRecursively(
                        priceData,
                        { defindex, quality, tradable, craftable },
                        items,
                        processedSKUs,
                        currentTime
                    );
                }
            }
        }
    }

    private extractPricesRecursively(
        data: any,
        baseSKU: any,
        items: Item[],
        processedSKUs: Set<string>,
        currentTime: number,
        attributes: any = {},
        depth = 0
    ): void {
        if (depth > 6) return;

        if (Array.isArray(data) && data.length > 0 && this.isPriceEntry(data[0])) {
            this.addItemToList(baseSKU, attributes, data[0], items, processedSKUs, currentTime);
            return;
        }

        if (typeof data === 'object' && data !== null) {
            for (const [key, value] of Object.entries(data)) {
                const newAttributes = this.parseAttributeKey(key, attributes);
                this.extractPricesRecursively(
                    value,
                    baseSKU,
                    items,
                    processedSKUs,
                    currentTime,
                    newAttributes,
                    depth + 1
                );
            }
        }
    }

    private parseAttributeKey(key: string, currentAttributes: any): any {
        const newAttributes = { ...currentAttributes };

        switch (key) {
            case 'Killstreak':
                newAttributes.killstreak = 1;
                break;
            case 'Specialized Killstreak':
                newAttributes.killstreak = 2;
                break;
            case 'Professional Killstreak':
                newAttributes.killstreak = 3;
                break;
            case 'Strange':
                newAttributes.quality2 = 11;
                break;
            case 'Australium':
                newAttributes.australium = true;
                break;
            case 'Festive':
                newAttributes.festive = true;
                break;
            default:
                const numKey = parseInt(key);
                if (!isNaN(numKey) && currentAttributes.quality === 5) {
                    newAttributes.effect = numKey;
                }
        }

        return newAttributes;
    }

    private isPriceEntry(obj: any): obj is PriceEntry {
        return obj && typeof obj === 'object' && 'currency' in obj && 'value' in obj;
    }

    private addItemToList(
        baseSKU: any,
        attributes: any,
        priceEntry: PriceEntry,
        items: Item[],
        processedSKUs: Set<string>,
        currentTime: number
    ): void {
        try {
            const fullSKU = { ...baseSKU, ...attributes };
            const skuString = SKU.fromObject(fullSKU).toString();

            if (processedSKUs.has(skuString)) return;
            processedSKUs.add(skuString);

            const currency = priceEntry.currency;
            const buyValue = priceEntry.value_raw ?? priceEntry.value;
            const valueHigh = priceEntry.value_high ?? null;

            const buy = this.createCurrencies(buyValue, currency);
            const sellValue = this.calculateSellPrice(buyValue, currency, valueHigh, fullSKU);
            const sell = this.createCurrencies(sellValue, currency);

            items.push({
                sku: skuString,
                source: 'bptf',
                time: priceEntry.last_update ?? currentTime,
                buy,
                sell
            });
        } catch (error) {}
    }

    public clearCache(): void {
        this.cache = null;
    }

    public getCacheInfo(): { cached: boolean; age: number; expires: number } {
        if (!this.cache) {
            return { cached: false, age: 0, expires: 0 };
        }

        const now = Date.now();
        const age = now - this.cache.timestamp;
        const expires = Math.max(0, this.cacheTimeout - age);

        return { cached: true, age, expires };
    }

    public async checkApiHealth(): Promise<{ success: boolean; responseTime: number; error?: string }> {
        const startTime = Date.now();

        try {
            await axios.get(this.baseUrl, {
                params: { key: this.apiKey, raw: 1 },
                timeout: 10000
            });

            return {
                success: true,
                responseTime: Date.now() - startTime
            };
        } catch (error) {
            return {
                success: false,
                responseTime: Date.now() - startTime,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    get isPricerConnecting(): boolean {
        return false;
    }

    connect(_enabled: boolean): void {
        //
    }

    init(enabled: boolean): void {
        if (enabled) {
            this.fetchPrices().catch(error => {
                console.error('Failed to preload price cache:', error);
            });
        }
    }

    shutdown(_enabled: boolean): void {
        this.clearCache();
    }

    bindHandlePriceEvent(_fn: (item: GetItemPriceResponse) => void): void {
        ////
    }
}
