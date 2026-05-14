/**
 * SkillDefinitions.ts
 *
 * 本文件包含设计稿中各个技能的具体实现（选中技能、升级路线、质变逻辑等）。
 *
 * 这里提供的是可扩展的模块化实现：
 * - 主动技能（ActiveSkill）可构建出投射、范围、牵引等效果。
 * - 被动技能（PassiveSkill）可监听事件、提供被动加成。
 * - 召唤技能（SummonSkill）可在场景中生成实体。
 *
 * 这些实现侧重于可扩展性，能为后续的技能融合、技能树等功能提供基础。
 */

import { Vec3, Node, Quat, tween, PhysicsSystem } from 'cc';
import { ActiveSkill } from './ActiveSkill';
import { BoostSkill } from './BoostSkill';
import { SummonSkill } from './SummonSkill';
import { SkillContext, SkillConfig, SkillSlotType } from './SkillTypes';
import { randomAngle, fanDirections, offsetAlongDirection } from './SkillUtils';
import { BulletHell } from '../bulletHell';
import { Bullet } from '../../bulletHell/bullet';
import { Skill } from '../../bulletHell/skill';
import { SkillBeam } from '../../bulletHell/skillBeam';
import { Enemy } from '../enemy';
import { TemporaryPickup } from '../TemporaryPickup';

const tempBeamRot = new Quat();

// -----------------------------
// 工具 - 远程投射/子弹辅助
// -----------------------------

interface ProjectileOptions {
    prefab: import('cc').Prefab;
    position: Vec3;
    direction: Vec3;
    speed: number;
    lifeTime: number;
    damage?: number;
}

function spawnProjectile(opts: ProjectileOptions) {
    // 这里我们使用现有的 Bullet/Skill 系统做简单演示
    if (!opts.prefab) {
        console.warn('[Skill] 无效的投射物预制体');
        return;
    }

    const bullet = Bullet.get(opts.prefab);
    bullet.setPosition(opts.position);
    bullet.velocity.set(opts.direction).multiplyScalar(opts.speed);
    bullet.lifeTime = opts.lifeTime;
    // 额外伤害字段可保存在 bullet.damage（需在 Bullet 中添加）
    (bullet as any).damage = opts.damage ?? 10;
}

// -----------------------------
// 主动技能实现
// -----------------------------

const commonActiveSkillConfig: Partial<SkillConfig> = {
    category: 'active',
    slotType: SkillSlotType.Active,
    maxLevel: 10,
    transformLevel: 10,
};

export class WhirlwindBroomSkill extends ActiveSkill {
    static CONFIG: SkillConfig = {
        id: 'whirlwind_broom',
        name: '旋风扫把',
        description: '挥舞扫把对前方扇形区域造成伤害。',
        icon: 'skill_whirlwind',
        ...commonActiveSkillConfig,
    } as SkillConfig;

    /** 扇形半径 */
    private radius = 150;
    /** 基础伤害 */
    private baseDamage = 30;
    /** 子弹飞行速度 */
    private projectileSpeed = 650;
    /** 扇面初始展开半径 */
    private initialFanRadius = 40;
    /** 扇面总张角（弧度）, Math.PI/2 = 90° */
    private spreadAngle = Math.PI / 2;

    constructor(level: number = 1) {
        super(WhirlwindBroomSkill.CONFIG, level);
        this.cooldown = 1.0;
        this.updateByLevel();
    }

