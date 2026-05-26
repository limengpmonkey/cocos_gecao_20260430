// Enemy.ts - 修复版，直接添加状态控制
import { _decorator, Animation, instantiate, PhysicsSystem, Prefab, Quat, Vec3, CCInteger, Node, Sprite, Color, EventTarget, tween } from 'cc';
import { cBody } from '../../collision/Body';
import { cObject, Trigger } from '../../collision/Object';
import { BulletHell } from './bulletHell';
import { Player } from './player';
import { Bullet } from './bullet'; 
import { Skill } from './skill';
import { ExperienceSystem } from './ExperienceSystem';
import { GameStateManager, GameStateEvents } from './GameStateManager';
import { GameState } from './types';
import { EliteSkillType } from './balanceTable';
import { PixelPerfectScaler } from './PixelPerfectScaler';
const { ccclass, property } = _decorator;

const tempPos = new Vec3();
const tempRot = new Quat();
const tempDeathTargetPos = new Vec3();

export interface EnemyKilledEventData {
    enemyNode: Node;
    enemyType: string;
    collectionKey: string;
    collectionDisplayName: string;
    isRare: boolean;
    exp: number;
    score: number;
    isBoss: boolean;
    killedByPlayer: boolean;
}

export enum EnemyEvents {
    ON_KILLED = 'enemy-killed',
}

@ccclass('Enemy')
export class Enemy extends cObject {
    private static _events = new EventTarget();
    static normalVisualScaleMultiplier = 0.72;
    static bossVisualScaleMultiplier = 1.18;

    static on(event: EnemyEvents, callback: (...args: any[]) => void, target?: any): void {
        this._events.on(event, callback, target);
    }

    static off(event: EnemyEvents, callback?: (...args: any[]) => void, target?: any): void {
        this._events.off(event, callback, target);
    }

    static emit(event: EnemyEvents, data: EnemyKilledEventData): void {
        this._events.emit(event, data);
    }

    // 获取默认物理控制面板的分组信息
    PLAYER = PhysicsSystem.PhysicsGroup["player"];
    BULLET = PhysicsSystem.PhysicsGroup["bullet"];
    
    @property({ type: CCInteger, tooltip: "击杀获得经验值" })
    expValue: number = 10;

    @property({ type: CCInteger, tooltip: "击杀获得分数" })
    scoreValue: number = 10;
    
    /** 最大血量（编辑器可配置，子类可重写） */
    @property({ type: CCInteger, tooltip: "敌人最大血量" })
    maxHp: number = 20;

    @property({ tooltip: "同一伤害源命中间隔（秒）" })
    damageIntervalPerSource: number = 0.12;

    @property({ tooltip: "Boss 移动速度倍率（相对最大速度）" })
    bossMoveSpeedMultiplier: number = 0.55;

    @property({ tooltip: "Boss 贴近减速半径" })
    bossChaseSlowdownDistance: number = 120;

    @property({ tooltip: "Boss 受到伤害倍率（<1 更难击败）" })
    bossDamageTakenMultiplier: number = 0.65;

    @property({ tooltip: '普通小怪死亡时播放的 Animation 状态名；为空时尝试播放默认状态' })
    deathAnimationName: string = 'death';

    @property({ tooltip: '死亡动画兜底回收延迟（秒）' })
    deathAnimationFallbackDuration: number = 0.5;

    /** 当前血量（私有，通过只读属性暴露） */
    private _currentHp: number = 0;
    get currentHp(): number { return this._currentHp; }
    get isDead(): boolean { return this._currentHp <= 0; }

    /** 标记是否正在死亡处理中（防止重复处理） */
    private _isDying: boolean = false;
    private _isBoss: boolean = false;
    private _isElite: boolean = false;

