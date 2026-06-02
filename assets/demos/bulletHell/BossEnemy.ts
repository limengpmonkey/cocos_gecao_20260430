import { _decorator, Animation, AnimationClip, Color, Graphics, instantiate, Node, Prefab, Sprite, SpriteFrame, tween, UITransform, Vec3 } from 'cc';
import { cBody } from '../../collision/Body';
import { Trigger } from '../../collision/Object';
import { CollectionSystem } from './CollectionSystem';
import { BulletHell } from './bulletHell';
import { Enemy } from './enemy';
import { Player } from './player';

const { ccclass, property } = _decorator;

const tempBossOffset = new Vec3();
const tempBossVelocity = new Vec3();
const tempDashPrevPos = new Vec3();
const tempDashCurrPos = new Vec3();
const tempMeteorBase = new Vec3();
const tempMeteorOffset = new Vec3();
const tempPlayerHitKnockback = new Vec3();
const areaAttackKnockbackDir = new Vec3(1, -1, 0);

interface ActiveMeteorHazard {
    key: string;
    position: Vec3;
    timer: number;
}

interface ActiveSpiralProjectile {
    node: Node;
    ringIndex: number;
    center: Vec3;
    angle: number;
    angularSpeed: number;
    radius: number;
    radialSpeed: number;
    lifeTime: number;
    hitRadius: number;
    damage: number;
}

enum BossAttackType {
    None = 0,
    Dash = 1,
    Meteor = 2,
    Nova = 3,
    Spiral = 4,
}

enum BossActionState {
    Idle = 0,
    Telegraph = 1,
    Dash = 2,
    Recover = 3,
    Spiral = 4,
}

@ccclass('BossMetaConfig')
class BossMetaConfig {
    @property({ tooltip: 'Boss 图鉴 ID，对应 CollectionSystem 定义' })
    collectionId: string = 'ghost_boss';

    @property({ tooltip: 'Boss 图鉴名为空时使用 prefab 节点名/图鉴名' })
    displayName: string = '';
}

@ccclass('BossCombatConfig')
class BossCombatConfig {
    @property({ tooltip: 'Boss 进入攻击循环前的基础冷却（秒）' })
    attackIntervalBase: number = 1.65;

    @property({ tooltip: 'Boss 每次攻击后恢复时长（秒）' })
    attackRecoverDuration: number = 0.42;

    @property({ tooltip: 'Boss 各技能连续命中玩家的最小间隔（秒）' })
    playerHitInterval: number = 0.3;

    @property({ tooltip: '非冲撞攻击命中玩家时的轻微击退力度' })
    followupHitKnockbackStrength: number = 280;

    @property({ tooltip: '非冲撞攻击命中玩家时的轻微击退时长（秒）' })
    followupHitKnockbackDuration: number = 0.18;

    @property({ tooltip: '非冲撞攻击命中玩家时，保持持续推动的时长（秒）' })
    followupHitKnockbackSustainDuration: number = 0.14;
}

@ccclass('BossMovementConfig')
class BossMovementConfig {
    @property({ tooltip: 'Boss 闲置时偏好的作战距离' })
    idlePreferredDistance: number = 250;

    @property({ tooltip: 'Boss 闲置横移幅度' })
    idleStrafeAmplitude: number = 110;

    @property({ tooltip: '锁定玩家位置时的速度预测倍率' })
    targetPredictionFactor: number = 0.28;
}

@ccclass('BossDashConfig')
class BossDashConfig {
    @property({ tooltip: '是否启用 Boss 冲撞技能，调试时可关闭' })
    enabled: boolean = true;

    @property({ tooltip: '冲刺读条时间（秒）' })
    telegraphDuration: number = 0.82;

    @property({ tooltip: '冲刺阶段持续时间（秒）' })
    duration: number = 0.28;

    @property({ tooltip: '冲刺速度' })
    speed: number = 760;

    @property({ tooltip: '冲刺碰撞半径' })
    hitRadius: number = 54;

    @property({ tooltip: '冲刺伤害' })
    damage: number = 16;

    @property({ tooltip: '冲刺持续命中间隔（秒）' })
    hitInterval: number = 0.22;

    @property({ tooltip: '冲撞命中玩家时的击退力度' })
    knockbackStrength: number = 520;

    @property({ tooltip: '冲撞命中玩家时的击退时长（秒）' })
    knockbackDuration: number = 0.24;

    @property({ tooltip: '冲撞命中玩家时的屏幕震动强度' })
    hitShakeStrength: number = 18;

    @property({ tooltip: '冲撞命中玩家时的屏幕震动时长（秒）' })
    hitShakeDuration: number = 0.16;
}

@ccclass('BossMeteorConfig')
class BossMeteorConfig {
    @property({ tooltip: '落点轰炸读条时间（秒）' })
    telegraphDuration: number = 0.95;

    @property({ tooltip: '落点轰炸圆形半径' })
    radius: number = 82;

    @property({ tooltip: '落点轰炸伤害' })
    damage: number = 14;

    @property({ tooltip: '落点轰炸危险区域持续时长（秒）' })
    lingerDuration: number = 1.2;

    @property({ tooltip: '副落点与主落点的间距倍率' })
    spreadMultiplier: number = 1.2;
}

@ccclass('BossNovaConfig')
class BossNovaConfig {
    @property({ tooltip: '环爆读条时间（秒）' })
    telegraphDuration: number = 0.74;

    @property({ tooltip: '环爆半径' })
    radius: number = 220;

    @property({ tooltip: '环爆伤害' })
    damage: number = 18;

    @property({ tooltip: '环爆危险区域持续时长（秒）' })
    lingerDuration: number = 0.65;
}

@ccclass('BossSpiralConfig')
class BossSpiralConfig {
    @property({ tooltip: '是否启用 Boss 漩涡抛弹技能' })
    enabled: boolean = true;

    @property({ tooltip: '漩涡抛弹读条时间（秒）' })
    telegraphDuration: number = 0.9;

    @property({ tooltip: 'Boss 原地释放漩涡抛弹的持续时长（秒）' })
    activeDuration: number = 2.8;

    @property({ type: Prefab, tooltip: '漩涡弹 prefab；为空时使用运行时圆形子弹' })
    bulletPrefab: Prefab | null = null;

    @property({ tooltip: '漩涡弹 prefab 缩放倍率；素材过大时可直接调小' })
    bulletPrefabScale: number = 0.33;

    @property({ tooltip: '每一圈抛出的子弹数量' })
    bulletsPerRing: number = 3;

    @property({ tooltip: '每一圈抛弹的间隔（秒）' })
    spawnInterval: number = 0.22;

    @property({ tooltip: '屏幕上同时保留的漩涡弹圈数，直接决定整体密度' })
    maxVisibleRings: number = 4;

    @property({ tooltip: '漩涡弹最小飞行半径；达到后才允许因寿命结束被移除' })
    minTravelRadius: number = 460;

    @property({ tooltip: '漩涡弹初始半径' })
    startRadius: number = 26;

    @property({ tooltip: '漩涡弹向外扩散速度' })
    radialSpeed: number = 82;

    @property({ tooltip: '漩涡弹角速度（度/秒）' })
    angularSpeed: number = 99;

    @property({ tooltip: '每一圈相位偏移（度）' })
    ringAngleStep: number = 20;

    @property({ tooltip: '漩涡弹生命时长（秒）' })
    bulletLifeTime: number = 4.2;

    @property({ tooltip: '漩涡弹命中半径' })
    bulletHitRadius: number = 20;

