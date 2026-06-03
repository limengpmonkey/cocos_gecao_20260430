export enum EliteSkillType {
    Dash = 0,
    Ranged = 1,
    Explode = 2,
}

export interface ExpCurvePoint {
    levelStart: number;
    baseExp: number;
    growthFactor: number;
}

export interface PressureCurvePoint {
    timeSec: number;
    normalHpMul: number;
    normalSpeedMul: number;
    spawnRateMul: number;
    maxAliveMul: number;
    pressureIndex: number;
}

export interface EliteSpawnRule {
    enabled: boolean;
    startTimeSec: number;
    intervalSec: number;
    maxAlive: number;
    hpMul: number;
    speedMul: number;
    expMul: number;
    scoreMul: number;
    skillType: EliteSkillType;
    skillCooldown: number;
    explodeRadius: number;
    explodeDamage: number;
}

export interface ResourceReliefRule {
    enabled: boolean;
    checkIntervalSec: number;
    minIntervalBetweenDropsSec: number;
    hpThreshold: number;
    pressureThreshold: number;
    expBurstBase: number;
    expBurstPerMinute: number;
    healAmount: number;
    damageBoostMultiplier: number;
    damageBoostDurationSec: number;
}

export interface BossRewardRule {
    bonusExp: number;
    bonusExpPerMinute: number;
    bonusPickupCount: number;
    rewardSkillOptionCount: number;
}

export interface StageBalanceTable {
    stageName: string;
    expCurve: ExpCurvePoint[];
    pressureCurve: PressureCurvePoint[];
    elite: EliteSpawnRule;
    relief: ResourceReliefRule;
    bossReward: BossRewardRule;
    maxEnemies: number;
}

function clonePressure(point: PressureCurvePoint): PressureCurvePoint {
    return {
        timeSec: point.timeSec,
        normalHpMul: point.normalHpMul,
        normalSpeedMul: point.normalSpeedMul,
        spawnRateMul: point.spawnRateMul,
        maxAliveMul: point.maxAliveMul,
        pressureIndex: point.pressureIndex,
    };
}

function lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
}

export function samplePressureAtTime(curve: PressureCurvePoint[], elapsedSec: number): PressureCurvePoint {
    if (!curve || curve.length === 0) {
        return {
            timeSec: Math.max(0, elapsedSec),
            normalHpMul: 1,
            normalSpeedMul: 1,
            spawnRateMul: 1,
            maxAliveMul: 1,
            pressureIndex: 1,
        };
    }

    if (elapsedSec <= curve[0].timeSec) {
        return clonePressure(curve[0]);
    }

    const last = curve[curve.length - 1];
    if (elapsedSec >= last.timeSec) {
        return clonePressure(last);
    }

    for (let i = 0; i < curve.length - 1; i++) {
        const left = curve[i];
        const right = curve[i + 1];
        if (elapsedSec < left.timeSec || elapsedSec > right.timeSec) {
            continue;
        }

        const duration = Math.max(0.001, right.timeSec - left.timeSec);
        const t = Math.max(0, Math.min(1, (elapsedSec - left.timeSec) / duration));

        return {
            timeSec: elapsedSec,
            normalHpMul: lerp(left.normalHpMul, right.normalHpMul, t),
            normalSpeedMul: lerp(left.normalSpeedMul, right.normalSpeedMul, t),
            spawnRateMul: lerp(left.spawnRateMul, right.spawnRateMul, t),
            maxAliveMul: lerp(left.maxAliveMul, right.maxAliveMul, t),
            pressureIndex: lerp(left.pressureIndex, right.pressureIndex, t),
        };
    }

    return clonePressure(last);
}

export function computeExpNeedForLevel(level: number, curve: ExpCurvePoint[]): number {
    const targetLevel = Math.max(1, Math.floor(level));
    if (!curve || curve.length === 0) {
        return Math.max(1, Math.floor(100 * Math.pow(1.5, targetLevel - 1)));
    }

    let segment = curve[0];
    for (let i = 0; i < curve.length; i++) {
        if (curve[i].levelStart <= targetLevel) {
            segment = curve[i];
        } else {
            break;
        }
    }

    const localLevel = Math.max(0, targetLevel - segment.levelStart);
    const base = Math.max(1, segment.baseExp);
    const growth = Math.max(1.01, segment.growthFactor);
    return Math.max(1, Math.floor(base * Math.pow(growth, localLevel)));
}