    private _baseMaxHp: number = 0;
    private _baseExpValue: number = 0;
    private _baseScoreValue: number = 0;
    private _baseScale: Vec3 = new Vec3(1, 1, 1);
    private _visualScale: Vec3 = new Vec3(1, 1, 1);
    private _baseSpriteColor: Color = new Color(255, 255, 255, 255);
    private _bossSpriteColor: Color = new Color(255, 180, 80, 255);
    private _eliteSpriteColor: Color = new Color(120, 240, 255, 255);
    private _bossEntranceFlashColor: Color = new Color(255, 255, 255, 255);
    private readonly _hitFlashTintColor: Color = new Color(212, 224, 236, 255);
    
    // ✅ 新添加：游戏状态控制
    private _isGamePaused: boolean = false;
    private _pausedVelocity: Vec3 = new Vec3(0, 0, 0);

    // 击退相关（被技能击中时临时应用）
    private _knockbackVelocity: Vec3 = new Vec3(0, 0, 0);
    private _knockbackTimer: number = 0;
    private _bossEntranceTimer: number = 0;
    private _bossEntranceFlashTimer: number = 0;
    private _bossEntranceFlashOn: boolean = false;
    private _lastDamageTimeBySource: WeakMap<Node, number> = new WeakMap();
    private _lastDamageTimeNoSource: number = -9999;
    private _facingDirection: number = 1;
    private _difficultyHpMultiplier: number = 1;
    private _difficultySpeedMultiplier: number = 1;
    private _difficultyExpMultiplier: number = 1;
    private _difficultyScoreMultiplier: number = 1;
    private _eliteSkillType: EliteSkillType = EliteSkillType.Dash;
    private _eliteSkillCooldown: number = 3;
    private _eliteSkillTimer: number = 0;
    private _eliteDashTimer: number = 0;
    private _eliteExplodeRadius: number = 88;
    private _eliteExplodeDamage: number = 12;
    private _movementDebuffTimer: number = 0;
    private _movementDebuffMultiplier: number = 1;
    private _pendingSuctionDeathDuration: number = 0;
    private _hasPendingSuctionDeath: boolean = false;
    private _pendingSuctionDeathWorldTarget: Vec3 = new Vec3();
    private _collectionKey: string = '';
    private _collectionDisplayName: string = '';
    private _isRareCollectionTarget: boolean = false;

    get isBoss(): boolean { return this._isBoss; }
    get isElite(): boolean { return this._isElite; }
    get collectionKey(): string { return this._collectionKey; }
    get isRareCollectionTarget(): boolean { return this._isRareCollectionTarget; }
    
    onLoad(): void {
        // 调用父类的 onLoad
        super.onLoad();

        this.avoidSameGroupAgents = false;
        if (this.body) {
            this.body.avoidSameGroupAgents = false;
        }

        this._baseMaxHp = this.maxHp;
        this._baseExpValue = this.expValue;
        this._baseScoreValue = this.scoreValue;
        this._baseScale.set(this.node.scale);
        this._facingDirection = this._baseScale.x < 0 ? -1 : 1;

        const sprite = this.node.getComponent(Sprite);
        if (sprite) {
            this._baseSpriteColor = sprite.color.clone();
        }
        
        // ✅ 监听游戏状态变化
        this.setupGameStateListener();
    }
    
    onDestroy(): void {
        // 调用父类的 onDestroy
        super.onDestroy();
        
        // ✅ 移除监听
        this.removeGameStateListener();
    }
    
    /**
     * 设置游戏状态监听
     */
    private setupGameStateListener(): void {
        if (GameStateManager.inst) {
            GameStateManager.inst.on(GameStateEvents.STATE_CHANGED, this.onGameStateChanged, this);
        }
    }
    
    /**
     * 移除游戏状态监听
     */
    private removeGameStateListener(): void {
        if (GameStateManager.inst) {
            GameStateManager.inst.off(GameStateEvents.STATE_CHANGED, this.onGameStateChanged, this);
        }
    }
    
    /**
     * 游戏状态变化回调
     */
    private onGameStateChanged(event: any): void {
        const { newState, previousState, reason } = event;
        
        // console.log(`敌人 ${this.node.name} 状态变化: ${previousState} -> ${newState}`);
        
        if (newState === GameState.PAUSED) {
            this.onGamePaused();
        } else if (newState === GameState.RUNNING && previousState === GameState.PAUSED) {
            this.onGameResumed();
        }
    }
    
