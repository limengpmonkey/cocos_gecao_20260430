import { Input, Prefab, Quat, Vec3, _decorator, CCInteger, PhysicsSystem, EventTarget, Component, Node, Renderer } from 'cc';
import { cBody } from '../../collision/Body';
import { Trigger, cObject } from '../../collision/Object';
import { BulletHell } from './bulletHell';
import { Gun } from './gun';
import { Skill } from './skill';
import { SkillManager } from './skills/SkillManager';
import { TemporaryPickup } from './TemporaryPickup';

const { ccclass, property } = _decorator;

const tempPos = new Vec3();
const tempRot = new Quat();
type EventCallback = (...args: any[]) => void;
// 玩家状态枚举
enum PlayerState {
    ALIVE = 'alive',
    INVINCIBLE = 'invincible', // 无敌状态（受伤后短暂无敌）
    DEAD = 'dead',
    RESPAWNING = 'respawning' // 重生中
}

// 玩家血量相关事件
export class PlayerHealthEvents {
    public static readonly ON_TAKE_DAMAGE = 'onTakeDamage';
    public static readonly ON_HEAL = 'onHeal';
    public static readonly ON_DEATH = 'onDeath';
    public static readonly ON_RESPAWN = 'onRespawn';
    public static readonly ON_INVINCIBLE_START = 'onInvincibleStart';
    public static readonly ON_INVINCIBLE_END = 'onInvincibleEnd';
}

@ccclass('Player')
export class Player extends cObject {
    // 单例模式
    private static _inst: Player = null;
    static get inst() {
        return this._inst;
    }
    private _renderers: Renderer[] = [];
    private _invincibleTimerCallback: () => void = null;
    private _invincibleBlinkCallback: () => void = null;
    ENEMYGROUP = PhysicsSystem.PhysicsGroup["enemy"];
    // ================== 血量相关属性 ==================
    /** 最大血量 */
    @property({ type: CCInteger, tooltip: "玩家最大血量" })
    maxHp: number = 100;
    
    /** 当前血量（私有） */
    private _currentHp: number = 0;
    
    /** 护盾值（可选，可扩展） */
    @property({ type: CCInteger, tooltip: "护盾值" })
    shield: number = 0;
    
    /** 无敌时间（秒） */
    @property({ type: CCInteger, tooltip: "受伤后无敌时间（秒）" })
    invincibleTime: number = 2;
    
    /** 重生时间（秒） */
    @property({ type: CCInteger, tooltip: "死亡后重生时间（秒）" })
    respawnTime: number = 3;

    /** 身体接触敌人时的伤害间隔（秒） */
    @property({ tooltip: "身体接触伤害冷却（秒）" })
    contactDamageCooldown: number = 0.5;

    private _contactDamageCooldownLeft: number = 0;
    
    /** 当前玩家状态 */
    private _state: PlayerState = PlayerState.ALIVE;
    
    /** 事件系统 */
    private _eventTarget: EventTarget = new EventTarget();
    
    // ================== 原有属性 ==================
    @property(Prefab)
    skill: Prefab = null;

    guns: Array<Gun> = [];
    velocity: Vec3 = new Vec3();

    /** 技能管理 */
    skillManager: SkillManager = null;

    /** 临时增伤倍率（1 = 无增伤） */
    private _temporaryDamageMultiplier = 1;
    private _temporaryDamageTimeLeft = 0;
    
    // ================== 血量相关Getter ==================
    get currentHp(): number { return this._currentHp; }
    get hpPercentage(): number { return this._currentHp / this.maxHp; }
    get isAlive(): boolean { return this._state !== PlayerState.DEAD; }
    get isInvincible(): boolean { return this._state === PlayerState.INVINCIBLE; }
    get state(): PlayerState { return this._state; }

    // ================== 生命周期方法 ==================
    onLoad(): void {
        super.onLoad();
        Player._inst = this;
        this._renderers = this.node.getComponentsInChildren(Renderer);
        // 初始化血量
        this._currentHp = this.maxHp;
        this._state = PlayerState.ALIVE;
        
        // 重置护盾
        this.shield = 0;

        // 初始化技能管理器（如果场景中没有附加，也自动添加一个）
        this.skillManager = this.getComponent(SkillManager) || this.addComponent(SkillManager);
    }

