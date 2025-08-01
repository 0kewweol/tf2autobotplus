import axios from 'axios';
import Currencies from '@tf2autobot/tf2-currencies';
import IPricer, {
    GetItemPriceResponse,
    GetPricelistResponse,
    Item,
    PricerOptions,
    RequestCheckResponse
} from '../../../classes/IPricer';
import SKU = require('@tf2autobot/tf2-sku');

interface BackpackTFPriceEntry {
    currency: string;
    value: number;
    value_raw?: number;
    value_high?: number;
    last_update?: number;
}

interface BackpackTFResponse {
    response: {
        success: number;
        current_time: number;
        items: {
            [itemName: string]: {
                defindex: number[];
                prices: {
                    [quality: string]: {
                        [tradable: string]: {
                            [craftable: string]: {
                                [killstreak: string]: {
                                    [strange: string]: {
                                        [australium: string]: {
                                            [festive: string]: BackpackTFPriceEntry[];
                                        };
                                    };
                                };
                            };
                        };
                    };
                };
            };
        };
    };
}

export default class BackpackTFPricer implements IPricer {
    private readonly apiKey: string;

    private readonly baseUrl = 'https://backpack.tf/api/IGetPrices/v4';

    private pricesCache: BackpackTFResponse | null = null;

    private cacheTime = 0;