    /**
     * 游戏暂停处理
     */
    private onGamePaused(): void {
        if (this._isGamePaused) return;
        
        // console.log(`敌人 ${this.node.name} 暂停`);
        this._isGamePaused = true;
        
        // 保存当前速度
        this._pausedVelocity.set(this.velocity);
        
        // 设置速度为0，停止移动
        this.velocity.set(Vec3.ZERO);
    }
    
    /**
     * 游戏恢复处理
     */
    private onGameResumed(): void {
        if (!this._isGamePaused) return;
        
        // console.log(`敌人 ${this.node.name} 恢复`);
        this._isGamePaused = false;
        
        // 恢复之前的速度
        this.velocity.set(this._pausedVelocity);
        
        // 清空暂停时的速度记录
        this._pausedVelocity.set(Vec3.ZERO);
    }

    /**
     * 受到击退（由技能触发），会在短时间内按冲击方向移动
     */
    applyKnockback(dir: Vec3, strength: number, duration: number = 0.15): void {
        // 确保向量归一化
        const knockDirection = dir.clone();
        knockDirection.normalize();
        this._knockbackVelocity.set(knockDirection).multiplyScalar(strength);
        this._knockbackTimer = duration;
    }

    applyMovementDebuff(duration: number, speedMultiplier: number): void {
        if (this.isDead || this._isDying) {
            return;
        }

        this._movementDebuffTimer = Math.max(this._movementDebuffTimer, duration);
        this._movementDebuffMultiplier = Math.min(this._movementDebuffMultiplier, Math.max(0, speedMultiplier));
        if (this._movementDebuffMultiplier <= 0.0001) {
            this.tryVelocity.set(Vec3.ZERO);
            this.velocity.set(Vec3.ZERO);
        }
    }

    setSuctionDeathTarget(worldTarget: Vec3, duration: number = 0.28): void {
        this._pendingSuctionDeathWorldTarget.set(worldTarget);
        this._pendingSuctionDeathDuration = Math.max(0.05, duration);
        this._hasPendingSuctionDeath = true;
    }

    beginBossEntranceBuffer(duration: number): void {
        if (!this._isBoss) {
            return;
        }

        this._bossEntranceTimer = Math.max(0, duration);
        this._bossEntranceFlashTimer = 0;
        this._bossEntranceFlashOn = false;
        this.velocity.set(Vec3.ZERO);
        this.applyVisualState();
    }
    
    init(): void {
        // 兜底：避免对象池复用或初始化顺序异常导致 maxHp <= 0，进而生成即死亡无法移动
        if (this.maxHp <= 0) {
            this.maxHp = this._baseMaxHp > 0 ? this._baseMaxHp : 20;
        }

        if (!this._collectionKey) {
            this.resetCollectionMetadata();
        }

        this.applySpawnScaling();
        this._eliteSkillTimer = this._eliteSkillCooldown * (0.45 + Math.random() * 0.4);
        this._eliteDashTimer = 0;

        this._currentHp = this.maxHp;
        this._isDying = false;
        this._isGamePaused = false;
        this._bossEntranceTimer = 0;
        this._bossEntranceFlashTimer = 0;
        this._bossEntranceFlashOn = false;
        this._movementDebuffTimer = 0;
        this._movementDebuffMultiplier = 1;
        this._pendingSuctionDeathDuration = 0;
        this._hasPendingSuctionDeath = false;
        this._pendingSuctionDeathWorldTarget.set(Vec3.ZERO);
        this._lastDamageTimeBySource = new WeakMap();
        this._lastDamageTimeNoSource = -9999;
        this.resetReusableAnimationState();
        this.follow();//跟随速度和方向
        this.velocity.set(this.tryVelocity);

        // 某些生命周期顺序下 body.maxVelocity 可能首帧还未就绪，下一帧再强制刷新一次速度
        this.scheduleOnce(() => {
            if (this.isDead || this._isDying || this._isGamePaused) {
                return;
            }
            this.follow();
            this.velocity.set(this.tryVelocity);
        }, 0);

        this.applyVisualState();
    }