    @property({ tooltip: '漩涡弹伤害' })
    bulletDamage: number = 9;

    @property({ tooltip: '漩涡弹默认绘制半径（未配置 prefab 时使用）' })
    bulletVisualRadius: number = 3;

    @property({ type: Color, tooltip: '漩涡弹默认颜色（未配置 prefab 时使用）' })
    bulletColor: Color = new Color(255, 158, 92, 255);
}

@ccclass('BossPhaseProfile')
class BossPhaseProfile {
    @property({ tooltip: '该阶段生效的血量阈值（当前血量占比 <= 该值）' })
    threshold: number = 1;

    @property({ tooltip: '该阶段的移动速度倍率' })
    speedMultiplier: number = 1;

    @property({ tooltip: '该阶段的攻击冷却倍率（越小越频繁）' })
    cooldownMultiplier: number = 1;

    @property({ tooltip: '该阶段冲刺技能权重' })
    dashWeight: number = 1;

    @property({ tooltip: '该阶段落点轰炸权重' })
    meteorWeight: number = 1;

    @property({ tooltip: '该阶段环爆权重' })
    novaWeight: number = 0;

    @property({ tooltip: '该阶段漩涡抛弹权重' })
    spiralWeight: number = 0;
}

@ccclass('BossAnimationConfig')
class BossAnimationConfig {
    @property({ tooltip: '暴怒循环动画' })
    rageLoopClip: string = 'baonu';

    @property({ tooltip: '空闲到暴怒的过渡动画' })
    idleToAngryClip: string = 'idle_to_angry';

    @property({ tooltip: '空闲到移动的过渡动画' })
    idleToWalkClip: string = 'idle_to_walking';

    @property({ tooltip: '攻击前摇 1，默认用于范围/投射攻击' })
    preAttackClip1: string = 'pre_attack_1';

    @property({ tooltip: '攻击前摇 2，默认用于突进/爆发攻击' })
    preAttackClip2: string = 'pre_attack_2';

    @property({ tooltip: '移动循环动画' })
    walkLoopClip: string = 'tank_walking';

    @property({ tooltip: '移动到空闲的过渡动画' })
    walkToIdleClip: string = 'walking_to_idle';

    @property({ tooltip: '判定为移动中的速度阈值平方' })
    movingSpeedSqrThreshold: number = 16;

    @property({ tooltip: 'Boss 开场展示时长（秒），期间不移动不攻击，只播放暴怒动画' })
    openingShowcaseDuration: number = 3;

    @property({ tooltip: '冲撞时移动动画的最短可见时长（秒）' })
    dashWalkVisibleDuration: number = 0.42;
}

function createPhaseProfile(
    threshold: number,
    speedMultiplier: number,
    cooldownMultiplier: number,
    dashWeight: number,
    meteorWeight: number,
    novaWeight: number,
    spiralWeight: number,
): BossPhaseProfile {
    const config = new BossPhaseProfile();
    config.threshold = threshold;
    config.speedMultiplier = speedMultiplier;
    config.cooldownMultiplier = cooldownMultiplier;
    config.dashWeight = dashWeight;
    config.meteorWeight = meteorWeight;
    config.novaWeight = novaWeight;
    config.spiralWeight = spiralWeight;
    return config;
}

@ccclass('BossEnemy')
export class BossEnemy extends Enemy {
    static pools: WeakMap<Prefab, BossEnemy[]> = new WeakMap();

    static get(prefab: Prefab): BossEnemy | null {
        if (!prefab) {
            return null;
        }

        let pool = this.pools.get(prefab);
        if (!pool) {
            pool = [];
            this.pools.set(prefab, pool);
        }

        let boss = pool.pop() ?? null;
        if (!boss) {
            const node = instantiate(prefab);
            boss = node.getComponent(BossEnemy);
            if (!boss) {
                console.error('[BossEnemy] Boss prefab must include BossEnemy component.');
                node.destroy();
                return null;
            }
        }

        boss._sourcePrefab = prefab;
        boss.node.active = true;
        return boss;
    }

    static put(boss: BossEnemy): void {
        const prefab = boss._sourcePrefab;
        if (prefab) {
            let pool = this.pools.get(prefab);
            if (!pool) {
                pool = [];
                this.pools.set(prefab, pool);
            }
            pool.push(boss);
        }

        boss.remove(false);
    }

    static clearPools(): void {
        this.pools = new WeakMap();
    }

    @property({ type: BossMetaConfig, tooltip: 'Boss 身份和图鉴信息' })
    metaConfig: BossMetaConfig = new BossMetaConfig();

    @property({ type: BossCombatConfig, tooltip: 'Boss 攻击循环基础参数' })
    combatConfig: BossCombatConfig = new BossCombatConfig();

    @property({ type: BossMovementConfig, tooltip: 'Boss 闲置与锁定移动参数' })
    movementConfig: BossMovementConfig = new BossMovementConfig();

    @property({ type: BossDashConfig, tooltip: 'Boss 冲刺技能参数' })
    dashConfig: BossDashConfig = new BossDashConfig();

    @property({ type: BossMeteorConfig, tooltip: 'Boss 落点轰炸技能参数' })
    meteorConfig: BossMeteorConfig = new BossMeteorConfig();

    @property({ type: BossNovaConfig, tooltip: 'Boss 环爆技能参数' })
    novaConfig: BossNovaConfig = new BossNovaConfig();

    @property({ type: BossSpiralConfig, tooltip: 'Boss 漩涡抛弹技能参数' })
    spiralConfig: BossSpiralConfig = new BossSpiralConfig();

    @property({ tooltip: '调试：开启后 Boss 只释放漩涡抛弹技能' })
    debugSpiralOnly: boolean = false;

    @property({ type: BossAnimationConfig, tooltip: 'Boss 动画衔接与 clip 命名配置' })
    animationConfig: BossAnimationConfig = new BossAnimationConfig();

    @property({ type: AnimationClip, tooltip: 'Meteor 落点特效动画 clip' })
    meteorImpactEffectClip: AnimationClip | null = null;

    @property({ type: SpriteFrame, tooltip: 'Meteor 落点特效首帧 spriteFrame' })
    meteorImpactEffectFirstFrame: SpriteFrame | null = null;

    @property({ tooltip: 'Meteor 落点特效缩放' })
    meteorImpactEffectScale: number = 1;

    @property({ tooltip: 'Meteor 落点特效显示时长（秒）' })
    meteorImpactEffectDisplayDuration: number = 1.15;

    @property({ tooltip: 'Meteor 落点特效播放完后的额外停留时长（秒）' })
    meteorImpactEffectLingerDuration: number = 0.18;

    @property({ type: BossPhaseProfile, tooltip: '一阶段权重与节奏参数' })
    phaseOneConfig: BossPhaseProfile = createPhaseProfile(1, 1, 1, 0.52, 0.32, 0, 0.16);

    @property({ type: BossPhaseProfile, tooltip: '二阶段权重与节奏参数' })
    phaseTwoConfig: BossPhaseProfile = createPhaseProfile(0.68, 1.1, 0.82, 0.3, 0.26, 0.22, 0.22);

    @property({ type: BossPhaseProfile, tooltip: '三阶段权重与节奏参数' })
    phaseThreeConfig: BossPhaseProfile = createPhaseProfile(0.34, 1.22, 0.64, 0.24, 0.22, 0.24, 0.3);

