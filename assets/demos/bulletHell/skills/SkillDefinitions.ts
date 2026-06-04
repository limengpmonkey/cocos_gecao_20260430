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

import { Animation, Color, Component, Graphics, Vec3, Node, ParticleSystem2D, Quat, Sprite, tween, PhysicsSystem, UITransform, view } from 'cc';
import { ActiveSkill } from './ActiveSkill';
import { BoostSkill } from './BoostSkill';
import { SummonSkill } from './SummonSkill';
import { SkillContext, SkillConfig, SkillSlotType } from './SkillTypes';
import { randomAngle, fanDirections, offsetAlongDirection } from './SkillUtils';
import { createWaterGunProfile, WATER_GUN_AMMO_LABELS, WATER_GUN_NOZZLE_LABELS, WATER_GUN_UPGRADE_FOCUS_LABELS, WaterGunAmmoType, WaterGunNozzleType, WaterGunProfile } from './WaterGunBalanceTable';
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

interface PressureCanisterState {
    visual: Skill | null;
    impactPrefab: import('cc').Prefab | null;
    launchPosition: Vec3;
    landingPosition: Vec3;
    currentPosition: Vec3;
    throwDirection: Vec3;
    elapsed: number;
    fuseTime: number;
    damage: number;
    blastRadius: number;
    knockbackStrength: number;
    stunDuration: number;
    arcHeight: number;
    isExploding: boolean;
    explosionElapsed: number;
    explosionDuration: number;
}

interface MopTrailState {
    node: Node;
    graphics: Graphics;
    worldPosition: Vec3;
    radiusX: number;
    radiusY: number;
    elapsed: number;
    duration: number;
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

function isSkillDamageDisabledForTesting(skillId: string): boolean {
    const skillSelectionSystem = BulletHell.inst?.node?.getComponentInChildren('SkillSelectionSystem') as {
        isSkillDamageDisabledForSkill?: (id: string) => boolean;
    } | null;

    return !!skillSelectionSystem?.isSkillDamageDisabledForSkill?.(skillId);
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
        description: '挥舞扫把进行挥砍攻击，范围随等级提升。',
        icon: 'skill_whirlwind',
        ...commonActiveSkillConfig,
    } as SkillConfig;

    private baseDamage = 30;
    private slashAngle = Math.PI / 3; // 初始挥砍角度 60°
    private slashRange = 150; // 初始挥砍范围
    private slashDuration = 1.0;    
    private minVisualDuration = 0.45;
    private orbitRadius = 40;
    private damageTickInterval = 0.08;

    private activeOwnerNode: Node | null = null;
    private activeBroomVisual: Skill | null = null;
    private orbitElapsed = 0;
    private damageTickElapsed = 0;
    private orbitStartAngle = -Math.PI * 0.5;
    private readonly orbitPosition = new Vec3();
    private readonly currentFacing = new Vec3(1, 0, 0);

    constructor(level: number = 1) {
        super(WhirlwindBroomSkill.CONFIG, level);
        this.cooldown = 1.0;
        this.updateByLevel();
    }

    private updateByLevel() {
        // 提升挥砍范围和角度
        this.slashRange = 150 + this.level * 20;
        this.slashAngle = Math.PI / 3 + (this.level - 1) * (Math.PI / 18); // 每级增加 10°
        this.baseDamage = 30 + this.level * 5;
        this.orbitRadius = 40;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public update(dt: number): void {
        super.update(dt);

        if (!this.activeOwnerNode || !this.activeBroomVisual) {
            return;
        }

        this.orbitElapsed += dt;
        this.damageTickElapsed += dt;

        const progress = Math.min(1, this.orbitElapsed / this.slashDuration);
        const orbitAngle = this.orbitStartAngle + progress * Math.PI * 2;

        this.currentFacing.set(Math.cos(orbitAngle), Math.sin(orbitAngle), 0);
        this.updateBroomOrbitTransform(this.currentFacing);

        while (this.damageTickElapsed >= this.damageTickInterval) {
            this.damageTickElapsed -= this.damageTickInterval;
            this.applyOrbitDamage();
        }

        if (progress >= 1) {
            this.clearActiveBroom();
        }
    }

    protected onUse(context: SkillContext): void {
        const owner = context.ownerNode;
        const parent = BulletHell.inst?.bullets;
        const prefab = context.payload?.visual?.projectilePrefab ?? null;
        const facingDir = this.getSlashDirection(context, owner.worldPosition);

        if (!parent || !prefab) {
            console.warn('[技能] 旋风扫把：未找到 bullets 挂载节点或扫把预制体，无法显示攻击效果');
            return;
        }

        this.clearActiveBroom();

        const broomVisual = Skill.get(prefab);
        if (!broomVisual) {
            console.warn('[技能] 旋风扫把：创建扫把可视体失败');
            return;
        }

        broomVisual.insert(parent);
        broomVisual.init();
        broomVisual.disableAutoRotation = true;
        broomVisual.trigger = false;
            broomVisual.lifeTime = 999999;
        broomVisual.velocity.set(0, 0, 0);
        broomVisual.setScale(new Vec3(1, 1, 1));

        const broomNode = broomVisual.node;
        const animationDuration = this.playBroomAnimation(broomNode);
        const cleanupDelay = Math.max(this.slashDuration, this.minVisualDuration, animationDuration);

        broomVisual.lifeTime = cleanupDelay + 0.1;

        this.activeOwnerNode = owner;
        this.activeBroomVisual = broomVisual;
        this.orbitElapsed = 0;
        this.damageTickElapsed = 0;
        this.orbitStartAngle = Math.atan2(facingDir.y, facingDir.x);
        this.currentFacing.set(facingDir.x, facingDir.y, 0);
        this.updateBroomOrbitTransform(this.currentFacing);
        this.applyOrbitDamage();
    }

    private getEnemiesInSlashRange(center: Vec3, facingDir: Vec3, range: number, angle: number): Enemy[] {
        const enemies: Enemy[] = [];
        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) return enemies;

        const normalizedFacing = new Vec3(facingDir.x, facingDir.y, 0);
        if (normalizedFacing.lengthSqr() <= 0.0001) {
            normalizedFacing.set(1, 0, 0);
        }
        normalizedFacing.normalize();

        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead) continue;

            const enemyPos = enemyNode.worldPosition;
            const dirToEnemy = new Vec3(enemyPos.x - center.x, enemyPos.y - center.y, 0);
            const distance = dirToEnemy.length();

            if (distance > range) continue;

            if (distance <= 0.001) {
                enemies.push(enemy);
                continue;
            }

            dirToEnemy.normalize();
            const dot = Math.max(-1, Math.min(1, Vec3.dot(normalizedFacing, dirToEnemy)));
            const deltaAngle = Math.acos(dot);
            if (deltaAngle <= angle * 0.5) {
                enemies.push(enemy);
            }
        }

        return enemies;
    }

    private getSlashDirection(context: SkillContext, origin: Vec3): Vec3 {
        const target = context.targetPosition;
        if (target) {
            const dir = new Vec3(target.x - origin.x, target.y - origin.y, 0);
            if (dir.lengthSqr() > 0.0001) {
                dir.normalize();
                return dir;
            }
        }

        return new Vec3(0, -1, 0);
    }

    private playSlashVisual(broomNode: Node, facingDir: Vec3): void {
        // 当前资源里扫把尾部方向与之前判断相反，需要额外翻转 180° 才会朝向玩家中心。
        const towardOwnerAngle = Math.atan2(-facingDir.y, -facingDir.x);
        const spriteTailAngleDeg = 45;
        const rotationDeg = towardOwnerAngle * 180 / Math.PI - spriteTailAngleDeg;

        broomNode.setRotationFromEuler(0, 0, rotationDeg);
        broomNode.setScale(new Vec3(1, 1, 1));
    }

    private updateBroomOrbitTransform(facingDir: Vec3): void {
        if (!this.activeOwnerNode || !this.activeBroomVisual) {
            return;
        }

        const ownerPos = this.activeOwnerNode.worldPosition;
        this.orbitPosition.set(
            ownerPos.x + facingDir.x * this.orbitRadius,
            ownerPos.y + facingDir.y * this.orbitRadius,
            ownerPos.z
        );

        const broomNode = this.activeBroomVisual.node;
        broomNode.setWorldPosition(this.orbitPosition);
        this.playSlashVisual(broomNode, facingDir);
    }

    private applyOrbitDamage(): void {
        if (!this.activeOwnerNode) {
            return;
        }

        if (isSkillDamageDisabledForTesting(WhirlwindBroomSkill.CONFIG.id)) {
            return;
        }

        const enemies = this.getEnemiesInSlashRange(
            this.activeOwnerNode.worldPosition,
            this.currentFacing,
            this.slashRange,
            this.slashAngle
        );

        for (const enemy of enemies) {
            enemy.takeDamage(this.baseDamage, this.activeOwnerNode);
        }
    }

    private clearActiveBroom(): void {
        if (this.activeBroomVisual) {
                tween(this.activeBroomVisual.node).stop();
            Skill.put(this.activeBroomVisual);
            this.activeBroomVisual = null;
        }

        this.activeOwnerNode = null;
        this.orbitElapsed = 0;
        this.damageTickElapsed = 0;
        this.currentFacing.set(1, 0, 0);
    }

    private playBroomAnimation(broomNode: Node): number {
        const animations = broomNode.getComponentsInChildren(Animation);
        if (!animations || animations.length === 0) {
            return 0;
        }

        let maxDuration = 0;
        for (const animation of animations) {
            const animationAny = animation as any;
            const clips = (animationAny.clips as Array<{ name?: string; duration?: number }> | undefined) ?? [];
            const slashClip = clips.find(clip => clip?.name === 'slash');
            const chosenClip = slashClip ?? animationAny.defaultClip ?? clips[0] ?? null;
            if (!chosenClip) {
                continue;
            }

            animation.stop();
            if (chosenClip.name) {
                animation.play(chosenClip.name);
            } else {
                animation.play();
            }

            if (typeof chosenClip.duration === 'number' && chosenClip.duration > maxDuration) {
                maxDuration = chosenClip.duration;
            }
        }

        return maxDuration;
    }
}

export class HighPressureWaterGunSkill extends ActiveSkill {
    static CONFIG: SkillConfig = {
        id: 'high_pressure_water_gun',
        name: '高压水枪',
        description: '持续喷射水流，依据压力、容量、喷嘴与弹药改变清洁方式。',
        icon: 'skill_water_gun',
        ...commonActiveSkillConfig,
    } as SkillConfig;

    private pressureLevel = 1;
    private tankCapacity = 1.1;
    private expandDuration = 0.12;
    private shrinkDuration = 0.18;
    private readonly visualWidthBaseline = 48;
    private readonly waterGunOriginOffset = 22;
    private readonly waterGunDefaultVisualLength = 64;