    private getReusableIdleAnimationName(animation: Animation): string {
        const deathStateName = this.deathAnimationName.trim().toLowerCase();
        const defaultName = animation.defaultClip?.name?.trim() || '';

        if (defaultName && defaultName.toLowerCase() !== deathStateName) {
            return defaultName;
        }

        for (const clip of animation.clips) {
            const clipName = clip?.name?.trim() || '';
            if (clipName && clipName.toLowerCase() !== deathStateName) {
                return clipName;
            }
        }

        return '';
    }

    private resetReusableAnimationState(): void {
        const animation = this.getComponent(Animation) ?? this.getComponentInChildren(Animation);
        if (!animation) {
            return;
        }

        animation.stop();

        const idleStateName = this.getReusableIdleAnimationName(animation);
        if (!idleStateName) {
            return;
        }

        animation.play(idleStateName);
    }

    private isPlayerAttack(attackerNode?: Node): boolean {
        if (!attackerNode) {
            return false;
        }

        if (attackerNode === (Player.inst && Player.inst.node)) {
            return true;
        }

        return !!attackerNode.getComponent(Bullet) || !!attackerNode.getComponent(Skill);
    }

    private isDamageIntervalReady(attackerNode?: Node): boolean {
        const now = performance.now() * 0.001;
        const interval = Math.max(0, this.damageIntervalPerSource);
        if (interval <= 0) {
            return true;
        }

        if (!attackerNode) {
            return now - this._lastDamageTimeNoSource >= interval;
        }

        const lastTime = this._lastDamageTimeBySource.get(attackerNode) ?? -9999;
        return now - lastTime >= interval;
    }

    private recordDamageTimestamp(attackerNode?: Node): void {
        const now = performance.now() * 0.001;
        if (!attackerNode) {
            this._lastDamageTimeNoSource = now;
            return;
        }
        this._lastDamageTimeBySource.set(attackerNode, now);
    }

    private applyVisualState(): void {
        const scaleMultiplier = this._isBoss ? Enemy.bossVisualScaleMultiplier : Enemy.normalVisualScaleMultiplier;
        const pixelPerfectScaler = this.getComponent(PixelPerfectScaler);
        const baseScale = pixelPerfectScaler ? pixelPerfectScaler.originalScale : this._baseScale;
        const pixelScaleMultiplier = pixelPerfectScaler ? pixelPerfectScaler.scaleMultiplier : 1;

        this._visualScale.set(
            Math.abs(baseScale.x) * scaleMultiplier * pixelScaleMultiplier * this._facingDirection,
            baseScale.y * scaleMultiplier * pixelScaleMultiplier,
            baseScale.z * pixelScaleMultiplier
        );
        this.node.setScale(this._visualScale);

        const sprite = this.node.getComponent(Sprite);
        if (!sprite) {
            return;
        }

        if (this._isBoss && this._bossEntranceTimer > 0) {
            sprite.color = this._bossEntranceFlashOn ? this._bossEntranceFlashColor : this._bossSpriteColor;
            return;
        }

        if (this._isBoss) {
            sprite.color = this._bossSpriteColor;
            return;
        }

        sprite.color = this._isElite ? this._eliteSpriteColor : this._baseSpriteColor;
    }

    setDifficultyScaling(hpMultiplier: number, speedMultiplier: number, expMultiplier: number, scoreMultiplier: number): void {
        this._difficultyHpMultiplier = Math.max(0.2, hpMultiplier || 1);
        this._difficultySpeedMultiplier = Math.max(0.2, speedMultiplier || 1);
        this._difficultyExpMultiplier = Math.max(0.2, expMultiplier || 1);
        this._difficultyScoreMultiplier = Math.max(0.2, scoreMultiplier || 1);
    }

    setCollectionMetadata(collectionKey: string, displayName?: string, isRare: boolean = false): void {
        this._collectionKey = (collectionKey || this.constructor.name).trim();
        this._collectionDisplayName = (displayName || this.node?.name || this.constructor.name).trim();
        this._isRareCollectionTarget = !!isRare;
    }