    private _sourcePrefab: Prefab = null;
    private _attackType: BossAttackType = BossAttackType.None;
    private _actionState: BossActionState = BossActionState.Idle;
    private _stateTimer: number = 0;
    private _attackCooldown: number = 1.35;
    private _orbitSeed: number = Math.random() * Math.PI * 2;
    private _telegraphNode: Node = null;
    private _telegraphGraphics: Graphics = null;
    private _telegraphPulse: number = 0;
    private _lockedTargetPos: Vec3 = new Vec3();
    private _dashDirection: Vec3 = new Vec3();
    private _dashDestination: Vec3 = new Vec3();
    private _dashHasHit: boolean = false;
    private _attackHitCooldowns: Map<string, number> = new Map();
    private _meteorTargets: Vec3[] = [new Vec3(), new Vec3(), new Vec3()];
    private _activeMeteorHazards: ActiveMeteorHazard[] = [];
    private _activeNovaTimer: number = 0;
    private _activeSpiralProjectiles: ActiveSpiralProjectile[] = [];
    private _spiralCenter: Vec3 = new Vec3();
    private _spiralSpawnTimer: number = 0;
    private _spiralRingIndex: number = 0;
    private _animation: Animation = null;
    private _animationQueue: Array<{ name: string; loop: boolean }> = [];
    private _currentAnimationName: string = '';
    private _currentAnimationLoop: boolean = false;
    private _animationLocked: boolean = false;
    private _lastVisualPhase: number = 1;
    private _pendingPhaseAngryTransition: boolean = false;
    private _wasMovingLastFrame: boolean = false;
    private _isSwitchingAnimation: boolean = false;
    private _openingIntroTimer: number = 0;
    private _openingIntroActive: boolean = false;
    private _openingShowcaseTimer: number = 0;
    private _dashWalkVisibleTimer: number = 0;

    onLoad(): void {
        super.onLoad();
        this.setupAnimationController();
    }

    init(): void {
        super.init();
        this._attackType = BossAttackType.None;
        this._actionState = BossActionState.Idle;
        this._stateTimer = 0;
        this._attackCooldown = Math.max(0.7, this.combatConfig.attackIntervalBase * 0.9);
        this._dashHasHit = false;
        this._attackHitCooldowns.clear();
        this._activeMeteorHazards.length = 0;
        this._activeNovaTimer = 0;
        this.clearSpiralProjectiles();
        this._spiralCenter.set(this.node.worldPosition);
        this._spiralSpawnTimer = 0;
        this._spiralRingIndex = 0;
        this._orbitSeed = Math.random() * Math.PI * 2;
        this.clearTelegraph();
        this.resetAnimationRuntimeState();
        this._openingShowcaseTimer = Math.max(0, this.animationConfig.openingShowcaseDuration);
        this.playOpeningShowcaseAnimation();
    }

    applyBossCollectionMetadata(): void {
        const collectionId = (this.metaConfig.collectionId || '').trim();
        const definition = collectionId ? CollectionSystem.getDefinition(collectionId) : null;
        const displayName = (this.metaConfig.displayName || '').trim() || definition?.name || this.node.name || 'Boss';

        this.resetCollectionMetadata();
        if (definition) {
            this.setCollectionMetadata(definition.id, displayName, false);
            return;
        }

        this.setCollectionMetadata(collectionId || this.node.name || 'boss', displayName, false);
    }

    onDestroy(): void {
        this.clearSpiralProjectiles();
        this.teardownAnimationController();
        this.clearTelegraph();
        super.onDestroy();
    }

    update(dt: number): void {
        this.tickAttackHitCooldowns(dt);
        this.updateActiveAreaHazards(dt);
        this.updateSpiralProjectiles(dt);

        const dashWasActive = this._actionState === BossActionState.Dash;
        if (dashWasActive) {
            tempDashPrevPos.set(this.node.worldPosition);
        }

        if (!this.isDead && !this.isDyingState && !this.isGamePausedState && !this.isBossEntranceActive && !this.isOpeningShowcaseActive()) {
            this.updateAttackState(dt);
        } else {
            this.clearTelegraph();
        }

        super.update(dt);

        if (dashWasActive && this._actionState === BossActionState.Dash) {
            tempDashCurrPos.set(this.node.worldPosition);
            this.tryDealDashDamage(tempDashPrevPos, tempDashCurrPos);
        }

        this.updateAnimationState(dt);

        this.drawTelegraph(dt);
    }

    follow(): void {
        if (this.isDead || this.isDyingState || !Player.inst || !Player.inst.node) {
            this.tryVelocity.set(Vec3.ZERO);
            this.velocity.set(Vec3.ZERO);
            return;
        }

        if (this.isGamePausedState) {
            return;
        }

        if (this.isOpeningShowcaseActive()) {
            this.tryVelocity.set(Vec3.ZERO);
            this.velocity.set(Vec3.ZERO);
            return;
        }

        if (this._actionState === BossActionState.Telegraph || this._actionState === BossActionState.Recover || this._actionState === BossActionState.Spiral) {
            this.tryVelocity.set(Vec3.ZERO);
            this.velocity.set(Vec3.ZERO);
            return;
        }

        if (this._actionState === BossActionState.Dash) {
            this.tryVelocity.set(this._dashDirection).multiplyScalar(this.getEffectiveDashSpeed());
            this.velocity.set(this.tryVelocity);
            this.syncFacingByVelocity(this.tryVelocity.x);
            return;
        }

        const playerPos = Player.inst.node.worldPosition;
        const selfPos = this.node.worldPosition;

        Vec3.subtract(tempBossOffset, playerPos, selfPos);
        const distance = tempBossOffset.length();
        if (distance <= 0.001) {
            this.tryVelocity.set(Vec3.ZERO);
            this.velocity.set(Vec3.ZERO);
            return;
        }

        tempBossOffset.multiplyScalar(1 / distance);
        const orbitNormalX = -tempBossOffset.y;
        const orbitNormalY = tempBossOffset.x;
        const orbitPhase = this._orbitSeed + performance.now() * 0.0016;
        const preferredDistance = Math.max(140, this.movementConfig.idlePreferredDistance);
        const radialBias = (distance - preferredDistance) / Math.max(80, preferredDistance);
        const orbitWeight = 0.72 + 0.28 * Math.sin(orbitPhase);
        const strafeDirection = Math.sin(orbitPhase * 0.75) >= 0 ? 1 : -1;

        tempBossVelocity.set(
            tempBossOffset.x * radialBias + orbitNormalX * orbitWeight * strafeDirection,
            tempBossOffset.y * radialBias + orbitNormalY * orbitWeight * strafeDirection,
            0,
        );

        if (tempBossVelocity.lengthSqr() <= 0.001) {
            this.tryVelocity.set(Vec3.ZERO);
            this.velocity.set(Vec3.ZERO);
            return;
        }

        tempBossVelocity.normalize();
        let maxVelocity = this.body?.maxVelocity ?? this.maxVelocity;
        if (maxVelocity <= 0) {
            maxVelocity = 90;
        }

        const phaseProfile = this.getCurrentPhaseProfile();
        const distanceBias = distance > preferredDistance + this.movementConfig.idleStrafeAmplitude ? 1.12 : 0.92;
        this.tryVelocity.set(tempBossVelocity).multiplyScalar(maxVelocity * Math.max(0.1, phaseProfile.speedMultiplier) * distanceBias);
        this.velocity.set(this.tryVelocity);
        this.syncFacingByVelocity(this.tryVelocity.x);
    }