    private readonly cacheTimeout = 300000; // 5 минут

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
        await this.getPrice(sku);
        return { sku, name: undefined };
    }

    private toCurrencies(value: number, currency: string): Currencies {
        if (currency === 'keys') return new Currencies({ keys: value, metal: 0 });
        return new Currencies({ keys: 0, metal: value });
    }

    private calculateSellPrice(
        buyValue: number,
        currency: string,
        valueHigh?: number | null,
        parsedSKU?: ReturnType<typeof SKU.fromString>
    ): number {
        if (valueHigh !== null && valueHigh !== undefined && valueHigh > buyValue) {
            return valueHigh;
        }

        if (parsedSKU) {
            if (parsedSKU.quality === 5) {
                if (currency === 'keys') {
                    return buyValue + Math.max(0.5, buyValue * 0.02);
                } else {
                    return buyValue + Math.max(0.33, buyValue * 0.02);
                }
            }

            if (parsedSKU.australium) {
                if (currency === 'keys') {
                    return buyValue + Math.max(0.25, buyValue * 0.03);
                } else {
                    return buyValue + Math.max(0.22, buyValue * 0.03);
                }
            }

            if (parsedSKU.killstreak && parsedSKU.killstreak > 0) {
                const ksMultiplier = parsedSKU.killstreak === 3 ? 0.04 : 0.03;
                if (currency === 'keys') {
                    return buyValue + Math.max(0.1, buyValue * ksMultiplier);
                } else {
                    return buyValue + Math.max(0.11, buyValue * ksMultiplier);
                }
            }
        }

        if (currency === 'metal') {
            return buyValue + 0.11;
        } else if (currency === 'keys') {
            return buyValue + 0.05;
        }

        return buyValue;
    }

    private getPriceKeys(parsedSKU: ReturnType<typeof SKU.fromString>): string[] {
        const killstreakMap: { [key: number]: string } = {
            0: 'Normal',
            1: 'Killstreak',
            2: 'Specialized Killstreak',
            3: 'Professional Killstreak'
        };

        const isStrange = parsedSKU.quality2 === 11;

        return [
            killstreakMap[parsedSKU.killstreak ?? 0] ?? 'Normal',
            isStrange ? 'Strange' : 'Normal',
            parsedSKU.australium ? 'Australium' : 'Normal',
            parsedSKU.festive ? 'Festive' : 'Normal'
        ];
    }

    private isItemSupported(parsedSKU: ReturnType<typeof SKU.fromString>): boolean {
        const unsupportedDefindexes = [
            
        ];

        if (unsupportedDefindexes.includes(parsedSKU.defindex)) {
            return false;
        }

        if (parsedSKU.quality < 0 || parsedSKU.quality > 15) {
            return false;
        }

        return true;
    }

    private normalizeSKUForSearch(parsedSKU: ReturnType<typeof SKU.fromString>): ReturnType<typeof SKU.fromString> {
        const normalized = { ...parsedSKU };

        if (normalized.paint && this.shouldIgnorePaint(normalized)) {
            delete normalized.paint;
        }

        if (normalized.wear && this.shouldIgnoreWear(normalized)) {
            delete normalized.wear;
        }

        return normalized;
    }

    private shouldIgnorePaint(parsedSKU: ReturnType<typeof SKU.fromString>): boolean {
        return parsedSKU.quality !== 15;
    }

    private shouldIgnoreWear(parsedSKU: ReturnType<typeof SKU.fromString>): boolean {
        return parsedSKU.quality !== 15;
    }

    private getAlternativeSKUs(parsedSKU: ReturnType<typeof SKU.fromString>): ReturnType<typeof SKU.fromString>[] {
        const alternatives: ReturnType<typeof SKU.fromString>[] = [];

        if (parsedSKU.killstreak && parsedSKU.killstreak > 0) {
            alternatives.push({ ...parsedSKU, killstreak: 0 });
        }

        if (parsedSKU.quality2 === 11) {
            alternatives.push({ ...parsedSKU, quality2: undefined });
        }

        if (parsedSKU.festive) {
            alternatives.push({ ...parsedSKU, festive: false });
        }

        alternatives.push({
            ...parsedSKU,
            killstreak: 0,
            quality2: undefined,
            australium: false,
            festive: false,
            effect: undefined,
            paint: undefined,
            wear: undefined,
            paintkit: undefined
        });

        return alternatives;
    }

    private async fetchPrices(): Promise<BackpackTFResponse> {
        const now = Date.now();

        if (this.pricesCache && now - this.cacheTime < this.cacheTimeout) {
            return this.pricesCache;
        }

        try {
            const res = await axios.get<BackpackTFResponse>(this.baseUrl, {
                params: { key: this.apiKey, raw: 1 },
                timeout: 30000
            });

            this.pricesCache = res.data;
            this.cacheTime = now;

            return res.data;
        } catch (error) {
            if (this.pricesCache) {
                console.warn('BackpackTF API error, using cached data:', error);
                return this.pricesCache;
            }
            throw error;
        }
    }

    private findPriceInNestedStructure(data: any, keys: string[]): BackpackTFPriceEntry | null {
        let current = data;

        for (const key of keys) {
            if (!current || typeof current !== 'object') {
                return null;
            }

            if (current[key]) {
                current = current[key];
                continue;
            }

            if (key !== 'Normal' && current['Normal']) {
                current = current['Normal'];
                continue;
            }

            return null;
        }

        if (Array.isArray(current) && current.length > 0) {
            return current[0];
        }

        return null;
    }

    async getPrice(sku: string): Promise<GetItemPriceResponse> {
        try {
            const parsed = SKU.fromString(sku);

            if (!this.isItemSupported(parsed)) {
                return {
                    sku,
                    source: 'bptf',
                    time: Math.floor(Date.now() / 1000),
                    buy: null,
                    sell: null,
                    message: 'Item not supported'
                };
            }

            const data = await this.fetchPrices();
            const items = data.response.items;

            if (parsed.quality === 5 && parsed.effect) {
                return this.handleUnusualPrice(sku, parsed, data);
            }

            const normalizedSKU = this.normalizeSKUForSearch(parsed);

            const mainResult = await this.searchPriceInItems(sku, normalizedSKU, items);
            if (mainResult.buy !== null) {
                return mainResult;
            }

            const alternatives = this.getAlternativeSKUs(normalizedSKU);
            for (const altSKU of alternatives) {
                const altResult = await this.searchPriceInItems(sku, altSKU, items);
                if (altResult.buy !== null) {
                    console.warn(`Using alternative SKU for ${sku}`);
                    return altResult;
                }
            }

            return {
                sku,
                source: 'bptf',
                time: Math.floor(Date.now() / 1000),
                buy: null,
                sell: null,
                message: 'Price not found in Backpack.tf data'
            };
        } catch (error) {
            console.error(`Error getting price for ${sku}:`, error);
            return {
                sku,
                source: 'bptf',
                time: Math.floor(Date.now() / 1000),
                buy: null,
                sell: null,
                message: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            };
        }
    }

    private async searchPriceInItems(
        originalSKU: string,
        parsedSKU: ReturnType<typeof SKU.fromString>,
        items: any
    ): Promise<GetItemPriceResponse> {
        for (const name in items) {
            const item = items[name];
            const defindexes = item.defindex || [];

            if (!defindexes.includes(Number(parsedSKU.defindex))) continue;

            const qualities = item.prices;
            const quality = String(parsedSKU.quality || 6);
            const qualityData = qualities[quality];

            if (!qualityData) continue;

            const tradable = parsedSKU.tradable ? 'Tradable' : 'Non-Tradable';
            const craftable = parsedSKU.craftable ? 'Craftable' : 'Non-Craftable';

            const baseStructure = qualityData?.[tradable]?.[craftable];
            if (!baseStructure) continue;

            if (
                !parsedSKU.killstreak &&
                parsedSKU.quality2 !== 11 &&
                !parsedSKU.australium &&
                !parsedSKU.festive &&
                !parsedSKU.effect
            ) {
                const priceEntry = Array.isArray(baseStructure) ? baseStructure[0] : null;
                if (priceEntry && typeof priceEntry === 'object' && 'currency' in priceEntry) {
                    return this.createPriceResponse(originalSKU, priceEntry as BackpackTFPriceEntry, parsedSKU);
                }
            }

            const priceKeys = this.getPriceKeys(parsedSKU);
            const priceEntry = this.findPriceInNestedStructure(baseStructure, priceKeys);

            if (priceEntry) {
                return this.createPriceResponse(originalSKU, priceEntry, parsedSKU);
            }

            const fallbackKeys = ['Normal', 'Normal', 'Normal', 'Normal'];
            const fallbackEntry = this.findPriceInNestedStructure(baseStructure, fallbackKeys);

            if (fallbackEntry) {
                return this.createPriceResponse(originalSKU, fallbackEntry, parsedSKU);
            }
        }

        return {
            sku: originalSKU,
            source: 'bptf',
            time: Math.floor(Date.now() / 1000),
            buy: null,
            sell: null
        };
    }

    private createPriceResponse(
        sku: string,
        priceEntry: BackpackTFPriceEntry,
        parsed: ReturnType<typeof SKU.fromString>
    ): GetItemPriceResponse {
        const currency = priceEntry.currency;
        const buyValue = priceEntry.value_raw ?? priceEntry.value;
        const valueHigh = priceEntry.value_high ?? null;

        const buy = this.toCurrencies(buyValue, currency);
        const sellValue = this.calculateSellPrice(buyValue, currency, valueHigh, parsed);
        const sell = this.toCurrencies(sellValue, currency);

        return {
            sku,
            source: 'bptf',
            time: priceEntry.last_update ?? Math.floor(Date.now() / 1000),
            buy,
            sell
        };
    }

    private async handleUnusualPrice(
        sku: string,
        parsed: ReturnType<typeof SKU.fromString>,
        data: BackpackTFResponse
    ): Promise<GetItemPriceResponse> {
        for (const name in data.response.items) {
            const item = data.response.items[name];
            const defindexes = item.defindex || [];

            if (!defindexes.includes(Number(parsed.defindex))) continue;

            const qualities = item.prices;
            const qualityData = qualities['5'];

            if (!qualityData) continue;

            const tradable = parsed.tradable ? 'Tradable' : 'Non-Tradable';
            const craftable = parsed.craftable ? 'Craftable' : 'Non-Craftable';

            const baseStructure = qualityData?.[tradable]?.[craftable];
            if (!baseStructure) continue;

            if (parsed.effect && baseStructure[parsed.effect]) {
                const effectPrices = baseStructure[parsed.effect];
                const priceEntry = Array.isArray(effectPrices) ? effectPrices[0] : effectPrices;

                if (priceEntry && typeof priceEntry === 'object' && 'currency' in priceEntry) {
                    return this.createPriceResponse(sku, priceEntry as BackpackTFPriceEntry, parsed);
                }
            }
        }

        return {
            sku,
            source: 'bptf',
            time: Math.floor(Date.now() / 1000),
            buy: null,
            sell: null,
            message: 'Unusual effect not found in price data'
        };
    }

    async getPricelist(): Promise<GetPricelistResponse> {
        try {
            const data = await this.fetchPrices();
            const items: Item[] = [];
            const processedSKUs = new Set<string>();

            for (const name in data.response.items) {
                const item = data.response.items[name];
                const defindexes = item.defindex || [];

                for (const defindex of defindexes) {
                    const qualities = item.prices;

                    for (const qualityId in qualities) {
                        const qualityPrices = qualities[qualityId];

                        for (const tradableKey of ['Tradable', 'Non-Tradable']) {
                            const tradableData = qualityPrices[tradableKey];
                            if (!tradableData) continue;

                            for (const craftableKey of ['Craftable', 'Non-Craftable']) {
                                const craftableData = tradableData[craftableKey];
                                if (!craftableData) continue;

                                this.processNestedPrices(
                                    craftableData,
                                    {
                                        defindex: Number(defindex),
                                        quality: Number(qualityId),
                                        tradable: tradableKey === 'Tradable',
                                        craftable: craftableKey === 'Craftable'
                                    },
                                    items,
                                    processedSKUs,
                                    data.response.current_time
                                );
                            }
                        }
                    }
                }
            }

            console.log(`Loaded ${items.length} items from Backpack.tf`);
            return { items };
        } catch (error) {
            console.error('Error getting pricelist:', error);
            return { items: [] };
        }
    }

    private processNestedPrices(
        data: any,
        baseSKU: any,
        items: Item[],
        processedSKUs: Set<string>,
        currentTime: number,
        depth = 0,
        attributes: any = {}
    ): void {
        if (depth > 10) return;

        if (Array.isArray(data) && data.length > 0) {
            const priceEntry = data[0];
            if (priceEntry && typeof priceEntry === 'object' && 'currency' in priceEntry) {
                this.addItemToList(
                    baseSKU,
                    attributes,
                    priceEntry as BackpackTFPriceEntry,
                    items,
                    processedSKUs,
                    currentTime
                );
            }
            return;
        }

        if (typeof data === 'object' && data !== null) {
            for (const key in data) {
                const value = data[key];

                const newAttributes = { ...attributes };

                if (['Normal', 'Killstreak', 'Specialized Killstreak', 'Professional Killstreak'].includes(key)) {
                    const killstreakMap: { [key: string]: number } = {
                        Normal: 0,
                        Killstreak: 1,
                        'Specialized Killstreak': 2,
                        'Professional Killstreak': 3
                    };
                    newAttributes.killstreak = killstreakMap[key];
                } else if (key === 'Strange') {
                    newAttributes.quality2 = 11;
                } else if (key === 'Australium') {
                    newAttributes.australium = true;
                } else if (key === 'Festive') {
                    newAttributes.festive = true;
                } else if (!isNaN(Number(key)) && baseSKU.quality === 5) {
                    newAttributes.effect = Number(key);
                }

                this.processNestedPrices(value, baseSKU, items, processedSKUs, currentTime, depth + 1, newAttributes);
            }
        }
    }

    private addItemToList(
        baseSKU: any,
        attributes: any,
        priceEntry: BackpackTFPriceEntry,
        items: Item[],
        processedSKUs: Set<string>,
        currentTime: number
    ): void {
        try {
            const fullSKU = { ...baseSKU, ...attributes };
            const sku = SKU.fromObject(fullSKU);
            const skuString = sku.toString();

            if (processedSKUs.has(skuString)) return;
            processedSKUs.add(skuString);

            const currency = priceEntry.currency;
            const buyValue = priceEntry.value_raw ?? priceEntry.value;
            const valueHigh = priceEntry.value_high ?? null;

            const buy = this.toCurrencies(buyValue, currency);
            const sellValue = this.calculateSellPrice(buyValue, currency, valueHigh, fullSKU);
            const sell = this.toCurrencies(sellValue, currency);

            items.push({
                sku: skuString,
                source: 'bptf',
                time: priceEntry.last_update ?? currentTime,
                buy,
                sell
            });
        } catch (error) {
            console.debug('Skipping invalid SKU combination:', baseSKU, attributes, error);
        }
    }

    public clearCache(): void {
        this.pricesCache = null;
        this.cacheTime = 0;
    }

    public getCacheInfo(): { cached: boolean; age: number; expires: number } {
        const now = Date.now();
        const age = now - this.cacheTime;
        const expires = this.cacheTimeout - age;

        return {
            cached: this.pricesCache !== null,
            age,
            expires: Math.max(0, expires)
        };
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

    public async getPriceStats(): Promise<{
        totalItems: number;
        byQuality: { [quality: string]: number };
        byType: {
            normal: number;
            killstreak: number;
            strange: number;
            australium: number;
            festive: number;
            unusual: number;
        };
        lastUpdate: number;
    }> {
        try {
            const data = await this.fetchPrices();
            let totalItems = 0;
            const byQuality: { [quality: string]: number } = {};
            const byType = {
                normal: 0,
                killstreak: 0,
                strange: 0,
                australium: 0,
                festive: 0,
                unusual: 0
            };

            for (const name in data.response.items) {
                const item = data.response.items[name];
                const qualities = item.prices;

                for (const qualityId in qualities) {
                    byQuality[qualityId] = (byQuality[qualityId] || 0) + 1;
                    totalItems++;

                    if (qualityId === '5') byType.unusual++;

                    const qualityData = qualities[qualityId];
                    this.countItemTypes(qualityData, byType);
                }
            }

            return {
                totalItems,
                byQuality,
                byType,
                lastUpdate: data.response.current_time
            };
        } catch (error) {
            throw new Error(`Failed to get price stats: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private countItemTypes(data: any, byType: any, depth = 0): void {
        if (depth > 10) return;

        if (typeof data === 'object' && data !== null) {
            for (const key in data) {
                if (key.includes('Killstreak')) byType.killstreak++;
                if (key === 'Strange') byType.strange++;
                if (key === 'Australium') byType.australium++;
                if (key === 'Festive') byType.festive++;
                if (key === 'Normal') byType.normal++;

                if (typeof data[key] === 'object') {
                    this.countItemTypes(data[key], byType, depth + 1);
                }
            }
        }
    }

    get isPricerConnecting(): boolean {
        return false;
    }

    connect(_enabled: boolean): void {
        console.log('BackpackTF Pricer connected');
    }

    init(_enabled: boolean): void {
        console.log('BackpackTF Pricer initialized');
        if (_enabled) {
            this.fetchPrices().catch(error => {
                console.error('Failed to preload price cache:', error);
            });
        }
    }

    shutdown(_enabled: boolean): void {
        console.log('BackpackTF Pricer shutdown');
        this.clearCache();
    }

    bindHandlePriceEvent(_fn: (item: GetItemPriceResponse) => void): void {
        console.log('Price event binding not supported for BackpackTF API');
    }
}