    resetCollectionMetadata(): void {
        this._collectionKey = this.constructor.name;
        this._collectionDisplayName = this.node?.name || this.constructor.name;
        this._isRareCollectionTarget = false;
    }

    setEliteMode(
        enabled: boolean,
        skillType: EliteSkillType = EliteSkillType.Dash,
        skillCooldown: number = 3,
        explodeRadius: number = 88,
        explodeDamage: number = 12
    ): void {
        this._isElite = enabled;
        this._eliteSkillType = skillType;
        this._eliteSkillCooldown = Math.max(0.8, skillCooldown);
        this._eliteSkillTimer = this._eliteSkillCooldown * (0.45 + Math.random() * 0.4);
        this._eliteDashTimer = 0;
        this._eliteExplodeRadius = Math.max(16, explodeRadius);
        this._eliteExplodeDamage = Math.max(1, Math.floor(explodeDamage));
        this.applyVisualState();
    }

    /**
     * 统一设置普通敌人/Boss数值，便于对象池复用时重置。
     */
    setBossMode(enabled: boolean, hpMultiplier: number = 1, expMultiplier: number = 1, scoreMultiplier: number = 1): void {
        // 延迟捕获基础值，避免某些实例生命周期顺序导致基础值被记录为 0
        if (this._baseMaxHp <= 0) {
            this._baseMaxHp = this.maxHp > 0 ? this.maxHp : 20;
        }
        if (this._baseExpValue <= 0) {
            this._baseExpValue = this.expValue > 0 ? this.expValue : 1;
        }
        if (this._baseScoreValue <= 0) {
            this._baseScoreValue = this.scoreValue > 0 ? this.scoreValue : 1;
        }

        this._isBoss = enabled;

        this.maxHp = this._baseMaxHp;
        this.expValue = this._baseExpValue;
        this.scoreValue = this._baseScoreValue;

        if (!enabled) {
            this.applyVisualState();
            return;
        }

        this.maxHp = Math.max(1, Math.floor(this.maxHp * Math.max(1, hpMultiplier)));
        this.expValue = Math.max(1, Math.floor(this.expValue * Math.max(1, expMultiplier)));
        this.scoreValue = Math.max(1, Math.floor(this.scoreValue * Math.max(1, scoreMultiplier)));
        this.applyVisualState();
    }

    private applySpawnScaling(): void {
        if (this._isBoss) {
            return;
        }

        this.maxHp = Math.max(1, Math.floor(this.maxHp * this._difficultyHpMultiplier));
        this.expValue = Math.max(1, Math.floor(this.expValue * this._difficultyExpMultiplier));
        this.scoreValue = Math.max(1, Math.floor(this.scoreValue * this._difficultyScoreMultiplier));
    }

    private updateEliteSkill(dt: number): void {
        if (!this._isElite || this._isBoss) {
            return;
        }

        if (this._eliteDashTimer > 0) {
            this._eliteDashTimer = Math.max(0, this._eliteDashTimer - dt);
        }

        this._eliteSkillTimer -= dt;
        if (this._eliteSkillTimer > 0) {
            return;
        }

        this._eliteSkillTimer = this._eliteSkillCooldown;

        if (this._eliteSkillType === EliteSkillType.Dash) {
            this._eliteDashTimer = 0.38;
            return;
        }

        if (!Player.inst || !Player.inst.isAlive) {
            return;
        }

        const distance = Vec3.distance(this.node.worldPosition, Player.inst.node.worldPosition);

        if (this._eliteSkillType === EliteSkillType.Ranged) {
            if (distance <= 520) {
                Player.inst.takeDamage(6, this.node);
            }
            return;
        }

        if (this._eliteSkillType === EliteSkillType.Explode) {
            if (distance <= this._eliteExplodeRadius) {
                Player.inst.takeDamage(Math.max(1, Math.floor(this._eliteExplodeDamage * 0.6)), this.node);
            }
        }
    }