    protected playDeathEffect(attackerNode?: Node, onComplete?: () => void): void {
        this.clearTelegraph();
        const startScale = this.node.scale.clone();
        const burstScale = startScale.clone().multiplyScalar(1.16);
        const collapseScale = startScale.clone().multiplyScalar(0.18);

        tween(this.node)
            .stop()
            .to(0.12, { scale: burstScale })
            .to(0.18, { scale: collapseScale })
            .call(() => {
                if (onComplete) {
                    onComplete();
                }
            })
            .start();
    }

    protected recycle(): void {
        this.resetAnimationRuntimeState();
        this.clearTelegraph();
        super.recycle();
        BossEnemy.put(this);
    }

    private updateAttackState(dt: number): void {
        if (!Player.inst || !Player.inst.isAlive) {
            this._attackType = BossAttackType.None;
            this._actionState = BossActionState.Idle;
            this._stateTimer = 0;
            return;
        }

        if (this._actionState === BossActionState.Telegraph) {
            this._stateTimer = Math.max(0, this._stateTimer - dt);
            if (this._stateTimer <= 0) {
                this.executeTelegraphedAttack();
            }
            return;
        }

        if (this._actionState === BossActionState.Dash) {
            this._stateTimer = Math.max(0, this._stateTimer - dt);
            if (this._stateTimer <= 0) {
                this.finishAttackRecovery();
            }
            return;
        }

        if (this._actionState === BossActionState.Spiral) {
            this._stateTimer = Math.max(0, this._stateTimer - dt);
            this.updateSpiralAttack(dt);
            if (this._stateTimer <= 0) {
                this.finishAttackRecovery();
            }
            return;
        }

        if (this._actionState === BossActionState.Recover) {
            this._stateTimer = Math.max(0, this._stateTimer - dt);
            if (this._stateTimer <= 0) {
                this._actionState = BossActionState.Idle;
                this._attackType = BossAttackType.None;
            }
            return;
        }

        this._attackCooldown = Math.max(0, this._attackCooldown - dt);
        if (this._attackCooldown > 0) {
            return;
        }

        this.beginTelegraph(this.chooseNextAttack());
    }

    private chooseNextAttack(): BossAttackType {
        if (this.debugSpiralOnly && this.spiralConfig.enabled) {
            return BossAttackType.Spiral;
        }

        const phaseProfile = this.getCurrentPhaseProfile();
        const dashWeight = this.dashConfig.enabled ? Math.max(0, phaseProfile.dashWeight) : 0;
        const meteorWeight = Math.max(0, phaseProfile.meteorWeight);
        const novaWeight = Math.max(0, phaseProfile.novaWeight);
        const spiralWeight = this.spiralConfig.enabled ? Math.max(0, phaseProfile.spiralWeight) : 0;
        const totalWeight = dashWeight + meteorWeight + novaWeight + spiralWeight;
        if (totalWeight <= 0.0001) {
            return spiralWeight >= meteorWeight ? BossAttackType.Spiral : (meteorWeight >= novaWeight ? BossAttackType.Meteor : BossAttackType.Nova);
        }

        const roll = Math.random() * totalWeight;
        if (roll < dashWeight) {
            return BossAttackType.Dash;
        }
        if (roll < dashWeight + meteorWeight) {
            return BossAttackType.Meteor;
        }
        if (roll < dashWeight + meteorWeight + novaWeight) {
            return BossAttackType.Nova;
        }
        return BossAttackType.Spiral;
    }

    private beginTelegraph(attackType: BossAttackType): void {
        this._attackType = attackType;
        this._actionState = BossActionState.Telegraph;
        this._dashHasHit = false;
        this.captureAttackTargets(attackType);

        if (attackType === BossAttackType.Dash) {
            this._stateTimer = Math.max(0.15, this.dashConfig.telegraphDuration, this.getClipDuration(this.animationConfig.preAttackClip2));
            return;
        }
        if (attackType === BossAttackType.Meteor) {
            this._stateTimer = Math.max(0.15, this.meteorConfig.telegraphDuration, this.getClipDuration(this.animationConfig.preAttackClip1));
            return;
        }

        if (attackType === BossAttackType.Spiral) {
            this._stateTimer = Math.max(0.15, this.spiralConfig.telegraphDuration, this.getClipDuration(this.animationConfig.preAttackClip1));
            return;
        }

        this._stateTimer = Math.max(0.15, this.novaConfig.telegraphDuration, this.getClipDuration(this.animationConfig.preAttackClip2));
    }

    private captureAttackTargets(attackType: BossAttackType): void {
        if (!Player.inst) {
            return;
        }

        if (attackType === BossAttackType.Meteor) {
            this._lockedTargetPos.set(Player.inst.getPosition());
        } else {
            this._lockedTargetPos.set(Player.inst.node.worldPosition);
            tempBossVelocity.set(Player.inst.velocity).multiplyScalar(Math.max(0, this.movementConfig.targetPredictionFactor));
            this._lockedTargetPos.add(tempBossVelocity);
        }

        tempMeteorBase.set(this._lockedTargetPos);
        this._meteorTargets[0].set(tempMeteorBase);

        Vec3.subtract(tempBossOffset, tempMeteorBase, this.node.worldPosition);
        if (tempBossOffset.lengthSqr() <= 0.001) {
            tempBossOffset.set(1, 0, 0);
        }
        tempBossOffset.normalize();

        tempMeteorOffset.set(-tempBossOffset.y, tempBossOffset.x, 0)
            .multiplyScalar(this.meteorConfig.radius * Math.max(0.1, this.meteorConfig.spreadMultiplier));
        this._meteorTargets[1].set(tempMeteorBase).add(tempMeteorOffset);
        this._meteorTargets[2].set(tempMeteorBase).subtract(tempMeteorOffset);

        for (const target of this._meteorTargets) {
            BulletHell.inst?.clampPositionToBossArena(target);
        }
    }

    private executeTelegraphedAttack(): void {
        if (this._attackType === BossAttackType.Dash) {
            this.executeDashAttack();
            return;
        }

        if (this._attackType === BossAttackType.Meteor) {
            this.executeMeteorAttack();
            return;
        }

        if (this._attackType === BossAttackType.Spiral) {
            this.executeSpiralAttack();
            return;
        }

        this.executeNovaAttack();
    }

    private executeDashAttack(): void {
        this._actionState = BossActionState.Dash;
        this._dashHasHit = false;
        this._attackHitCooldowns.delete('dash');
        this._animationLocked = false;
        this._animationQueue.length = 0;

        Vec3.subtract(this._dashDirection, this._lockedTargetPos, this.node.worldPosition);
        if (this._dashDirection.lengthSqr() <= 0.001) {
            this._dashDirection.set(1, 0, 0);
        }
        this._dashDirection.normalize();

        this._dashDestination.set(this.node.worldPosition);
        BulletHell.inst?.projectBossArenaEdgePoint(this.node.worldPosition, this._dashDirection, this._dashDestination);

        const dashDistance = Vec3.distance(this.node.worldPosition, this._dashDestination);
        const dashDuration = dashDistance / Math.max(1, this.getEffectiveDashSpeed());
        this._stateTimer = Math.max(0.08, dashDuration);
        this._dashWalkVisibleTimer = Math.max(
            this._stateTimer,
            this.animationConfig.dashWalkVisibleDuration,
            this.getClipDuration(this.animationConfig.walkLoopClip),
        );
        this.transitionToMove(true);
        this._wasMovingLastFrame = true;
    }

