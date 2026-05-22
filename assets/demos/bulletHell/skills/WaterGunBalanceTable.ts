export type WaterGunNozzleType = 'fan' | 'direct' | 'rotary';
export type WaterGunAmmoType = 'none' | 'hot' | 'soap' | 'ice';
export type WaterGunUpgradeFocus = 'pressure' | 'tank' | 'nozzle' | 'ammo' | 'hybrid';

export interface WaterGunLevelConfig {
    level: number;
    pressureLevel: number;
    tankCapacity: number;
    nozzleType: WaterGunNozzleType;
    ammoType: WaterGunAmmoType;
    range: number;
    damagePerTick: number;
    beamWidth: number;
    damageTickInterval: number;
    knockback: number;
    penetration: number;
    coneAngle: number;
    sweepCycles: number;
    slowDuration: number;
    slowMultiplier: number;
    upgradeFocus: WaterGunUpgradeFocus;
    upgradeSummary: string;
}

export interface WaterGunProfile extends WaterGunLevelConfig {
    sustainDuration: number;
}

export const WATER_GUN_NOZZLE_LABELS: Record<WaterGunNozzleType, string> = {
    fan: '扇形喷嘴',
    direct: '直射喷嘴',
    rotary: '旋转喷嘴',
};

export const WATER_GUN_AMMO_LABELS: Record<WaterGunAmmoType, string> = {
    none: '常温清水',
    hot: '热水弹药',
    soap: '肥皂水弹药',
    ice: '冰水弹药',
};

export const WATER_GUN_UPGRADE_FOCUS_LABELS: Record<WaterGunUpgradeFocus, string> = {
    pressure: '压力强化',
    tank: '水箱扩容',
    nozzle: '喷嘴迭代',
    ammo: '弹药改装',
    hybrid: '综合强化',
};