    update(dt: number) {
        // ✅ 检查游戏是否暂停
        if (this._isGamePaused) {
            return;
        }
        
        if (this.isDead || this._isDying) return;

        this.updateEliteSkill(dt);

        if (this._movementDebuffTimer > 0) {
            this._movementDebuffTimer = Math.max(0, this._movementDebuffTimer - dt);
            if (this._movementDebuffTimer <= 0) {
                this._movementDebuffMultiplier = 1;
            }
        }

        if (this._bossEntranceTimer > 0) {
            this._bossEntranceTimer = Math.max(0, this._bossEntranceTimer - dt);
            this._bossEntranceFlashTimer += dt;
            if (this._bossEntranceFlashTimer >= 0.08) {
                this._bossEntranceFlashTimer = 0;
                this._bossEntranceFlashOn = !this._bossEntranceFlashOn;
                this.applyVisualState();
            }

            this.velocity.set(Vec3.ZERO);
            if (this._bossEntranceTimer <= 0) {
                this._bossEntranceFlashOn = false;
                this.applyVisualState();
                this.follow();
                this.velocity.set(this.tryVelocity);
            }
            return;
        }
        
        // 如果正在受到击退效果，优先使用击退速度
        if (this._knockbackTimer > 0) {
            this._knockbackTimer -= dt;
            this.velocity.set(this._knockbackVelocity);
            // 逐渐衰减击退速度
            this._knockbackVelocity.multiplyScalar(0.85);
        } else {
            // 正常跟随逻辑
            this.follow();
        }

        // 计算新位置
        let pos = this.getPosition();
        let velocity = this.velocity;
        tempPos.x = pos.x + velocity.x * dt;
        tempPos.y = pos.y + velocity.y * dt;
        tempPos.z = pos.z + velocity.z * dt;
        if (this._isBoss) {
            BulletHell.inst?.clampPositionToBossArena(tempPos);
        }
        this.setPosition(tempPos);
    }

    //跟随主角
    follow() {
        if (this.isDead || this._isDying) return;
        if (!Player.inst || !Player.inst.node) return;
        
        // ✅ 检查游戏是否暂停
        if (this._isGamePaused) {
            return;
        }
        
        let pos = this.node.worldPosition; 
        let tartet = Player.inst.node.worldPosition;
        Vec3.subtract(this.tryVelocity, tartet, pos);
        const distanceToPlayer = this.tryVelocity.length();
        if (distanceToPlayer <= 0.0001) {
            this.tryVelocity.set(Vec3.ZERO);
            this.velocity.set(Vec3.ZERO);
            return;
        }
        this.tryVelocity.multiplyScalar(1 / distanceToPlayer);

        // 优先使用 body 中的最大速度，异常时回退到组件配置，最后使用安全默认值
        let maxVelocity = this.body?.maxVelocity ?? 0;
        if (maxVelocity <= 0) {
            maxVelocity = this.maxVelocity > 0 ? this.maxVelocity : 80;
        }

        if (!this._isBoss) {
            const speedMultiplier = Math.max(0.05, BulletHell.inst?.enemyMoveSpeedMultiplier ?? 1);
            maxVelocity *= speedMultiplier;
            maxVelocity *= this._difficultySpeedMultiplier;
            if (this._isElite) {
                maxVelocity *= 1.08;
                if (this._eliteDashTimer > 0) {
                    maxVelocity *= 2.3;
                }
            }
        } else {
            const bossSpeedMultiplier = Math.max(0.05, this.bossMoveSpeedMultiplier);
            maxVelocity *= bossSpeedMultiplier;

            const slowdownDist = Math.max(1, this.bossChaseSlowdownDistance);
            if (distanceToPlayer < slowdownDist) {
                maxVelocity *= distanceToPlayer / slowdownDist;
            }
        }
        maxVelocity *= this._movementDebuffMultiplier;
        this.tryVelocity.multiplyScalar(maxVelocity);
    
        // 只在朝向变化时翻面，避免每帧触发缩放脏标记导致碰撞体持续重建和抖动。
        const desiredFacing = this.tryVelocity.x < 0 ? -1 : 1;
        if (desiredFacing !== this._facingDirection) {
            this._facingDirection = desiredFacing;
            this.applyVisualState();
        }
    }