    private executeMeteorAttack(): void {
        this._activeMeteorHazards.length = 0;

        const meteorHazardDuration = Math.max(
            0.1,
            this.meteorConfig.lingerDuration,
            this.meteorImpactEffectDisplayDuration + this.meteorImpactEffectLingerDuration,
        );

        let meteorIndex = 0;
        for (const target of this._meteorTargets) {
            this.spawnMeteorImpactEffect(target);
            this._activeMeteorHazards.push({
                key: `meteor-${meteorIndex}`,
                position: target.clone(),
                timer: meteorHazardDuration,
            });
            meteorIndex += 1;
        }

        this.applyMeteorHazardDamage();

        this.finishAttackRecovery();
    }

    private spawnMeteorImpactEffect(worldPos: Vec3): void {
        if (!this.meteorImpactEffectClip) {
            return;
        }

        this.ensureTelegraphNode();

        const parent = this._telegraphNode?.parent || BulletHell.inst?.node || this.node.parent;
        if (!parent) {
            return;
        }

        const effectNode = new Node(`${this.node.name}-MeteorImpactEffect`);
        parent.addChild(effectNode);
        effectNode.layer = parent.layer;
        effectNode.addComponent(UITransform).setContentSize(2, 2);
        effectNode.setPosition(worldPos);
        effectNode.setScale(this.meteorImpactEffectScale, this.meteorImpactEffectScale, 1);

        const sprite = effectNode.addComponent(Sprite);
        if (this.meteorImpactEffectFirstFrame) {
            sprite.spriteFrame = this.meteorImpactEffectFirstFrame;
        }

        const animation = effectNode.addComponent(Animation);
        const animationAny = animation as Animation & { clips: AnimationClip[]; defaultClip: AnimationClip | null };
        animationAny.clips = [this.meteorImpactEffectClip];
        animationAny.defaultClip = this.meteorImpactEffectClip;

        const state = animation.getState(this.meteorImpactEffectClip.name);
        if (state) {
            state.wrapMode = AnimationClip.WrapMode.Loop;
            state.repeatCount = Infinity;
            state.speed = 1;
        }

        animation.play(this.meteorImpactEffectClip.name);
        tween(effectNode)
            .delay(
                Math.max(0.1, this.meteorImpactEffectDisplayDuration)
                + Math.max(0, this.meteorImpactEffectLingerDuration)
            )
            .call(() => effectNode.destroy())
            .start();
    }

    private executeNovaAttack(): void {
        this._activeNovaTimer = Math.max(this._activeNovaTimer, this.novaConfig.lingerDuration);
        this.applyNovaHazardDamage();

        this.finishAttackRecovery();
    }

    private executeSpiralAttack(): void {
        this._actionState = BossActionState.Spiral;
        this._stateTimer = Math.max(0.3, this.spiralConfig.activeDuration);
        this._spiralCenter.set(this.node.worldPosition);
        this._spiralSpawnTimer = 0;
        this._spiralRingIndex = 0;
        this.velocity.set(Vec3.ZERO);
        this.tryVelocity.set(Vec3.ZERO);
        this.spawnSpiralRing();
    }

    private finishAttackRecovery(): void {
        this._actionState = BossActionState.Recover;
        this._stateTimer = Math.max(0.15, this.combatConfig.attackRecoverDuration);
        this._attackCooldown = this.computeNextAttackCooldown();
        this._attackType = BossAttackType.None;
        this._dashHasHit = false;
        this._attackHitCooldowns.delete('dash');
        this.clearTelegraph();
    }

    private updateSpiralAttack(dt: number): void {
        if (this._actionState !== BossActionState.Spiral) {
            return;
        }

        this.tryVelocity.set(Vec3.ZERO);
        this.velocity.set(Vec3.ZERO);

        this._spiralSpawnTimer -= Math.max(0, dt);
        while (this._spiralSpawnTimer <= 0) {
            this.spawnSpiralRing();
            this._spiralSpawnTimer += Math.max(0.05, this.spiralConfig.spawnInterval);
        }
    }

    private spawnSpiralRing(): void {
        const bulletsPerRing = Math.max(1, Math.floor(this.spiralConfig.bulletsPerRing));
        const step = (Math.PI * 2) / bulletsPerRing;
        const baseAngle = this._spiralRingIndex * (this.spiralConfig.ringAngleStep * Math.PI / 180);
        const angularSpeed = this.spiralConfig.angularSpeed * Math.PI / 180;
        const currentRingIndex = this._spiralRingIndex;
        const spiralLifetime = Math.max(0.2, this.spiralConfig.bulletLifeTime);

        for (let i = 0; i < bulletsPerRing; i += 1) {
            const angle = baseAngle + step * i;
            const node = this.createSpiralProjectileNode();
            if (!node) {
                continue;
            }

            const projectile: ActiveSpiralProjectile = {
                node,
                ringIndex: currentRingIndex,
                center: this._spiralCenter.clone(),
                angle,
                angularSpeed,
                radius: Math.max(0, this.spiralConfig.startRadius),
                radialSpeed: Math.max(10, this.spiralConfig.radialSpeed),
                lifeTime: spiralLifetime,
                hitRadius: Math.max(4, this.spiralConfig.bulletHitRadius),
                damage: Math.max(1, this.spiralConfig.bulletDamage),
            };
            this.positionSpiralProjectile(projectile);
            this._activeSpiralProjectiles.push(projectile);
        }

        this._spiralRingIndex += 1;
        this.pruneOldSpiralRings();
    }

    private createSpiralProjectileNode(): Node | null {
        const parent = BulletHell.inst?.bullets ?? this.node.parent;
        if (!parent) {
            return null;
        }

        let node: Node;
        if (this.spiralConfig.bulletPrefab) {
            node = instantiate(this.spiralConfig.bulletPrefab);
            const prefabScale = Math.max(0.01, this.spiralConfig.bulletPrefabScale);
            node.setScale(prefabScale, prefabScale, 1);
        } else {
            node = new Node(`${this.node.name}-SpiralBullet`);
            node.layer = parent.layer;
            const transform = node.addComponent(UITransform);
            const visualRadius = Math.max(2, this.spiralConfig.bulletVisualRadius);
            transform.setContentSize(visualRadius * 2 + 4, visualRadius * 2 + 4);
            const graphics = node.addComponent(Graphics);
            graphics.fillColor = this.spiralConfig.bulletColor.clone();
            graphics.circle(0, 0, visualRadius);
            graphics.fill();
        }

        node.layer = parent.layer;
        parent.addChild(node);
        return node;
    }

    private updateSpiralProjectiles(dt: number): void {
        if (this._activeSpiralProjectiles.length <= 0) {
            return;
        }

        const player = Player.inst;
        const playerPos = player?.node?.worldPosition ?? null;
        for (let i = this._activeSpiralProjectiles.length - 1; i >= 0; i -= 1) {
            const projectile = this._activeSpiralProjectiles[i];
            if (!projectile.node || !projectile.node.isValid) {
                this._activeSpiralProjectiles.splice(i, 1);
                continue;
            }

            projectile.lifeTime = Math.max(0, projectile.lifeTime - dt);
            projectile.radius += projectile.radialSpeed * Math.max(0, dt);
            projectile.angle += projectile.angularSpeed * Math.max(0, dt);
            this.positionSpiralProjectile(projectile);

            let shouldRemove = projectile.lifeTime <= 0 && projectile.radius >= Math.max(0, this.spiralConfig.minTravelRadius);
            if (!shouldRemove && player && player.isAlive && playerPos) {
                const dx = projectile.node.worldPosition.x - playerPos.x;
                const dy = projectile.node.worldPosition.y - playerPos.y;
                const hitRadius = projectile.hitRadius + 12;
                if ((dx * dx + dy * dy) <= hitRadius * hitRadius) {
                    if (player.takeDamage(projectile.damage, this.node)) {
                        player.applyKnockback(areaAttackKnockbackDir, this.combatConfig.followupHitKnockbackStrength, this.combatConfig.followupHitKnockbackDuration, this.combatConfig.followupHitKnockbackSustainDuration);
                    }
                    shouldRemove = true;
                }
            }

            if (shouldRemove) {
                projectile.node.destroy();
                this._activeSpiralProjectiles.splice(i, 1);
            }
        }
    }