const WATER_GUN_LEVEL_TABLE: WaterGunLevelConfig[] = [
    {
        level: 1,
        pressureLevel: 1,
        tankCapacity: 1.26,
        nozzleType: 'direct',
        ammoType: 'none',
        range: 188,
        damagePerTick: 12,
        beamWidth: 98,
        damageTickInterval: 0.16,
        knockback: 150,
        penetration: 1,
        coneAngle: Math.PI / 12,
        sweepCycles: 0,
        slowDuration: 0,
        slowMultiplier: 1,
        upgradeFocus: 'pressure',
        upgradeSummary: '基础直射，先建立射程和单体压制能力。',
    },
    {
        level: 2,
        pressureLevel: 1,
        tankCapacity: 1.42,
        nozzleType: 'direct',
        ammoType: 'none',
        range: 198,
        damagePerTick: 13.5,
        beamWidth: 98,
        damageTickInterval: 0.16,
        knockback: 158,
        penetration: 1,
        coneAngle: Math.PI / 12,
        sweepCycles: 0,
        slowDuration: 0,
        slowMultiplier: 1,
        upgradeFocus: 'tank',
        upgradeSummary: '扩大水箱容量，延长持续喷射时间。',
    },
    {
        level: 3,
        pressureLevel: 2,
        tankCapacity: 1.58,
        nozzleType: 'direct',
        ammoType: 'none',
        range: 214,
        damagePerTick: 15.4,
        beamWidth: 98,
        damageTickInterval: 0.15,
        knockback: 170,
        penetration: 1,
        coneAngle: Math.PI / 13,
        sweepCycles: 0,
        slowDuration: 0,
        slowMultiplier: 1,
        upgradeFocus: 'pressure',
        upgradeSummary: '压力提升到二档，射程和击退同步加强。',
    },
    {
        level: 4,
        pressureLevel: 2,
        tankCapacity: 1.74,
        nozzleType: 'fan',
        ammoType: 'soap',
        range: 168,
        damagePerTick: 13.2,
        beamWidth: 98,
        damageTickInterval: 0.15,
        knockback: 132,
        penetration: 9999,
        coneAngle: Math.PI / 2.5,
        sweepCycles: 0,
        slowDuration: 0,
        slowMultiplier: 1,
        upgradeFocus: 'nozzle',
        upgradeSummary: '切换扇形喷嘴并接入肥皂水，清洁范围显著扩大。',
    },
    {
        level: 5,
        pressureLevel: 3,
        tankCapacity: 1.9,
        nozzleType: 'fan',
        ammoType: 'soap',
        range: 178,
        damagePerTick: 14.6,
        beamWidth: 98,
        damageTickInterval: 0.14,
        knockback: 138,
        penetration: 9999,
        coneAngle: Math.PI / 2.45,
        sweepCycles: 0,
        slowDuration: 0,
        slowMultiplier: 1,
        upgradeFocus: 'pressure',
        upgradeSummary: '提高扇喷压力，补回范围技的伤害损失。',
    },
    {
        level: 6,
        pressureLevel: 3,
        tankCapacity: 2.06,
        nozzleType: 'fan',
        ammoType: 'soap',
        range: 188,
        damagePerTick: 16.1,
        beamWidth: 98,
        damageTickInterval: 0.14,
        knockback: 145,
        penetration: 9999,
        coneAngle: Math.PI / 2.4,
        sweepCycles: 0,
        slowDuration: 0,
        slowMultiplier: 1,
        upgradeFocus: 'tank',
        upgradeSummary: '扇喷续航进一步拉长，适合处理中密度敌群。',
    },
    {
        level: 7,
        pressureLevel: 4,
        tankCapacity: 2.22,
        nozzleType: 'rotary',
        ammoType: 'ice',
        range: 202,
        damagePerTick: 17.2,
        beamWidth: 98,
        damageTickInterval: 0.09,
        knockback: 182,
        penetration: 9999,
        coneAngle: Math.PI / 5.2,
        sweepCycles: 2.2,
        slowDuration: 1.5,
        slowMultiplier: 0.55,
        upgradeFocus: 'ammo',
        upgradeSummary: '解锁旋转喷嘴和冰水，开始形成控场节奏。',
    },
    {
        level: 8,
        pressureLevel: 4,
        tankCapacity: 2.38,
        nozzleType: 'rotary',
        ammoType: 'ice',
        range: 214,
        damagePerTick: 19.1,
        beamWidth: 98,
        damageTickInterval: 0.085,
        knockback: 190,
        penetration: 9999,
        coneAngle: Math.PI / 4.7,
        sweepCycles: 2.45,
        slowDuration: 1.6,
        slowMultiplier: 0.52,
        upgradeFocus: 'hybrid',
        upgradeSummary: '旋转频率和减速稳定性同步增强，效率更高。',
    },
    {
        level: 9,
        pressureLevel: 5,
        tankCapacity: 2.54,
        nozzleType: 'rotary',
        ammoType: 'ice',
        range: 226,
        damagePerTick: 21.4,
        beamWidth: 98,
        damageTickInterval: 0.08,
        knockback: 202,
        penetration: 9999,
        coneAngle: Math.PI / 4.3,
        sweepCycles: 2.75,
        slowDuration: 1.7,
        slowMultiplier: 0.48,
        upgradeFocus: 'pressure',
        upgradeSummary: '五档压力驱动旋转喷头，控场和削血都到位。',
    },
    {
        level: 10,
        pressureLevel: 5,
        tankCapacity: 2.72,
        nozzleType: 'rotary',
        ammoType: 'hot',
        range: 238,
        damagePerTick: 25.8,
        beamWidth: 98,
        damageTickInterval: 0.075,
        knockback: 210,
        penetration: 9999,
        coneAngle: Math.PI / 3.9,
        sweepCycles: 3.1,
        slowDuration: 0,
        slowMultiplier: 1,
        upgradeFocus: 'ammo',
        upgradeSummary: '质变为高温旋转清洗，对油污目标形成爆发压制。',
    },
];

export function getWaterGunLevelConfig(level: number): WaterGunLevelConfig {
    const clampedLevel = Math.max(1, Math.min(level, WATER_GUN_LEVEL_TABLE.length));
    return WATER_GUN_LEVEL_TABLE[clampedLevel - 1];
}

export function getWaterGunLevelTable(): readonly WaterGunLevelConfig[] {
    return WATER_GUN_LEVEL_TABLE;
}

export function createWaterGunProfile(level: number, overrides?: Partial<WaterGunProfile>): WaterGunProfile {
    const base = getWaterGunLevelConfig(level);
    return {
        ...base,
        sustainDuration: base.tankCapacity,
        ...overrides,
    };
}