    start(): void {
        // 获取当前枪枝
        this.guns = this.node.getComponentsInChildren(Gun);

        // 绑定摇杆回调
        const joystick = BulletHell.inst.joystick;
        if (joystick) {
            joystick.init((event) => {
                let angle = event.angle;
                let ratio = event.ratio;
                switch (event.type) {
                    case Input.EventType.TOUCH_START:
                        this.velocity.set(Vec3.ZERO);
                        break;
                    case Input.EventType.TOUCH_MOVE:
                        this.velocity.set(Math.cos(angle), Math.sin(angle), 0);
                        this.velocity.multiplyScalar(this.maxVelocity * ratio);
                        break;
                    case Input.EventType.TOUCH_END:
                        this.velocity.set(Vec3.ZERO);
                        break;
                }
            });
        }
    }

    update(dt: number): void {
        // 如果玩家死亡，不执行移动逻辑
        if (this._state === PlayerState.DEAD) {
            this.velocity.set(Vec3.ZERO);
            return;
        }

        if (this._temporaryDamageTimeLeft > 0) {
            this._temporaryDamageTimeLeft = Math.max(0, this._temporaryDamageTimeLeft - dt);
            if (this._temporaryDamageTimeLeft <= 0) {
                this._temporaryDamageMultiplier = 1;
            }
        }

        if (this._contactDamageCooldownLeft > 0) {
            this._contactDamageCooldownLeft = Math.max(0, this._contactDamageCooldownLeft - dt);
        }
        
        // 计算新位置
        let pos = this.getPosition();
        let velocity = this.velocity;

        tempPos.x = pos.x + velocity.x * dt;
        tempPos.y = pos.y + velocity.y * dt;
        tempPos.z = pos.z + velocity.z * dt;

        BulletHell.inst?.clampPositionToBossArena(tempPos);

        this.setPosition(tempPos);
    }

    // ================== 血量核心方法 ==================
    
    /**
     * 玩家受到伤害
     * @param damage 伤害值
     * @param attacker 攻击者节点（可选）
     * @returns 是否实际造成了伤害
     */
    takeDamage(damage: number, attacker?: Node): boolean {
        // 无敌状态或死亡状态不受伤害
        if (this.isInvincible || !this.isAlive) {
            return false;
        }
        
        console.log(`玩家受到 ${damage} 点伤害，攻击者: ${attacker?.name || "未知"}`);
        
        let actualDamage = damage;
        
        // 先扣除护盾
        if (this.shield > 0) {
            if (this.shield >= damage) {
                this.shield -= damage;
                actualDamage = 0;
            } else {
                actualDamage = damage - this.shield;
                this.shield = 0;
            }
        }
        
        // 扣除实际血量
        if (actualDamage > 0) {
            this._currentHp = Math.max(0, this._currentHp - actualDamage);
        }
        
        // 触发受伤事件
        this._eventTarget.emit(PlayerHealthEvents.ON_TAKE_DAMAGE, {
            damage: damage,
            actualDamage: actualDamage,
            attacker: attacker,
            currentHp: this._currentHp,
            maxHp: this.maxHp,
            shield: this.shield
        });

        // 通知技能管理器被动技能
        this.skillManager?.notifyOwnerDamaged(actualDamage);
        
        // 播放受伤特效
        this.playHitEffect();
        
        // 检查是否死亡
        if (this._currentHp <= 0) {
            this.onDeath(attacker);
            return true;
        }
        
        // 进入无敌状态
        // this.enterInvincibleState();
        
        return true;
    }
    
    /**
     * 治疗玩家
     * @param healAmount 治疗量
     */
    heal(healAmount: number): void {
        if (!this.isAlive) return;
        
        const oldHp = this._currentHp;
        this._currentHp = Math.min(this.maxHp, this._currentHp + healAmount);
        const actualHeal = this._currentHp - oldHp;
        
        if (actualHeal > 0) {
            console.log(`玩家恢复 ${actualHeal} 点血量`);
            
            // 触发治疗事件
            this._eventTarget.emit(PlayerHealthEvents.ON_HEAL, {
                healAmount: healAmount,
                actualHeal: actualHeal,
                currentHp: this._currentHp,
                maxHp: this.maxHp
            });
            
            // 播放治疗特效
            this.playHealEffect();
        }
    }
    
    /**
     * 增加护盾
     * @param shieldAmount 护盾值
     */
    addShield(shieldAmount: number): void {
        this.shield += shieldAmount;
        console.log(`玩家获得 ${shieldAmount} 点护盾，当前护盾: ${this.shield}`);
    }
    