    private updateByLevel() {
        // 升级路径：范围↑ → 攻速↑ → 分裂出小扫把
        this.radius = 120 + this.level * 10;
        this.cooldown = Math.max(0.25, 1.0 - (this.level - 1) * 0.07);
        this.projectileSpeed = 650 + (this.level - 1) * 35;
        this.initialFanRadius = 34 + this.level * 3;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    protected onUse(context: SkillContext): void {
        const owner = context.ownerNode;
        const worldPos = owner.worldPosition;
        const parent = BulletHell.inst?.bullets;
        const prefab = context.payload?.visual?.projectilePrefab ?? null;
        //console.log(`[技能] 旋风扫把 (Lv${this.level}) 触发，位置:`, worldPos, `; 接收 prefab:`, prefab?.name || 'null');

        // 质变 (Lv10)：化为“清洁龙卷风”，持续吸附周围垃圾
        if (this.isTransformed) {
            // TODO: 这里可以生成一个持续的吸附 AOEs，并在一定时间内吸附/拉拽敌人
            //console.log('[技能] 触发：清洁龙卷风（质变）');
        } else {
            // 简单模拟：生成三个小扫把子弹来代表扇形
            if (!parent) {
                console.warn('[技能] 旋风扫把：未找到 bullets 挂载节点，无法显示投射体');
                return;
            }
            const angleCount = 7;
            // 每次发动随机挑一个朝向，再展开固定张角的扇面
            const dirs = fanDirections(angleCount, randomAngle(), this.spreadAngle);
            for (let i = 0; i < angleCount; i++) {
                const dir = dirs[i];

                // 这里使用 Skill 作为投射体（需要在 SkillManager 中配置 skillPrefab）
                const skill = prefab ? Skill.get(prefab) : null;
                if (!skill) {
                    console.warn('[技能] 旋风扫把：未配置 Skill Prefab，无法生成投射体');
                    return;
                }

                skill.insert(parent);
                skill.init();

                const spawnWorldPos = offsetAlongDirection(worldPos, dir, this.initialFanRadius);
                const localPos = new Vec3();
                Vec3.subtract(localPos, spawnWorldPos, parent.worldPosition);
                skill.setPosition(localPos);
                skill.velocity.set(dir).multiplyScalar(this.projectileSpeed);
                // 攻击距离 = 速度 * 存活时间；将存活时间减半可保证全等级射程统一减半。
                skill.lifeTime = 0.2;

                // 伤害/穿透/击退
                (skill as any).damage = this.baseDamage;
                (skill as any).penetration = 3 + Math.floor(this.level / 3);
                (skill as any).knockback = 250;
                (skill as any).hitCount = 0;

                // 可根据是否激活分裂增加更多子技能
                if (this.level >= 7) {
                    // 额外的小扫把
                    // （仅演示，不会真实分裂）
                }
            }
        }
    }
}

export class HighPressureWaterGunSkill extends ActiveSkill {
    static CONFIG: SkillConfig = {
        id: 'high_pressure_water_gun',
        name: '高压水枪',
        description: '发射水柱穿透直线敌人。',
        icon: 'skill_water_gun',
        ...commonActiveSkillConfig,
    } as SkillConfig;

    private baseDamage = 25;
    private projectileSpeed = 800;
    
    /** 激光扩展时长（秒） */
    private expandDuration = 0.6;
    /** 激光缩小时长（秒） */
    private shrinkDuration = 0.4;
    /** 激光最大拉伸倍数 */
    private maxScaleX = 3;

    private activeWaterGun: Skill | null = null;
    private waterGunSpawnTime: number = 0;

    constructor(level: number = 1) {
        super(HighPressureWaterGunSkill.CONFIG, level);
        this.cooldown = 1.2;
        this.updateByLevel();
    }