export function getDefaultBalanceTables(): StageBalanceTable[] {
    return [
        {
            stageName: 'Stage 1',
            expCurve: [
                { levelStart: 1, baseExp: 28, growthFactor: 1.14 },
                { levelStart: 6, baseExp: 88, growthFactor: 1.22 },
                { levelStart: 11, baseExp: 210, growthFactor: 1.31 },
            ],
            pressureCurve: [
                { timeSec: 0, normalHpMul: 2.00, normalSpeedMul: 0.76, spawnRateMul: 0.18, maxAliveMul: 0.16, pressureIndex: 0.28 },
                { timeSec: 15, normalHpMul: 2.00, normalSpeedMul: 0.80, spawnRateMul: 0.24, maxAliveMul: 0.25, pressureIndex: 0.38 },
                { timeSec: 30, normalHpMul: 2.08, normalSpeedMul: 0.86, spawnRateMul: 0.42, maxAliveMul: 0.42, pressureIndex: 0.58 },
                { timeSec: 45, normalHpMul: 2.18, normalSpeedMul: 0.94, spawnRateMul: 0.70, maxAliveMul: 0.62, pressureIndex: 0.82 },
                { timeSec: 60, normalHpMul: 2.28, normalSpeedMul: 1.02, spawnRateMul: 1.05, maxAliveMul: 0.92, pressureIndex: 1.10 },
                { timeSec: 90, normalHpMul: 2.42, normalSpeedMul: 1.10, spawnRateMul: 1.34, maxAliveMul: 1.16, pressureIndex: 1.36 },
                { timeSec: 135, normalHpMul: 2.62, normalSpeedMul: 1.16, spawnRateMul: 1.58, maxAliveMul: 1.34, pressureIndex: 1.60 },
                { timeSec: 180, normalHpMul: 2.46, normalSpeedMul: 1.12, spawnRateMul: 1.42, maxAliveMul: 1.24, pressureIndex: 1.42 },
            ],
            elite: {
                enabled: true,
                startTimeSec: 75,
                intervalSec: 16,
                maxAlive: 1,
                hpMul: 2.2,
                speedMul: 1.15,
                expMul: 2.0,
                scoreMul: 2.3,
                skillType: EliteSkillType.Dash,
                skillCooldown: 3.2,
                explodeRadius: 88,
                explodeDamage: 12,
            },
            relief: {
                enabled: true,
                checkIntervalSec: 3.2,
                minIntervalBetweenDropsSec: 14,
                hpThreshold: 0.52,
                pressureThreshold: 1.28,
                expBurstBase: 30,
                expBurstPerMinute: 14,
                healAmount: 12,
                damageBoostMultiplier: 1.2,
                damageBoostDurationSec: 5.5,
            },
            bossReward: {
                bonusExp: 460,
                bonusExpPerMinute: 76,
                bonusPickupCount: 4,
                rewardSkillOptionCount: 4,
            },
            maxEnemies: 20,
        },
        {
            stageName: 'Stage 2',
            expCurve: [
                { levelStart: 1, baseExp: 40, growthFactor: 1.17 },
                { levelStart: 8, baseExp: 165, growthFactor: 1.29 },
                { levelStart: 14, baseExp: 390, growthFactor: 1.39 },
            ],
            pressureCurve: [
                { timeSec: 0, normalHpMul: 1.02, normalSpeedMul: 0.86, spawnRateMul: 0.98, maxAliveMul: 0.90, pressureIndex: 0.86 },
                { timeSec: 35, normalHpMul: 1.16, normalSpeedMul: 0.94, spawnRateMul: 1.16, maxAliveMul: 1.04, pressureIndex: 1.02 },
                { timeSec: 90, normalHpMul: 1.38, normalSpeedMul: 1.05, spawnRateMul: 1.44, maxAliveMul: 1.24, pressureIndex: 1.34 },
                { timeSec: 145, normalHpMul: 1.66, normalSpeedMul: 1.14, spawnRateMul: 1.74, maxAliveMul: 1.48, pressureIndex: 1.66 },
                { timeSec: 195, normalHpMul: 1.92, normalSpeedMul: 1.22, spawnRateMul: 2.00, maxAliveMul: 1.72, pressureIndex: 1.94 },
                { timeSec: 225, normalHpMul: 1.76, normalSpeedMul: 1.16, spawnRateMul: 1.82, maxAliveMul: 1.58, pressureIndex: 1.72 },
            ],
            elite: {
                enabled: true,
                startTimeSec: 52,
                intervalSec: 10.5,
                maxAlive: 2,
                hpMul: 2.7,
                speedMul: 1.22,
                expMul: 2.4,
                scoreMul: 2.8,
                skillType: EliteSkillType.Ranged,
                skillCooldown: 2.4,
                explodeRadius: 100,
                explodeDamage: 16,
            },
            relief: {
                enabled: true,
                checkIntervalSec: 3.0,
                minIntervalBetweenDropsSec: 12,
                hpThreshold: 0.54,
                pressureThreshold: 1.42,
                expBurstBase: 42,
                expBurstPerMinute: 20,
                healAmount: 18,
                damageBoostMultiplier: 1.22,
                damageBoostDurationSec: 6,
            },
            bossReward: {
                bonusExp: 720,
                bonusExpPerMinute: 110,
                bonusPickupCount: 5,
                rewardSkillOptionCount: 5,
            },
            maxEnemies: 50,
        },
    ];
}
