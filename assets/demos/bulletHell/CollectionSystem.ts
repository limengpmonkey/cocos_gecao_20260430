import { sys } from 'cc';
import type { EnemyKilledEventData } from './enemy';

export type CollectionRarity = 'common' | 'boss' | 'rare';

export interface CollectionDefinition {
    id: string;
    name: string;
    badge: string;
    rarity: CollectionRarity;
    unlockTarget: number;
    accent: string;
    shortDescription: string;
    details: string;
    strategy: string;
}

interface CollectionEntryState {
    killCount: number;
    unlocked: boolean;
    unlockedAt: number;
    seen: boolean;
}

interface CollectionSaveData {
    version: number;
    entries: Record<string, CollectionEntryState>;
}

export interface CollectionEntrySnapshot {
    definition: CollectionDefinition;
    killCount: number;
    progress: number;
    remaining: number;
    unlocked: boolean;
    unlockedAt: number;
    seen: boolean;
}

export interface CollectionOverview {
    unlockedCount: number;
    totalCount: number;
    rareUnlockedCount: number;
    rareTotalCount: number;
}

export interface CollectionRecordResult {
    tracked: boolean;
    unlockedNow: boolean;
    snapshot: CollectionEntrySnapshot | null;
}

const STORAGE_KEY = 'bullet-hell-collection-v1';

const COLLECTION_DEFINITIONS: CollectionDefinition[] = [
    {
        id: 'ghost',
        name: '幽影追猎者',
        badge: 'COMMON',
        rarity: 'common',
        unlockTarget: 120,
        accent: '#5ec8ff',
        shortDescription: '会持续贴近玩家的基础游魂单位。',
        details: '它们数量最多、压迫感最稳定，通常是战局节奏的底噪。持续清理这类单位，可以明显降低近身风险。',
        strategy: '优先用范围技或穿透武器处理，保持走位流畅，累计击杀 120 只即可完成收集。',
    },
    {
        id: 'snail_tail',
        name: '可乐罐突进者',
        badge: 'COMMON',
        rarity: 'common',
        unlockTarget: 100,
        accent: '#ff9860',
        shortDescription: '伪装成罐体的高速近战小怪。',
        details: '它们比游魂更强调突脸和碰撞压力，成群出现时会快速压缩玩家回旋空间。',
        strategy: '保持横向移动，利用减速或击退效果切断冲锋路线。击杀 100 只后解锁卡片。',
    },
    {
        id: 'ghost_boss',
        name: '幽影主宰',
        badge: 'BOSS',
        rarity: 'boss',
        unlockTarget: 1,
        accent: '#ffd46a',
        shortDescription: '第一类关底首领，拥有更高生命和压场能力。',
        details: 'Boss 会在关卡条件满足后直接登场。只要完成一次击杀，就会立即登记为已收藏。',
        strategy: 'Boss 卡片没有累计要求，击败一次即可永久解锁。建议在清场后保留爆发技能进入 Boss 战。',
    },
    {
        id: 'snail_tail_boss',
        name: '罐潮领主',
        badge: 'BOSS',
        rarity: 'boss',
        unlockTarget: 1,
        accent: '#f7c35a',
        shortDescription: '第二类关底首领，兼顾硬度与持续追击。',
        details: '它会把小怪阶段的近身压迫升级成 Boss 级别的持久战，要求玩家在更小空间内保持稳定输出。',
        strategy: '与普通可乐罐不同，这张卡不靠累计击杀，而是靠单次击败直接完成收集。',
    },
    {
        id: 'rare_phantom_messenger',
        name: '幻信使',
        badge: 'RARE',
        rarity: 'rare',
        unlockTarget: 1,
        accent: '#79f2de',
        shortDescription: '稀有幽影变体，会在中后段随机入场。',
        details: '它继承幽影底盘，但更像侦查型精英。出现频率低，错过后需要等待下一次随机生成。',
        strategy: '尽量把战场小怪清薄，给稀有怪留下可追击空间。系统会优先补偿未解锁的稀有卡，但仍需要你亲手击杀。',
    },
    {
        id: 'rare_can_mimic',
        name: '王冠罐灵',
        badge: 'RARE',
        rarity: 'rare',
        unlockTarget: 1,
        accent: '#ff7d7d',
        shortDescription: '稀有可乐罐变体，出现时会带来更强压迫。',
        details: '它是高威胁的稀有收集目标，只会随机出现且同屏数量受限，适合作为长期图鉴目标。',
        strategy: '中局后留意高亮精英单位。系统带有保底概率提升，连续几轮没刷出时，下次出现的概率会升高。',
    },
];

const DEFINITIONS_BY_ID = new Map(COLLECTION_DEFINITIONS.map(definition => [definition.id, definition]));

export class CollectionSystem {
    private static _cache: CollectionSaveData | null = null;

    private static createEmptyState(): CollectionSaveData {
        const entries: Record<string, CollectionEntryState> = {};
        for (const definition of COLLECTION_DEFINITIONS) {
            entries[definition.id] = {
                killCount: 0,
                unlocked: false,
                unlockedAt: 0,
                seen: false,
            };
        }

        return {
            version: 1,
            entries,
        };
    }