    /**
     * 受攻击扣血方法
     */
    takeDamage(damage: number, attackerNode?: Node): void {
        if (this.isDead || this._isDying) return;
        if (this._isBoss && this._bossEntranceTimer > 0) return;
        if (!this.isDamageIntervalReady(attackerNode)) return;
        this.recordDamageTimestamp(attackerNode);

        let actualDamage = damage;
        if (this._isBoss) {
            actualDamage = Math.max(1, Math.floor(damage * Math.max(0.05, this.bossDamageTakenMultiplier)));
        }

        // 扣血并保证血量不小于0
        this._currentHp = Math.max(0, this._currentHp - actualDamage);
        // console.log(`${this.node.name} 受攻击，当前血量：${this._currentHp}/${this.maxHp}`);

        // 受击回调（子类可重写）
        this.onTakeDamage(actualDamage, attackerNode);

        // 播放命中特效
        this.playHitEffect();

        // 血量为0触发死亡
        if (this._currentHp <= 0 && !this._isDying) {
            this._isDying = true;
            this.onDie(attackerNode);
        }
    }

    /** 
     * 死亡逻辑（模板方法）
     * 1. 播放死亡动画/特效
     * 2. 调用回收方法
     */
    protected onDie(attackerNode?: Node): void {
        // console.log(`${this.node.name} 死亡，击杀者：${attackerNode?.name || "未知"}`);
        // 给玩家加经验
        if (ExperienceSystem.inst && attackerNode) {
            // 这里需要判断是否是玩家击杀
            ExperienceSystem.inst.addExp(this.expValue, this.constructor.name);

            // 通知玩家触发的技能系统（用于被动技能触发）
            if (this.isPlayerAttack(attackerNode)) {
                Player.inst?.onEnemyKilled(this.node);
            }
        }

        const killedByPlayer = this.isPlayerAttack(attackerNode);

        if (this._isElite && this._eliteSkillType === EliteSkillType.Explode && Player.inst && Player.inst.isAlive) {
            const distance = Vec3.distance(this.node.worldPosition, Player.inst.node.worldPosition);
            if (distance <= this._eliteExplodeRadius) {
                Player.inst.takeDamage(this._eliteExplodeDamage, this.node);
            }
        }

        Enemy.emit(EnemyEvents.ON_KILLED, {
            enemyNode: this.node,
            enemyType: this.constructor.name,
            collectionKey: this._collectionKey || this.constructor.name,
            collectionDisplayName: this._collectionDisplayName || this.node.name || this.constructor.name,
            isRare: this._isRareCollectionTarget,
            exp: this.expValue,
            score: this.scoreValue,
            isBoss: this._isBoss,
            killedByPlayer,
        });
        
        // 1. 停止所有移动和AI
        this.velocity.set(Vec3.ZERO);
        this.tryVelocity.set(Vec3.ZERO);
        if (this._hasPendingSuctionDeath) {
            const parent = this.node.parent;
            if (parent) {
                Vec3.subtract(tempDeathTargetPos, this._pendingSuctionDeathWorldTarget, parent.worldPosition);
                const targetScale = this.node.scale.clone().multiplyScalar(0.18);
                tween(this.node)
                    .stop()
                    .to(this._pendingSuctionDeathDuration, { position: tempDeathTargetPos, scale: targetScale }, { easing: 'quadIn' })
                    .call(() => this.recycle())
                    .start();
                this._hasPendingSuctionDeath = false;
                return;
            }
        }

        this.playDeathEffect(attackerNode, () => {
            this.recycle();
        });
    }
    