    private activeOwnerNode: Node | null = null;
    private activeWaterGun: Skill | null = null;
    private activeProfile: WaterGunProfile | null = null;
    private readonly activeDirection = new Vec3(1, 0, 0);
    private activeBaseAngle = 0;
    private activeElapsed = 0;
    private damageTickElapsed = 0;
    private readonly waterGunWorldPosition = new Vec3();
    private readonly waterGunLocalPosition = new Vec3();
    private readonly waterGunScale = new Vec3(1, 1, 1);
    private waterGunRootSprite: Sprite | null = null;
    private waterGunBeamCoreNode: Node | null = null;
    private waterGunSoftEdgeNode: Node | null = null;
    private waterGunMuzzleNode: Node | null = null;
    private waterGunImpactNode: Node | null = null;
    private waterGunMuzzleParticle: ParticleSystem2D | null = null;
    private waterGunImpactParticle: ParticleSystem2D | null = null;
    private isWaterGunImpactParticleActive = false;
    private readonly waterGunCoreScale = new Vec3(1, 1, 1);
    private readonly waterGunSoftEdgeScale = new Vec3(1, 1, 1);
    private readonly waterGunSplashScale = new Vec3(1, 1, 1);
    private readonly waterGunMuzzleScale = new Vec3(1, 1, 1);
    private readonly waterGunMuzzleBaseScale = new Vec3(1, 1, 1);
    private readonly waterGunKnockbackMultiplier = 1.35;
    private readonly waterGunKnockbackDuration = 0.18;
    private readonly waterGunContactKnockbackMultiplier = 2.7;
    private readonly waterGunContactKnockbackDuration = 0.12;
    private readonly transformedWaterGunBeamWidthMultiplier = 2;
    private static readonly CARDINAL_DIRECTIONS = [
        new Vec3(1, 0, 0),
        new Vec3(-1, 0, 0),
        new Vec3(0, 1, 0),
        new Vec3(0, -1, 0),
    ];

    private getCurrentWaterGunReach(): number {
        if (!this.activeProfile) {
            return 0;
        }

        if (this.activeProfile.nozzleType !== 'direct') {
            return this.activeProfile.range;
        }

        const nearestHit = this.collectSprayTargetCandidates(this.activeProfile.range)[0];
        if (!nearestHit) {
            return this.activeProfile.range;
        }

        return Math.max(10, Math.min(this.activeProfile.range, nearestHit.distance));
    }

    constructor(level: number = 1) {
        super(HighPressureWaterGunSkill.CONFIG, level);
        this.cooldown = 1.2;
        this.updateByLevel();
    }