    private positionSpiralProjectile(projectile: ActiveSpiralProjectile): void {
        const x = projectile.center.x + Math.cos(projectile.angle) * projectile.radius;
        const y = projectile.center.y + Math.sin(projectile.angle) * projectile.radius;
        projectile.node.setWorldPosition(x, y, projectile.center.z);
    }

    private clearSpiralProjectiles(): void {
        for (const projectile of this._activeSpiralProjectiles) {
            if (projectile.node && projectile.node.isValid) {
                projectile.node.destroy();
            }
        }
        this._activeSpiralProjectiles.length = 0;
    }

    private pruneOldSpiralRings(): void {
        const maxVisibleRings = Math.max(1, Math.floor(this.spiralConfig.maxVisibleRings));
        const minRingIndex = this._spiralRingIndex - maxVisibleRings;
        if (minRingIndex <= 0) {
            return;
        }

        for (let i = this._activeSpiralProjectiles.length - 1; i >= 0; i -= 1) {
            const projectile = this._activeSpiralProjectiles[i];
            if (projectile.ringIndex >= minRingIndex) {
                continue;
            }

            if (projectile.node && projectile.node.isValid) {
                projectile.node.destroy();
            }
            this._activeSpiralProjectiles.splice(i, 1);
        }
    }

    private computeNextAttackCooldown(): number {
        const phaseProfile = this.getCurrentPhaseProfile();
        const base = this.combatConfig.attackIntervalBase * Math.max(0.1, phaseProfile.cooldownMultiplier);
        return Math.max(0.45, base * (0.82 + Math.random() * 0.35));
    }

    private getEffectiveDashSpeed(): number {
        return this.dashConfig.speed * (2 / 3);
    }

    private getCurrentPhase(): number {
        const hpRate = this.maxHp > 0 ? this.currentHp / this.maxHp : 1;
        if (hpRate <= this.phaseThreeConfig.threshold) {
            return 3;
        }
        if (hpRate <= this.phaseTwoConfig.threshold) {
            return 2;
        }
        return 1;
    }

    private getCurrentPhaseProfile(): BossPhaseProfile {
        const phase = this.getCurrentPhase();
        if (phase >= 3) {
            return this.phaseThreeConfig;
        }
        if (phase >= 2) {
            return this.phaseTwoConfig;
        }
        return this.phaseOneConfig;
    }

    private tryDealDashDamage(from: Vec3, to: Vec3): void {
        if (!Player.inst || !Player.inst.isAlive) {
            return;
        }

        const playerPos = Player.inst.node.worldPosition;
        const distance = this.distancePointToSegment(playerPos, from, to);
        if (distance > this.dashConfig.hitRadius) {
            return;
        }

        this.tryApplyDashHit(this._dashDirection);
    }

    onTrigger(b: cBody, trigger: Trigger): void {
        if (b.group === this.PLAYER && trigger !== Trigger.exit) {
            this.tryApplyDashHit();
            return;
        }

        super.onTrigger(b, trigger);
    }

    private tryApplyDashHit(direction?: Vec3): void {
        if (this._actionState !== BossActionState.Dash) {
            return;
        }

        const didHit = this.tryApplyPlayerHit(
            'dash',
            this.dashConfig.damage,
            this.dashConfig.hitInterval,
            this.dashConfig.knockbackStrength,
            this.dashConfig.knockbackDuration,
            0,
            direction,
            this.dashConfig.hitShakeStrength,
            this.dashConfig.hitShakeDuration,
        );

        if (didHit) {
            this._dashHasHit = true;
        }
    }

    private tryApplyPlayerHit(
        key: string,
        damage: number,
        interval: number,
        knockbackStrength: number,
        knockbackDuration: number,
        knockbackSustainDuration: number = 0,
        direction?: Vec3,
        shakeStrength: number = 0,
        shakeDuration: number = 0,
    ): boolean {
        if (!Player.inst || !Player.inst.isAlive) {
            return false;
        }

        if ((this._attackHitCooldowns.get(key) ?? 0) > 0) {
            return false;
        }

        if (!Player.inst.takeDamage(damage, this.node)) {
            return false;
        }

        tempPlayerHitKnockback.set(direction ?? areaAttackKnockbackDir);
        if (tempPlayerHitKnockback.lengthSqr() <= 0.001) {
            Vec3.subtract(tempPlayerHitKnockback, Player.inst.node.worldPosition, this.node.worldPosition);
            if (tempPlayerHitKnockback.lengthSqr() <= 0.001) {
                tempPlayerHitKnockback.set(1, -1, 0);
            }
        }
        tempPlayerHitKnockback.normalize();

        Player.inst.applyKnockback(
            tempPlayerHitKnockback,
            knockbackStrength,
            knockbackDuration,
            knockbackSustainDuration,
        );

        this._attackHitCooldowns.set(key, Math.max(0.03, interval));
        if (shakeStrength > 0 && shakeDuration > 0) {
            BulletHell.inst?.triggerCameraShake(shakeStrength, shakeDuration);
        }

        return true;
    }

    private updateActiveAreaHazards(dt: number): void {
        if (this._activeMeteorHazards.length > 0) {
            for (let i = this._activeMeteorHazards.length - 1; i >= 0; i -= 1) {
                const hazard = this._activeMeteorHazards[i];
                hazard.timer = Math.max(0, hazard.timer - dt);
                if (hazard.timer <= 0) {
                    this._activeMeteorHazards.splice(i, 1);
                    continue;
                }
            }

            this.applyMeteorHazardDamage();
        }

        if (this._activeNovaTimer > 0) {
            this._activeNovaTimer = Math.max(0, this._activeNovaTimer - dt);
            this.applyNovaHazardDamage();
        }
    }

    private applyMeteorHazardDamage(): void {
        if (!Player.inst || !Player.inst.isAlive) {
            return;
        }

        const playerPos = Player.inst.getPosition();
        for (const hazard of this._activeMeteorHazards) {
            if (Vec3.distance(playerPos, hazard.position) > this.meteorConfig.radius) {
                continue;
            }

            this.tryApplyPlayerHit(
                hazard.key,
                this.meteorConfig.damage,
                this.combatConfig.playerHitInterval,
                this.combatConfig.followupHitKnockbackStrength,
                this.combatConfig.followupHitKnockbackDuration,
                this.combatConfig.followupHitKnockbackSustainDuration,
                areaAttackKnockbackDir,
            );
        }
    }

    private applyNovaHazardDamage(): void {
        if (!Player.inst || !Player.inst.isAlive) {
            return;
        }

        if (Vec3.distance(Player.inst.getPosition(), this.getPosition()) > this.novaConfig.radius) {
            return;
        }

        this.tryApplyPlayerHit(
            'nova',
            this.novaConfig.damage,
            this.combatConfig.playerHitInterval,
            this.combatConfig.followupHitKnockbackStrength,
            this.combatConfig.followupHitKnockbackDuration,
            this.combatConfig.followupHitKnockbackSustainDuration,
            areaAttackKnockbackDir,
        );
    }