    /** 
     * 播放死亡效果（钩子方法，可被子类重写）
     * @param attackerNode 攻击者
     * @param onComplete 动画完成后的回调
     */
    protected playDeathEffect(attackerNode?: Node, onComplete?: () => void): void {
        if (this._isBoss) {
            if (onComplete) onComplete();
            return;
        }

        const animation = this.getComponent(Animation) ?? this.getComponentInChildren(Animation);
        if (!animation) {
            if (onComplete) onComplete();
            return;
        }

        const stateName = this.deathAnimationName.trim() || animation.defaultClip?.name || animation.clips[0]?.name || '';
        if (!stateName) {
            if (onComplete) onComplete();
            return;
        }

        const finish = () => {
            animation.off(Animation.EventType.FINISHED, onAnimationFinished, this);
            this.unschedule(onAnimationFallback);
            if (onComplete) onComplete();
        };

        const onAnimationFinished = () => {
            finish();
        };

        const onAnimationFallback = () => {
            finish();
        };

        animation.off(Animation.EventType.FINISHED, onAnimationFinished, this);
        animation.on(Animation.EventType.FINISHED, onAnimationFinished, this);
        animation.play(stateName);
        this.scheduleOnce(onAnimationFallback, Math.max(0.05, this.deathAnimationFallbackDuration));
    }
    
    /** 
     * 回收方法（抽象方法，必须被子类实现）
     */
    protected recycle(): void {
        // 取消所有待处理的定时器
        this.unscheduleAllCallbacks();
        // 父类不实现具体回收逻辑
        // 子类必须重写此方法，调用自己的对象池
        // console.warn(`${this.constructor.name} 没有实现recycle方法！`);
    }
    
    /** 受击回调（钩子方法，子类可重写） */
    protected onTakeDamage(damage: number, attackerNode?: Node): void {
        // 空实现，子类可重写（如播放受击动画、音效）
    }

    /** 播放被击中特效（缩放+闪烁） */
    protected playHitEffect(): void {
        const sprite = this.node.getComponent(Sprite) ?? this.node.getComponentInChildren(Sprite);
        const originalScale = this.node.scale.clone();

        // 缩放效果
        const effectScale = originalScale.clone();
        effectScale.multiplyScalar(1.15);
        this.node.setScale(effectScale);

        this.scheduleOnce(() => {
            this.node.setScale(originalScale);
        }, 0.1);

        // 保留原来的“放大一下再恢复”，颜色改成更克制的浅灰蓝。
        if (sprite) {
            const originalColor = sprite.color.clone();
            sprite.color = new Color(
                this._hitFlashTintColor.r,
                this._hitFlashTintColor.g,
                this._hitFlashTintColor.b,
                originalColor.a
            );
            this.scheduleOnce(() => {
                if (!sprite || !sprite.isValid) {
                    return;
                }

                sprite.color = originalColor;
            }, 0.1);
        }
    }

    /** 修复所有类型报错的碰撞触发逻辑 */
    onTrigger(b: cBody, trigger: Trigger) {
        // 过滤退出触发/已死亡的情况
        if (trigger === Trigger.exit || this.isDead || this._isDying) return;
        // 容错：cBody 未关联 cObject 直接返回
        if (!b.object) {
            // console.warn("cBody 未关联 cObject，无法获取节点");
            return;
        }

        switch (b.group) {
            case this.BULLET: // 碰到子弹或技能投射物
                // 1. 正确获取子弹节点（cBody -> cObject -> Node）
                const bulletNode = b.object.node;

                // 2. 尝试获取 Bullet/Skill 组件，优先读取伤害值
                const bulletComp = bulletNode.getComponent(Bullet);
                const skillComp = bulletNode.getComponent(Skill) as any;

                const bulletDamage = bulletComp?.damage ?? skillComp?.damage ?? 10;

                // 3. 扣血
                this.takeDamage(bulletDamage, bulletNode);

                // 4. 回收投射物
                if (bulletComp) {
                    Bullet.put(bulletComp);
                } else if (skillComp) {
                    // Skill 投射物通常希望击中一次后消失
                    (skillComp.constructor as any).put?.(skillComp);
                }
                break;

            case this.PLAYER: // 碰到玩家
                // 需求：玩家身体碰到敌人时，敌人不受伤；玩家受伤由 Player.onTrigger 统一处理。
                break;
        }
    }
}