    private updateByLevel() {
        this.baseDamage = 25 + 5 * (this.level - 1);
        this.projectileSpeed = 800 + (this.level - 1) * 50;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public update(dt: number): void {
        super.update(dt);
        
        if (!this.activeWaterGun) return;
        
        const elapsed = performance.now() * 0.001 - this.waterGunSpawnTime;
        const totalDuration = this.expandDuration + this.shrinkDuration;
        
        let scaleX = 0;
        
        if (elapsed < this.expandDuration) {
            // 展开期：0 -> maxScaleX
            scaleX = (elapsed / this.expandDuration) * this.maxScaleX;
        } else if (elapsed < totalDuration) {
            // 缩小期：maxScaleX -> 0
            const shrinkElapsed = elapsed - this.expandDuration;
            scaleX = Math.max(0, this.maxScaleX * (1 - (shrinkElapsed / this.shrinkDuration)));
        } else {
            // 完全消失，回收
            Skill.put(this.activeWaterGun);
            this.activeWaterGun = null;
            return;
        }
        
        const scale = this.activeWaterGun.node.scale.clone();
        scale.x = Math.max(0.01, scaleX);
        this.activeWaterGun.setScale(scale);
    }

    protected onUse(context: SkillContext): void {
        const owner = context.ownerNode;
        const worldPos = owner.worldPosition;
        const parent = BulletHell.inst?.bullets;
        const prefab = context.payload?.visual?.projectilePrefab ?? null;
        console.log(`[技能] 高压水枪 (Lv${this.level}) 触发，位置:`, worldPos, `; 接收 prefab:`, prefab?.name || 'null');

        if (!parent || !prefab) {
            console.warn('[技能] 高压水枪：缺少 bullets 节点或 prefab，无法生成水柱', { hasParent: !!parent, hasPrefab: !!prefab });
            return;
        }

        const target = context.targetPosition ?? worldPos;
        const dir = new Vec3(target.x - worldPos.x, target.y - worldPos.y, 0);
        if (dir.lengthSqr() < 0.0001) {
            dir.set(1, 0, 0);
        }
        dir.normalize();

        // 回收旧的水枪
        if (this.activeWaterGun) {
            Skill.put(this.activeWaterGun);
        }

        const skill = prefab ? Skill.get(prefab) : null;
        if (!skill) {
            console.warn('[技能] 高压水枪：未配置 Skill Prefab，无法生成投射体');
            return;
        }

        skill.insert(parent);
        skill.init();

        // 禁用自动旋转，保持固定朝向
        (skill as any).disableAutoRotation = true;

        const spawnWorldPos = offsetAlongDirection(worldPos, dir, 30);
        const localPos = new Vec3();
        Vec3.subtract(localPos, spawnWorldPos, parent.worldPosition);
        skill.setPosition(localPos);

        // 设置初始旋转，使水柱指向发射方向
        const angle = Math.atan2(dir.y, dir.x);
        const rot = new Quat();
        Quat.rotateZ(rot, Quat.IDENTITY, angle);
        skill.setRotation(rot);

        skill.velocity.set(dir).multiplyScalar(this.projectileSpeed);
        skill.lifeTime = this.expandDuration + this.shrinkDuration + 0.1;

        // 伤害/穿透/击退
        (skill as any).damage = this.baseDamage;
        (skill as any).penetration = 9999; // 无限穿透，可以穿过所有敌人
        (skill as any).knockback = 180;
        (skill as any).hitCount = 0;

        this.activeWaterGun = skill;
        this.waterGunSpawnTime = performance.now() * 0.001;

        //console.log(`[技能] 高压水枪 (Lv${this.level}) 发射`);
    }
}

export class TrashBagFieldSkill extends ActiveSkill {
    static CONFIG: SkillConfig = {
        id: 'trash_bag_field',
        name: '垃圾袋领域',
        description: '放置持续污染区，减速敌人。',
        icon: 'skill_trash_bag',
        ...commonActiveSkillConfig,
    } as SkillConfig;

    private duration = 5;
    private radius = 120;
    private readonly damagePerTick = 8;
    private readonly tickInterval = 0.25;
    private readonly visualBaseRadius = 120;

    private isFieldActive = false;
    private fieldElapsed = 0;
    private tickElapsed = 0;
    private fieldOwnerNode: Node | null = null;
    private readonly fieldCenter = new Vec3();
    private activeFieldVisual: Skill | null = null;

    constructor(level: number = 1) {
        super(TrashBagFieldSkill.CONFIG, level);
        this.cooldown = 6;
        this.updateByLevel();
    }