    /**
     * 死亡处理
     */
    private onDeath(attacker?: Node): void {
        console.log(`玩家死亡，击杀者: ${attacker?.name || "未知"}`);
        
        // 更新状态
        this._state = PlayerState.DEAD;
        
        // 停止所有移动
        this.velocity.set(Vec3.ZERO);
        
        // 禁用所有枪械
        this.disableAllGuns();
        
        // 触发死亡事件
        this._eventTarget.emit(PlayerHealthEvents.ON_DEATH, {
            attacker: attacker
        });
        
        // 播放死亡动画
        this.playDeathAnimation().then(() => {
            // 开始重生计时
            this.scheduleOnce(() => {
                this.respawn();
            }, this.respawnTime);
        });
    }
    
    /**
     * 重生
     */
    private respawn(): void {
        console.log("玩家重生");

        // 如果之前被隐藏，确保重新激活
        this.node.active = true;

        // 更新状态
        this._state = PlayerState.ALIVE;

        // 恢复血量
        this._currentHp = this.maxHp;
        this.shield = 0;

        // 启用所有枪械
        this.enableAllGuns();

        // 设置重生位置（这里设置为场景中心，可根据需求调整）
        this.setPosition(Vec3.ZERO);

        // 触发重生事件
        this._eventTarget.emit(PlayerHealthEvents.ON_RESPAWN, {
            respawnPosition: this.getPosition()
        });

        // 重生后短暂无敌
        this.enterInvincibleState();
    }
    
    /**
     * 进入无敌状态
     */
    private enterInvincibleState(): void {
        if (this._state === PlayerState.INVINCIBLE) return;
        this._state = PlayerState.INVINCIBLE;

        this._eventTarget.emit(PlayerHealthEvents.ON_INVINCIBLE_START);
        this.playInvincibleEffect();

        if (this._invincibleTimerCallback) {
            this.unschedule(this._invincibleTimerCallback);
        }
        this._invincibleTimerCallback = () => {
            this.exitInvincibleState();
        };
        this.scheduleOnce(this._invincibleTimerCallback, this.invincibleTime);
    }
    
    /**
     * 退出无敌状态
     */
    private exitInvincibleState(): void {
        if (this._state !== PlayerState.INVINCIBLE) return;

        this._state = PlayerState.ALIVE;
        this._eventTarget.emit(PlayerHealthEvents.ON_INVINCIBLE_END);

        this.stopInvincibleEffect();
    }
    
    // ================== 特效方法（需实现） ==================
    
    /** 播放受伤特效 */
    private playHitEffect(): void {
        // 实现：屏幕闪烁、红色闪屏、受伤音效等
        console.log("播放受伤特效");
    }
    
    /** 播放治疗特效 */
    private playHealEffect(): void {
        // 实现：绿色光芒、治疗音效等
        console.log("播放治疗特效");
    }
    
    /** 播放死亡动画 */
    private async playDeathAnimation(): Promise<void> {
        // 实现：死亡动画、爆炸特效、游戏结束UI等
        console.log("播放死亡动画");
        return new Promise(resolve => {
            this.scheduleOnce(() => resolve(), 1.0);
        });
    }
    
    /** 播放无敌特效（闪烁） */
    private playInvincibleEffect(): void {
        console.log("播放无敌闪烁特效");

        let blinkCount = 0;
        const maxBlinks = this.invincibleTime * 5;

        this._invincibleBlinkCallback = () => {
            // 只切换渲染器的 enabled，不去改 node.active
            const enabled = !this._renderers[0]?.enabled;
            for (const r of this._renderers) {
                r.enabled = enabled;
            }

            blinkCount++;
            if (blinkCount >= maxBlinks) {
                this.stopInvincibleEffect();
            }
        };

        this.schedule(this._invincibleBlinkCallback, 0.1);
    }
    
    /** 停止无敌特效 */
    private stopInvincibleEffect(): void {
        if (this._invincibleBlinkCallback) {
            this.unschedule(this._invincibleBlinkCallback);
            this._invincibleBlinkCallback = null;
        }
        if (this._invincibleTimerCallback) {
            this.unschedule(this._invincibleTimerCallback);
            this._invincibleTimerCallback = null;
        }
        
                // 结束后确保渲染器都重新打开
        for (const r of this._renderers) {
            r.enabled = true;
        }
    }
    
    // ================== 枪械控制 ==================
    
    /** 禁用所有枪械 */
    private disableAllGuns(): void {
        for (const gun of this.guns) {
            gun.enabled = false;
        }
    }
    
    /** 启用所有枪械 */
    private enableAllGuns(): void {
        for (const gun of this.guns) {
            gun.enabled = true;
        }
    }
    
    // ================== 事件监听 ==================
    
    /**
     * 监听玩家血量事件
     * @param event 事件类型
     * @param callback 回调函数
     * @param target 目标对象
     */
    on(event: string, callback: EventCallback, target?: any): void {
        this._eventTarget.on(event, callback, target);
    }
    