    private static ensureState(): CollectionSaveData {
        if (this._cache) {
            return this._cache;
        }

        const raw = sys.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            this._cache = this.createEmptyState();
            return this._cache;
        }

        try {
            const parsed = JSON.parse(raw) as Partial<CollectionSaveData>;
            const state = this.createEmptyState();
            for (const definition of COLLECTION_DEFINITIONS) {
                const saved = parsed.entries?.[definition.id];
                if (!saved) {
                    continue;
                }

                state.entries[definition.id] = {
                    killCount: Math.max(0, saved.killCount || 0),
                    unlocked: !!saved.unlocked,
                    unlockedAt: Math.max(0, saved.unlockedAt || 0),
                    seen: !!saved.seen,
                };
            }
            this._cache = state;
        } catch (error) {
            console.warn('[CollectionSystem] 读取存档失败，已回退默认状态', error);
            this._cache = this.createEmptyState();
        }

        return this._cache;
    }

    private static save(): void {
        if (!this._cache) {
            return;
        }
        sys.localStorage.setItem(STORAGE_KEY, JSON.stringify(this._cache));
    }

    public static debugResetAll(): void {
        this._cache = this.createEmptyState();
        this.save();
    }

    public static debugUnlockAll(): void {
        const state = this.ensureState();
        const unlockedAt = Date.now();
        for (const definition of COLLECTION_DEFINITIONS) {
            const entry = state.entries[definition.id];
            entry.killCount = definition.unlockTarget;
            entry.unlocked = true;
            entry.unlockedAt = unlockedAt;
        }
        this.save();
    }

    public static debugSetProgress(id: string, killCount: number): void {
        const definition = this.getDefinition(id);
        if (!definition) {
            console.warn(`[CollectionSystem] debugSetProgress failed, unknown id: ${id}`);
            return;
        }

        const state = this.ensureState();
        const entry = state.entries[id];
        entry.killCount = Math.max(0, Math.floor(killCount));
        entry.unlocked = entry.killCount >= definition.unlockTarget;
        entry.unlockedAt = entry.unlocked ? (entry.unlockedAt || Date.now()) : 0;
        this.save();
    }

    public static getDefinitions(): readonly CollectionDefinition[] {
        return COLLECTION_DEFINITIONS;
    }

    public static getDefinition(id: string): CollectionDefinition | null {
        return DEFINITIONS_BY_ID.get(id) ?? null;
    }

    public static getEntrySnapshot(id: string): CollectionEntrySnapshot | null {
        const definition = this.getDefinition(id);
        if (!definition) {
            return null;
        }

        const state = this.ensureState().entries[id];
        const killCount = state?.killCount ?? 0;
        const progress = Math.min(definition.unlockTarget, killCount);

        return {
            definition,
            killCount,
            progress,
            remaining: Math.max(0, definition.unlockTarget - progress),
            unlocked: !!state?.unlocked,
            unlockedAt: state?.unlocked ?? false ? state.unlockedAt : 0,
            seen: !!state?.seen,
        };
    }

    public static getAllSnapshots(): CollectionEntrySnapshot[] {
        return COLLECTION_DEFINITIONS.map(definition => this.getEntrySnapshot(definition.id)).filter(Boolean) as CollectionEntrySnapshot[];
    }

    public static getOverview(): CollectionOverview {
        const snapshots = this.getAllSnapshots();
        const rareSnapshots = snapshots.filter(entry => entry.definition.rarity === 'rare');
        return {
            unlockedCount: snapshots.filter(entry => entry.unlocked).length,
            totalCount: snapshots.length,
            rareUnlockedCount: rareSnapshots.filter(entry => entry.unlocked).length,
            rareTotalCount: rareSnapshots.length,
        };
    }

    public static getPreferredRareDefinitions(): CollectionDefinition[] {
        const rareDefinitions = COLLECTION_DEFINITIONS.filter(definition => definition.rarity === 'rare');
        const locked = rareDefinitions.filter(definition => !this.getEntrySnapshot(definition.id)?.unlocked);
        return locked.length > 0 ? locked : rareDefinitions;
    }

    public static markSeen(id: string): void {
        const state = this.ensureState();
        const entry = state.entries[id];
        if (!entry || entry.seen) {
            return;
        }
        entry.seen = true;
        this.save();
    }

    public static recordEnemyKill(data: EnemyKilledEventData): CollectionRecordResult {
        if (!data.killedByPlayer) {
            return { tracked: false, unlockedNow: false, snapshot: null };
        }

        const definition = this.getDefinition(data.collectionKey);
        if (!definition) {
            return { tracked: false, unlockedNow: false, snapshot: null };
        }

        const state = this.ensureState();
        const entry = state.entries[definition.id];
        entry.killCount += 1;

        let unlockedNow = false;
        if (!entry.unlocked && entry.killCount >= definition.unlockTarget) {
            entry.unlocked = true;
            entry.unlockedAt = Date.now();
            unlockedNow = true;
        }

        this.save();
        return {
            tracked: true,
            unlockedNow,
            snapshot: this.getEntrySnapshot(definition.id),
        };
    }
}