    private updateByLevel() {
        // 升级路线：仅提升范围与持续时间
        this.radius = 120 + this.level * 14;
        this.duration = 4 + this.level * 0.8;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public update(dt: number): void {
        super.update(dt);

        if (!this.isFieldActive) {
            return;
        }

        this.fieldElapsed += dt;
        this.tickElapsed += dt;

        if (this.fieldElapsed >= this.duration) {
            this.clearField();
            return;
        }

        while (this.tickElapsed >= this.tickInterval) {
            this.tickElapsed -= this.tickInterval;
            this.applyAreaDamage();
        }
    }

    protected onUse(context: SkillContext): void {
        const origin = context.ownerNode.worldPosition;
        const parent = BulletHell.inst?.bullets;
        const prefab = context.payload?.visual?.projectilePrefab ?? null;

        //console.log(`[技能] 垃圾袋领域 (Lv${this.level}) 放置，持续 ${this.duration.toFixed(1)}s，范围 ${this.radius}`);

        this.clearField();

        this.fieldOwnerNode = context.ownerNode;
        this.fieldCenter.set(origin);
        this.fieldElapsed = 0;
        this.tickElapsed = 0;
        this.isFieldActive = true;

        // 立即结算一跳伤害，让技能触发反馈更直接。
        this.applyAreaDamage();

        if (parent && prefab) {
            const visual = Skill.get(prefab);
            if (visual) {
                visual.insert(parent);
                visual.init();

                const localPos = new Vec3();
                Vec3.subtract(localPos, this.fieldCenter, parent.worldPosition);
                visual.setPosition(localPos);
                visual.velocity.set(0, 0, 0);
                visual.lifeTime = this.duration + 0.1;
                visual.disableAutoRotation = true;
                visual.trigger = false;

                const scaleRatio = Math.max(0.1, this.radius / this.visualBaseRadius);
                visual.setScale(new Vec3(scaleRatio, scaleRatio, 1));

                this.activeFieldVisual = visual;
            }
        }

        if (this.isTransformed) {
            //console.log('[技能] 质变：垃圾填埋场（禁锢、持续伤害）');
        }
    }

    private applyAreaDamage(): void {
        if (!this.fieldOwnerNode) {
            return;
        }

        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return;
        }

        const radiusSqr = this.radius * this.radius;
        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead) {
                continue;
            }

            const enemyPos = enemyNode.worldPosition;
            const dx = enemyPos.x - this.fieldCenter.x;
            const dy = enemyPos.y - this.fieldCenter.y;
            if (dx * dx + dy * dy <= radiusSqr) {
                enemy.takeDamage(this.damagePerTick, this.fieldOwnerNode);
            }
        }
    }

    private clearField(): void {
        this.isFieldActive = false;
        this.fieldElapsed = 0;
        this.tickElapsed = 0;
        this.fieldOwnerNode = null;

        if (this.activeFieldVisual) {
            Skill.put(this.activeFieldVisual);
            this.activeFieldVisual = null;
        }
    }
}

export class VacuumVortexSkill extends ActiveSkill {
    static CONFIG: SkillConfig = {
        id: 'vacuum_vortex',
        name: '吸尘器漩涡',
        description: '产生向中心牵引的漩涡。',
        icon: 'skill_vacuum',
        ...commonActiveSkillConfig,
    } as SkillConfig;

    private radius = 160;
    private pullStrength = 120;
    private stunChance = 0.0;

    constructor(level: number = 1) {
        super(VacuumVortexSkill.CONFIG, level);
        this.cooldown = 5;
        this.updateByLevel();
    }

    private updateByLevel() {
        this.radius = 140 + this.level * 12;
        this.pullStrength = 100 + this.level * 10;
        this.stunChance = Math.min(0.25, 0.05 * (this.level - 1));
    }