    private tickAttackHitCooldowns(dt: number): void {
        if (this._attackHitCooldowns.size <= 0) {
            return;
        }

        for (const [key, remaining] of [...this._attackHitCooldowns.entries()]) {
            const next = Math.max(0, remaining - dt);
            if (next <= 0) {
                this._attackHitCooldowns.delete(key);
                continue;
            }

            this._attackHitCooldowns.set(key, next);
        }
    }

    private applyFollowupAttackKnockback(): void {
        if (!Player.inst) {
            return;
        }

        tempPlayerHitKnockback.set(1, -1, 0);
        Player.inst.applyKnockback(
            tempPlayerHitKnockback,
            this.combatConfig.followupHitKnockbackStrength,
            this.combatConfig.followupHitKnockbackDuration,
            this.combatConfig.followupHitKnockbackSustainDuration,
        );
    }

    private distancePointToSegment(point: Vec3, from: Vec3, to: Vec3): number {
        const abx = to.x - from.x;
        const aby = to.y - from.y;
        const apx = point.x - from.x;
        const apy = point.y - from.y;
        const lengthSq = abx * abx + aby * aby;
        if (lengthSq <= 0.0001) {
            const dx = point.x - from.x;
            const dy = point.y - from.y;
            return Math.sqrt(dx * dx + dy * dy);
        }

        const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lengthSq));
        const closestX = from.x + abx * t;
        const closestY = from.y + aby * t;
        const dx = point.x - closestX;
        const dy = point.y - closestY;
        return Math.sqrt(dx * dx + dy * dy);
    }

    private ensureTelegraphNode(): void {
        if (this._telegraphNode && this._telegraphGraphics) {
            return;
        }

        const parent = BulletHell.inst?.node ?? this.node.parent;
        if (!parent) {
            return;
        }

        const node = new Node(`${this.node.name}-BossTelegraph`);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(2, 2);
        const graphics = node.addComponent(Graphics);
        graphics.lineWidth = 6;
        parent.addChild(node);
        node.setPosition(Vec3.ZERO);

        this._telegraphNode = node;
        this._telegraphGraphics = graphics;
    }

    private clearTelegraph(): void {
        if (!this._telegraphGraphics) {
            return;
        }

        this._telegraphGraphics.clear();
        if (this._telegraphNode) {
            this._telegraphNode.active = false;
        }
    }

    private drawTelegraph(dt: number): void {
        if (this._actionState !== BossActionState.Telegraph || this._attackType === BossAttackType.None) {
            this.clearTelegraph();
            return;
        }

        this.ensureTelegraphNode();
        if (!this._telegraphNode || !this._telegraphGraphics) {
            return;
        }

        this._telegraphPulse += dt;
        const glow = 0.55 + 0.45 * Math.sin(this._telegraphPulse * 15);
        const alpha = 110 + Math.floor(glow * 115);
        const graphics = this._telegraphGraphics;
        graphics.clear();
        graphics.lineWidth = 6;
        graphics.strokeColor = new Color(255, 96, 96, alpha);
        graphics.fillColor = new Color(255, 76, 76, Math.floor(alpha * 0.18));

        this._telegraphNode.active = true;
        this._telegraphNode.setPosition(Vec3.ZERO);

        if (this._attackType === BossAttackType.Dash) {
            graphics.moveTo(this.node.worldPosition.x, this.node.worldPosition.y);
            graphics.lineTo(this._lockedTargetPos.x, this._lockedTargetPos.y);
            graphics.stroke();
            graphics.circle(this._lockedTargetPos.x, this._lockedTargetPos.y, this.dashConfig.hitRadius * 0.75);
            graphics.fill();
            return;
        }

        if (this._attackType === BossAttackType.Meteor) {
            for (const target of this._meteorTargets) {
                graphics.circle(target.x, target.y, this.meteorConfig.radius);
                graphics.fill();
                graphics.stroke();
            }
            return;
        }

        if (this._attackType === BossAttackType.Spiral) {
            graphics.circle(this.node.worldPosition.x, this.node.worldPosition.y, 96);
            graphics.fill();
            graphics.stroke();
            graphics.circle(this.node.worldPosition.x, this.node.worldPosition.y, 156);
            graphics.stroke();
            return;
        }

        graphics.circle(this.node.worldPosition.x, this.node.worldPosition.y, this.novaConfig.radius);
        graphics.fill();
        graphics.stroke();
    }

    private setupAnimationController(): void {
        this._animation = this.getComponent(Animation) ?? this.getComponentInChildren(Animation);
        if (!this._animation) {
            return;
        }

        this._animation.off(Animation.EventType.FINISHED, this.onAnimationFinished, this);
        this._animation.on(Animation.EventType.FINISHED, this.onAnimationFinished, this);
    }

    private teardownAnimationController(): void {
        if (!this._animation) {
            return;
        }

        this._animation.off(Animation.EventType.FINISHED, this.onAnimationFinished, this);
    }

    private resetAnimationRuntimeState(): void {
        this._animationQueue.length = 0;
        this._currentAnimationName = '';
        this._currentAnimationLoop = false;
        this._animationLocked = false;
        this._lastVisualPhase = 1;
        this._pendingPhaseAngryTransition = false;
        this._wasMovingLastFrame = false;
        this._isSwitchingAnimation = false;
        this._openingIntroTimer = 0;
        this._openingIntroActive = false;
        this._openingShowcaseTimer = 0;
        this._dashWalkVisibleTimer = 0;
    }

    private updateAnimationState(dt: number): void {
        if (!this._animation || this.isDead || this.isDyingState) {
            return;
        }

        if (this._openingShowcaseTimer > 0) {
            this._openingShowcaseTimer = Math.max(0, this._openingShowcaseTimer - Math.max(0, dt));
        }

        if (this._dashWalkVisibleTimer > 0) {
            this._dashWalkVisibleTimer = Math.max(0, this._dashWalkVisibleTimer - Math.max(0, dt));
        }

        if (this._openingIntroActive) {
            this._openingIntroTimer -= Math.max(0, dt);
            if (this._openingIntroTimer <= 0) {
                this._openingIntroActive = false;
                this._animationLocked = false;
                this.ensureRageLoop();
            }
            return;
        }

        if (this._openingShowcaseTimer > 0) {
            this._wasMovingLastFrame = false;
            this.ensureRageLoop();
            return;
        }

        const currentPhase = this.getCurrentPhase();
        if (currentPhase > this._lastVisualPhase) {
            this._pendingPhaseAngryTransition = true;
            this._lastVisualPhase = currentPhase;
        }

        if (this._actionState === BossActionState.Telegraph) {
            this.playAttackTelegraphAnimation();
            return;
        }

        if (this._dashWalkVisibleTimer > 0) {
            this.transitionToMove(true);
            this._wasMovingLastFrame = true;
            return;
        }

        if (this._animationLocked) {
            return;
        }

        const isMoving = this._actionState === BossActionState.Dash
            || this.velocity.lengthSqr() >= Math.max(1, this.animationConfig.movingSpeedSqrThreshold);

        if (this._pendingPhaseAngryTransition && !isMoving && this._actionState !== BossActionState.Dash) {
            this._pendingPhaseAngryTransition = false;
            this.playAngryLoopIntro();
            this._wasMovingLastFrame = false;
            return;
        }

        if (isMoving) {
            if (!this._wasMovingLastFrame || !this.isCurrentAnimation(this.animationConfig.walkLoopClip, true)) {
                this.transitionToMove(this._actionState === BossActionState.Dash);
            }
            this._wasMovingLastFrame = true;
            return;
        }

        if (this._wasMovingLastFrame) {
            this.transitionToIdle();
            this._wasMovingLastFrame = false;
            return;
        }

        this.ensureRageLoop();
    }

    private playAttackTelegraphAnimation(): void {
        if (this._attackType === BossAttackType.Dash) {
            this.playDashTelegraphAnimation();
            return;
        }

        const clipName = this.resolveTelegraphClipName(this._attackType);
        if (!clipName) {
            return;
        }

        if (this._animationLocked && this._currentAnimationName === clipName) {
            return;
        }

        this.playSequence([{ name: clipName, loop: false }], true);
    }

    private playDashTelegraphAnimation(): void {
        const telegraphClip = this.resolveClipName(this.animationConfig.preAttackClip2);
        const walkClip = this.resolveClipName(this.animationConfig.walkLoopClip);

        if (!telegraphClip && !walkClip) {
            return;
        }

        if (this.isCurrentAnimation(telegraphClip, false) || this.isCurrentAnimation(walkClip, true) || this.hasQueuedAnimation(walkClip)) {
            return;
        }

        const sequence: Array<{ name: string; loop: boolean }> = [];
        if (telegraphClip) {
            sequence.push({ name: telegraphClip, loop: false });
        }
        if (walkClip) {
            sequence.push({ name: walkClip, loop: true });
        }

        this.playSequence(sequence, true);
    }

    private resolveTelegraphClipName(attackType: BossAttackType): string {
        if (attackType === BossAttackType.Meteor) {
            return this.resolveClipName(this.animationConfig.preAttackClip1);
        }
        return this.resolveClipName(this.animationConfig.preAttackClip2);
    }

    private playAngryLoopIntro(): void {
        const introClip = this.resolveClipName(this.animationConfig.idleToAngryClip);
        const rageClip = this.resolveClipName(this.animationConfig.rageLoopClip);
        if (introClip) {
            this._animationQueue.length = 0;
            this._openingIntroActive = true;
            this._openingIntroTimer = Math.max(0.05, this.getClipDuration(this.animationConfig.idleToAngryClip));
            this._animationLocked = true;
            this.playClip(introClip, false);
            return;
        }

        this._openingIntroActive = false;
        this._openingIntroTimer = 0;
        if (rageClip) {
            this.playSequence([{ name: rageClip, loop: true }], false);
        }
    }

    private playOpeningShowcaseAnimation(): void {
        this._openingIntroActive = false;
        this._openingIntroTimer = 0;
        this._animationQueue.length = 0;
        const rageClip = this.resolveClipName(this.animationConfig.rageLoopClip);
        if (rageClip) {
            this.playSequence([{ name: rageClip, loop: true }], false);
        }
    }

    private isOpeningShowcaseActive(): boolean {
        return this._openingIntroActive || this._openingShowcaseTimer > 0;
    }

    private transitionToMove(skipStartupTransition: boolean): void {
        const walkLoop = this.resolveClipName(this.animationConfig.walkLoopClip);
        if (!walkLoop) {
            return;
        }

        if (skipStartupTransition) {
            this.playSequence([{ name: walkLoop, loop: true }], false);
            return;
        }

        const startupClip = this.resolveClipName(this.animationConfig.idleToWalkClip);
        const sequence: Array<{ name: string; loop: boolean }> = [];
        if (startupClip) {
            sequence.push({ name: startupClip, loop: false });
        }
        sequence.push({ name: walkLoop, loop: true });
        this.playSequence(sequence, true);
    }

    private transitionToIdle(): void {
        const rageClip = this.resolveClipName(this.animationConfig.rageLoopClip);
        if (!rageClip) {
            return;
        }

        const stopClip = this.resolveClipName(this.animationConfig.walkToIdleClip);
        const sequence: Array<{ name: string; loop: boolean }> = [];
        if (stopClip) {
            sequence.push({ name: stopClip, loop: false });
        }
        sequence.push({ name: rageClip, loop: true });
        this.playSequence(sequence, true);
    }

    private ensureRageLoop(): void {
        const rageClip = this.resolveClipName(this.animationConfig.rageLoopClip);
        if (!rageClip) {
            return;
        }

        if (this.isCurrentAnimation(rageClip, true) || this._animationQueue.length > 0) {
            return;
        }

        this.playSequence([{ name: rageClip, loop: true }], false);
    }

    private playSequence(sequence: Array<{ name: string; loop: boolean }>, lockUntilLoopOrEnd: boolean): void {
        if (!this._animation) {
            return;
        }

        const filtered = sequence.filter(entry => !!entry.name);
        if (filtered.length <= 0) {
            return;
        }

        if (filtered.length === 1 && this.isCurrentAnimation(filtered[0].name, filtered[0].loop) && this._animationQueue.length === 0) {
            this._animationLocked = lockUntilLoopOrEnd && !filtered[0].loop;
            return;
        }

        this._animationQueue = filtered.slice(1);
        this._animationLocked = lockUntilLoopOrEnd && !filtered[0].loop;
        this.playClip(filtered[0].name, filtered[0].loop);
    }

    private playClip(clipName: string, loop: boolean): void {
        if (!this._animation || !clipName) {
            return;
        }

        this._isSwitchingAnimation = true;
        this._animation.stop();
        const state = this._animation.getState(clipName);
        if (state) {
            state.wrapMode = loop ? AnimationClip.WrapMode.Loop : AnimationClip.WrapMode.Normal;
            state.repeatCount = loop ? Infinity : 1;
        }

        this._currentAnimationName = clipName;
        this._currentAnimationLoop = loop;
        if (loop) {
            this._animationLocked = false;
        }
        this._animation.play(clipName);
        this._isSwitchingAnimation = false;
    }

    private onAnimationFinished(): void {
        if (this._isSwitchingAnimation) {
            return;
        }

        if (this._openingIntroActive) {
            return;
        }

        this._currentAnimationName = '';
        this._currentAnimationLoop = false;

        if (this._animationQueue.length > 0) {
            const next = this._animationQueue.shift();
            if (next) {
                this.playClip(next.name, next.loop);
                return;
            }
        }

        this._animationLocked = false;
    }

    private isCurrentAnimation(clipName: string, loop: boolean): boolean {
        return this._currentAnimationName === clipName && this._currentAnimationLoop === loop;
    }

    private hasQueuedAnimation(clipName: string): boolean {
        if (!clipName) {
            return false;
        }

        return this._animationQueue.some(entry => entry.name === clipName);
    }

    private resolveClipName(configuredClipName: string): string {
        if (!this._animation) {
            return '';
        }

        const wantedName = (configuredClipName || '').trim();
        if (!wantedName) {
            return '';
        }

        for (const clip of this._animation.clips) {
            if (clip?.name === wantedName) {
                return clip.name;
            }
        }

        return '';
    }

    private getClipDuration(configuredClipName: string): number {
        const clipName = this.resolveClipName(configuredClipName);
        if (!clipName || !this._animation) {
            return 0;
        }

        const state = this._animation.getState(clipName);
        if (state?.duration && Number.isFinite(state.duration)) {
            return state.duration;
        }

        const clip = this._animation.clips.find(entry => entry?.name === clipName);
        return clip?.duration ?? 0;
    }
}