    private updateByLevel() {
        const profile = createWaterGunProfile(this.level);
        this.pressureLevel = profile.pressureLevel;
        this.tankCapacity = profile.sustainDuration;
        this.cooldown = Math.max(0.78, 1.2 - (this.level - 1) * 0.03);
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public getDescription(): string {
        const profile = this.buildWaterGunProfile();
        return `${WATER_GUN_UPGRADE_FOCUS_LABELS[profile.upgradeFocus]}: 压力 Lv.${this.pressureLevel}，水箱 ${profile.sustainDuration.toFixed(1)}s，${WATER_GUN_NOZZLE_LABELS[profile.nozzleType]}，${WATER_GUN_AMMO_LABELS[profile.ammoType]}。${profile.upgradeSummary}`;
    }

    public update(dt: number): void {
        super.update(dt);

        if (!this.activeWaterGun || !this.activeProfile || !this.activeOwnerNode) {
            return;
        }

        this.activeElapsed += dt;
        const totalDuration = this.activeProfile.sustainDuration + this.shrinkDuration;
        if (this.activeElapsed >= totalDuration) {
            this.clearActiveWaterGun();
            return;
        }

        this.damageTickElapsed += dt;
        this.updateSprayDirection();
        this.updateWaterGunVisual();

        if (this.activeElapsed <= this.activeProfile.sustainDuration) {
            this.applyContinuousSprayContactKnockback();
            while (this.damageTickElapsed >= this.activeProfile.damageTickInterval) {
                this.damageTickElapsed -= this.activeProfile.damageTickInterval;
                this.applyContinuousSprayDamage();
            }
        }
    }

    protected onUse(context: SkillContext): void {
        const owner = context.ownerNode;
        const worldPos = owner.worldPosition;
        const parent = BulletHell.inst?.bullets;
        const prefab = context.payload?.visual?.projectilePrefab ?? null;

        if (!parent || !prefab) {
            console.warn('[技能] 高压水枪：缺少 bullets 节点或 prefab，无法生成水柱', { hasParent: !!parent, hasPrefab: !!prefab });
            return;
        }

        const profile = this.buildWaterGunProfile(context);

        const target = context.targetPosition ?? worldPos;
        const dir = new Vec3(target.x - worldPos.x, target.y - worldPos.y, 0);
        if (dir.lengthSqr() < 0.0001) {
            dir.set(this.getRandomCardinalDirection());
        }
        dir.normalize();

        this.clearActiveWaterGun();

        const skill = prefab ? Skill.get(prefab) : null;
        if (!skill) {
            console.warn('[技能] 高压水枪：未配置 Skill Prefab，无法生成投射体');
            return;
        }

        skill.insert(parent);
        skill.init();

        skill.disableAutoRotation = true;
        skill.trigger = false;
        skill.velocity.set(0, 0, 0);
        skill.lifeTime = profile.sustainDuration + this.shrinkDuration + 0.1;
        skill.damage = 0;
        skill.penetration = 9999;
        skill.knockback = 0;

        this.activeOwnerNode = owner;
        this.activeWaterGun = skill;
        this.activeProfile = profile;
        this.activeDirection.set(dir);
        this.activeBaseAngle = Math.atan2(dir.y, dir.x);
        this.activeElapsed = this.expandDuration;
        this.damageTickElapsed = 0;
        this.cacheWaterGunVisualNodes();
        this.playWaterGunParticle(this.waterGunMuzzleParticle, true);
        this.stopWaterGunParticle(this.waterGunImpactParticle, true);
        this.isWaterGunImpactParticleActive = false;
        this.updateSprayDirection();
        this.updateWaterGunVisual();
        this.applyContinuousSprayContactKnockback();
        this.applyContinuousSprayDamage();

        console.log(`[技能] 高压水枪 (Lv${this.level}) 启动：${WATER_GUN_NOZZLE_LABELS[profile.nozzleType]} / ${WATER_GUN_AMMO_LABELS[profile.ammoType]} / 持续 ${profile.sustainDuration.toFixed(1)}s`);
    }

    private getRandomCardinalDirection(): Vec3 {
        const directions = HighPressureWaterGunSkill.CARDINAL_DIRECTIONS;
        return directions[Math.floor(Math.random() * directions.length)];
    }

    private buildWaterGunProfile(context?: SkillContext): WaterGunProfile {
        const payloadProfile = (context?.payload?.waterGunProfile as Partial<WaterGunProfile> | undefined) ?? undefined;
        const profile = createWaterGunProfile(this.level, payloadProfile);
        profile.sustainDuration = Math.max(0.55, profile.sustainDuration);
        profile.range = Math.min(profile.range, this.getWaterGunMaxRange());
        if (this.level >= HighPressureWaterGunSkill.CONFIG.transformLevel) {
            profile.beamWidth *= this.transformedWaterGunBeamWidthMultiplier;
        }
        return profile;
    }

    private getWaterGunMaxRange(): number {
        const visibleWidth = view.getVisibleSize().width;
        if (visibleWidth <= 0) {
            return 240;
        }

        return Math.max(96, visibleWidth * 0.5);
    }

    private updateSprayDirection(): void {
        if (!this.activeProfile) {
            return;
        }

        if (this.activeProfile.nozzleType !== 'rotary' || this.activeProfile.sweepCycles <= 0 || this.activeProfile.sustainDuration <= 0.0001) {
            this.activeDirection.set(Math.cos(this.activeBaseAngle), Math.sin(this.activeBaseAngle), 0);
            return;
        }

        const sweepAmplitude = this.activeProfile.coneAngle * 0.55;
        const normalizedTime = Math.min(1, this.activeElapsed / this.activeProfile.sustainDuration);
        const sweep = Math.sin(normalizedTime * Math.PI * 2 * this.activeProfile.sweepCycles) * sweepAmplitude;
        const angle = this.activeBaseAngle + sweep;
        this.activeDirection.set(Math.cos(angle), Math.sin(angle), 0);
    }

    private updateWaterGunVisual(): void {
        if (!this.activeOwnerNode || !this.activeWaterGun || !this.activeProfile) {
            return;
        }

        const parent = BulletHell.inst?.bullets;
        if (!parent) {
            return;
        }

        const emissionRatio = this.getEmissionRatio(this.activeElapsed, this.activeProfile.sustainDuration);
        const effectiveReach = this.getCurrentWaterGunReach();
        const hasLayeredVisuals = !!this.waterGunBeamCoreNode;
        this.getWaterGunSprayOrigin(this.waterGunWorldPosition);
        Vec3.subtract(this.waterGunLocalPosition, this.waterGunWorldPosition, parent.worldPosition);
        this.activeWaterGun.setPosition(this.waterGunLocalPosition);

        const angle = Math.atan2(this.activeDirection.y, this.activeDirection.x);
        Quat.rotateZ(tempBeamRot, Quat.IDENTITY, angle);
        this.activeWaterGun.setRotation(tempBeamRot);

        if (hasLayeredVisuals) {
            this.activeWaterGun.setScale(this.waterGunScale.set(1, 1, 1));
            this.updateLayeredWaterGunVisual(emissionRatio, effectiveReach);
            return;
        }

        const visualLengthScale = this.getWaterGunVisualLengthScale(this.activeWaterGun.node, emissionRatio, effectiveReach);
        const widthPulse = this.getWaterGunWidthPulse();
        this.waterGunScale.set(
            visualLengthScale,
            Math.max(0.18, this.activeProfile.beamWidth / this.visualWidthBaseline) * widthPulse,
            1
        );
        this.activeWaterGun.setScale(this.waterGunScale);

        const fallbackSprite = this.activeWaterGun.node.getComponent(Sprite);
        if (fallbackSprite) {
            fallbackSprite.color = this.getWaterGunPalette(this.activeProfile.ammoType).core;
        }
    }

    private cacheWaterGunVisualNodes(): void {
        const root = this.activeWaterGun?.node;
        this.waterGunRootSprite = root?.getComponent(Sprite) ?? null;
        this.waterGunBeamCoreNode = root?.getChildByName('BeamCore') ?? null;
        this.waterGunSoftEdgeNode = root?.getChildByName('BeamSoftEdge') ?? null;
        this.waterGunMuzzleNode = root?.getChildByName('MuzzleFlash') ?? null;
        this.waterGunImpactNode = root?.getChildByName('ImpactSplash') ?? null;
        this.waterGunMuzzleParticle = this.getWaterGunParticle(this.waterGunMuzzleNode);
        this.waterGunImpactParticle = this.getWaterGunParticle(this.waterGunImpactNode);
        this.isWaterGunImpactParticleActive = false;

        if (this.waterGunMuzzleNode) {
            this.waterGunMuzzleBaseScale.set(this.waterGunMuzzleNode.scale);
        } else {
            this.waterGunMuzzleBaseScale.set(1, 1, 1);
        }

        if (root && !this.waterGunBeamCoreNode) {
            console.warn('[技能] 高压水枪：未找到 BeamCore，回退为单 Sprite 显示');
        }

        this.waterGunBeamCoreNode && (this.waterGunBeamCoreNode.active = true);
        this.waterGunSoftEdgeNode && (this.waterGunSoftEdgeNode.active = true);
        this.waterGunMuzzleNode && (this.waterGunMuzzleNode.active = true);
        this.waterGunImpactNode && (this.waterGunImpactNode.active = true);

        if (this.waterGunRootSprite) {
            this.waterGunRootSprite.enabled = true;
            this.waterGunRootSprite.color = this.getWaterGunPalette(this.activeProfile?.ammoType ?? 'none').core;
        }
    }

    private updateLayeredWaterGunVisual(emissionRatio: number, effectiveReach: number): void {
        if (!this.activeProfile) {
            return;
        }

        const palette = this.getWaterGunPalette(this.activeProfile.ammoType);
        const pulse = this.activeProfile.nozzleType === 'rotary'
            ? 0.92 + Math.abs(Math.sin(this.activeElapsed * 12)) * 0.24
            : 1;
        const widthPulse = this.getWaterGunWidthPulse();

        const coreLengthScale = this.getWaterGunVisualLengthScale(this.waterGunBeamCoreNode, emissionRatio, effectiveReach);
        const coreWidthScale = Math.max(0.22, this.activeProfile.beamWidth / this.visualWidthBaseline) * widthPulse;
        const edgeWidthScale = coreWidthScale * (this.activeProfile.nozzleType === 'fan' ? 1.45 : 1.18);
        const splashScale = (0.68 + coreWidthScale * 0.42) * (this.activeProfile.nozzleType === 'fan' ? 1.2 : pulse);

        this.waterGunCoreScale.set(coreLengthScale, coreWidthScale, 1);
        this.waterGunSoftEdgeScale.set(coreLengthScale * 1.03, edgeWidthScale, 1);
        this.waterGunSplashScale.set(splashScale, splashScale, 1);
        this.waterGunMuzzleScale.set(this.waterGunMuzzleBaseScale);

        this.waterGunBeamCoreNode?.setScale(this.waterGunCoreScale);
        this.waterGunSoftEdgeNode?.setScale(this.waterGunSoftEdgeScale);
        this.waterGunMuzzleNode?.setScale(this.waterGunMuzzleScale);
        this.waterGunImpactNode?.setScale(this.waterGunSplashScale);

        const beamLength = this.getScaledNodeLength(this.waterGunBeamCoreNode, this.waterGunCoreScale.x);
        if (this.waterGunSoftEdgeNode) {
            this.waterGunSoftEdgeNode.setPosition(-2, 0, 0);
        }
        if (this.waterGunMuzzleNode) {
            this.waterGunMuzzleNode.setPosition(0, 0, 0);
        }
        if (this.waterGunImpactNode) {
            const impactOffset = this.activeProfile.nozzleType === 'direct' ? Math.max(8, beamLength - 2) : Math.max(10, beamLength - 6);
            this.waterGunImpactNode.setPosition(impactOffset, 0, 0);
            this.waterGunImpactNode.active = this.activeProfile.nozzleType !== 'direct' || effectiveReach < this.activeProfile.range;
        }
        this.updateWaterGunImpactParticle();

        this.tintWaterGunNode(this.waterGunBeamCoreNode, palette.core, emissionRatio);
        this.tintWaterGunNode(this.waterGunSoftEdgeNode, palette.edge, emissionRatio);
        this.tintWaterGunNode(this.waterGunMuzzleNode, palette.muzzle, Math.min(1, emissionRatio * 1.1));
        this.tintWaterGunNode(this.waterGunImpactNode, palette.impact, Math.min(1, emissionRatio * 1.05));
    }

    private getScaledNodeLength(node: Node | null, scaleX: number): number {
        return Math.max(1, this.getWaterGunBaseLength(node) * scaleX);
    }

    private getWaterGunBaseLength(node: Node | null): number {
        const transform = node?.getComponent(UITransform);
        return Math.max(1, transform?.contentSize.width ?? this.waterGunDefaultVisualLength);
    }

    private getWaterGunVisualLengthScale(node: Node | null, emissionRatio: number, visualDistance?: number): number {
        if (!this.activeProfile) {
            return 1;
        }

        const baseLength = this.getWaterGunBaseLength(node);
        const visualLength = Math.max(6, (visualDistance ?? this.activeProfile.range) * emissionRatio);
        return Math.max(0.08, visualLength / baseLength);
    }

    private getWaterGunWidthPulse(): number {
        const amplitude = this.activeProfile?.nozzleType === 'rotary' ? 0.16 : 0.12;
        return 1 + Math.sin(this.activeElapsed * 16) * amplitude;
    }

    private getWaterGunSprayOrigin(out: Vec3): Vec3 {
        if (!this.activeOwnerNode) {
            return out.set(0, 0, 0);
        }

        return out.set(
            this.activeOwnerNode.worldPosition.x + this.activeDirection.x * this.waterGunOriginOffset,
            this.activeOwnerNode.worldPosition.y + this.activeDirection.y * this.waterGunOriginOffset,
            this.activeOwnerNode.worldPosition.z
        );
    }

    private getWaterGunParticle(node: Node | null): ParticleSystem2D | null {
        if (!node) {
            return null;
        }

        const direct = node.getComponent('ParticleSystem2D') as ParticleSystem2D | null;
        if (direct) {
            return direct;
        }

        const nested = node.getComponentInChildren('ParticleSystem2D') as Component | null;
        return nested as ParticleSystem2D | null;
    }

    private playWaterGunParticle(particle: ParticleSystem2D | null, reset: boolean = false): void {
        if (!particle) {
            return;
        }

        if (reset) {
            particle.resetSystem();
            return;
        }

        particle.resetSystem();
    }

    private stopWaterGunParticle(particle: ParticleSystem2D | null, clear: boolean = false): void {
        if (!particle) {
            return;
        }

        particle.stopSystem();
    }

    private updateWaterGunImpactParticle(): void {
        const shouldPlay = !!this.waterGunImpactNode?.active;
        if (shouldPlay === this.isWaterGunImpactParticleActive) {
            return;
        }

        this.isWaterGunImpactParticleActive = shouldPlay;
        if (shouldPlay) {
            this.playWaterGunParticle(this.waterGunImpactParticle, true);
            return;
        }

        this.stopWaterGunParticle(this.waterGunImpactParticle, true);
    }

    private tintWaterGunNode(node: Node | null, color: Color, alphaScale: number): void {
        const sprite = node?.getComponent(Sprite);
        if (!sprite) {
            return;
        }

        this.tintWaterGunSprite(sprite, color, alphaScale);
    }

    private tintWaterGunSprite(sprite: Sprite | null, color: Color, alphaScale: number): void {
        if (!sprite) {
            return;
        }

        sprite.color = new Color(
            color.r,
            color.g,
            color.b,
            Math.max(0, Math.min(255, Math.round(color.a * alphaScale)))
        );
    }

    private getWaterGunPalette(ammoType: WaterGunAmmoType): { core: Color; edge: Color; muzzle: Color; impact: Color } {
        switch (ammoType) {
            case 'hot':
                return {
                    core: new Color(255, 235, 190, 255),
                    edge: new Color(255, 179, 112, 154),
                    muzzle: new Color(255, 246, 214, 232),
                    impact: new Color(255, 188, 120, 214),
                };
            case 'soap':
                return {
                    core: new Color(214, 245, 255, 255),
                    edge: new Color(173, 226, 255, 148),
                    muzzle: new Color(245, 252, 255, 232),
                    impact: new Color(214, 244, 255, 204),
                };
            case 'ice':
                return {
                    core: new Color(184, 239, 255, 255),
                    edge: new Color(110, 206, 255, 156),
                    muzzle: new Color(228, 249, 255, 228),
                    impact: new Color(152, 225, 255, 214),
                };
            case 'none':
            default:
                return {
                    core: new Color(120, 198, 255, 255),
                    edge: new Color(176, 228, 255, 136),
                    muzzle: new Color(240, 249, 255, 218),
                    impact: new Color(178, 228, 255, 186),
                };
        }
    }

    private getEmissionRatio(elapsed: number, sustainDuration: number): number {
        if (elapsed <= this.expandDuration) {
            return Math.max(0.35, elapsed / Math.max(0.001, this.expandDuration));
        }

        if (elapsed <= sustainDuration) {
            return 1;
        }

        const fadeElapsed = elapsed - sustainDuration;
        return Math.max(0.05, 1 - fadeElapsed / Math.max(0.001, this.shrinkDuration));
    }

    private applyContinuousSprayDamage(): void {
        if (!this.activeOwnerNode || !this.activeProfile) {
            return;
        }

        if (isSkillDamageDisabledForTesting(HighPressureWaterGunSkill.CONFIG.id)) {
            return;
        }

        const enemies = this.collectSprayTargets();
        for (const enemy of enemies) {
            const damage = this.getDamageForEnemy(enemy, this.activeProfile);
            if (damage <= 0) {
                continue;
            }

            enemy.takeDamage(damage, this.activeOwnerNode);

            if (this.activeProfile.knockback > 0 && enemy.isBoss) {
                enemy.applyKnockback(
                    this.activeDirection,
                    this.activeProfile.knockback * this.waterGunKnockbackMultiplier,
                    this.waterGunKnockbackDuration
                );
            }

            if (this.activeProfile.ammoType === 'ice' && this.activeProfile.slowDuration > 0) {
                enemy.applyMovementDebuff(this.activeProfile.slowDuration, this.activeProfile.slowMultiplier);
            }
        }
    }

    private applyContinuousSprayContactKnockback(): void {
        if (!this.activeOwnerNode || !this.activeProfile || this.activeProfile.knockback <= 0) {
            return;
        }

        const enemies = this.collectSprayTargets();
        for (const enemy of enemies) {
            if (enemy.isBoss) {
                continue;
            }

            enemy.applyKnockback(
                this.activeDirection,
                this.activeProfile.knockback * this.waterGunContactKnockbackMultiplier,
                this.waterGunContactKnockbackDuration
            );
        }
    }

    private collectSprayTargets(): Enemy[] {
        const effectiveReach = this.getCurrentWaterGunReach();
        const candidates = this.collectSprayTargetCandidates(effectiveReach);
        if (!this.activeProfile) {
            return [];
        }

        if (this.activeProfile.nozzleType === 'direct') {
            return candidates.slice(0, 1).map(item => item.enemy);
        }

        return candidates.map(item => item.enemy);
    }

    private collectSprayTargetCandidates(maxDistanceOverride?: number): Array<{ enemy: Enemy; distance: number }> {
        if (!this.activeOwnerNode || !this.activeProfile) {
            return [];
        }

        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return [];
        }

        const candidates: Array<{ enemy: Enemy; distance: number }> = [];
        const origin = this.getWaterGunSprayOrigin(this.waterGunWorldPosition);
        const maxForwardDistance = Math.max(0, Math.min(maxDistanceOverride ?? this.activeProfile.range, this.activeProfile.range));
        const maxRadiusDistance = this.activeProfile.range;
        const halfBeamWidth = this.activeProfile.beamWidth * 0.5;
        const halfCone = this.activeProfile.coneAngle * 0.5;
        const facing = this.activeDirection.clone().normalize();

        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead) {
                continue;
            }

