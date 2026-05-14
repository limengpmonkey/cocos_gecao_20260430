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
                { levelStart: 1, baseExp: 20, growthFactor: 1.12 },
                { levelStart: 6, baseExp: 76, growthFactor: 1.2 },
                { levelStart: 11, baseExp: 188, growthFactor: 1.3 },
            ],
            pressureCurve: [
                { timeSec: 0, normalHpMul: 0.82, normalSpeedMul: 0.78, spawnRateMul: 0.75, maxAliveMul: 0.72, pressureIndex: 0.55 },
                { timeSec: 30, normalHpMul: 0.9, normalSpeedMul: 0.84, spawnRateMul: 0.95, maxAliveMul: 0.86, pressureIndex: 0.75 },
                { timeSec: 75, normalHpMul: 1.08, normalSpeedMul: 0.98, spawnRateMul: 1.22, maxAliveMul: 1.04, pressureIndex: 1.02 },
                { timeSec: 120, normalHpMul: 1.28, normalSpeedMul: 1.08, spawnRateMul: 1.48, maxAliveMul: 1.22, pressureIndex: 1.28 },
                { timeSec: 165, normalHpMul: 1.55, normalSpeedMul: 1.18, spawnRateMul: 1.8, maxAliveMul: 1.45, pressureIndex: 1.62 },
                { timeSec: 200, normalHpMul: 1.42, normalSpeedMul: 1.12, spawnRateMul: 1.62, maxAliveMul: 1.34, pressureIndex: 1.44 },
            ],
            elite: {
                enabled: true,
                startTimeSec: 70,
                intervalSec: 18,
                maxAlive: 1,
                hpMul: 2.3,
                speedMul: 1.18,
                expMul: 2.1,
                scoreMul: 2.4,
                skillType: EliteSkillType.Dash,
                skillCooldown: 3.2,
                explodeRadius: 88,
                explodeDamage: 12,
            },
            relief: {
                enabled: true,
                checkIntervalSec: 3.4,
                minIntervalBetweenDropsSec: 14,
                hpThreshold: 0.5,
                pressureThreshold: 1.26,
                expBurstBase: 28,
                expBurstPerMinute: 14,
                healAmount: 12,
                damageBoostMultiplier: 1.2,
                damageBoostDurationSec: 5.5,
            },
            bossReward: {
                bonusExp: 420,
                bonusExpPerMinute: 72,
                bonusPickupCount: 4,
                rewardSkillOptionCount: 4,
            },
        },
        {
            stageName: 'Stage 2',
            expCurve: [
                { levelStart: 1, baseExp: 34, growthFactor: 1.16 },
                { levelStart: 8, baseExp: 152, growthFactor: 1.28 },
                { levelStart: 14, baseExp: 360, growthFactor: 1.38 },
            ],
            pressureCurve: [
                { timeSec: 0, normalHpMul: 1.0, normalSpeedMul: 0.84, spawnRateMul: 0.95, maxAliveMul: 0.88, pressureIndex: 0.82 },
                { timeSec: 35, normalHpMul: 1.12, normalSpeedMul: 0.92, spawnRateMul: 1.15, maxAliveMul: 1.02, pressureIndex: 1.0 },
                { timeSec: 95, normalHpMul: 1.34, normalSpeedMul: 1.04, spawnRateMul: 1.42, maxAliveMul: 1.22, pressureIndex: 1.3 },
                { timeSec: 155, normalHpMul: 1.62, normalSpeedMul: 1.14, spawnRateMul: 1.72, maxAliveMul: 1.46, pressureIndex: 1.62 },
                { timeSec: 210, normalHpMul: 1.96, normalSpeedMul: 1.24, spawnRateMul: 2.02, maxAliveMul: 1.74, pressureIndex: 1.96 },
                { timeSec: 245, normalHpMul: 1.8, normalSpeedMul: 1.18, spawnRateMul: 1.86, maxAliveMul: 1.62, pressureIndex: 1.76 },
            ],
            elite: {
                enabled: true,
                startTimeSec: 48,
                intervalSec: 11,
                maxAlive: 3,
                hpMul: 2.8,
                speedMul: 1.24,
                expMul: 2.5,
                scoreMul: 2.8,
                skillType: EliteSkillType.Ranged,
                skillCooldown: 2.4,
                explodeRadius: 100,
                explodeDamage: 16,
            },
            relief: {
                enabled: true,
                checkIntervalSec: 3,
                minIntervalBetweenDropsSec: 12,
                hpThreshold: 0.54,
                pressureThreshold: 1.42,
                expBurstBase: 40,
                expBurstPerMinute: 20,
                healAmount: 18,
                damageBoostMultiplier: 1.22,
                damageBoostDurationSec: 6,
            },
            bossReward: {
                bonusExp: 680,
                bonusExpPerMinute: 105,
                bonusPickupCount: 5,
                rewardSkillOptionCount: 5,
            },
        },
    ];
}