    protected onUse(context: SkillContext): void {
        const center = context.ownerNode.worldPosition;
        //console.log(`[技能] 吸尘器漩涡 (Lv${this.level}) 生成，范围 ${this.radius}`);

        if (this.isTransformed) {
            //console.log('[技能] 质变：黑洞吸尘器（吞噬低血量敌人）');
        }

        // TODO: 这里应在场景中创建一个持续效果区域，将敌人拉向中心，并根据吸附强度损失生命。
    }
}

// -----------------------------
// 被动技能实现
// -----------------------------

const commonPassiveSkillConfig: Partial<SkillConfig> = {
    category: 'boost',
    slotType: SkillSlotType.Passive,
    maxLevel: 10,
    transformLevel: 10,
};

export class EfficiencyExpertSkill extends BoostSkill {
    static CONFIG: SkillConfig = {
        id: 'efficiency_expert',
        name: '效率专家',
        description: '每清洁10个敌人，下次攻击伤害+20%。',
        icon: 'skill_efficiency',
        ...commonPassiveSkillConfig,
    } as SkillConfig;

    private killCount = 0;
    private damageBonus = 0.2;

    constructor(level: number = 1) {
        super(EfficiencyExpertSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel() {
        this.damageBonus = 0.15 + 0.05 * (this.level - 1);
    }

    public onEquip(owner: Node): void {
        // 这里可以监听全局击杀事件（需由 SkillManager 触发）
        //console.log('[被动] 装备：效率专家');
    }

    public onEnemyKilled(enemyNode: Node, owner: Node): void {
        this.killCount++;
        if (this.killCount >= 10) {
            this.killCount = 0;
            //console.log('[被动] 触发加伤效果，下次攻击伤害 +', Math.round(this.damageBonus * 100), '%');
            // 这里可通知 Owner 的攻击系统应用加伤（需在 SkillManager 中实现）
        }
    }
}

export class RecyclingSkill extends BoostSkill {
    static CONFIG: SkillConfig = {
        id: 'recycling_master',
        name: '回收利用',
        description: '击杀敌人后有概率掉落临时增益道具（Lv1 不触发）。',
        icon: 'skill_recycle',
        ...commonPassiveSkillConfig,
    } as SkillConfig;

    private dropChance = 0.2;
    private effectDuration = 5;
    private effectMultiplier = 1.2;
    private pickupLifeTime = 8;

    constructor(level: number = 1) {
        super(RecyclingSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel() {
        // 最低等级不触发，Lv2 开始生效
        this.dropChance = Math.min(0.55, 0.1 + 0.06 * (this.level - 1));
        this.effectDuration = 4 + this.level * 0.7;
        this.effectMultiplier = 1.15 + this.level * 0.03;
        this.pickupLifeTime = 7 + this.level * 0.3;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public onEquip(owner: Node): void {
        //console.log('[被动] 装备：回收利用');
    }

    public onEnemyKilled(enemyNode: Node, owner: Node): void {
        if (this.level <= 1) {
            return;
        }

        const random = Math.random();
        if (random < this.dropChance) {
            const parent = BulletHell.inst?.objects || owner.parent;
            if (!parent) {
                return;
            }

            const pickup = TemporaryPickup.get(BulletHell.inst?.temporaryPickupPrefab);
            pickup.insert(parent);
            pickup.initPickup(
                'temporary_damage_boost',
                this.effectMultiplier,
                this.effectDuration,
                this.pickupLifeTime,
                enemyNode.worldPosition
            );

            console.log(
                `[增益] 回收利用触发掉落：x${this.effectMultiplier.toFixed(2)}，持续 ${this.effectDuration.toFixed(1)}s，概率 ${(this.dropChance * 100).toFixed(0)}%`
            );
        }
    }
}

export class SterileAuraSkill extends BoostSkill {
    static CONFIG: SkillConfig = {
        id: 'sterile_aura',
        name: '无菌领域',
        description: '自身周围产生持续净化光环。',
        icon: 'skill_aura',
        ...commonPassiveSkillConfig,
    } as SkillConfig;

    private radius = 120;

    constructor(level: number = 1) {
        super(SterileAuraSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel() {
        this.radius = 100 + this.level * 8;
    }

    public onUpdate(dt: number, owner: Node): void {
        // 这里可以处理持续净化逻辑，比如每秒清除附近某些状态或对敌人造成小量伤害
    }
}

export class SortingMasterSkill extends BoostSkill {
    static CONFIG: SkillConfig = {
        id: 'sorting_master',
        name: '分类大师',
        description: '对不同类型敌人造成额外伤害。',
        icon: 'skill_sorting',
        ...commonPassiveSkillConfig,
    } as SkillConfig;

    private bonusPerCategory = 0.1;

    constructor(level: number = 1) {
        super(SortingMasterSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel() {
        this.bonusPerCategory = 0.1 + 0.02 * (this.level - 1);
    }

    public onEquip(owner: Node): void {
        //console.log('[被动] 装备：分类大师');
    }

    public getBonusForCategory(category: string): number {
        // 这里我们简单返回一个固定值；后续可扩展为针对具体类型
        return this.bonusPerCategory;
    }
}

// -----------------------------
// 召唤技能实现
// -----------------------------

const commonSummonSkillConfig: Partial<SkillConfig> = {
    category: 'summon',
    slotType: SkillSlotType.Summon,
    maxLevel: 10,
    transformLevel: 10,
};

export class CleaningRobotSkill extends SummonSkill {
    static CONFIG: SkillConfig = {
        id: 'cleaning_robot',
        name: '清洁机器人',
        description: '自动攻击最近的敌人。',
        icon: 'skill_robot',
        ...commonSummonSkillConfig,
    } as SkillConfig;

    private attackInterval = 1.0;

    constructor(level: number = 1) {
        super(CleaningRobotSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel() {
        this.attackInterval = Math.max(0.4, 1.0 - 0.05 * (this.level - 1));
    }

    protected onSummon(context: SkillContext): void {
        //console.log('[召唤] 清洁机器人 召唤（占位）');
        // TODO: 在场景中创建机器人实体，并设置其自动攻击行为。
    }
}

export class TrashGuardSkill extends SummonSkill {
    static CONFIG: SkillConfig = {
        id: 'trash_guard',
        name: '垃圾桶卫兵',
        description: '固定位置的范围攻击。',
        icon: 'skill_guard',
        ...commonSummonSkillConfig,
    } as SkillConfig;

    private attackRadius = 260;
    private attackInterval = 3.1;
    private summonDuration = 24;

    private followRadius = 110;
    private followLerpSpeed = 5;
    private orbitSpeed = 1.4;

    private castLockDuration = 0.55;
    private vanishDuration = 0.3;
    private vanishEveryCasts = 3;

    private ownerNode: Node | null = null;
    private summonParent: Node | null = null;
    private guardVisual: Skill | null = null;

    private isSummoned = false;
    private summonElapsed = 0;
    private attackElapsed = 0;
    private castLockElapsed = 0;
    private vanishElapsed = 0;
    private orbitAngle = 0;
    private isCasting = false;
    private isVanishing = false;
    private castsSinceVanish = 0;

    private readonly guardPosition = new Vec3();
    private readonly desiredWorldPosition = new Vec3();
    private readonly tempLocalPosition = new Vec3();
    private readonly castCenterWorldPosition = new Vec3();

    constructor(level: number = 1) {
        super(TrashGuardSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel() {
        this.attackRadius = 240 + this.level * 24;
        this.attackInterval = Math.max(1.6, 3.2 - 0.14 * (this.level - 1));
        this.summonDuration = 22 + this.level * 2.0;
        this.followRadius = 90 + this.level * 5;
        this.followLerpSpeed = Math.min(8, 4.8 + this.level * 0.2);
        this.castLockDuration = Math.max(0.35, 0.58 - this.level * 0.01);
        // 提升等级后更少消失，更像稳定随从。
        this.vanishEveryCasts = Math.max(2, 4 - Math.floor(this.level / 4));
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public update(dt: number): void {
        if (!this.isSummoned || !this.ownerNode || !this.guardVisual || !this.summonParent) {
            return;
        }

        // 兜底：如果实体被意外从父节点移除，立即重新挂回，避免“逻辑在跑但看不到”。
        if (this.guardVisual.node.parent !== this.summonParent) {
            this.guardVisual.insert(this.summonParent);
            this.guardVisual.node.active = !this.isVanishing;
            this.syncGuardToWorld(this.guardPosition);
            this.configureGuardVisualCollision();
        }

        this.summonElapsed += dt;
        if (this.summonElapsed >= this.summonDuration) {
            this.clearGuard();
            return;
        }

        if (this.isVanishing) {
            // 隐身期间仍持续跟随，避免显形时落在很远的旧位置导致“看起来没回来”。
            this.followOwner(dt);

            this.vanishElapsed += dt;
            if (this.vanishElapsed >= this.vanishDuration) {
                this.isVanishing = false;
                this.vanishElapsed = 0;
                this.guardVisual.node.active = true;
                this.syncGuardToWorld(this.guardPosition);
            }
            return;
        }

        if (this.isCasting) {
            this.castLockElapsed += dt;
            if (this.castLockElapsed >= this.castLockDuration) {
                this.executeSuctionAndExecution();
                this.isCasting = false;
                this.castLockElapsed = 0;
                this.castsSinceVanish++;
                if (this.castsSinceVanish >= this.vanishEveryCasts) {
                    this.castsSinceVanish = 0;
                    const remainTime = this.summonDuration - this.summonElapsed;
                    // 召唤即将结束时不再进入隐身，避免出现“消失后看起来再也不回来”的观感。
                    if (remainTime > this.vanishDuration + 1.0) {
                        this.isVanishing = true;
                        this.guardVisual.node.active = false;
                    }
                }
            }
            return;
        }

        this.attackElapsed += dt;
        if (this.attackElapsed >= this.attackInterval) {
            this.attackElapsed = 0;
            this.startCast();
            return;
        }

        this.followOwner(dt);
    }

    protected onSummon(context: SkillContext): void {
        this.ownerNode = context.ownerNode;
        this.summonParent = BulletHell.inst?.bullets;
        if (!this.summonParent) {
            console.warn('[召唤] 垃圾桶卫兵：缺少 bullets 节点，无法召唤');
            return;
        }

        const prefab = context.payload?.visual?.projectilePrefab ?? null;
        if (!prefab) {
            console.warn('[召唤] 垃圾桶卫兵：未配置可视 prefab，无法召唤');
            return;
        }

        // 已有实体时仅刷新持续时间和参数，不重复创建。
        if (!this.guardVisual) {
            this.guardVisual = Skill.get(prefab);
            if (!this.guardVisual) {
                console.warn('[召唤] 垃圾桶卫兵：创建实体失败');
                return;
            }
            this.guardVisual.insert(this.summonParent);
            this.guardVisual.init();
            this.guardVisual.velocity.set(0, 0, 0);
            this.guardVisual.disableAutoRotation = true;
        }

        this.configureGuardVisualCollision();

        this.guardVisual.lifeTime = 999999;

        this.guardVisual.node.active = true;
        this.isSummoned = true;
        this.summonElapsed = 0;
        this.attackElapsed = 0;
        this.castLockElapsed = 0;
        this.vanishElapsed = 0;
        this.isCasting = false;
        this.isVanishing = false;
        this.castsSinceVanish = 0;

        this.orbitAngle = Math.random() * Math.PI * 2;
        this.guardPosition.set(this.ownerNode.worldPosition);
        this.syncGuardToWorld(this.guardPosition);

        //console.log(`[召唤] 垃圾桶卫兵 已召唤，持续 ${this.summonDuration.toFixed(1)}s，攻击半径 ${this.attackRadius}`);
    }

    public onUnequip(owner: Node): void {
        this.clearGuard();
    }

    private followOwner(dt: number): void {
        if (!this.ownerNode || !this.guardVisual) {
            return;
        }

        this.orbitAngle += dt * this.orbitSpeed;
        const ownerPos = this.ownerNode.worldPosition;
        this.desiredWorldPosition.set(
            ownerPos.x + Math.cos(this.orbitAngle) * this.followRadius,
            ownerPos.y + Math.sin(this.orbitAngle) * this.followRadius,
            0
        );

        const t = Math.min(1, dt * this.followLerpSpeed);
        Vec3.lerp(this.guardPosition, this.guardPosition, this.desiredWorldPosition, t);
        this.syncGuardToWorld(this.guardPosition);
    }

    private startCast(): void {
        if (!this.guardVisual) {
            return;
        }

        this.isCasting = true;
        this.castLockElapsed = 0;
        this.castCenterWorldPosition.set(this.guardPosition);

        // 攻击前摇：短促放大，制造“剧烈释放”感。
        tween(this.guardVisual.node)
            .stop()
            .to(0.12, { scale: new Vec3(1.45, 1.45, 1) })
            .to(0.08, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    private executeSuctionAndExecution(): void {
        if (!this.ownerNode) {
            return;
        }

        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return;
        }

        const radiusSqr = this.attackRadius * this.attackRadius;
        let killCount = 0;

        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead) {
                continue;
            }

            const enemyPos = enemyNode.worldPosition;
            const dx = enemyPos.x - this.castCenterWorldPosition.x;
            const dy = enemyPos.y - this.castCenterWorldPosition.y;
            if (dx * dx + dy * dy > radiusSqr) {
                continue;
            }

            const parent = enemyNode.parent;
            if (parent) {
                Vec3.subtract(this.tempLocalPosition, this.castCenterWorldPosition, parent.worldPosition);
                enemy.setPosition(this.tempLocalPosition);
            }

            enemy.takeDamage(999999, this.ownerNode);
            killCount++;
        }

        if (killCount > 0) {
            console.log(`[召唤] 垃圾桶卫兵释放收束处决，击杀 ${killCount} 个目标`);
        }
    }

    private syncGuardToWorld(worldPos: Vec3): void {
        if (!this.guardVisual || !this.summonParent) {
            return;
        }

        Vec3.subtract(this.tempLocalPosition, worldPos, this.summonParent.worldPosition);
        this.guardVisual.setPosition(this.tempLocalPosition);
    }

    private clearGuard(): void {
        if (this.guardVisual) {
            Skill.put(this.guardVisual);
            this.guardVisual = null;
        }

        this.isSummoned = false;
        this.summonElapsed = 0;
        this.attackElapsed = 0;
        this.castLockElapsed = 0;
        this.vanishElapsed = 0;
        this.isCasting = false;
        this.isVanishing = false;
        this.castsSinceVanish = 0;
    }

    /**
     * 守卫仅作为可视召唤物存在，不参与子弹/敌人伤害碰撞链，避免被敌人误当投射物回收。
     */
    private configureGuardVisualCollision(): void {
        if (!this.guardVisual || !this.guardVisual.body) {
            return;
        }

        this.guardVisual.trigger = false;
        this.guardVisual.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        this.guardVisual.body.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        this.guardVisual.body.mask = 0;
    }
}

export class MopGhostSkill extends SummonSkill {
    static CONFIG: SkillConfig = {
        id: 'mop_ghost',
        name: '拖地幽灵',
        description: '留下持续伤害的污渍轨迹。',
        icon: 'skill_ghost',
        ...commonSummonSkillConfig,
    } as SkillConfig;

    private trailDuration = 6;

    constructor(level: number = 1) {
        super(MopGhostSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel() {
        this.trailDuration = 4 + this.level * 0.6;
    }

    protected onSummon(context: SkillContext): void {
        console.log('[召唤] 拖地幽灵 召唤（占位）');
        // TODO: 在场景中生成一个幽灵实体，并让其在移动时留下持续伤害区域。
    }
}