            const deltaX = enemyNode.worldPosition.x - origin.x;
            const deltaY = enemyNode.worldPosition.y - origin.y;
            const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
            if (distance > maxRadiusDistance || distance <= 0.0001) {
                continue;
            }

            const forwardDot = Math.max(-1, Math.min(1, (deltaX / distance) * facing.x + (deltaY / distance) * facing.y));
            const angle = Math.acos(forwardDot);
            if (angle > halfCone) {
                continue;
            }

            const projection = deltaX * facing.x + deltaY * facing.y;
            if (projection <= 0.0001 || projection > maxForwardDistance) {
                continue;
            }

            const perpendicular = Math.sqrt(Math.max(0, distance * distance - projection * projection));
            if (this.activeProfile.nozzleType === 'direct' && perpendicular > halfBeamWidth) {
                continue;
            }

            candidates.push({ enemy, distance: projection });
        }

        candidates.sort((left, right) => left.distance - right.distance);
        return candidates;
    }

    private getDamageForEnemy(enemy: Enemy, profile: WaterGunProfile): number {
        let damage = profile.damagePerTick;
        if (profile.ammoType === 'hot' && this.isOilContaminantEnemy(enemy)) {
            damage *= 1.5;
        }

        return damage;
    }

    private isOilContaminantEnemy(enemy: Enemy): boolean {
        const rawType = `${(enemy as any).enemyType ?? ''} ${enemy.node.name ?? ''}`.toLowerCase();
        return /oil|grease|slime|youwu|油污|油渍/.test(rawType);
    }

    private clearActiveWaterGun(): void {
        if (this.activeWaterGun) {
            Skill.put(this.activeWaterGun);
            this.activeWaterGun = null;
        }

        this.activeOwnerNode = null;
        this.activeProfile = null;
        this.activeElapsed = 0;
        this.damageTickElapsed = 0;
        this.activeBaseAngle = 0;
        this.activeDirection.set(1, 0, 0);
        this.waterGunBeamCoreNode = null;
        this.waterGunSoftEdgeNode = null;
        this.waterGunMuzzleNode = null;
        this.waterGunImpactNode = null;
        this.stopWaterGunParticle(this.waterGunMuzzleParticle, true);
        this.stopWaterGunParticle(this.waterGunImpactParticle, true);
        this.waterGunMuzzleParticle = null;
        this.waterGunImpactParticle = null;
        this.isWaterGunImpactParticleActive = false;
        this.waterGunRootSprite = null;
        this.waterGunMuzzleBaseScale.set(1, 1, 1);
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
    private readonly visualBaseRadiusFallback = 120;
    private slowDuration = 0.36;
    private slowMultiplier = 0.76;

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
        this.slowDuration = 0.34 + this.level * 0.02;
        this.slowMultiplier = Math.max(0.48, 0.8 - this.level * 0.025);
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
        const bulletsParent = BulletHell.inst?.bullets;
        const objectsParent = BulletHell.inst?.objects;
        const visualParent = objectsParent?.parent ?? bulletsParent;
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

        if (visualParent && prefab) {
            const visual = Skill.get(prefab);
            if (visual) {
                visual.insert(visualParent);
                visual.init();

                if (objectsParent && visual.node.parent === objectsParent.parent) {
                    visual.node.setSiblingIndex(objectsParent.getSiblingIndex());
                }

                const localPos = new Vec3();
                Vec3.subtract(localPos, this.fieldCenter, visualParent.worldPosition);
                visual.setPosition(localPos);
                visual.velocity.set(0, 0, 0);
                visual.lifeTime = this.duration + 0.1;
                visual.disableAutoRotation = true;
                visual.trigger = false;

                const scaleRatio = Math.max(0.1, this.radius / this.getTrashBagVisualBaseRadius(visual.node));
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

        if (isSkillDamageDisabledForTesting(TrashBagFieldSkill.CONFIG.id)) {
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
                enemy.applyMovementDebuff(
                    this.slowDuration,
                    enemy.isBoss ? Math.max(0.75, this.slowMultiplier + 0.18) : this.slowMultiplier
                );
            }
        }
    }

    private getTrashBagVisualBaseRadius(node: Node): number {
        const transform = node.getComponent(UITransform);
        if (!transform) {
            return this.visualBaseRadiusFallback;
        }

        return Math.max(
            1,
            Math.max(transform.contentSize.width, transform.contentSize.height) * 0.5
        );
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
    private static readonly THROW_CLIP_NAME = 'throw';
    private static readonly RELEASE_CLIP_NAME = 'yaliguan_shifang';

    static CONFIG: SkillConfig = {
        id: 'vacuum_vortex',
        name: '压力罐冲击',
        description: '周期性抛出压力罐，延时爆炸并震开敌人，满级后可追加眩晕。',
        icon: 'skill_vacuum',
        ...commonActiveSkillConfig,
    } as SkillConfig;

    private throwDistance = 120;
    private throwTravelDuration = 0.38;
    private fuseTime = 1.8;
    private blastRadius = 110;
    private impactDamage = 42;
    private knockbackStrength = 240;
    private stunDuration = 0;
    private readonly activeCanisters: PressureCanisterState[] = [];
    private readonly canisterBaseScale = new Vec3(1, 1, 1);
    private readonly shockwaveStartScale = new Vec3(0.18, 0.18, 1);
    private readonly shockwaveTargetScale = new Vec3(1, 1, 1);
    private readonly tempDirection = new Vec3(1, 0, 0);
    private readonly tempLandingPosition = new Vec3();
    private readonly tempLocalPosition = new Vec3();
    private readonly tempScale = new Vec3(1, 1, 1);
    private readonly tempEnemyDelta = new Vec3();
    private readonly fallbackThrowDirection = new Vec3(1, 0, 0);

    constructor(level: number = 1) {
        super(VacuumVortexSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel() {
        this.cooldown = Math.max(2.2, 3.8 - (this.level - 1) * 0.16);
        this.throwDistance = 96 + this.level * 10;
        this.fuseTime = Math.max(1.1, 2.1 - (this.level - 1) * 0.06);
        this.blastRadius = 88 + this.level * 10;
        this.impactDamage = 24 + this.level * 14;
        this.knockbackStrength = 170 + this.level * 42;
        this.stunDuration = this.isTransformed ? 1.2 : 0;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public getDescription(): string {
        const stunText = this.stunDuration > 0
            ? `爆炸后额外眩晕 ${this.stunDuration.toFixed(1)}s。`
            : '满级后会追加地面眩晕。';
        return `每 ${this.cooldown.toFixed(1)}s 抛出一个压力罐，${this.fuseTime.toFixed(1)}s 后爆炸，造成 ${this.impactDamage} 伤害并击退半径 ${Math.round(this.blastRadius)} 内敌人。${stunText}`;
    }

    public update(dt: number): void {
        super.update(dt);

        if (this.activeCanisters.length <= 0) {
            return;
        }

        for (let i = this.activeCanisters.length - 1; i >= 0; i--) {
            const canister = this.activeCanisters[i];
            canister.elapsed += dt;
            if (canister.isExploding) {
                canister.explosionElapsed += dt;
            }
            this.updateCanisterVisual(canister);

            if (!canister.isExploding && canister.elapsed >= canister.fuseTime) {
                this.explodeCanister(canister);
            }

            if (canister.isExploding && canister.explosionElapsed >= canister.explosionDuration) {
                this.activeCanisters.splice(i, 1);
            }
        }
    }

    protected onUse(context: SkillContext): void {
        const ownerPosition = context.ownerNode.worldPosition;
        const parent = BulletHell.inst?.bullets;
        const prefab = context.payload?.visual?.projectilePrefab ?? null;
        const impactPrefab = context.payload?.visual?.impactPrefab ?? null;

        const landingPosition = this.getLandingPosition(context);
        const direction = new Vec3(
            landingPosition.x - ownerPosition.x,
            landingPosition.y - ownerPosition.y,
            0
        );
        if (direction.lengthSqr() <= 0.0001) {
            direction.set(this.getFallbackThrowDirection());
        }
        direction.normalize();

        let visual: Skill | null = null;
        if (parent && prefab) {
            visual = Skill.get(prefab);
            if (visual) {
                visual.insert(parent);
                visual.init();
                visual.disableAutoRotation = true;
                visual.trigger = false;
                visual.velocity.set(0, 0, 0);
                visual.lifeTime = this.fuseTime + 0.8;
                visual.damage = 0;
                visual.penetration = 9999;
                visual.knockback = 0;
                this.canisterBaseScale.set(visual.node.scale);
                this.playPressureCanisterAnimation(visual.node, VacuumVortexSkill.THROW_CLIP_NAME);
            }
        }

        const canister: PressureCanisterState = {
            visual,
            impactPrefab,
            launchPosition: new Vec3(ownerPosition.x, ownerPosition.y, ownerPosition.z),
            landingPosition: new Vec3(landingPosition.x, landingPosition.y, landingPosition.z),
            currentPosition: new Vec3(ownerPosition.x, ownerPosition.y, ownerPosition.z),
            throwDirection: new Vec3(direction.x, direction.y, 0),
            elapsed: 0,
            fuseTime: this.fuseTime,
            damage: this.impactDamage,
            blastRadius: this.blastRadius,
            knockbackStrength: this.knockbackStrength,
            stunDuration: this.stunDuration,
            arcHeight: 28 + this.throwDistance * 0.22,
            isExploding: false,
            explosionElapsed: 0,
            explosionDuration: 0.3,
        };

        this.activeCanisters.push(canister);
        this.updateCanisterVisual(canister);
    }

    private getLandingPosition(context: SkillContext): Vec3 {
        const origin = context.ownerNode.worldPosition;
        const target = context.targetPosition ?? this.findNearestEnemyPosition(origin);

        if (target) {
            this.tempDirection.set(target.x - origin.x, target.y - origin.y, 0);
        } else {
            this.tempDirection.set(this.getFallbackThrowDirection());
        }

        if (this.tempDirection.lengthSqr() <= 0.0001) {
            this.tempDirection.set(this.getFallbackThrowDirection());
        }

        this.tempDirection.normalize();
        this.tempLandingPosition.set(
            origin.x + this.tempDirection.x * this.throwDistance,
            origin.y + this.tempDirection.y * this.throwDistance,
            origin.z
        );

        return this.tempLandingPosition;
    }

    private getFallbackThrowDirection(): Vec3 {
        const angle = Math.random() * Math.PI * 2;
        this.fallbackThrowDirection.set(Math.cos(angle), Math.sin(angle), 0);
        return this.fallbackThrowDirection;
    }

    private findNearestEnemyPosition(origin: Vec3): Vec3 | null {
        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return null;
        }

        let nearest: Vec3 | null = null;
        let nearestDistanceSq = Number.POSITIVE_INFINITY;

        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState) {
                continue;
            }

            const dx = enemyNode.worldPosition.x - origin.x;
            const dy = enemyNode.worldPosition.y - origin.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq >= nearestDistanceSq) {
                continue;
            }

            nearestDistanceSq = distanceSq;
            nearest = enemyNode.worldPosition;
        }

        return nearest;
    }

    private updateCanisterVisual(canister: PressureCanisterState): void {
        const travelProgress = Math.min(1, canister.elapsed / this.throwTravelDuration);
        const easedTravel = 1 - Math.pow(1 - travelProgress, 2);
        const arcFactor = Math.sin(travelProgress * Math.PI);

        const verticalArcOffset = canister.isExploding ? 0 : arcFactor * canister.arcHeight;

        canister.currentPosition.set(
            canister.launchPosition.x + (canister.landingPosition.x - canister.launchPosition.x) * easedTravel,
            canister.launchPosition.y + (canister.landingPosition.y - canister.launchPosition.y) * easedTravel + verticalArcOffset,
            canister.launchPosition.z
        );

        if (canister.isExploding) {
            canister.currentPosition.set(canister.landingPosition);
        }

        const visual = canister.visual;
        const parent = BulletHell.inst?.bullets;
        if (!visual || !parent) {
            return;
        }

        Vec3.subtract(this.tempLocalPosition, canister.currentPosition, parent.worldPosition);
        visual.setPosition(this.tempLocalPosition);

        if (canister.isExploding) {
            const explosionProgress = Math.min(1, canister.explosionElapsed / Math.max(0.001, canister.explosionDuration));
            const releaseScale = 1 + explosionProgress * 0.45;
            this.tempScale.set(
                this.canisterBaseScale.x * releaseScale,
                this.canisterBaseScale.y * releaseScale,
                this.canisterBaseScale.z
            );
            visual.setScale(this.tempScale);
            return;
        }

        const pulse = canister.elapsed >= canister.fuseTime * 0.65
            ? 1 + Math.sin(canister.elapsed * 24) * 0.16
            : 1;
        const arcScale = 0.92 + arcFactor * 0.22;
        const squash = 0.84 + arcFactor * 0.34;
        this.tempScale.set(
            this.canisterBaseScale.x * squash * pulse,
            this.canisterBaseScale.y * arcScale * pulse,
            this.canisterBaseScale.z
        );
        visual.setScale(this.tempScale);
    }

    private explodeCanister(canister: PressureCanisterState): void {
        canister.isExploding = true;
        canister.explosionElapsed = 0;
        this.spawnImpactShockwave(canister);
        const enemies = this.collectEnemiesInRadius(canister.landingPosition, canister.blastRadius);
        for (const enemy of enemies) {
            const enemyPosition = enemy.node.worldPosition;
            this.tempEnemyDelta.set(
                enemyPosition.x - canister.landingPosition.x,
                enemyPosition.y - canister.landingPosition.y,
                0
            );

            const distance = this.tempEnemyDelta.length();
            if (distance <= 0.001) {
                this.tempEnemyDelta.set(canister.throwDirection);
            } else {
                this.tempEnemyDelta.multiplyScalar(1 / distance);
            }

            const distanceRatio = Math.max(0.25, 1 - distance / Math.max(1, canister.blastRadius));
            const damage = Math.round(canister.damage * (0.7 + distanceRatio * 0.6));
            enemy.takeDamage(damage);
            enemy.applyKnockback(
                this.tempEnemyDelta,
                canister.knockbackStrength * (enemy.isBoss ? 0.45 : 1),
                enemy.isBoss ? 0.12 : 0.18
            );

            if (canister.stunDuration > 0 && !enemy.isBoss) {
                enemy.applyStun(canister.stunDuration);
            }
        }

        if (canister.visual) {
            if (canister.impactPrefab) {
                Skill.put(canister.visual);
                canister.visual = null;
            } else {
                const releaseDuration = this.playPressureCanisterAnimation(canister.visual.node, VacuumVortexSkill.RELEASE_CLIP_NAME);
                canister.explosionDuration = Math.max(0.24, releaseDuration || 0.3);
                canister.visual.lifeTime = canister.explosionDuration + 0.1;
            }
        }

        this.updateCanisterVisual(canister);
    }

    private spawnImpactShockwave(canister: PressureCanisterState): void {
        const impactPrefab = canister.impactPrefab;
        const parent = BulletHell.inst?.bullets;
        if (!impactPrefab || !parent) {
            return;
        }

        const shockwave = Skill.get(impactPrefab);
        if (!shockwave) {
            return;
        }

        shockwave.insert(parent);
        shockwave.init();
        shockwave.disableAutoRotation = true;
        shockwave.trigger = false;
        shockwave.velocity.set(0, 0, 0);
        shockwave.damage = 0;
        shockwave.penetration = 9999;
        shockwave.knockback = 0;

        Vec3.subtract(this.tempLocalPosition, canister.landingPosition, parent.worldPosition);
        shockwave.setPosition(this.tempLocalPosition);

        const releaseDuration = this.playPressureCanisterAnimation(shockwave.node, VacuumVortexSkill.RELEASE_CLIP_NAME);
        canister.explosionDuration = Math.max(0.24, releaseDuration || 0.32);
        shockwave.lifeTime = canister.explosionDuration + 0.1;

        const baseRadius = this.getImpactVisualBaseRadius(shockwave.node);
        const targetScale = Math.max(0.08, canister.blastRadius / Math.max(1, baseRadius));

        this.shockwaveStartScale.set(targetScale * 0.18, targetScale * 0.18, 1);
        this.shockwaveTargetScale.set(targetScale, targetScale, 1);
        shockwave.setScale(this.shockwaveStartScale);

        tween(shockwave.node)
            .stop()
            .to(canister.explosionDuration, { scale: this.shockwaveTargetScale })
            .start();
    }

    private getImpactVisualBaseRadius(node: Node): number {
        const transform = node.getComponent(UITransform);
        if (!transform) {
            return 64;
        }

        return Math.max(1, Math.max(transform.contentSize.width, transform.contentSize.height) * 0.5);
    }

    private playPressureCanisterAnimation(node: Node, preferredClipName: string): number {
        const animations = node.getComponentsInChildren(Animation);
        if (!animations || animations.length <= 0) {
            return 0;
        }

        let maxDuration = 0;
        for (const animation of animations) {
            const animationAny = animation as any;
            const clips = (animationAny.clips as Array<{ name?: string; duration?: number }> | undefined) ?? [];
            const clip = clips.find(item => item?.name === preferredClipName) ?? animationAny.defaultClip ?? clips[0] ?? null;
            if (!clip) {
                continue;
            }

            animation.stop();
            if (clip.name) {
                animation.play(clip.name);
            } else {
                animation.play();
            }

            if (typeof clip.duration === 'number' && clip.duration > maxDuration) {
                maxDuration = clip.duration;
            }
        }

        return maxDuration;
    }

    private collectEnemiesInRadius(center: Vec3, radius: number): Enemy[] {
        const enemies: Enemy[] = [];
        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return enemies;
        }

        const radiusSq = radius * radius;
        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState) {
                continue;
            }

            const dx = enemyNode.worldPosition.x - center.x;
            const dy = enemyNode.worldPosition.y - center.y;
            if (dx * dx + dy * dy <= radiusSq) {
                enemies.push(enemy);
            }
        }

        return enemies;
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
    private static readonly vortexVisualBaselineByPrefab = new WeakMap<import('cc').Prefab, { scale: Vec3; radius: number }>();

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

    private standbyRadius = 72;
    private minPlayerClearRadius = 56;
    private maxLeashRadius = 148;
    private followMoveSpeed = 150;
    private dashMoveSpeed = 780;
    private castMoveMinRadius = 48;
    private castMoveMaxRadius = 110;

    private castLockDuration = 0.55;
    private vanishDuration = 0.3;
    private vanishEveryCasts = 3;
    private castControlRadiusFactor = 1.0;
    private castSlowDuration = 0.12;
    private castKillSuctionDuration = 0.26;
    private readonly baseCastDamage = 24;
    private readonly castDamageGrowthPerLevel = 10;
    private readonly castDamageTuningMultiplier = 1;
    private castDamage = 24;

    private ownerNode: Node | null = null;
    private summonParent: Node | null = null;
    private guardVisual: Skill | null = null;
    private guardVisualPrefab: import('cc').Prefab | null = null;
    private guardAnimations: Animation[] = [];
    private guardVortexNode: Node | null = null;
    private readonly guardMoveAnimationClipName = 'weibing_walking';
    private readonly guardAttackAnimationClipName = 'xishou';

    private isSummoned = false;
    private summonElapsed = 0;
    private attackElapsed = 0;
    private castLockElapsed = 0;
    private vanishElapsed = 0;
    private isCasting = false;
    private isVanishing = false;
    private isRepositioningForCast = false;
    private castsSinceVanish = 0;

    private readonly guardPosition = new Vec3();
    private readonly standbyOffset = new Vec3();
    private readonly desiredWorldPosition = new Vec3();
    private readonly castTargetWorldPosition = new Vec3();
    private readonly tempLocalPosition = new Vec3();
    private readonly castCenterWorldPosition = new Vec3();
    private readonly tempMoveDelta = new Vec3();
    private readonly tempOwnerOffset = new Vec3();
    private readonly guardBaseScale = new Vec3(1, 1, 1);
    private readonly vortexBaseScale = new Vec3(1, 1, 1);
    private readonly vortexHiddenScale = new Vec3(0.2, 0.2, 1);
    private readonly vortexChargeScale = new Vec3(1, 1, 1);
    private readonly vortexCastScale = new Vec3(1, 1, 1);
    private readonly tempVortexScale = new Vec3(1, 1, 1);
    private hasCachedVortexBaseScale = false;
    private vortexVisualBaseRadius = 16;

    constructor(level: number = 1) {
        super(TrashGuardSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel() {
        this.attackRadius = 132;
        this.attackInterval = Math.max(1.1, 3.15 - 0.22 * (this.level - 1));
        this.castDamage = Math.round(
            (this.baseCastDamage + this.castDamageGrowthPerLevel * (this.level - 1)) * this.castDamageTuningMultiplier
        );
        this.summonDuration = 22 + this.level * 2.0;
        this.standbyRadius = 56 + this.level * 4;
        this.minPlayerClearRadius = Math.min(this.standbyRadius - 10, 50 + this.level * 2);
        this.maxLeashRadius = 132 + this.level * 6;
        this.followMoveSpeed = 132 + this.level * 10;
        this.dashMoveSpeed = 700 + this.level * 24;
        this.castMoveMinRadius = Math.max(this.minPlayerClearRadius + 8, Math.min(82, 40 + this.level * 2));
        this.castMoveMaxRadius = Math.min(this.maxLeashRadius - 12, 92 + this.level * 5);
        this.castLockDuration = Math.max(0.35, 0.58 - this.level * 0.01);
        this.castSlowDuration = this.castLockDuration + 0.08;
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
                this.playGuardMoveAnimation();
            }
            return;
        }

        if (this.isRepositioningForCast) {
            if (this.moveGuardTowards(this.castTargetWorldPosition, this.dashMoveSpeed, dt)) {
                this.isRepositioningForCast = false;
                this.startCast();
            }
            return;
        }

        if (this.isCasting) {
            this.applyCastControl();
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
            this.beginCastReposition();
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
        this.guardVisualPrefab = prefab;

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

        this.cacheGuardVisualNodes();

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
        this.isRepositioningForCast = false;
        this.castsSinceVanish = 0;

        this.pickStandbyOffset();
        this.guardPosition.set(this.ownerNode.worldPosition);
        this.guardPosition.add(this.standbyOffset);
        this.syncGuardToWorld(this.guardPosition);
        this.resetGuardVisualState();
        this.playGuardMoveAnimation();

        //console.log(`[召唤] 垃圾桶卫兵 已召唤，持续 ${this.summonDuration.toFixed(1)}s，攻击半径 ${this.attackRadius}`);
    }

    public onUnequip(owner: Node): void {
        this.clearGuard();
    }

    private followOwner(dt: number): void {
        if (!this.ownerNode || !this.guardVisual) {
            return;
        }

        const ownerPos = this.ownerNode.worldPosition;
        this.desiredWorldPosition.set(
            ownerPos.x + this.standbyOffset.x,
            ownerPos.y + this.standbyOffset.y,
            0
        );
        this.clampWithinLeash(ownerPos, this.desiredWorldPosition);

        let moveSpeed = this.followMoveSpeed;
        Vec3.subtract(this.tempMoveDelta, this.guardPosition, ownerPos);
        if (this.tempMoveDelta.lengthSqr() > this.maxLeashRadius * this.maxLeashRadius) {
            moveSpeed *= 2;
        }

        this.moveGuardTowards(this.desiredWorldPosition, moveSpeed, dt);
    }

    private beginCastReposition(): void {
        if (!this.ownerNode) {
            return;
        }

        const ownerPos = this.ownerNode.worldPosition;
        const angle = this.getCurrentRelativeAngle(ownerPos) + (Math.random() - 0.5) * Math.PI * 0.9;
        const radius = this.castMoveMinRadius + Math.random() * Math.max(0, this.castMoveMaxRadius - this.castMoveMinRadius);
        this.castTargetWorldPosition.set(
            ownerPos.x + Math.cos(angle) * radius,
            ownerPos.y + Math.sin(angle) * radius,
            0
        );
        this.clampWithinLeash(ownerPos, this.castTargetWorldPosition);
        this.isRepositioningForCast = true;
    }

    private startCast(): void {
        if (!this.guardVisual) {
            return;
        }

        this.isCasting = true;
        this.castLockElapsed = 0;
        this.castCenterWorldPosition.set(this.guardPosition);
        this.playGuardAttackAnimation();
        this.showVortexChargeEffect();

        // 攻击前摇：短促放大，制造“剧烈释放”感。
        tween(this.guardVisual.node)
            .stop()
            .to(0.18, { scale: new Vec3(1.45, 1.45, 1) })
            .to(0.16, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    private executeSuctionAndExecution(): void {
        if (!this.ownerNode) {
            return;
        }

        if (isSkillDamageDisabledForTesting(TrashGuardSkill.CONFIG.id)) {
            this.playVortexCastEffect(() => this.playGuardMoveAnimation());
            return;
        }

        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            this.playVortexCastEffect(() => this.playGuardMoveAnimation());
            return;
        }

        const radius = this.attackRadius * this.castControlRadiusFactor;
        const radiusSqr = radius * radius;
        let killCount = 0;
        let hitCount = 0;

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

            const willBeKilled = enemy.currentHp <= this.castDamage;
            if (willBeKilled) {
                enemy.setSuctionDeathTarget(this.castCenterWorldPosition, this.castKillSuctionDuration);
            }

            enemy.takeDamage(this.castDamage, this.ownerNode);
            hitCount++;
            if (willBeKilled) {
                killCount++;
            }
        }

        if (hitCount > 0) {
            console.log(`[召唤] 垃圾桶卫兵释放收束打击，命中 ${hitCount} 个目标，击杀 ${killCount} 个目标，单次伤害 ${this.castDamage}`);
        }

        this.playVortexCastEffect(() => this.playGuardMoveAnimation());
    }

    private applyCastControl(): void {
        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return;
        }

        const radius = this.attackRadius * this.castControlRadiusFactor;
        const radiusSqr = radius * radius;
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

            enemy.applyMovementDebuff(this.castSlowDuration, enemy.isBoss ? 0.28 : 0);
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
        if (this.guardVortexNode) {
            tween(this.guardVortexNode).stop();
            if (this.hasCachedVortexBaseScale) {
                this.guardVortexNode.setScale(this.vortexBaseScale);
            }
            this.guardVortexNode.active = false;
        }

        if (this.guardVisual) {
            tween(this.guardVisual.node).stop();
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
        this.isRepositioningForCast = false;
        this.castsSinceVanish = 0;
        this.guardAnimations = [];
        this.guardVisualPrefab = null;
        this.guardVortexNode = null;
    }

    private pickStandbyOffset(): void {
        const angle = this.getCurrentRelativeAngle(this.ownerNode?.worldPosition ?? Vec3.ZERO) + (Math.random() - 0.5) * Math.PI * 0.45;
        const radius = this.standbyRadius * (0.72 + Math.random() * 0.22);
        this.standbyOffset.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    }

    private clampWithinLeash(ownerWorldPos: Vec3, targetWorldPos: Vec3): void {
        Vec3.subtract(this.tempMoveDelta, targetWorldPos, ownerWorldPos);
        const distance = this.tempMoveDelta.length();
        if (distance > this.maxLeashRadius) {
            this.tempMoveDelta.multiplyScalar(this.maxLeashRadius / distance);
            targetWorldPos.set(
                ownerWorldPos.x + this.tempMoveDelta.x,
                ownerWorldPos.y + this.tempMoveDelta.y,
                0
            );
        } else if (distance > 0.0001 && distance < this.minPlayerClearRadius) {
            this.tempMoveDelta.multiplyScalar(this.minPlayerClearRadius / distance);
            targetWorldPos.set(
                ownerWorldPos.x + this.tempMoveDelta.x,
                ownerWorldPos.y + this.tempMoveDelta.y,
                0
            );
        } else if (distance <= 0.0001) {
            targetWorldPos.set(ownerWorldPos.x + this.minPlayerClearRadius, ownerWorldPos.y, 0);
        }
    }

    private moveGuardTowards(targetWorldPos: Vec3, speed: number, dt: number): boolean {
        const ownerPos = this.ownerNode?.worldPosition;
        if (ownerPos) {
            this.clampWithinLeash(ownerPos, targetWorldPos);
        }

        Vec3.subtract(this.tempMoveDelta, targetWorldPos, this.guardPosition);
        const distance = this.tempMoveDelta.length();
        if (distance <= 0.001) {
            this.guardPosition.set(targetWorldPos);
            if (ownerPos) {
                this.clampWithinLeash(ownerPos, this.guardPosition);
            }
            this.syncGuardToWorld(this.guardPosition);
            return true;
        }

        const maxStep = Math.max(0, speed) * dt;
        if (distance <= maxStep) {
            this.guardPosition.set(targetWorldPos);
            if (ownerPos) {
                this.clampWithinLeash(ownerPos, this.guardPosition);
            }
            this.syncGuardToWorld(this.guardPosition);
            return true;
        }

        this.tempMoveDelta.multiplyScalar(maxStep / distance);
        this.guardPosition.add(this.tempMoveDelta);
        if (ownerPos) {
            this.clampWithinLeash(ownerPos, this.guardPosition);
        }
        this.syncGuardToWorld(this.guardPosition);
        return false;
    }

    private getCurrentRelativeAngle(ownerWorldPos: Vec3): number {
        Vec3.subtract(this.tempOwnerOffset, this.guardPosition, ownerWorldPos);
        if (this.tempOwnerOffset.lengthSqr() <= 0.0001) {
            return randomAngle();
        }

        return Math.atan2(this.tempOwnerOffset.y, this.tempOwnerOffset.x);
    }

    private cacheGuardVisualNodes(): void {
        if (!this.guardVisual) {
            this.guardAnimations = [];
            this.guardVortexNode = null;
            return;
        }

        this.guardAnimations = this.guardVisual.node.getComponentsInChildren(Animation);
        this.guardBaseScale.set(this.guardVisual.node.scale);
        this.guardVortexNode = this.findGuardVortexNode(this.guardVisual.node);
        if (this.guardVortexNode) {
            const cachedBaseline = this.guardVisualPrefab
                ? TrashGuardSkill.vortexVisualBaselineByPrefab.get(this.guardVisualPrefab)
                : null;

            if (cachedBaseline) {
                this.vortexBaseScale.set(cachedBaseline.scale);
                this.vortexVisualBaseRadius = cachedBaseline.radius;
                this.hasCachedVortexBaseScale = true;
            } else if (!this.hasCachedVortexBaseScale) {
                const currentScale = this.guardVortexNode.scale;
                const looksLikeHiddenScale = currentScale.x <= this.vortexHiddenScale.x + 0.001 && currentScale.y <= this.vortexHiddenScale.y + 0.001;
                if (looksLikeHiddenScale) {
                    this.vortexBaseScale.set(1, 1, 1);
                } else {
                    this.vortexBaseScale.set(currentScale);
                }

                this.guardVortexNode.setScale(this.vortexBaseScale);
                const vortexTransform = this.guardVortexNode.getComponent(UITransform);
                const maxSize = Math.max(vortexTransform?.contentSize.width ?? 0, vortexTransform?.contentSize.height ?? 0);
                const baseScaleRadius = Math.max(
                    this.vortexBaseScale.x * maxSize * 0.5,
                    this.vortexBaseScale.y * maxSize * 0.5,
                    1
                );
                this.vortexVisualBaseRadius = baseScaleRadius;
                this.hasCachedVortexBaseScale = true;

                if (this.guardVisualPrefab) {
                    TrashGuardSkill.vortexVisualBaselineByPrefab.set(this.guardVisualPrefab, {
                        scale: this.vortexBaseScale.clone(),
                        radius: this.vortexVisualBaseRadius,
                    });
                }
            }

            this.guardVortexNode.setScale(this.vortexBaseScale);
        }
    }

    private findGuardVortexNode(root: Node): Node | null {
        const exactNode = root.getChildByName('xuanwo');
        if (exactNode) {
            return exactNode;
        }

        return root.children.find(child => child.name.toLowerCase().includes('xuanwo')) ?? null;
    }

    private resetGuardVisualState(): void {
        if (!this.guardVisual) {
            return;
        }

        tween(this.guardVisual.node).stop();
        this.guardVisual.node.setScale(this.guardBaseScale);
        this.hideGuardVortex();
    }

    private hideGuardVortex(): void {
        if (!this.guardVortexNode) {
            return;
        }

        tween(this.guardVortexNode).stop();
        this.guardVortexNode.active = false;
        this.guardVortexNode.setScale(this.vortexHiddenScale);
    }

    private getVortexScaleForRadius(multiplier: number = 1): Vec3 {
        const scaleFactor = Math.max(0.1, (this.attackRadius / Math.max(1, this.vortexVisualBaseRadius)) * multiplier);
        this.tempVortexScale.set(
            this.vortexBaseScale.x * scaleFactor,
            this.vortexBaseScale.y * scaleFactor,
            this.vortexBaseScale.z
        );
        return this.tempVortexScale.clone();
    }

    private playGuardMoveAnimation(): void {
        this.playGuardAnimation(this.guardMoveAnimationClipName);
        this.hideGuardVortex();
    }

    private playGuardAttackAnimation(): void {
        this.playGuardAnimation(this.guardAttackAnimationClipName);
    }

    private playGuardAnimation(configuredClipName: string): void {
        if (!this.guardAnimations.length) {
            return;
        }

        for (const animation of this.guardAnimations) {
            const animationAny = animation as any;
            const clips = (animationAny.clips as Array<{ name?: string }> | undefined) ?? [];
            const chosenClip = this.resolveGuardAnimationClip(animationAny, clips, configuredClipName);

            if (!chosenClip) {
                continue;
            }

            animation.stop();
            if (chosenClip.name) {
                animation.play(chosenClip.name);
            } else {
                animation.play();
            }
        }
    }

    private resolveGuardAnimationClip(
        animationAny: { defaultClip?: { name?: string } | null },
        clips: Array<{ name?: string }>,
        configuredClipName: string
    ): { name?: string } | null {
        const normalizedConfiguredName = configuredClipName.trim().toLowerCase();
        if (normalizedConfiguredName) {
            const exactClip = clips.find(clip => (clip?.name?.trim().toLowerCase() ?? '') === normalizedConfiguredName);
            if (exactClip) {
                return exactClip;
            }

            console.warn(`[TrashGuardSkill] 未找到动画剪辑: ${configuredClipName}，将回退到默认动画`);
        }

        return animationAny.defaultClip ?? clips[0] ?? null;
    }

    private playVortexCastEffect(onComplete?: () => void): void {
        if (!this.guardVortexNode) {
            onComplete?.();
            return;
        }

        const fullRangeScale = this.getVortexScaleForRadius(1.0);
        const overdriveScale = this.getVortexScaleForRadius(1.08);

        tween(this.guardVortexNode).stop();
        this.guardVortexNode.active = true;
        this.guardVortexNode.setScale(this.vortexChargeScale);

        tween(this.guardVortexNode)
            .to(0.18, { scale: fullRangeScale })
            .to(0.18, { scale: overdriveScale })
            .to(0.22, { scale: this.vortexHiddenScale })
            .call(() => {
                if (!this.guardVortexNode) {
                    onComplete?.();
                    return;
                }
                this.guardVortexNode.active = false;
                onComplete?.();
            })
            .start();
    }

    private showVortexChargeEffect(): void {
        if (!this.guardVortexNode) {
            return;
        }

        const chargeScale = this.getVortexScaleForRadius(0.72);
        this.vortexChargeScale.set(chargeScale);
        this.vortexCastScale.set(this.getVortexScaleForRadius(1.0));

        tween(this.guardVortexNode).stop();
        this.guardVortexNode.active = true;
        this.guardVortexNode.setScale(this.vortexHiddenScale);

        tween(this.guardVortexNode)
            .to(0.16, { scale: chargeScale })
            .start();
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
    private static readonly IDLE_CLIP_NAME = 'idle';
    private static readonly ATTACK_CLIP_NAME = 'tuodiyouling_attack';

    static CONFIG: SkillConfig = {
        id: 'mop_ghost',
        name: '拖地幽灵',
        description: '围绕玩家游走，周期性突进最近敌人并拖出减速水渍。',
        icon: 'skill_ghost',
        ...commonSummonSkillConfig,
    } as SkillConfig;

    private attackInterval = 2.7;
    private summonDuration = 26;
    private standbyRadius = 72;
    private minPlayerClearRadius = 54;
    private maxLeashRadius = 156;
    private followMoveSpeed = 164;
    private dashMoveSpeed = 720;
    private attackDamage = 30;
    private attackHitRadius = 34;
    private dashMinDistance = 80;
    private dashMaxDistance = 208;
    private trailDuration = 5.2;
    private trailWidth = 30;
    private trailLength = 54;
    private trailSpawnInterval = 18;
    private trailSlowDuration = 0.42;
    private trailSlowMultiplier = 0.62;
    private transformedReservedMultiplier = 1;

    private ownerNode: Node | null = null;
    private summonParent: Node | null = null;
    private ghostVisual: Skill | null = null;
    private ghostAnimations: Animation[] = [];
    private isSummoned = false;
    private isAttacking = false;
    private summonElapsed = 0;
    private attackElapsed = 0;
    private distanceSinceTrailSpawn = 0;
    private readonly ghostPosition = new Vec3();
    private readonly standbyOffset = new Vec3();
    private readonly desiredWorldPosition = new Vec3();
    private readonly attackTargetWorldPosition = new Vec3();
    private readonly attackDirection = new Vec3(1, 0, 0);
    private readonly tempMoveDelta = new Vec3();
    private readonly tempOwnerOffset = new Vec3();
    private readonly tempLocalPosition = new Vec3();
    private readonly ghostBaseScale = new Vec3(1, 1, 1);
    private readonly hitEnemiesThisDash = new Set<Enemy>();
    private readonly trailStates: MopTrailState[] = [];

    constructor(level: number = 1) {
        super(MopGhostSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel() {
        this.attackInterval = Math.max(1.4, 2.8 - (this.level - 1) * 0.12);
        this.attackDamage = 18 + this.level * 12;
        this.attackHitRadius = 24 + this.level * 2.2;
        this.summonDuration = 20 + this.level * 2.4;
        this.followMoveSpeed = 146 + this.level * 10;
        this.dashMoveSpeed = 620 + this.level * 26;
        this.standbyRadius = 56 + this.level * 4;
        this.minPlayerClearRadius = Math.min(this.standbyRadius - 10, 44 + this.level * 2);
        this.maxLeashRadius = 128 + this.level * 6;
        this.dashMinDistance = 60 + this.level * 3;
        this.dashMaxDistance = 164 + this.level * 8;
        this.trailDuration = 3.6 + this.level * 0.42;
        this.trailWidth = 18 + this.level * 3.2;
        this.trailLength = this.trailWidth * 1.85;
        this.trailSpawnInterval = Math.max(12, this.trailWidth * 0.7);
        this.trailSlowDuration = 0.26 + this.level * 0.03;
        this.trailSlowMultiplier = Math.max(0.26, 0.78 - this.level * 0.04);
        this.transformedReservedMultiplier = this.isTransformed ? 1.2 : 1;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public update(dt: number): void {
        this.updateTrailStates(dt);

        if (!this.isSummoned || !this.ownerNode || !this.ghostVisual || !this.summonParent) {
            return;
        }

        if (this.ghostVisual.node.parent !== this.summonParent) {
            this.ghostVisual.insert(this.summonParent);
            this.syncGhostToWorld(this.ghostPosition);
            this.configureGhostVisualCollision();
        }

        this.summonElapsed += dt;
        if (this.summonElapsed >= this.summonDuration) {
            this.clearGhost();
            return;
        }

        if (this.isAttacking) {
            if (this.moveGhostTowards(this.attackTargetWorldPosition, this.dashMoveSpeed, dt)) {
                this.finishAttack();
            } else {
                this.spawnTrailAlongMovement();
                this.applyDashHitDamage();
            }
            return;
        }

        this.attackElapsed += dt;
        if (this.attackElapsed >= this.attackInterval && this.beginAttack()) {
            return;
        }

        this.followOwner(dt);
    }

    public onUnequip(owner: Node): void {
        this.clearGhost();
    }

    public getDescription(): string {
        const transformedText = this.isTransformed
            ? '终阶形态预留中，当前先保留数值增幅接口。'
            : '终阶形态暂未设计，逻辑接口已预留。';
        return `每 ${this.attackInterval.toFixed(1)}s 突进最近敌人，碰撞造成 ${Math.round(this.attackDamage)} 伤害，并留下更宽的蓝色水渍减速敌人。${transformedText}`;
    }

    protected onSummon(context: SkillContext): void {
        this.ownerNode = context.ownerNode;
        this.summonParent = BulletHell.inst?.bullets;
        if (!this.summonParent) {
            console.warn('[召唤] 拖地幽灵：缺少 bullets 节点，无法召唤');
            return;
        }

        const prefab = context.payload?.visual?.projectilePrefab ?? null;
        if (!prefab) {
            console.warn('[召唤] 拖地幽灵：未配置可视 prefab，无法召唤');
            return;
        }

        if (!this.ghostVisual) {
            this.ghostVisual = Skill.get(prefab);
            if (!this.ghostVisual) {
                console.warn('[召唤] 拖地幽灵：创建实体失败');
                return;
            }
            this.ghostVisual.insert(this.summonParent);
            this.ghostVisual.init();
            this.ghostVisual.velocity.set(0, 0, 0);
            this.ghostVisual.disableAutoRotation = true;
        }

        this.configureGhostVisualCollision();
        this.ghostVisual.lifeTime = 999999;
        this.ghostVisual.node.active = true;
        this.ghostAnimations = this.ghostVisual.node.getComponentsInChildren(Animation);
        this.ghostBaseScale.set(this.ghostVisual.node.scale);

        this.isSummoned = true;
        this.isAttacking = false;
        this.summonElapsed = 0;
        this.attackElapsed = 0;
        this.distanceSinceTrailSpawn = 0;
        this.hitEnemiesThisDash.clear();

        this.pickStandbyOffset();
        this.ghostPosition.set(this.ownerNode.worldPosition);
        this.ghostPosition.add(this.standbyOffset);
        this.syncGhostToWorld(this.ghostPosition);
        this.playGhostAnimation(MopGhostSkill.IDLE_CLIP_NAME);
    }

    private followOwner(dt: number): void {
        if (!this.ownerNode) {
            return;
        }

        const ownerPos = this.ownerNode.worldPosition;
        this.desiredWorldPosition.set(
            ownerPos.x + this.standbyOffset.x,
            ownerPos.y + this.standbyOffset.y,
            0
        );
        this.clampWithinLeash(ownerPos, this.desiredWorldPosition);
        this.moveGhostTowards(this.desiredWorldPosition, this.followMoveSpeed, dt);
    }

    private beginAttack(): boolean {
        const nearestEnemy = this.findNearestEnemy(this.ghostPosition);
        if (!nearestEnemy) {
            return false;
        }

        const targetPosition = nearestEnemy.node.worldPosition;
        this.attackDirection.set(
            targetPosition.x - this.ghostPosition.x,
            targetPosition.y - this.ghostPosition.y,
            0
        );
        if (this.attackDirection.lengthSqr() <= 0.0001) {
            this.attackDirection.set(1, 0, 0);
        }
        this.attackDirection.normalize();

        const distanceToTarget = Vec3.distance(this.ghostPosition, targetPosition);
        const dashDistance = Math.max(this.dashMinDistance, Math.min(this.dashMaxDistance, distanceToTarget + this.attackHitRadius));
        this.attackTargetWorldPosition.set(
            this.ghostPosition.x + this.attackDirection.x * dashDistance,
            this.ghostPosition.y + this.attackDirection.y * dashDistance,
            0
        );

        const ownerPos = this.ownerNode?.worldPosition;
        if (ownerPos) {
            this.clampWithinLeash(ownerPos, this.attackTargetWorldPosition);
        }

        this.isAttacking = true;
        this.attackElapsed = 0;
        this.distanceSinceTrailSpawn = this.trailSpawnInterval;
        this.hitEnemiesThisDash.clear();
        this.playGhostAnimation(MopGhostSkill.ATTACK_CLIP_NAME);
        this.spawnTrailPatch(this.ghostPosition);
        this.applyDashHitDamage();
        return true;
    }

    private finishAttack(): void {
        this.isAttacking = false;
        this.distanceSinceTrailSpawn = 0;
        this.hitEnemiesThisDash.clear();
        this.playGhostAnimation(MopGhostSkill.IDLE_CLIP_NAME);
        this.pickStandbyOffset();
    }

    private findNearestEnemy(origin: Vec3): Enemy | null {
        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return null;
        }

        let nearestEnemy: Enemy | null = null;
        let nearestDistanceSq = Number.POSITIVE_INFINITY;
        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState) {
                continue;
            }

            const dx = enemyNode.worldPosition.x - origin.x;
            const dy = enemyNode.worldPosition.y - origin.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < nearestDistanceSq) {
                nearestDistanceSq = distanceSq;
                nearestEnemy = enemy;
            }
        }

        return nearestEnemy;
    }

    private applyDashHitDamage(): void {
        if (!this.ownerNode || isSkillDamageDisabledForTesting(MopGhostSkill.CONFIG.id)) {
            return;
        }

        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return;
        }

        const hitRadiusSq = this.attackHitRadius * this.attackHitRadius;
        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState || this.hitEnemiesThisDash.has(enemy)) {
                continue;
            }

            const dx = enemyNode.worldPosition.x - this.ghostPosition.x;
            const dy = enemyNode.worldPosition.y - this.ghostPosition.y;
            if (dx * dx + dy * dy > hitRadiusSq) {
                continue;
            }

            enemy.takeDamage(Math.round(this.attackDamage * this.transformedReservedMultiplier), this.ownerNode);
            this.hitEnemiesThisDash.add(enemy);
        }
    }

    private updateTrailStates(dt: number): void {
        if (this.trailStates.length <= 0) {
            return;
        }

        const enemyRoot = BulletHell.inst?.objects;
        for (let i = this.trailStates.length - 1; i >= 0; i--) {
            const trail = this.trailStates[i];
            trail.elapsed += dt;

            if (enemyRoot) {
                const radiusXSq = trail.radiusX * trail.radiusX;
                const radiusYSq = trail.radiusY * trail.radiusY;
                for (const enemyNode of enemyRoot.children) {
                    const enemy = enemyNode.getComponent(Enemy);
                    if (!enemy || enemy.isDead || enemy.isDyingState) {
                        continue;
                    }

                    const dx = enemyNode.worldPosition.x - trail.worldPosition.x;
                    const dy = enemyNode.worldPosition.y - trail.worldPosition.y;
                    const ellipseFactor = (dx * dx) / Math.max(1, radiusXSq) + (dy * dy) / Math.max(1, radiusYSq);
                    if (ellipseFactor <= 1) {
                        enemy.applyMovementDebuff(this.trailSlowDuration, enemy.isBoss ? Math.max(0.58, this.trailSlowMultiplier + 0.18) : this.trailSlowMultiplier);
                    }
                }
            }

            if (trail.elapsed >= trail.duration) {
                trail.node.destroy();
                this.trailStates.splice(i, 1);
                continue;
            }

            this.redrawTrail(trail, 1 - trail.elapsed / Math.max(0.001, trail.duration));
        }
    }

    private spawnTrailAlongMovement(): void {
        this.distanceSinceTrailSpawn += this.tempMoveDelta.length();
        if (this.distanceSinceTrailSpawn < this.trailSpawnInterval) {
            return;
        }

        this.distanceSinceTrailSpawn = 0;
        this.spawnTrailPatch(this.ghostPosition);
    }

    private spawnTrailPatch(worldPosition: Vec3): void {
        if (!this.summonParent) {
            return;
        }

        const node = new Node('MopGhostTrail');
        const graphics = node.addComponent(Graphics);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(this.trailLength * 2, this.trailWidth * 2);
        node.parent = this.summonParent;

        Vec3.subtract(this.tempLocalPosition, worldPosition, this.summonParent.worldPosition);
        node.setPosition(this.tempLocalPosition);
        node.setRotationFromEuler(0, 0, Math.atan2(this.attackDirection.y, this.attackDirection.x) * 180 / Math.PI);

        const trail: MopTrailState = {
            node,
            graphics,
            worldPosition: new Vec3(worldPosition.x, worldPosition.y, worldPosition.z),
            radiusX: this.trailLength * 0.5,
            radiusY: this.trailWidth * 0.5,
            elapsed: 0,
            duration: this.trailDuration,
        };

        this.redrawTrail(trail, 1);
        this.trailStates.push(trail);
    }

    private redrawTrail(trail: MopTrailState, opacityFactor: number): void {
        const alpha = Math.max(28, Math.min(180, Math.round(150 * opacityFactor)));
        trail.graphics.clear();
        trail.graphics.fillColor = new Color(72, 182, 255, alpha);
        trail.graphics.roundRect(-trail.radiusX, -trail.radiusY, trail.radiusX * 2, trail.radiusY * 2, trail.radiusY * 0.8);
        trail.graphics.fill();
    }

    private syncGhostToWorld(worldPos: Vec3): void {
        if (!this.ghostVisual || !this.summonParent) {
            return;
        }

        Vec3.subtract(this.tempLocalPosition, worldPos, this.summonParent.worldPosition);
        this.ghostVisual.setPosition(this.tempLocalPosition);
    }

    private moveGhostTowards(targetWorldPos: Vec3, speed: number, dt: number): boolean {
        const ownerPos = this.ownerNode?.worldPosition;
        if (ownerPos) {
            this.clampWithinLeash(ownerPos, targetWorldPos);
        }

        Vec3.subtract(this.tempMoveDelta, targetWorldPos, this.ghostPosition);
        const distance = this.tempMoveDelta.length();
        if (distance <= 0.001) {
            this.ghostPosition.set(targetWorldPos);
            this.syncGhostToWorld(this.ghostPosition);
            return true;
        }

        const maxStep = Math.max(0, speed) * dt;
        if (distance <= maxStep) {
            this.ghostPosition.set(targetWorldPos);
            this.syncGhostToWorld(this.ghostPosition);
            return true;
        }

        this.tempMoveDelta.multiplyScalar(maxStep / distance);
        this.ghostPosition.add(this.tempMoveDelta);
        this.syncGhostToWorld(this.ghostPosition);
        return false;
    }

    private clampWithinLeash(ownerWorldPos: Vec3, targetWorldPos: Vec3): void {
        Vec3.subtract(this.tempOwnerOffset, targetWorldPos, ownerWorldPos);
        const distance = this.tempOwnerOffset.length();
        if (distance > this.maxLeashRadius) {
            this.tempOwnerOffset.multiplyScalar(this.maxLeashRadius / distance);
            targetWorldPos.set(ownerWorldPos.x + this.tempOwnerOffset.x, ownerWorldPos.y + this.tempOwnerOffset.y, 0);
            return;
        }

        if (distance > 0.0001 && distance < this.minPlayerClearRadius) {
            this.tempOwnerOffset.multiplyScalar(this.minPlayerClearRadius / distance);
            targetWorldPos.set(ownerWorldPos.x + this.tempOwnerOffset.x, ownerWorldPos.y + this.tempOwnerOffset.y, 0);
            return;
        }

        if (distance <= 0.0001) {
            targetWorldPos.set(ownerWorldPos.x + this.minPlayerClearRadius, ownerWorldPos.y, 0);
        }
    }

    private pickStandbyOffset(): void {
        const angle = this.getCurrentRelativeAngle(this.ownerNode?.worldPosition ?? Vec3.ZERO) + (Math.random() - 0.5) * Math.PI * 0.55;
        const radius = this.standbyRadius * (0.72 + Math.random() * 0.22);
        this.standbyOffset.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    }

    private getCurrentRelativeAngle(ownerWorldPos: Vec3): number {
        Vec3.subtract(this.tempOwnerOffset, this.ghostPosition, ownerWorldPos);
        if (this.tempOwnerOffset.lengthSqr() <= 0.0001) {
            return randomAngle();
        }

        return Math.atan2(this.tempOwnerOffset.y, this.tempOwnerOffset.x);
    }

    private playGhostAnimation(preferredClipName: string): void {
        if (!this.ghostAnimations.length) {
            return;
        }

        for (const animation of this.ghostAnimations) {
            const animationAny = animation as any;
            const clips = (animationAny.clips as Array<{ name?: string }> | undefined) ?? [];
            const clip = clips.find(item => item?.name === preferredClipName) ?? animationAny.defaultClip ?? clips[0] ?? null;
            if (!clip) {
                continue;
            }

            animation.stop();
            if (clip.name) {
                animation.play(clip.name);
            } else {
                animation.play();
            }
        }
    }

    private configureGhostVisualCollision(): void {
        if (!this.ghostVisual || !this.ghostVisual.body) {
            return;
        }

        this.ghostVisual.trigger = false;
        this.ghostVisual.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        this.ghostVisual.body.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        this.ghostVisual.body.mask = 0;
    }

    private clearGhost(): void {
        if (this.ghostVisual) {
            tween(this.ghostVisual.node).stop();
            Skill.put(this.ghostVisual);
            this.ghostVisual = null;
        }

        for (const trail of this.trailStates) {
            trail.node.destroy();
        }
        this.trailStates.length = 0;

        this.ownerNode = null;
        this.summonParent = null;
        this.ghostAnimations = [];
        this.isSummoned = false;
        this.isAttacking = false;
        this.summonElapsed = 0;
        this.attackElapsed = 0;
        this.distanceSinceTrailSpawn = 0;
        this.hitEnemiesThisDash.clear();
        this.ghostPosition.set(Vec3.ZERO);
    }
}