    /**
     * 取消监听玩家血量事件
     * @param event 事件类型
     * @param callback 回调函数
     * @param target 目标对象
     */
    off(event: string, callback: EventCallback, target?: any): void {
        this._eventTarget.off(event, callback, target);
    }
    
    // ================== 原有方法 ==================
    
    onAttack(b: cBody) {
        // 如果死亡，不能攻击
        if (!this.isAlive) return;
        
        // 进入攻击范围
        let guns = this.guns;
        let length = guns.length;

        for (let i = 0; i < length; i++) {
            let postion = b.getCenter();
            guns[i].shoot(postion);
        }
    }

    onSkill() {
        // 如果死亡，不能释放技能
        if (!this.isAlive) return;

        // 当前系统已将“主动技能”视为周期自动发动，被动技能则持续生效。
        // 旧逻辑仍保留为回退（手动触发），但默认不再必须调用。
        // 如果希望手动进行一次技能释放，可以在外部直接调用 skillManager.useActiveSkill。

        this.legacySkillRelease();
    }

    private legacySkillRelease() {
        let angle = Math.random() * Math.PI * 2;

        for (let i = 0; i < 3; i++) {
            let parent = BulletHell.inst.bullets;
            let skill = Skill.get(this.skill);
            if (!skill) {
                console.warn('[Player] legacySkillRelease 失败：skill 预制体未配置 Skill 组件');
                return;
            }
            skill.insert(parent);
            skill.init();

            Vec3.subtract(tempPos, this.node.worldPosition, parent.worldPosition);
            skill.setPosition(tempPos);

            // 发射速度和生命时长
            let speed = 300;
            angle += Math.PI * 2 / 3;
            let x = Math.cos(angle), y = Math.sin(angle);
            skill.velocity.set(x, y, 0).multiplyScalar(speed);

            skill.angle = 0;
            skill.lifeTime = 3;
        }
    }

    onCollect(b: cBody) {
        // 进入拾取范围
        const itemNode = b.object?.node;
        if (!itemNode) {
            return;
        }

        const pickup = itemNode.getComponent(TemporaryPickup);
        if (!pickup) {
            return;
        }

        pickup.collect(this.node);
        this.skillManager?.notifyItemCollected(itemNode);
    }

    public applyTemporaryDamageBoost(multiplier: number, duration: number): void {
        if (multiplier <= 1 || duration <= 0) {
            return;
        }

        this._temporaryDamageMultiplier = Math.max(this._temporaryDamageMultiplier, multiplier);
        this._temporaryDamageTimeLeft = Math.max(this._temporaryDamageTimeLeft, duration);
        console.log(`[玩家] 获得临时增伤：x${this._temporaryDamageMultiplier.toFixed(2)}，持续 ${this._temporaryDamageTimeLeft.toFixed(1)}s`);
    }

    public getDamageMultiplier(): number {
        return this._temporaryDamageMultiplier;
    }

    /**
     * 通知技能系统已击杀敌人（供 Enemy.onDie 调用）
     */
    onEnemyKilled(enemyNode: Node): void {
        this.skillManager?.notifyEnemyKilled(enemyNode);
    }

    onTrigger(b: cBody, trigger: Trigger) {
        if (trigger == Trigger.exit) return;
        
        // 如果死亡或无敌，不处理碰撞
        if (!this.isAlive || this.isInvincible) return;
        
        // 碰撞到敌方
        // 这里需要根据碰撞体的分组来判断
        // 假设敌人的分组是"enemy"，子弹的分组是"bullet"
        // const ENEMY_GROUP = 1; // 需要根据实际分组设置
        // const BULLET_GROUP = 2; // 需要根据实际分组设置
        
        switch (b.group) {
            case this.ENEMYGROUP:
                // 碰到敌人，按冷却频率受伤，避免重叠时瞬间掉光血
                if (this._contactDamageCooldownLeft <= 0) {
                    this.takeDamage(10, b.object?.node);
                    this._contactDamageCooldownLeft = Math.max(0.05, this.contactDamageCooldown);
                }
                break;
                
            // case BULLET_GROUP:
                // 碰到子弹，受到子弹伤害
                // const bullet = b.object?.node.getComponent('Bullet');
                // if (bullet) {
                //     const bulletComp = bulletNode.getComponent(Bullet);
                //     this.takeDamage(bullet.damage, b.object?.node);
                // } else {
                //     this.takeDamage(5, b.object?.node); // 默认伤害
                // }
                // break;
        }
    }
}