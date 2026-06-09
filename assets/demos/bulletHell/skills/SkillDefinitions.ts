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

import { Animation, Color, Component, Graphics, Vec3, Node, ParticleSystem2D, Quat, Sprite, instantiate, tween, PhysicsSystem, UITransform, view } from 'cc';
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
import { Player } from '../player';
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

interface VacuumVortexFieldState {
    worldPosition: Vec3;
    visual: Skill | null;
    visualBaseScale: Vec3;
    elapsed: number;
    duration: number;
    radius: number;
    pullStrength: number;
    tickDamage: number;
    tickElapsed: number;
    stunPulse: number;
}

interface BroomWindWallState {
    node: Node;
    graphics: Graphics;
    worldPosition: Vec3;
    radius: number;
    elapsed: number;
    duration: number;
}

interface TrashBagFieldInstanceState {
    center: Vec3;
    radius: number;
    visual: Skill | null;
    visualBaseScale: number;
}

interface MopTrailState {
    node: Node;
    graphics: Graphics;
    worldPosition: Vec3;
    radiusX: number;
    radiusY: number;
    elapsed: number;
    duration: number;
    isMergedZone: boolean;
    tickDamage: number;
    tickElapsed: number;
    zoneSlowMultiplier: number;
    mergeCount: number;
}

interface StaticArcStrikeState {
    visual: Skill | null;
    targetEnemy: Enemy | null;
    sourceWorldPosition: Vec3;
    targetWorldPosition: Vec3;
    elapsed: number;
    delay: number;
    duration: number;
    damage: number;
    hasStarted: boolean;
    hasAppliedDamage: boolean;
    isSecondary?: boolean;
}

interface StaticGroundPatchState {
    worldPosition: Vec3;
    visual: Skill | null;
    elapsed: number;
    duration: number;
    radius: number;
    damageTickElapsed: number;
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
    private static readonly WIND_WALL_SPAWN_ANGLE_STEP = 0.4;
    private static readonly WIND_WALL_COLOR = new Color(142, 232, 188);
    private static readonly MAX_WIND_WALLS = 10;

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
    private orbitLaps = 1;
    private secondLapDamageMultiplier = 1;
    private windWallDuration = 0;
    private windWallRadius = 0;
    private windWallSlowMultiplier = 0.58;
    private windWallSlowDuration = 0.28;

    private activeOwnerNode: Node | null = null;
    private activeBroomVisual: Skill | null = null;
    private activeBroomParent: Node | null = null;
    private orbitElapsed = 0;
    private damageTickElapsed = 0;
    private orbitStartAngle = -Math.PI * 0.5;
    private lastWindWallSpawnAngle = Number.NaN;
    private readonly orbitPosition = new Vec3();
    private readonly currentFacing = new Vec3(1, 0, 0);
    private readonly broomBaseScale = new Vec3(1, 1, 1);
    private readonly tempLocalPosition = new Vec3();
    private readonly tempBroomScale = new Vec3(1, 1, 1);
    private readonly windWallStates: BroomWindWallState[] = [];

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
        this.orbitLaps = 1;
        this.secondLapDamageMultiplier = 1;
        this.windWallDuration = 0;
        this.windWallRadius = 0;
        this.applyTransformBonuses();
    }

    private applyTransformBonuses(): void {
        if (!this.isTransformed) {
            return;
        }

        this.orbitLaps = 2;
        this.slashDuration = 0.92;
        this.secondLapDamageMultiplier = 1.5;
        this.orbitRadius = 48;
        this.slashAngle *= 1.12;
        this.damageTickInterval = Math.max(0.06, this.damageTickInterval * 0.9);
        this.windWallDuration = 2;
        this.windWallRadius = Math.max(28, this.slashRange * 0.2);
        this.windWallSlowMultiplier = 0.52;
        this.windWallSlowDuration = 0.34;
        this.cooldown = Math.max(0.75, this.cooldown * 0.92);
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public getDescription(): string {
        const transformedText = this.isTransformed
            ? '终阶「龙卷清扫」：绕玩家连转两圈，轨迹留下风墙减速，第二圈伤害大幅提升。'
            : '满级后进化为龙卷清扫，双圈挥砍并留下短暂风墙。';
        const overloadText = this.isTransformed
            ? `风墙持续 ${this.windWallDuration.toFixed(1)}s，第二圈伤害 ×${this.secondLapDamageMultiplier.toFixed(1)}。`
            : '';
        return `扫把绕玩家旋转挥砍，范围 ${Math.round(this.slashRange)}、扇形 ${Math.round(this.slashAngle * 180 / Math.PI)}°，单次 ${this.baseDamage} 伤害。${overloadText}${transformedText}`;
    }

    public update(dt: number): void {
        super.update(dt);
        this.updateWindWalls(dt);

        if (!this.activeOwnerNode || !this.activeBroomVisual) {
            return;
        }

        this.orbitElapsed += dt;
        this.damageTickElapsed += dt;

        const totalDuration = this.slashDuration * this.orbitLaps;
        const progress = Math.min(1, this.orbitElapsed / totalDuration);
        const orbitAngle = this.orbitStartAngle + progress * Math.PI * 2 * this.orbitLaps;
        const currentLap = Math.min(this.orbitLaps - 1, Math.floor(progress * this.orbitLaps));

        this.currentFacing.set(Math.cos(orbitAngle), Math.sin(orbitAngle), 0);
        this.updateBroomOrbitTransform(this.currentFacing, currentLap);

        if (this.isTransformed && this.windWallDuration > 0) {
            this.maybeSpawnWindWall(orbitAngle);
        }

        while (this.damageTickElapsed >= this.damageTickInterval) {
            this.damageTickElapsed -= this.damageTickInterval;
            const damageMultiplier = currentLap >= 1 ? this.secondLapDamageMultiplier : 1;
            this.applyOrbitDamage(damageMultiplier);
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
        this.broomBaseScale.set(broomVisual.node.scale);
        broomVisual.setScale(this.broomBaseScale);

        const broomNode = broomVisual.node;
        const animationDuration = this.playBroomAnimation(broomNode);
        const totalSlashDuration = this.slashDuration * this.orbitLaps;
        const cleanupDelay = Math.max(totalSlashDuration, this.minVisualDuration, animationDuration);

        broomVisual.lifeTime = cleanupDelay + 0.1;

        this.activeOwnerNode = owner;
        this.activeBroomVisual = broomVisual;
        this.activeBroomParent = parent;
        this.orbitElapsed = 0;
        this.damageTickElapsed = 0;
        this.lastWindWallSpawnAngle = Number.NaN;
        this.orbitStartAngle = Math.atan2(facingDir.y, facingDir.x);
        this.currentFacing.set(facingDir.x, facingDir.y, 0);
        this.updateBroomOrbitTransform(this.currentFacing, 0);
        this.applyOrbitDamage(1);
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
    }

    private updateBroomOrbitTransform(facingDir: Vec3, currentLap: number = 0): void {
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
        const scaleBoost = this.isTransformed
            ? (currentLap >= 1 ? 1.18 : 1.06)
            : 1;
        this.tempBroomScale.set(
            this.broomBaseScale.x * scaleBoost,
            this.broomBaseScale.y * scaleBoost,
            this.broomBaseScale.z
        );
        this.playSlashVisual(broomNode, facingDir);
        broomNode.setScale(this.tempBroomScale);
    }

    private applyOrbitDamage(damageMultiplier: number = 1): void {
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

        const damage = Math.max(1, Math.round(this.baseDamage * damageMultiplier));
        for (const enemy of enemies) {
            enemy.takeDamage(damage, this.activeOwnerNode);
        }
    }

    private maybeSpawnWindWall(orbitAngle: number): void {
        if (!this.activeBroomParent) {
            return;
        }

        if (Number.isNaN(this.lastWindWallSpawnAngle)) {
            this.lastWindWallSpawnAngle = orbitAngle;
            this.spawnWindWall(this.orbitPosition);
            return;
        }

        let deltaAngle = Math.abs(orbitAngle - this.lastWindWallSpawnAngle);
        if (deltaAngle > Math.PI) {
            deltaAngle = Math.PI * 2 - deltaAngle;
        }

        if (deltaAngle < WhirlwindBroomSkill.WIND_WALL_SPAWN_ANGLE_STEP) {
            return;
        }

        this.lastWindWallSpawnAngle = orbitAngle;
        this.spawnWindWall(this.orbitPosition);
    }

    private spawnWindWall(worldPosition: Vec3): void {
        if (!this.activeBroomParent || this.windWallDuration <= 0) {
            return;
        }

        if (this.windWallStates.length >= WhirlwindBroomSkill.MAX_WIND_WALLS) {
            const oldest = this.windWallStates.shift();
            oldest?.node.destroy();
        }

        const node = new Node('BroomWindWall');
        const graphics = node.addComponent(Graphics);
        const transform = node.addComponent(UITransform);
        const diameter = this.windWallRadius * 2;
        transform.setContentSize(diameter, diameter);
        node.parent = this.activeBroomParent;

        Vec3.subtract(this.tempLocalPosition, worldPosition, this.activeBroomParent.worldPosition);
        node.setPosition(this.tempLocalPosition);

        const wall: BroomWindWallState = {
            node,
            graphics,
            worldPosition: new Vec3(worldPosition.x, worldPosition.y, worldPosition.z),
            radius: this.windWallRadius,
            elapsed: 0,
            duration: this.windWallDuration,
        };

        this.redrawWindWall(wall, 1);
        this.windWallStates.push(wall);
    }

    private updateWindWalls(dt: number): void {
        if (this.windWallStates.length <= 0) {
            return;
        }

        const enemyRoot = BulletHell.inst?.objects;
        for (let i = this.windWallStates.length - 1; i >= 0; i--) {
            const wall = this.windWallStates[i];
            wall.elapsed += dt;

            if (enemyRoot) {
                const radiusSq = wall.radius * wall.radius;
                for (const enemyNode of enemyRoot.children) {
                    const enemy = enemyNode.getComponent(Enemy);
                    if (!enemy || enemy.isDead || enemy.isDyingState) {
                        continue;
                    }

                    const dx = enemyNode.worldPosition.x - wall.worldPosition.x;
                    const dy = enemyNode.worldPosition.y - wall.worldPosition.y;
                    if (dx * dx + dy * dy <= radiusSq) {
                        const bossSlow = Math.max(0.62, this.windWallSlowMultiplier + 0.14);
                        enemy.applyMovementDebuff(
                            this.windWallSlowDuration,
                            enemy.isBoss ? bossSlow : this.windWallSlowMultiplier
                        );
                    }
                }
            }

            if (wall.elapsed >= wall.duration) {
                wall.node.destroy();
                this.windWallStates.splice(i, 1);
                continue;
            }

            this.redrawWindWall(wall, 1 - wall.elapsed / Math.max(0.001, wall.duration));
        }
    }

    private redrawWindWall(wall: BroomWindWallState, opacityFactor: number): void {
        const color = WhirlwindBroomSkill.WIND_WALL_COLOR;
        const alpha = Math.max(18, Math.min(110, Math.round(88 * opacityFactor)));
        wall.graphics.clear();
        wall.graphics.fillColor = new Color(color.r, color.g, color.b, alpha);
        wall.graphics.circle(0, 0, wall.radius);
        wall.graphics.fill();
        wall.graphics.strokeColor = new Color(210, 255, 230, Math.min(130, alpha + 24));
        wall.graphics.lineWidth = 1.5;
        wall.graphics.circle(0, 0, wall.radius);
        wall.graphics.stroke();
    }

    private clearWindWalls(): void {
        for (const wall of this.windWallStates) {
            wall.node.destroy();
        }
        this.windWallStates.length = 0;
    }

    private clearActiveBroom(): void {
        if (this.activeBroomVisual) {
            tween(this.activeBroomVisual.node).stop();
            Skill.put(this.activeBroomVisual);
            this.activeBroomVisual = null;
        }

        this.activeOwnerNode = null;
        this.activeBroomParent = null;
        this.orbitElapsed = 0;
        this.damageTickElapsed = 0;
        this.lastWindWallSpawnAngle = Number.NaN;
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
    private static readonly LANDFILL_FIELD_TINT = new Color(58, 72, 48);
    private static readonly PLAYER_RADIUS_FALLBACK = 40;
    private static readonly VISUAL_BASE_RADIUS_FALLBACK = 64;

    static CONFIG: SkillConfig = {
        id: 'trash_bag_field',
        name: '垃圾袋领域',
        description: '放置持续污染区，减速敌人。',
        icon: 'skill_trash_bag',
        ...commonActiveSkillConfig,
    } as SkillConfig;

    private duration = 5;
    private fieldRadius = 40;
    private fieldCount = 1;
    private fieldSizeMultiplier = 1;
    private randomFieldPlacement = false;
    private transformRadiusFactor = 1;
    private damagePerTick = 8;
    private tickInterval = 0.25;
    private slowDuration = 0.36;
    private slowMultiplier = 0.76;
    private imprisonEnabled = false;
    private imprisonClampRadiusFactor = 0.94;
    private imprisonEdgePushStrength = 165;

    private isFieldActive = false;
    private fieldElapsed = 0;
    private tickElapsed = 0;
    private fieldOwnerNode: Node | null = null;
    private readonly tempEnemyOffset = new Vec3();
    private readonly tempInwardDirection = new Vec3();
    private readonly tempFieldScale = new Vec3(1, 1, 1);
    private readonly tempFieldCenter = new Vec3();
    private readonly activeFields: TrashBagFieldInstanceState[] = [];

    constructor(level: number = 1) {
        super(TrashBagFieldSkill.CONFIG, level);
        this.cooldown = 6;
        this.updateByLevel();
    }

    private updateByLevel() {
        this.duration = 4 + this.level * 0.8;
        this.damagePerTick = 6 + Math.round(this.level * 1.35);
        this.tickInterval = 0.25;
        this.slowDuration = 0.34 + this.level * 0.02;
        this.slowMultiplier = Math.max(0.48, 0.8 - this.level * 0.025);
        this.transformRadiusFactor = 1;
        this.imprisonEnabled = false;
        this.applyFieldTierByLevel();
        this.applyTransformBonuses();
    }

    private applyFieldTierByLevel(): void {
        if (this.level <= 3) {
            this.fieldCount = 1;
            this.fieldSizeMultiplier = 1;
            this.randomFieldPlacement = false;
            return;
        }

        if (this.level <= 7) {
            this.fieldCount = 2;
            this.fieldSizeMultiplier = 1.5;
            this.randomFieldPlacement = false;
            return;
        }

        this.fieldCount = 3;
        this.fieldSizeMultiplier = 2;
        this.randomFieldPlacement = true;
    }

    private applyTransformBonuses(): void {
        if (!this.isTransformed) {
            return;
        }

        this.cooldown = Math.max(4.2, this.cooldown * 0.92);
        this.transformRadiusFactor = 1.08;
        this.duration += 1.0;
        this.damagePerTick = Math.max(1, Math.round(this.damagePerTick * 1.75));
        this.tickInterval = 0.22;
        this.slowDuration += 0.06;
        this.slowMultiplier = Math.max(0.36, this.slowMultiplier * 0.82);
        this.imprisonEnabled = true;
        this.imprisonClampRadiusFactor = 0.94;
        this.imprisonEdgePushStrength = 185;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public getDescription(): string {
        const tierText = this.level <= 3
            ? 'Lv1-3 放置 1 个与角色等大的污染区。'
            : this.level <= 7
                ? 'Lv4-7 放置 2 个 1.5 倍大的污染区。'
                : 'Lv8-10 随机放置 3 个 2 倍大的污染区。';
        const transformedText = this.isTransformed
            ? '终阶「垃圾填埋场」：非 Boss 敌人无法离开边缘。'
            : '满级后进化为垃圾填埋场并禁锢圈内敌人。';
        const overloadText = this.isTransformed
            ? `填埋场每秒约 ${(this.damagePerTick / this.tickInterval).toFixed(0)} 点伤害，Boss 仅减速不禁锢。`
            : '';
        return `一次释放 ${this.fieldCount} 个污染区，持续 ${this.duration.toFixed(1)}s，单区半径约 ${Math.round(this.fieldRadius)}，每跳 ${this.damagePerTick} 伤害。${tierText}${overloadText}${transformedText}`;
    }

    public update(dt: number): void {
        super.update(dt);

        if (!this.isFieldActive) {
            return;
        }

        this.fieldElapsed += dt;
        this.tickElapsed += dt;
        this.syncFieldVisual();

        if (this.fieldElapsed >= this.duration) {
            this.clearField();
            return;
        }

        if (this.imprisonEnabled) {
            this.applyFieldContainment();
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

        this.clearField();

        this.fieldOwnerNode = context.ownerNode;
        this.fieldRadius = this.resolveFieldRadius(context.ownerNode);
        this.fieldElapsed = 0;
        this.tickElapsed = 0;
        this.isFieldActive = true;

        const fieldCenters = this.buildFieldCenters(origin, this.fieldRadius);
        for (const center of fieldCenters) {
            const field: TrashBagFieldInstanceState = {
                center: new Vec3(center.x, center.y, center.z),
                radius: this.fieldRadius,
                visual: null,
                visualBaseScale: 1,
            };

            if (visualParent && prefab) {
                const visual = Skill.get(prefab);
                if (visual) {
                    visual.insert(visualParent);
                    visual.init();

                    if (objectsParent && visual.node.parent === objectsParent.parent) {
                        visual.node.setSiblingIndex(objectsParent.getSiblingIndex());
                    }

                    Vec3.subtract(this.tempFieldCenter, field.center, visualParent.worldPosition);
                    visual.setPosition(this.tempFieldCenter);
                    visual.velocity.set(0, 0, 0);
                    visual.lifeTime = this.duration + 0.1;
                    visual.disableAutoRotation = true;
                    visual.trigger = false;

                    field.visualBaseScale = Math.max(0.1, field.radius / this.getTrashBagVisualBaseRadius(visual.node));
                    this.tempFieldScale.set(field.visualBaseScale, field.visualBaseScale, 1);
                    visual.setScale(this.tempFieldScale);
                    this.tintFieldVisual(visual.node, this.isTransformed);
                    field.visual = visual;
                }
            }

            this.activeFields.push(field);
        }

        this.applyAreaDamage();
    }

    private resolveFieldRadius(ownerNode: Node): number {
        const playerRadius = this.getPlayerReferenceRadius(ownerNode);
        return Math.max(24, Math.round(playerRadius * this.fieldSizeMultiplier * this.transformRadiusFactor));
    }

    private getPlayerReferenceRadius(ownerNode: Node): number {
        const transform = ownerNode.getComponent(UITransform) ?? ownerNode.getComponentInChildren(UITransform);
        if (!transform) {
            return TrashBagFieldSkill.PLAYER_RADIUS_FALLBACK;
        }

        const worldScale = Math.max(ownerNode.worldScale.x, ownerNode.worldScale.y, 0.1);
        return Math.max(
            24,
            Math.max(transform.contentSize.width, transform.contentSize.height) * 0.5 * worldScale
        );
    }

    private getVisiblePlacementBounds(origin: Vec3, fieldRadius: number): {
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
    } | null {
        const visibleSize = view.getVisibleSize();
        if (visibleSize.width <= 0 || visibleSize.height <= 0) {
            return null;
        }

        const cameraPos = BulletHell.inst?.camera?.worldPosition ?? origin;
        const edgeMargin = 16;
        const inset = fieldRadius + edgeMargin;
        const halfW = visibleSize.width * 0.5 - inset;
        const halfH = visibleSize.height * 0.5 - inset;
        if (halfW <= 12 || halfH <= 12) {
            return null;
        }

        return {
            minX: cameraPos.x - halfW,
            maxX: cameraPos.x + halfW,
            minY: cameraPos.y - halfH,
            maxY: cameraPos.y + halfH,
        };
    }

    private clampCenterToVisibleBounds(center: Vec3, fieldRadius: number, origin: Vec3): void {
        const bounds = this.getVisiblePlacementBounds(origin, fieldRadius);
        if (!bounds) {
            return;
        }

        center.x = Math.max(bounds.minX, Math.min(bounds.maxX, center.x));
        center.y = Math.max(bounds.minY, Math.min(bounds.maxY, center.y));
    }

    private pickRandomCenterWithinVisibleBounds(
        origin: Vec3,
        fieldRadius: number,
        bounds: { minX: number; maxX: number; minY: number; maxY: number }
    ): Vec3 {
        return new Vec3(
            bounds.minX + Math.random() * (bounds.maxX - bounds.minX),
            bounds.minY + Math.random() * (bounds.maxY - bounds.minY),
            origin.z
        );
    }

    private isCenterSeparatedFromExisting(
        center: Vec3,
        existingCenters: Vec3[],
        minSeparation: number
    ): boolean {
        const minSeparationSq = minSeparation * minSeparation;
        for (const existing of existingCenters) {
            const dx = existing.x - center.x;
            const dy = existing.y - center.y;
            if (dx * dx + dy * dy < minSeparationSq) {
                return false;
            }
        }

        return true;
    }

    private buildFieldCenters(origin: Vec3, fieldRadius: number): Vec3[] {
        const centers: Vec3[] = [];
        if (this.fieldCount <= 1) {
            const center = new Vec3(origin.x, origin.y, origin.z);
            this.clampCenterToVisibleBounds(center, fieldRadius, origin);
            centers.push(center);
            return centers;
        }

        if (!this.randomFieldPlacement) {
            const primary = new Vec3(origin.x, origin.y, origin.z);
            this.clampCenterToVisibleBounds(primary, fieldRadius, origin);
            centers.push(primary);

            const angle = Math.random() * Math.PI * 2;
            const distance = fieldRadius * (1.15 + Math.random() * 0.55);
            const secondary = new Vec3(
                origin.x + Math.cos(angle) * distance,
                origin.y + Math.sin(angle) * distance,
                origin.z
            );
            this.clampCenterToVisibleBounds(secondary, fieldRadius, origin);
            centers.push(secondary);
            return centers;
        }

        const bounds = this.getVisiblePlacementBounds(origin, fieldRadius);
        const minSeparation = fieldRadius * 1.05;
        const maxAttempts = 32;
        if (bounds) {
            for (let attempt = 0; attempt < maxAttempts && centers.length < this.fieldCount; attempt++) {
                const candidate = this.pickRandomCenterWithinVisibleBounds(origin, fieldRadius, bounds);
                if (!this.isCenterSeparatedFromExisting(candidate, centers, minSeparation)) {
                    continue;
                }

                centers.push(candidate);
            }
        }

        while (centers.length < this.fieldCount) {
            const angle = Math.random() * Math.PI * 2;
            const distance = fieldRadius * (0.8 + centers.length * 0.75);
            const fallback = new Vec3(
                origin.x + Math.cos(angle) * distance,
                origin.y + Math.sin(angle) * distance,
                origin.z
            );
            this.clampCenterToVisibleBounds(fallback, fieldRadius, origin);
            if (this.isCenterSeparatedFromExisting(fallback, centers, minSeparation)) {
                centers.push(fallback);
            } else if (bounds) {
                const boundedFallback = this.pickRandomCenterWithinVisibleBounds(origin, fieldRadius, bounds);
                this.clampCenterToVisibleBounds(boundedFallback, fieldRadius, origin);
                centers.push(boundedFallback);
            } else {
                centers.push(fallback);
            }
        }

        return centers;
    }

    private applyAreaDamage(): void {
        if (!this.fieldOwnerNode || this.activeFields.length <= 0) {
            return;
        }

        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return;
        }

        const damageDisabled = isSkillDamageDisabledForTesting(TrashBagFieldSkill.CONFIG.id);
        const affectedEnemies = new Set<Enemy>();
        for (const field of this.activeFields) {
            const radiusSqr = field.radius * field.radius;
            for (const enemyNode of enemyRoot.children) {
                const enemy = enemyNode.getComponent(Enemy);
                if (!enemy || enemy.isDead || affectedEnemies.has(enemy)) {
                    continue;
                }

                const enemyPos = enemyNode.worldPosition;
                const dx = enemyPos.x - field.center.x;
                const dy = enemyPos.y - field.center.y;
                if (dx * dx + dy * dy > radiusSqr) {
                    continue;
                }

                if (!damageDisabled) {
                    enemy.takeDamage(this.damagePerTick, this.fieldOwnerNode);
                }
                const bossSlow = this.imprisonEnabled
                    ? Math.max(0.68, this.slowMultiplier + 0.22)
                    : Math.max(0.75, this.slowMultiplier + 0.18);
                enemy.applyMovementDebuff(
                    this.slowDuration,
                    enemy.isBoss ? bossSlow : this.slowMultiplier
                );
                affectedEnemies.add(enemy);
            }
        }
    }

    private applyFieldContainment(): void {
        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return;
        }

        for (const field of this.activeFields) {
            const containRadius = field.radius;
            const clampRadius = containRadius * this.imprisonClampRadiusFactor;
            const containRadiusSq = containRadius * containRadius;
            const clampRadiusSq = clampRadius * clampRadius;
            const edgeBandStartSq = clampRadiusSq;

            for (const enemyNode of enemyRoot.children) {
                const enemy = enemyNode.getComponent(Enemy);
                if (!enemy || enemy.isDead || enemy.isDyingState || enemy.isBoss) {
                    continue;
                }

                const enemyPos = enemyNode.worldPosition;
                this.tempEnemyOffset.set(
                    enemyPos.x - field.center.x,
                    enemyPos.y - field.center.y,
                    0
                );
                const distanceSq = this.tempEnemyOffset.lengthSqr();
                if (distanceSq > containRadiusSq) {
                    continue;
                }

                const distance = Math.sqrt(Math.max(0.0001, distanceSq));
                if (distance > clampRadius) {
                    const clampScale = clampRadius / distance;
                    enemyNode.setWorldPosition(
                        field.center.x + this.tempEnemyOffset.x * clampScale,
                        field.center.y + this.tempEnemyOffset.y * clampScale,
                        enemyPos.z
                    );
                }

                if (distanceSq >= edgeBandStartSq) {
                    this.tempInwardDirection.set(-this.tempEnemyOffset.x, -this.tempEnemyOffset.y, 0);
                    if (this.tempInwardDirection.lengthSqr() <= 0.0001) {
                        this.tempInwardDirection.set(1, 0, 0);
                    } else {
                        this.tempInwardDirection.normalize();
                    }

                    const edgeRatio = Math.max(0, (distance - clampRadius) / Math.max(1, containRadius - clampRadius));
                    const pushStrength = this.imprisonEdgePushStrength * (0.55 + edgeRatio * 0.75);
                    enemy.applyKnockback(this.tempInwardDirection, pushStrength, 0.1);
                    enemy.applyMovementDebuff(0.14, 0.22);
                }
            }
        }
    }

    private syncFieldVisual(): void {
        if (!this.isTransformed) {
            return;
        }

        const lifeRatio = Math.max(0, 1 - this.fieldElapsed / Math.max(0.001, this.duration));
        const pulse = 1 + Math.sin(this.fieldElapsed * 5.5) * 0.035 * lifeRatio;
        for (const field of this.activeFields) {
            if (!field.visual) {
                continue;
            }

            this.tempFieldScale.set(
                field.visualBaseScale * pulse,
                field.visualBaseScale * pulse,
                1
            );
            field.visual.setScale(this.tempFieldScale);
        }
    }

    private tintFieldVisual(node: Node, useLandfillTint: boolean): void {
        const sprites = node.getComponentsInChildren(Sprite);
        for (const sprite of sprites) {
            if (useLandfillTint) {
                sprite.color = new Color(
                    TrashBagFieldSkill.LANDFILL_FIELD_TINT.r,
                    TrashBagFieldSkill.LANDFILL_FIELD_TINT.g,
                    TrashBagFieldSkill.LANDFILL_FIELD_TINT.b,
                    sprite.color.a
                );
            } else {
                sprite.color = new Color(255, 255, 255, sprite.color.a);
            }
        }
    }

    private getTrashBagVisualBaseRadius(node: Node): number {
        const transform = node.getComponent(UITransform);
        if (!transform) {
            return TrashBagFieldSkill.VISUAL_BASE_RADIUS_FALLBACK;
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

        for (const field of this.activeFields) {
            if (field.visual) {
                Skill.put(field.visual);
            }
        }
        this.activeFields.length = 0;
    }
}

export class VacuumVortexSkill extends ActiveSkill {
    private static readonly THROW_CLIP_NAME = 'throw';
    private static readonly RELEASE_CLIP_NAME = 'yaliguan_shifang';
    private static readonly VORTEX_FIELD_DURATION = 2.35;
    private static readonly VORTEX_FIELD_TICK_INTERVAL = 0.38;
    /** 终阶双罐落点横向总间距（两罐各偏中心一半） */
    private static readonly CANISTER_PAIR_SPREAD = 118;
    private static readonly VORTEX_FIELD_COLOR = new Color(108, 214, 255, 200);

    static CONFIG: SkillConfig = {
        id: 'vacuum_vortex',
        name: '压力罐冲击',
        description: '周期性抛出压力罐，延时爆炸并震开敌人，满级后进化为连环真空涡。',
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
    private canistersPerCast = 1;
    private vacuumFieldDuration = 0;
    private vacuumFieldRadiusFactor = 0;
    private vacuumFieldTickDamage = 0;
    private vacuumFieldPullStrength = 0;
    private ownerNode: Node | null = null;
    private readonly activeCanisters: PressureCanisterState[] = [];
    private readonly activeVortexFields: VacuumVortexFieldState[] = [];
    private readonly canisterBaseScale = new Vec3(1, 1, 1);
    private readonly shockwaveStartScale = new Vec3(0.18, 0.18, 1);
    private readonly shockwaveTargetScale = new Vec3(1, 1, 1);
    private readonly tempDirection = new Vec3(1, 0, 0);
    private readonly tempLandingPosition = new Vec3();
    private readonly tempSecondaryLanding = new Vec3();
    private readonly tempLocalPosition = new Vec3();
    private readonly tempScale = new Vec3(1, 1, 1);
    private readonly tempEnemyDelta = new Vec3();
    private readonly tempPullDirection = new Vec3();
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
        this.stunDuration = 0;
        this.canistersPerCast = 1;
        this.vacuumFieldDuration = 0;
        this.vacuumFieldRadiusFactor = 0;
        this.vacuumFieldTickDamage = 0;
        this.vacuumFieldPullStrength = 0;
        this.applyTransformBonuses();
    }

    private applyTransformBonuses(): void {
        if (!this.isTransformed) {
            return;
        }

        this.cooldown = Math.max(1.85, this.cooldown * 0.82);
        this.blastRadius = Math.round(this.blastRadius * 1.22);
        this.impactDamage = Math.round(this.impactDamage * 1.16);
        this.knockbackStrength = Math.round(this.knockbackStrength * 1.24);
        this.stunDuration = 1.2;
        this.canistersPerCast = 2;
        this.vacuumFieldDuration = VacuumVortexSkill.VORTEX_FIELD_DURATION;
        this.vacuumFieldRadiusFactor = 0.88;
        this.vacuumFieldTickDamage = Math.max(6, Math.round(this.impactDamage * 0.22));
        this.vacuumFieldPullStrength = 148;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public getDescription(): string {
        const transformedText = this.isTransformed
            ? '终阶「连环真空涡」：每次连投双罐，爆炸后留下真空涡吸附敌人并持续撕扯。'
            : '满级后进化为连环真空涡，追加眩晕与真空残留区。';
        const overloadText = this.isTransformed
            ? `真空涡持续 ${this.vacuumFieldDuration.toFixed(1)}s，每 ${VacuumVortexSkill.VORTEX_FIELD_TICK_INTERVAL.toFixed(2)}s 追加撕扯伤害，并刷新 ${this.stunDuration.toFixed(1)}s 眩晕。`
            : '';
        return `每 ${this.cooldown.toFixed(1)}s 抛出${this.canistersPerCast > 1 ? '两颗' : '一个'}压力罐，${this.fuseTime.toFixed(1)}s 后爆炸，造成 ${this.impactDamage} 伤害并击退半径 ${Math.round(this.blastRadius)} 内敌人。${overloadText}${transformedText}`;
    }

    public update(dt: number): void {
        super.update(dt);
        this.updateVortexFields(dt);

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
        this.ownerNode = context.ownerNode;
        const primaryLanding = this.getLandingPosition(context);

        for (let castIndex = 0; castIndex < this.canistersPerCast; castIndex++) {
            const landingPosition = this.canistersPerCast > 1
                ? this.getPairedLandingPosition(context, primaryLanding, castIndex)
                : primaryLanding;
            this.spawnPressureCanister(context, landingPosition);
        }
    }

    private spawnPressureCanister(context: SkillContext, landingPosition: Vec3): void {
        const ownerPosition = context.ownerNode.worldPosition;
        const parent = BulletHell.inst?.bullets;
        const prefab = context.payload?.visual?.projectilePrefab ?? null;
        const impactPrefab = context.payload?.visual?.impactPrefab ?? null;

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
                this.configureCanisterVisualCollision(visual);
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

    private getPairedLandingPosition(context: SkillContext, primaryLanding: Vec3, castIndex: number): Vec3 {
        const origin = context.ownerNode.worldPosition;
        this.tempDirection.set(
            primaryLanding.x - origin.x,
            primaryLanding.y - origin.y,
            0
        );
        if (this.tempDirection.lengthSqr() <= 0.0001) {
            this.tempDirection.set(this.getFallbackThrowDirection());
        }
        this.tempDirection.normalize();

        const spreadSign = castIndex % 2 === 0 ? -1 : 1;
        const halfSpread = VacuumVortexSkill.CANISTER_PAIR_SPREAD * 0.5;
        const perpX = -this.tempDirection.y * spreadSign;
        const perpY = this.tempDirection.x * spreadSign;
        this.tempSecondaryLanding.set(
            primaryLanding.x + perpX * halfSpread,
            primaryLanding.y + perpY * halfSpread,
            primaryLanding.z
        );
        return this.tempSecondaryLanding;
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
        const damageDisabled = isSkillDamageDisabledForTesting(VacuumVortexSkill.CONFIG.id);
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
            if (!damageDisabled) {
                const damage = Math.round(canister.damage * (0.7 + distanceRatio * 0.6));
                enemy.takeDamage(damage, this.ownerNode ?? undefined);
            }
            enemy.applyKnockback(
                this.tempEnemyDelta,
                canister.knockbackStrength * (enemy.isBoss ? 0.45 : 1),
                enemy.isBoss ? 0.12 : 0.18
            );

            if (canister.stunDuration > 0 && !enemy.isBoss) {
                enemy.applyStun(canister.stunDuration);
            }
        }

        if (this.isTransformed && this.vacuumFieldDuration > 0) {
            this.spawnVortexField(canister);
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
        this.configureCanisterVisualCollision(shockwave);
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

    /** 压力罐由技能逻辑控制生命周期，不与敌人发生子弹碰撞回收。 */
    private configureCanisterVisualCollision(visual: Skill): void {
        if (!visual.body) {
            return;
        }

        visual.trigger = false;
        visual.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        visual.body.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        visual.body.mask = 0;
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

    private updateVortexFields(dt: number): void {
        if (!this.isTransformed) {
            if (this.activeVortexFields.length > 0) {
                this.clearVortexFields();
            }
            return;
        }

        if (this.activeVortexFields.length <= 0) {
            return;
        }

        for (let index = this.activeVortexFields.length - 1; index >= 0; index--) {
            const field = this.activeVortexFields[index];
            field.elapsed += dt;
            field.tickElapsed += dt;
            this.syncVortexFieldVisual(field);
            this.applyVortexFieldPull(field);

            while (field.tickElapsed >= VacuumVortexSkill.VORTEX_FIELD_TICK_INTERVAL) {
                field.tickElapsed -= VacuumVortexSkill.VORTEX_FIELD_TICK_INTERVAL;
                this.tickVortexField(field);
            }

            if (field.elapsed >= field.duration) {
                if (field.visual) {
                    Skill.put(field.visual);
                }
                this.activeVortexFields.splice(index, 1);
            }
        }
    }

    private spawnVortexField(canister: PressureCanisterState): void {
        const parent = BulletHell.inst?.bullets;
        if (!parent) {
            return;
        }

        const fieldRadius = Math.max(48, canister.blastRadius * this.vacuumFieldRadiusFactor);
        let visual: Skill | null = null;
        const impactPrefab = canister.impactPrefab;
        if (impactPrefab) {
            visual = Skill.get(impactPrefab);
            if (visual) {
                visual.insert(parent);
                visual.init();
                visual.disableAutoRotation = true;
                this.configureCanisterVisualCollision(visual);
                visual.velocity.set(0, 0, 0);
                visual.damage = 0;
                visual.penetration = 9999;
                visual.knockback = 0;
                visual.lifeTime = this.vacuumFieldDuration + 0.2;
                Vec3.subtract(this.tempLocalPosition, canister.landingPosition, parent.worldPosition);
                visual.setPosition(this.tempLocalPosition);

                const baseRadius = this.getImpactVisualBaseRadius(visual.node);
                const targetScale = Math.max(0.12, fieldRadius / Math.max(1, baseRadius));
                this.tempScale.set(targetScale * 0.42, targetScale * 0.42, 1);
                visual.setScale(this.tempScale);
                this.tintVortexFieldVisual(visual.node, 0.58);
            }
        }

        const visualBaseScale = visual
            ? new Vec3(this.tempScale.x, this.tempScale.y, this.tempScale.z)
            : new Vec3(1, 1, 1);

        this.activeVortexFields.push({
            worldPosition: new Vec3(canister.landingPosition.x, canister.landingPosition.y, canister.landingPosition.z),
            visual,
            visualBaseScale,
            elapsed: 0,
            duration: this.vacuumFieldDuration,
            radius: fieldRadius,
            pullStrength: this.vacuumFieldPullStrength,
            tickDamage: this.vacuumFieldTickDamage,
            tickElapsed: 0,
            stunPulse: this.stunDuration > 0 ? Math.min(0.45, this.stunDuration) : 0,
        });
    }

    private syncVortexFieldVisual(field: VacuumVortexFieldState): void {
        if (!field.visual || !BulletHell.inst?.bullets) {
            return;
        }

        const parent = BulletHell.inst.bullets;
        Vec3.subtract(this.tempLocalPosition, field.worldPosition, parent.worldPosition);
        field.visual.setPosition(this.tempLocalPosition);

        const lifeRatio = Math.max(0, 1 - field.elapsed / Math.max(0.001, field.duration));
        const pulse = 1 + Math.sin(field.elapsed * 14) * 0.08 * lifeRatio;
        this.tempScale.set(
            field.visualBaseScale.x * pulse,
            field.visualBaseScale.y * pulse,
            field.visualBaseScale.z
        );
        field.visual.setScale(this.tempScale);
        field.visual.node.setRotationFromEuler(0, 0, field.elapsed * 72);
        this.tintVortexFieldVisual(field.visual.node, 0.34 + lifeRatio * 0.42);
    }

    private applyVortexFieldPull(field: VacuumVortexFieldState): void {
        const enemies = this.collectEnemiesInRadius(field.worldPosition, field.radius);
        for (const enemy of enemies) {
            const enemyPosition = enemy.node.worldPosition;
            this.tempPullDirection.set(
                field.worldPosition.x - enemyPosition.x,
                field.worldPosition.y - enemyPosition.y,
                0
            );
            const distance = this.tempPullDirection.length();
            if (distance <= 0.001) {
                continue;
            }

            this.tempPullDirection.multiplyScalar(1 / distance);
            const edgeFactor = Math.max(0.35, 1 - distance / Math.max(1, field.radius));
            const pullStrength = field.pullStrength * edgeFactor * (enemy.isBoss ? 0.38 : 1);
            enemy.applyMovementDebuff(0.12, enemy.isBoss ? 0.58 : 0.46);
            enemy.applyKnockback(this.tempPullDirection, pullStrength, 0.12);
        }
    }

    private tickVortexField(field: VacuumVortexFieldState): void {
        const enemies = this.collectEnemiesInRadius(field.worldPosition, field.radius);
        const damageDisabled = isSkillDamageDisabledForTesting(VacuumVortexSkill.CONFIG.id);

        for (const enemy of enemies) {
            if (!damageDisabled) {
                enemy.takeDamage(field.tickDamage, this.ownerNode ?? undefined);
            }
            if (field.stunPulse > 0 && !enemy.isBoss) {
                enemy.applyStun(field.stunPulse);
            }
        }
    }

    private clearVortexFields(): void {
        for (const field of this.activeVortexFields) {
            if (field.visual) {
                Skill.put(field.visual);
            }
        }
        this.activeVortexFields.length = 0;
    }

    private tintVortexFieldVisual(node: Node, alphaScale: number): void {
        const sprites = node.getComponentsInChildren(Sprite);
        const color = VacuumVortexSkill.VORTEX_FIELD_COLOR;
        const alpha = Math.max(0, Math.min(255, Math.round(color.a * alphaScale)));
        for (const sprite of sprites) {
            sprite.color = new Color(color.r, color.g, color.b, alpha);
        }
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

export class BubbleShieldSkill extends ActiveSkill {
    private static readonly EXPAND_CLIP_NAME = 'bubble_attack';
    private static readonly DISAPPEAR_CLIP_NAME = 'bubble_disappear';
    /** 终阶穹顶内玩家受伤倍率（0.7 = 30% 减伤） */
    private static readonly DOME_DAMAGE_TAKEN_MULTIPLIER = 0.7;
    private static readonly DOME_FADE_FLASH_DURATION = 0.08;

    static CONFIG: SkillConfig = {
        id: 'bubble_shield',
        name: '泡沫盾',
        description: '以玩家为中心展开泡沫盾，扩张时推开敌人，停留期间只伤害外圈目标。',
        icon: 'skill_bubble_shield',
        ...commonActiveSkillConfig,
    } as SkillConfig;

    private maxRadius = 132;
    private expandDuration = 0.5;
    private sustainDuration = 2.2;
    private fadeDuration = 0.3;
    private edgeThickness = 18;
    private expansionDamage = 8;
    private holdDamage = 3;
    private damageTickInterval = 0.24;
    private knockbackStrength = 220;
    private knockbackDuration = 0.15;
    private readonly visualBaseRadiusFallback = 50;

    private activeOwnerNode: Node | null = null;
    private shieldVisualParent: Node | null = null;
    private shieldVisualNode: Node | null = null;
    private shieldGraphics: Graphics | null = null;
    private shieldVisual: Skill | null = null;
    private shieldAnimations: Animation[] = [];
    private shieldSprites: Sprite[] = [];
    private shieldVisualBaseRadius = 32;
    private isShieldActive = false;
    private shieldElapsed = 0;
    private damageTickElapsed = 0;
    private currentRadius = 0;
    private previousRadius = 0;
    private hasStartedFade = false;
    private expansionDamagedEnemies: WeakSet<Enemy> = new WeakSet();
    private readonly shieldCenter = new Vec3();
    private readonly tempLocalPosition = new Vec3();
    private readonly tempEnemyDelta = new Vec3();
    private readonly shieldScale = new Vec3(1, 1, 1);

    constructor(level: number = 1) {
        super(BubbleShieldSkill.CONFIG, level);
        this.cooldown = 5;
        this.updateByLevel();
    }

    private updateByLevel(): void {
        this.maxRadius = 112 + this.level * 18;
        this.expandDuration = Math.max(0.34, 0.54 - (this.level - 1) * 0.014);
        this.sustainDuration = 1.8 + this.level * 0.18;
        this.fadeDuration = 0.28;
        this.edgeThickness = 16 + this.level * 1.6;
        this.expansionDamage = 5 + this.level * 1.4;
        this.holdDamage = 2 + this.level * 0.9;
        this.damageTickInterval = Math.max(0.16, 0.28 - (this.level - 1) * 0.01);
        this.knockbackStrength = 320 + this.level * 42;
        this.knockbackDuration = 0.22;
        this.cooldown = Math.max(2.7, 5.2 - (this.level - 1) * 0.22);
        this.applyTransformBonuses();
    }

    private applyTransformBonuses(): void {
        if (!this.isTransformed) {
            return;
        }

        this.holdDamage *= 2;
        this.knockbackStrength *= 1.5;
        this.sustainDuration += 0.35;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public getDescription(): string {
        const transformedText = this.isTransformed
            ? '终阶「硬化泡沫穹顶」：停留阶段泡沫变实心，玩家获得 30% 减伤；外圈伤害翻倍，扩张击退更强。'
            : '终阶形态暂未接入，当前以扩张推开与外圈伤害为主。';
        const holdDamageText = Math.max(1, Math.round(this.holdDamage));
        const sustainText = this.isTransformed
            ? `停留 ${this.sustainDuration.toFixed(1)}s 期间穹顶内减伤 30%，外圈每跳 ${holdDamageText} 伤害`
            : `停留 ${this.sustainDuration.toFixed(1)}s 期间只对外圈造成 ${holdDamageText} 点伤害，不阻挡穿行`;
        return `每 ${this.cooldown.toFixed(1)}s 以玩家为中心展开泡沫盾，半径扩大到 ${Math.round(this.maxRadius)}。扩张阶段击退外缘敌人并造成少量伤害；${sustainText}。${transformedText}`;
    }

    private isInSustainPhase(): boolean {
        return this.shieldElapsed >= this.expandDuration
            && this.shieldElapsed < this.expandDuration + this.sustainDuration;
    }

    private isHardenedDomeActive(): boolean {
        return this.isTransformed && this.isInSustainPhase();
    }

    public update(dt: number): void {
        super.update(dt);

        if (!this.isShieldActive || !this.activeOwnerNode) {
            return;
        }

        if (!this.activeOwnerNode.isValid) {
            this.clearShield();
            return;
        }

        this.shieldElapsed += dt;
        this.damageTickElapsed += dt;
        this.previousRadius = this.currentRadius;
        this.shieldCenter.set(this.activeOwnerNode.worldPosition);
        this.syncDomeProtection();

        const totalDuration = this.expandDuration + this.sustainDuration + this.fadeDuration;
        if (this.shieldElapsed >= totalDuration) {
            this.clearShield();
            return;
        }

        if (this.shieldElapsed < this.expandDuration) {
            const progress = this.shieldElapsed / Math.max(0.001, this.expandDuration);
            const easedProgress = 1 - Math.pow(1 - progress, 3);
            this.currentRadius = Math.max(4, this.maxRadius * easedProgress);
            this.applyExpansionWave();
            this.updateShieldVisual(1);
            return;
        }

        this.currentRadius = this.maxRadius;
        if (this.shieldElapsed < this.expandDuration + this.sustainDuration) {
            while (this.damageTickElapsed >= this.damageTickInterval) {
                this.damageTickElapsed -= this.damageTickInterval;
                this.applyOuterRingDamage();
            }
            const sustainPulse = 0.96 + Math.sin(this.shieldElapsed * 8) * 0.04;
            this.updateShieldVisual(this.isHardenedDomeActive() ? 1 : sustainPulse);
            return;
        }

        if (!this.hasStartedFade) {
            this.hasStartedFade = true;
            this.playShieldAnimation(BubbleShieldSkill.DISAPPEAR_CLIP_NAME);
        }

        const fadeElapsed = this.shieldElapsed - this.expandDuration - this.sustainDuration;
        if (this.isTransformed && fadeElapsed < BubbleShieldSkill.DOME_FADE_FLASH_DURATION) {
            this.updateShieldVisual(1);
            return;
        }

        const fadeProgress = Math.min(1, fadeElapsed / Math.max(0.001, this.fadeDuration));
        this.currentRadius = Math.max(4, this.maxRadius * (1 - fadeProgress * 0.88));
        const alpha = Math.max(0, 1 - fadeElapsed / Math.max(0.001, this.fadeDuration));
        this.updateShieldVisual(alpha);
    }

    protected onUse(context: SkillContext): void {
        this.clearShield();

        this.activeOwnerNode = context.ownerNode;
        this.shieldVisualParent = BulletHell.inst?.objects?.parent ?? BulletHell.inst?.bullets ?? context.ownerNode.parent;
        this.shieldElapsed = 0;
        this.damageTickElapsed = 0;
        this.currentRadius = 4;
        this.previousRadius = 0;
        this.hasStartedFade = false;
        this.expansionDamagedEnemies = new WeakSet();
        this.isShieldActive = true;
        this.shieldCenter.set(context.ownerNode.worldPosition);

        this.ensureShieldSkillVisual(context.payload?.visual?.projectilePrefab ?? null);
        this.ensureShieldVisual();
        this.updateShieldVisual(1);
        this.applyExpansionWave();
    }

    private ensureShieldSkillVisual(prefab: import('cc').Prefab | null): void {
        if (!this.shieldVisualParent || !prefab) {
            this.shieldVisual = null;
            this.shieldAnimations = [];
            this.shieldSprites = [];
            return;
        }

        const visual = Skill.get(prefab);
        if (!visual) {
            console.warn('[技能] 泡沫盾：创建泡沫盾 prefab 失败，回退为 Graphics 圆环');
            return;
        }

        visual.insert(this.shieldVisualParent);
        visual.init();
        visual.disableAutoRotation = true;
        visual.trigger = false;
        visual.velocity.set(0, 0, 0);
        visual.damage = 0;
        visual.penetration = 9999;
        visual.knockback = 0;
        visual.lifeTime = this.expandDuration + this.sustainDuration + this.fadeDuration + 0.2;
        if (visual.body) {
            visual.group = PhysicsSystem.PhysicsGroup.DEFAULT;
            visual.body.group = PhysicsSystem.PhysicsGroup.DEFAULT;
            visual.body.mask = 0;
        }

        this.shieldVisual = visual;
        this.shieldAnimations = visual.node.getComponentsInChildren(Animation);
        this.shieldSprites = visual.node.getComponentsInChildren(Sprite);
        this.shieldVisualBaseRadius = this.getShieldVisualBaseRadius(visual.node);
        this.expandDuration = Math.max(this.expandDuration, this.getShieldAnimationDuration(BubbleShieldSkill.EXPAND_CLIP_NAME));
        this.fadeDuration = Math.max(this.fadeDuration, this.getShieldAnimationDuration(BubbleShieldSkill.DISAPPEAR_CLIP_NAME));
        this.shieldVisual.lifeTime = this.expandDuration + this.sustainDuration + this.fadeDuration + 0.2;
        this.playShieldAnimation(BubbleShieldSkill.EXPAND_CLIP_NAME);
    }

    private ensureShieldVisual(): void {
        if (this.shieldVisual) {
            if (this.shieldVisualNode?.isValid) {
                this.shieldVisualNode.active = false;
            }
            return;
        }

        if (!this.shieldVisualParent) {
            return;
        }

        if (!this.shieldVisualNode || !this.shieldVisualNode.isValid) {
            this.shieldVisualNode = new Node('BubbleShieldVisual');
            const transform = this.shieldVisualNode.addComponent(UITransform);
            transform.setContentSize(this.maxRadius * 2.4, this.maxRadius * 2.4);
            this.shieldGraphics = this.shieldVisualNode.addComponent(Graphics);
        }

        if (this.shieldVisualNode.parent !== this.shieldVisualParent) {
            this.shieldVisualNode.parent = this.shieldVisualParent;
        }

        this.shieldVisualNode.active = true;
    }

    private updateShieldVisual(alphaScale: number): void {
        if (this.shieldVisual) {
            this.updateShieldSkillVisual(alphaScale);
            return;
        }

        if (!this.shieldVisualNode || !this.shieldGraphics || !this.shieldVisualParent) {
            return;
        }

        Vec3.subtract(this.tempLocalPosition, this.shieldCenter, this.shieldVisualParent.worldPosition);
        this.shieldVisualNode.setPosition(this.tempLocalPosition);

        const outerRadius = Math.max(4, this.currentRadius);
        const lineWidth = Math.max(8, this.edgeThickness * 0.72);
        const hardened = this.isHardenedDomeActive();
        const fillAlpha = Math.max(0, Math.min(255, Math.round((hardened ? 118 : 28) * alphaScale)));
        const strokeAlpha = Math.max(0, Math.min(255, Math.round((hardened ? 236 : 206) * alphaScale)));
        const innerStrokeAlpha = Math.max(0, Math.min(255, Math.round((hardened ? 188 : 118) * alphaScale)));

        this.shieldGraphics.clear();
        this.shieldGraphics.fillColor = hardened
            ? new Color(248, 248, 255, fillAlpha)
            : new Color(182, 242, 255, fillAlpha);
        this.shieldGraphics.circle(0, 0, Math.max(4, outerRadius - lineWidth * 0.35));
        this.shieldGraphics.fill();
        this.shieldGraphics.lineWidth = lineWidth;
        this.shieldGraphics.strokeColor = new Color(122, 223, 255, strokeAlpha);
        this.shieldGraphics.circle(0, 0, outerRadius);
        this.shieldGraphics.stroke();
        this.shieldGraphics.lineWidth = Math.max(2, lineWidth * 0.32);
        this.shieldGraphics.strokeColor = new Color(237, 251, 255, innerStrokeAlpha);
        this.shieldGraphics.circle(0, 0, Math.max(4, outerRadius - lineWidth * 0.55));
        this.shieldGraphics.stroke();
    }

    private updateShieldSkillVisual(alphaScale: number): void {
        if (!this.shieldVisual || !this.shieldVisualParent) {
            return;
        }

        if (this.shieldVisual.node.parent !== this.shieldVisualParent) {
            this.shieldVisual.insert(this.shieldVisualParent);
        }

        Vec3.subtract(this.tempLocalPosition, this.shieldCenter, this.shieldVisualParent.worldPosition);
        this.shieldVisual.setPosition(this.tempLocalPosition);

        const scaleFactor = Math.max(0.12, this.currentRadius / Math.max(1, this.shieldVisualBaseRadius));
        this.shieldScale.set(scaleFactor, scaleFactor, 1);
        this.shieldVisual.setScale(this.shieldScale);
        this.tintShieldSprites(1);
    }

    private tintShieldSprites(alphaScale: number): void {
        if (!this.shieldSprites.length) {
            return;
        }

        const normalizedAlpha = Math.max(0, Math.min(1, alphaScale));
        const hardened = this.isHardenedDomeActive();
        for (const sprite of this.shieldSprites) {
            if (hardened) {
                sprite.color = new Color(
                    248,
                    248,
                    255,
                    Math.max(0, Math.min(255, Math.round(235 * normalizedAlpha)))
                );
                continue;
            }

            const color = sprite.color;
            sprite.color = new Color(
                color.r,
                color.g,
                color.b,
                Math.max(0, Math.min(255, Math.round(255 * Math.max(0.98, normalizedAlpha))))
            );
        }
    }

    private syncDomeProtection(): void {
        const player = this.resolveProtectedPlayer();
        if (!player) {
            return;
        }

        if (this.isHardenedDomeActive()) {
            player.setIncomingDamageMultiplier(BubbleShieldSkill.DOME_DAMAGE_TAKEN_MULTIPLIER);
            return;
        }

        player.setIncomingDamageMultiplier(1);
    }

    private clearDomeProtection(): void {
        const player = this.resolveProtectedPlayer() ?? Player.inst;
        player?.setIncomingDamageMultiplier(1);
    }

    private resolveProtectedPlayer(): Player | null {
        if (this.activeOwnerNode) {
            return this.activeOwnerNode.getComponent(Player);
        }

        return Player.inst;
    }

    private getShieldVisualBaseRadius(node: Node): number {
        const sprite = node.getComponent(Sprite);
        const spriteFrame = sprite?.spriteFrame as any;
        const originalSize = spriteFrame?.originalSize as { width?: number; height?: number } | undefined;
        if (originalSize?.width || originalSize?.height) {
            return Math.max(1, Math.max(originalSize.width ?? 0, originalSize.height ?? 0) * 0.5);
        }

        const transform = node.getComponent(UITransform);
        if (!transform) {
            return this.visualBaseRadiusFallback;
        }

        return Math.max(1, Math.max(transform.contentSize.width, transform.contentSize.height) * 0.5);
    }

    private playShieldAnimation(preferredClipName: string): void {
        if (!this.shieldAnimations.length) {
            return;
        }

        for (const animation of this.shieldAnimations) {
            const animationAny = animation as any;
            const clips = (animationAny.clips as Array<{ name?: string }> | undefined) ?? [];
            const clip = clips.find(item => item?.name === preferredClipName)
                ?? animationAny.defaultClip
                ?? clips[0]
                ?? null;
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

    private getShieldAnimationDuration(preferredClipName: string): number {
        let maxDuration = 0;
        for (const animation of this.shieldAnimations) {
            const animationAny = animation as any;
            const clips = (animationAny.clips as Array<{ name?: string; duration?: number }> | undefined) ?? [];
            const clip = clips.find(item => item?.name === preferredClipName) ?? null;
            if (!clip) {
                continue;
            }

            if (typeof clip.duration === 'number' && clip.duration > maxDuration) {
                maxDuration = clip.duration;
            }
        }

        return maxDuration;
    }

    private applyExpansionWave(): void {
        const owner = this.activeOwnerNode;
        const enemyRoot = BulletHell.inst?.objects;
        if (!owner || !enemyRoot) {
            return;
        }

        const damageDisabled = isSkillDamageDisabledForTesting(BubbleShieldSkill.CONFIG.id);
        const minDistance = Math.max(0, this.previousRadius - this.edgeThickness * 0.6);
        const maxDistance = this.currentRadius + this.edgeThickness * 1.8;
        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState) {
                continue;
            }

            this.tempEnemyDelta.set(
                enemyNode.worldPosition.x - this.shieldCenter.x,
                enemyNode.worldPosition.y - this.shieldCenter.y,
                0
            );

            const distance = this.tempEnemyDelta.length();
            if (distance < minDistance || distance > maxDistance) {
                continue;
            }

            if (distance <= 0.001) {
                this.tempEnemyDelta.set(1, 0, 0);
            } else {
                this.tempEnemyDelta.multiplyScalar(1 / distance);
            }

            enemy.applyKnockback(
                this.tempEnemyDelta,
                this.knockbackStrength * (enemy.isBoss ? 0.42 : 1),
                this.knockbackDuration
            );

            if (!damageDisabled && !this.expansionDamagedEnemies.has(enemy)) {
                enemy.takeDamage(Math.max(1, Math.round(this.expansionDamage)), owner);
                this.expansionDamagedEnemies.add(enemy);
            }
        }
    }

    private applyOuterRingDamage(): void {
        const owner = this.activeOwnerNode;
        const enemyRoot = BulletHell.inst?.objects;
        if (!owner || !enemyRoot || isSkillDamageDisabledForTesting(BubbleShieldSkill.CONFIG.id)) {
            return;
        }

        const minDistance = Math.max(0, this.currentRadius - this.edgeThickness);
        const maxDistance = this.currentRadius + this.edgeThickness * 0.85;
        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState) {
                continue;
            }

            this.tempEnemyDelta.set(
                enemyNode.worldPosition.x - this.shieldCenter.x,
                enemyNode.worldPosition.y - this.shieldCenter.y,
                0
            );
            const distance = this.tempEnemyDelta.length();
            if (distance < minDistance || distance > maxDistance) {
                continue;
            }

            const damage = enemy.isBoss ? this.holdDamage * 0.7 : this.holdDamage;
            enemy.takeDamage(Math.max(1, Math.round(damage)), owner);
        }
    }

    private clearShield(): void {
        this.clearDomeProtection();
        this.isShieldActive = false;
        this.activeOwnerNode = null;
        this.shieldVisualParent = null;
        this.shieldElapsed = 0;
        this.damageTickElapsed = 0;
        this.currentRadius = 0;
        this.previousRadius = 0;
        this.hasStartedFade = false;
        this.expansionDamagedEnemies = new WeakSet();

        if (this.shieldGraphics) {
            this.shieldGraphics.clear();
        }

        if (this.shieldVisual) {
            Skill.put(this.shieldVisual);
            this.shieldVisual = null;
        }

        this.shieldAnimations = [];
        this.shieldSprites = [];
        this.shieldVisualBaseRadius = 32;

        if (this.shieldVisualNode?.isValid) {
            this.shieldVisualNode.active = false;
        }
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

export class StaticEmitterSkill extends SummonSkill {
    private static readonly GROUND_PATCH_DURATION = 3.2;
    private static readonly GROUND_PATCH_RADIUS = 56;
    private static readonly GROUND_PATCH_TICK_INTERVAL = 0.38;
    private static readonly GROUND_PATCH_CHAIN_RANGE = 92;
    private static readonly GROUND_PATCH_TICK_DAMAGE_FACTOR = 0.34;
    private static readonly SECONDARY_CHAIN_DAMAGE_FACTOR = 0.55;
    private static readonly OVERLOAD_LIGHTNING_COLOR = new Color(228, 210, 255, 255);
    private static readonly OVERLOAD_PATCH_COLOR = new Color(186, 168, 255, 210);

    static CONFIG: SkillConfig = {
        id: 'static_emitter',
        name: '静电发射器',
        description: '常驻在玩家右上方，周期性锁定近敌并发射可跳转的静电。',
        icon: 'skill_static_emitter',
        ...commonSummonSkillConfig,
    } as SkillConfig;

    private summonDuration = 26;
    private attackInterval = 1.7;
    private attackRange = 220;
    private chainRange = 160;
    private boltCount = 3;
    private chainTargetCount = 1;
    private damagePerHit = 18;
    private chainDelayStep = 0.08;
    private readonly emitterOffset = new Vec3(52, 88, 0);
    private readonly lightningVisualBaseLengthFallback = 96;

    private ownerNode: Node | null = null;
    private summonParent: Node | null = null;
    private emitterVisual: Skill | null = null;
    private emitterAnimations: Animation[] = [];
    private isSummoned = false;
    private summonElapsed = 0;
    private attackElapsed = 0;
    private readonly emitterWorldPosition = new Vec3();
    private readonly tempLocalPosition = new Vec3();
    private readonly tempStrikePosition = new Vec3();
    private readonly lightningScale = new Vec3(1, 1, 1);
    private readonly activeStrikes: StaticArcStrikeState[] = [];
    private readonly groundPatches: StaticGroundPatchState[] = [];
    private readonly tempPatchScale = new Vec3(1, 1, 1);

    constructor(level: number = 1) {
        super(StaticEmitterSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel(): void {
        this.summonDuration = 22 + this.level * 2.3;
        this.attackInterval = Math.max(0.78, 1.7 - (this.level - 1) * 0.07);
        this.attackRange = 210 + this.level * 18;
        this.chainRange = 136 + this.level * 16;
        this.boltCount = Math.min(6, 3 + Math.floor((this.level - 1) / 2));
        this.chainTargetCount = Math.min(4, 1 + Math.floor(this.level / 3));
        this.damagePerHit = 14 + this.level * 8;
        this.chainDelayStep = Math.max(0.04, 0.09 - (this.level - 1) * 0.004);
        this.applyTransformBonuses();
    }

    private applyTransformBonuses(): void {
        if (!this.isTransformed) {
            return;
        }

        this.attackInterval = Math.max(0.62, this.attackInterval * 0.88);
        this.boltCount = Math.min(7, this.boltCount + 1);
        this.chainTargetCount = Math.min(5, this.chainTargetCount + 1);
        this.chainRange += 24;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public getDescription(): string {
        const transformedText = this.isTransformed
            ? '终阶「避雷针网格」：命中后留下电浆地贴，地贴内敌人会持续受击并彼此二次导电。'
            : '等级越高，单轮发射数量越多，且每条静电可继续跳向更多敌人。';
        const overloadText = this.isTransformed
            ? `电浆地贴持续 ${StaticEmitterSkill.GROUND_PATCH_DURATION.toFixed(1)}s，范围内敌人会自动二次跳转。`
            : '';
        return `发射器停在玩家右上方，每 ${this.attackInterval.toFixed(1)}s 锁定范围 ${Math.round(this.attackRange)} 内最近敌人，单轮释放 ${this.boltCount} 条静电。每条静电最多命中 ${this.chainTargetCount} 个目标，命中后再沿附近敌人继续跳转。${overloadText}${transformedText}`;
    }

    public update(dt: number): void {
        if (!this.isSummoned || !this.ownerNode || !this.summonParent) {
            this.updateActiveStrikes(dt);
            this.updateGroundPatches(dt);
            return;
        }

        this.summonElapsed += dt;
        this.attackElapsed += dt;

        this.updateEmitterAnchor();
        this.syncEmitterVisual();
        this.updateActiveStrikes(dt);
        this.updateGroundPatches(dt);

        if (this.summonElapsed >= this.summonDuration) {
            this.clearEmitter();
            return;
        }

        if (this.attackElapsed >= this.attackInterval) {
            this.attackElapsed = 0;
            this.fireStaticVolley();
        }
    }

    protected onSummon(context: SkillContext): void {
        this.clearEmitter();

        this.ownerNode = context.ownerNode;
        this.summonParent = BulletHell.inst?.bullets;
        if (!this.summonParent) {
            console.warn('[召唤] 静电发射器：缺少 bullets 节点，无法召唤');
            return;
        }

        this.ensureEmitterVisual(context.payload?.visual?.projectilePrefab ?? null);
        this.isSummoned = true;
        this.summonElapsed = 0;
        this.attackElapsed = this.attackInterval * 0.4;
        this.updateEmitterAnchor();
        this.syncEmitterVisual();
    }

    public onUnequip(owner: Node): void {
        this.clearEmitter();
    }

    private ensureEmitterVisual(prefab: import('cc').Prefab | null): void {
        if (!this.summonParent || !prefab) {
            return;
        }

        const visual = Skill.get(prefab);
        if (!visual) {
            console.warn('[召唤] 静电发射器：创建发射器 prefab 失败');
            return;
        }

        visual.insert(this.summonParent);
        visual.init();
        visual.velocity.set(0, 0, 0);
        visual.disableAutoRotation = true;
        visual.lifeTime = 999999;
        this.configureSummonVisualCollision(visual);

        this.emitterVisual = visual;
        this.emitterAnimations = visual.node.getComponentsInChildren(Animation);
        this.playEmitterAnimation();
    }

    private playEmitterAnimation(): void {
        for (const animation of this.emitterAnimations) {
            animation.stop();
            animation.play();
        }
    }

    private updateEmitterAnchor(): void {
        if (!this.ownerNode) {
            return;
        }

        this.emitterWorldPosition.set(
            this.ownerNode.worldPosition.x + this.emitterOffset.x,
            this.ownerNode.worldPosition.y + this.emitterOffset.y,
            this.ownerNode.worldPosition.z
        );
    }

    private syncEmitterVisual(): void {
        if (!this.emitterVisual || !this.summonParent) {
            return;
        }

        if (this.emitterVisual.node.parent !== this.summonParent) {
            this.emitterVisual.insert(this.summonParent);
            this.configureSummonVisualCollision(this.emitterVisual);
        }

        Vec3.subtract(this.tempLocalPosition, this.emitterWorldPosition, this.summonParent.worldPosition);
        this.emitterVisual.setPosition(this.tempLocalPosition);
    }

    private fireStaticVolley(): void {
        const impactPrefab = this.getImpactPrefab();
        const preferredTargets = new Set<Enemy>();

        for (let boltIndex = 0; boltIndex < this.boltCount; boltIndex++) {
            let firstTarget = this.findNearestEnemyWithinRange(this.emitterWorldPosition, this.attackRange, preferredTargets);
            if (!firstTarget) {
                firstTarget = this.findNearestEnemyWithinRange(this.emitterWorldPosition, this.attackRange);
            }
            if (!firstTarget) {
                break;
            }

            preferredTargets.add(firstTarget);
            this.queueChainFromTarget(firstTarget, impactPrefab, boltIndex);
        }
    }

    private queueChainFromTarget(firstTarget: Enemy, impactPrefab: import('cc').Prefab | null, boltIndex: number): void {
        const usedTargets = new Set<Enemy>();
        let sourcePosition = new Vec3(this.emitterWorldPosition.x, this.emitterWorldPosition.y, this.emitterWorldPosition.z);
        let currentTarget: Enemy | null = firstTarget;
        let delay = boltIndex * 0.03;

        for (let chainIndex = 0; chainIndex < this.chainTargetCount && currentTarget; chainIndex++) {
            usedTargets.add(currentTarget);
            const targetPosition = currentTarget.node.worldPosition.clone();
            this.queueStaticStrike(impactPrefab, sourcePosition, targetPosition, currentTarget, delay);

            sourcePosition = targetPosition;
            delay += this.chainDelayStep;
            currentTarget = this.findNearestEnemyWithinRange(sourcePosition, this.chainRange, usedTargets);
        }
    }

    private queueStaticStrike(
        prefab: import('cc').Prefab | null,
        sourceWorldPosition: Vec3,
        targetWorldPosition: Vec3,
        targetEnemy: Enemy,
        delay: number,
        damageOverride?: number,
        isSecondary = false
    ): void {
        let visual: Skill | null = null;
        let duration = 0.18;

        if (prefab && this.summonParent) {
            visual = Skill.get(prefab);
            if (visual) {
                visual.insert(this.summonParent);
                visual.init();
                visual.disableAutoRotation = true;
                visual.velocity.set(0, 0, 0);
                visual.lifeTime = 999999;
                visual.node.active = false;
                this.configureSummonVisualCollision(visual);
                duration = Math.max(duration, this.getVisualAnimationDuration(visual.node));
            }
        }

        this.activeStrikes.push({
            visual,
            targetEnemy,
            sourceWorldPosition: new Vec3(sourceWorldPosition.x, sourceWorldPosition.y, sourceWorldPosition.z),
            targetWorldPosition: new Vec3(targetWorldPosition.x, targetWorldPosition.y, targetWorldPosition.z),
            elapsed: 0,
            delay,
            duration,
            damage: damageOverride ?? this.damagePerHit,
            hasStarted: false,
            hasAppliedDamage: false,
            isSecondary,
        });
    }

    private updateActiveStrikes(dt: number): void {
        if (this.activeStrikes.length <= 0) {
            return;
        }

        for (let index = this.activeStrikes.length - 1; index >= 0; index--) {
            const strike = this.activeStrikes[index];
            strike.elapsed += dt;

            if (!strike.hasStarted && strike.elapsed >= strike.delay) {
                strike.hasStarted = true;
                this.activateStrikeVisual(strike);
            }

            if (strike.elapsed < strike.delay + strike.duration) {
                continue;
            }

            if (!strike.hasAppliedDamage) {
                strike.hasAppliedDamage = true;
                if (!isSkillDamageDisabledForTesting(StaticEmitterSkill.CONFIG.id) && strike.targetEnemy && !strike.targetEnemy.isDead && !strike.targetEnemy.isDyingState) {
                    strike.targetEnemy.takeDamage(Math.max(1, Math.round(strike.damage)), this.ownerNode ?? undefined);
                    if (this.isTransformed && !strike.isSecondary) {
                        this.spawnGroundPatch(strike.targetWorldPosition, this.getImpactPrefab());
                    }
                }
            }

            if (strike.visual) {
                Skill.put(strike.visual);
            }
            this.activeStrikes.splice(index, 1);
        }
    }

    private spawnGroundPatch(worldPosition: Vec3, prefab: import('cc').Prefab | null): void {
        let visual: Skill | null = null;
        if (prefab && this.summonParent) {
            visual = Skill.get(prefab);
            if (visual) {
                visual.insert(this.summonParent);
                visual.init();
                visual.disableAutoRotation = true;
                visual.velocity.set(0, 0, 0);
                visual.lifeTime = 999999;
                visual.node.active = true;
                this.configureSummonVisualCollision(visual);
                this.tintOverloadVisual(visual.node, StaticEmitterSkill.OVERLOAD_PATCH_COLOR, 0.52);
                this.playVisualAnimation(visual.node);
            }
        }

        this.groundPatches.push({
            worldPosition: new Vec3(worldPosition.x, worldPosition.y, worldPosition.z),
            visual,
            elapsed: 0,
            duration: StaticEmitterSkill.GROUND_PATCH_DURATION,
            radius: StaticEmitterSkill.GROUND_PATCH_RADIUS,
            damageTickElapsed: StaticEmitterSkill.GROUND_PATCH_TICK_INTERVAL * 0.5,
        });
    }

    private updateGroundPatches(dt: number): void {
        if (!this.isTransformed) {
            if (this.groundPatches.length > 0) {
                this.clearGroundPatches();
            }
            return;
        }

        if (this.groundPatches.length <= 0) {
            return;
        }

        for (let index = this.groundPatches.length - 1; index >= 0; index--) {
            const patch = this.groundPatches[index];
            patch.elapsed += dt;
            patch.damageTickElapsed += dt;
            this.syncGroundPatchVisual(patch);

            if (patch.elapsed >= patch.duration) {
                if (patch.visual) {
                    Skill.put(patch.visual);
                }
                this.groundPatches.splice(index, 1);
                continue;
            }

            while (patch.damageTickElapsed >= StaticEmitterSkill.GROUND_PATCH_TICK_INTERVAL) {
                patch.damageTickElapsed -= StaticEmitterSkill.GROUND_PATCH_TICK_INTERVAL;
                this.tickGroundPatch(patch);
            }
        }
    }

    private syncGroundPatchVisual(patch: StaticGroundPatchState): void {
        if (!patch.visual || !this.summonParent) {
            return;
        }

        Vec3.subtract(this.tempLocalPosition, patch.worldPosition, this.summonParent.worldPosition);
        patch.visual.setPosition(this.tempLocalPosition);

        const lifeRatio = Math.max(0, 1 - patch.elapsed / Math.max(0.001, patch.duration));
        const scale = 0.34 + 0.2 * lifeRatio;
        this.tempPatchScale.set(scale, scale, 1);
        patch.visual.setScale(this.tempPatchScale);

        const alpha = Math.round(StaticEmitterSkill.OVERLOAD_PATCH_COLOR.a * (0.45 + lifeRatio * 0.55));
        this.tintOverloadVisual(patch.visual.node, StaticEmitterSkill.OVERLOAD_PATCH_COLOR, alpha / 255);
    }

    private tickGroundPatch(patch: StaticGroundPatchState): void {
        if (isSkillDamageDisabledForTesting(StaticEmitterSkill.CONFIG.id) || !this.ownerNode) {
            return;
        }

        const enemiesInPatch = this.collectEnemiesWithinRadius(patch.worldPosition, patch.radius);
        if (enemiesInPatch.length <= 0) {
            return;
        }

        const tickDamage = Math.max(1, Math.round(this.damagePerHit * StaticEmitterSkill.GROUND_PATCH_TICK_DAMAGE_FACTOR));
        const chainedThisTick = new Set<Enemy>();

        for (const enemy of enemiesInPatch) {
            enemy.takeDamage(tickDamage, this.ownerNode);
        }

        if (enemiesInPatch.length < 2) {
            return;
        }

        const impactPrefab = this.getImpactPrefab();
        for (const sourceEnemy of enemiesInPatch) {
            const chainTarget = this.findNearestEnemyWithinRange(
                sourceEnemy.node.worldPosition,
                StaticEmitterSkill.GROUND_PATCH_CHAIN_RANGE,
                new Set([...chainedThisTick, sourceEnemy])
            );
            if (!chainTarget || enemiesInPatch.indexOf(chainTarget) < 0) {
                continue;
            }

            chainedThisTick.add(chainTarget);
            const secondaryDamage = Math.max(1, Math.round(this.damagePerHit * StaticEmitterSkill.SECONDARY_CHAIN_DAMAGE_FACTOR));
            this.queueStaticStrike(
                impactPrefab,
                sourceEnemy.node.worldPosition,
                chainTarget.node.worldPosition,
                chainTarget,
                0,
                secondaryDamage,
                true
            );
        }
    }

    private collectEnemiesWithinRadius(center: Vec3, radius: number): Enemy[] {
        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return [];
        }

        const radiusSq = radius * radius;
        const enemies: Enemy[] = [];
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

    private activateStrikeVisual(strike: StaticArcStrikeState): void {
        if (!strike.visual || !this.summonParent) {
            return;
        }

        const dx = strike.targetWorldPosition.x - strike.sourceWorldPosition.x;
        const dy = strike.targetWorldPosition.y - strike.sourceWorldPosition.y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const angle = Math.atan2(dy, dx);
        const midpointX = (strike.sourceWorldPosition.x + strike.targetWorldPosition.x) * 0.5;
        const midpointY = (strike.sourceWorldPosition.y + strike.targetWorldPosition.y) * 0.5;

        this.tempStrikePosition.set(midpointX, midpointY, strike.sourceWorldPosition.z);
        Vec3.subtract(this.tempLocalPosition, this.tempStrikePosition, this.summonParent.worldPosition);
        strike.visual.setPosition(this.tempLocalPosition);
        Quat.rotateZ(tempBeamRot, Quat.IDENTITY, angle);
        strike.visual.setRotation(tempBeamRot);

        const baseLength = this.getLightningVisualBaseLength(strike.visual.node);
        this.lightningScale.set(Math.max(0.12, distance / Math.max(1, baseLength)), 1, 1);
        strike.visual.setScale(this.lightningScale);
        strike.visual.node.active = true;
        if (this.isTransformed || strike.isSecondary) {
            this.tintOverloadVisual(
                strike.visual.node,
                StaticEmitterSkill.OVERLOAD_LIGHTNING_COLOR,
                strike.isSecondary ? 0.82 : 1
            );
        }
        this.playVisualAnimation(strike.visual.node);
    }

    private tintOverloadVisual(node: Node, color: Color, alphaScale: number): void {
        const sprites = node.getComponentsInChildren(Sprite);
        const alpha = Math.max(0, Math.min(255, Math.round(color.a * alphaScale)));
        for (const sprite of sprites) {
            sprite.color = new Color(color.r, color.g, color.b, alpha);
        }
    }

    private findNearestEnemyWithinRange(origin: Vec3, maxDistance: number, excluded?: Set<Enemy>): Enemy | null {
        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return null;
        }

        let nearestEnemy: Enemy | null = null;
        let nearestDistanceSq = maxDistance * maxDistance;
        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState || excluded?.has(enemy)) {
                continue;
            }

            const dx = enemyNode.worldPosition.x - origin.x;
            const dy = enemyNode.worldPosition.y - origin.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq > nearestDistanceSq) {
                continue;
            }

            nearestDistanceSq = distanceSq;
            nearestEnemy = enemy;
        }

        return nearestEnemy;
    }

    private getImpactPrefab(): import('cc').Prefab | null {
        const skillManager = this.ownerNode?.getComponent('SkillManager') as {
            resolveSkillVisual?: (skillId: string, level: number) => { impactPrefab?: import('cc').Prefab | null };
        } | null;
        return skillManager?.resolveSkillVisual?.(this.id, this.level)?.impactPrefab ?? null;
    }

    private playVisualAnimation(node: Node): void {
        const animations = node.getComponentsInChildren(Animation);
        for (const animation of animations) {
            animation.stop();
            animation.play();
        }
    }

    private getVisualAnimationDuration(node: Node): number {
        const animations = node.getComponentsInChildren(Animation);
        let maxDuration = 0;
        for (const animation of animations) {
            const animationAny = animation as any;
            const clips = (animationAny.clips as Array<{ duration?: number }> | undefined) ?? [];
            const chosenClip = animationAny.defaultClip ?? clips[0] ?? null;
            if (typeof chosenClip?.duration === 'number' && chosenClip.duration > maxDuration) {
                maxDuration = chosenClip.duration;
            }
        }

        return maxDuration;
    }

    private getLightningVisualBaseLength(node: Node): number {
        const sprite = node.getComponent(Sprite);
        const spriteFrame = sprite?.spriteFrame as any;
        const originalSize = spriteFrame?.originalSize as { width?: number } | undefined;
        if (originalSize?.width) {
            return Math.max(1, originalSize.width);
        }

        const transform = node.getComponent(UITransform);
        return Math.max(1, transform?.contentSize.width ?? this.lightningVisualBaseLengthFallback);
    }

    private configureSummonVisualCollision(visual: Skill): void {
        if (!visual.body) {
            return;
        }

        visual.trigger = false;
        visual.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        visual.body.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        visual.body.mask = 0;
    }

    private clearEmitter(): void {
        if (this.emitterVisual) {
            tween(this.emitterVisual.node).stop();
            Skill.put(this.emitterVisual);
            this.emitterVisual = null;
        }

        for (const strike of this.activeStrikes) {
            if (strike.visual) {
                Skill.put(strike.visual);
            }
        }
        this.activeStrikes.length = 0;
        this.clearGroundPatches();

        this.ownerNode = null;
        this.summonParent = null;
        this.emitterAnimations = [];
        this.isSummoned = false;
        this.summonElapsed = 0;
        this.attackElapsed = 0;
        this.emitterWorldPosition.set(Vec3.ZERO);
    }

    private clearGroundPatches(): void {
        for (const patch of this.groundPatches) {
            if (patch.visual) {
                Skill.put(patch.visual);
            }
        }
        this.groundPatches.length = 0;
    }
}

export class PurificationTowerSkill extends SummonSkill {
    /** beam 贴图默认朝右上约 45°，补偿后 beamAngle=0 时指向正右方 */
    private static readonly BEAM_ART_OFFSET_DEG = 45;
    /** Lv1 光束半径约占屏幕宽度 1/4，满级约 1/2 */
    private static readonly BEAM_MIN_SCREEN_WIDTH_RATIO = 0.25;
    private static readonly BEAM_MAX_SCREEN_WIDTH_RATIO = 0.5;
    private static readonly BEAM_SCREEN_WIDTH_FALLBACK = 720;
    private static readonly BEAM_NORMAL_ALPHA = 102;
    private static readonly BEAM_OVERLOAD_PRIMARY_ALPHA = 220;
    private static readonly BEAM_OVERLOAD_MIRROR_ALPHA = 200;

    static CONFIG: SkillConfig = {
        id: 'purification_tower',
        name: '净化塔',
        description: '周期性在玩家附近部署净化塔，旋转光束持续净化照射范围内敌人。',
        icon: 'skill_purification_tower',
        ...commonSummonSkillConfig,
    } as SkillConfig;

    private summonDuration = 34;
    private activeDuration = 5.4;
    private respawnCooldown = 2.8;
    private beamRange = 168;
    private beamHalfAngle = Math.PI / 5;
    private beamRotationSpeed = Math.PI * 0.62;
    private damagePerTick = 14;
    private damageTickInterval = 0.22;
    private immobilizeDuration = 0.2;
    private minSpawnDistance = 96;
    private maxSpawnDistance = 236;
    private readonly beamVisualBaseLengthFallback = 60;

    private ownerNode: Node | null = null;
    private summonParent: Node | null = null;
    private towerVisual: Skill | null = null;
    private towerAnimations: Animation[] = [];
    private towerBeamNode: Node | null = null;
    private towerBeamMirrorNode: Node | null = null;
    private towerBeamAnimations: Animation[] = [];
    private towerBeamBaseScale = new Vec3(1, 1, 1);
    private readonly towerPosition = new Vec3();
    private readonly beamOrigin = new Vec3();
    private readonly tempLocalPosition = new Vec3();
    private readonly tempEnemyDelta = new Vec3();
    private readonly tempBeamScale = new Vec3(1, 1, 1);
    private isSummoned = false;
    private isTowerActive = false;
    private summonElapsed = 0;
    private towerElapsed = 0;
    private respawnElapsed = 0;
    private damageTickElapsed = 0;
    private beamAngle = 0;

    constructor(level: number = 1) {
        super(PurificationTowerSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel(): void {
        this.summonDuration = 30 + this.level * 2.8;
        this.activeDuration = 4.8 + this.level * 0.3;
        this.respawnCooldown = Math.max(1.9, 3.2 - (this.level - 1) * 0.08);
        this.beamRange = this.getBeamRangeForLevel(this.level);
        this.beamHalfAngle = Math.min(Math.PI / 3, Math.PI / 7 + (this.level - 1) * (Math.PI / 90));
        this.beamRotationSpeed = Math.PI * (0.48 + this.level * 0.03);
        this.damagePerTick = 8 + this.level * 5;
        this.damageTickInterval = Math.max(0.12, 0.24 - (this.level - 1) * 0.008);
        this.immobilizeDuration = Math.max(0.14, this.damageTickInterval + 0.06);
        this.minSpawnDistance = 88;
        this.maxSpawnDistance = 180 + this.level * 12;
        this.applyTransformBonuses();
    }

    private applyTransformBonuses(): void {
        if (!this.isTransformed) {
            return;
        }

        this.activeDuration = this.summonDuration;
        this.respawnCooldown = 0;
        this.beamRotationSpeed *= 2;
        this.beamHalfAngle = Math.min(Math.PI / 2.2, this.beamHalfAngle * 1.5);
        this.damagePerTick *= 1.3;
        this.damageTickInterval = Math.max(0.1, this.damageTickInterval * 0.82);
        this.immobilizeDuration = Math.max(0.16, this.damageTickInterval + 0.1);
    }

    private getBeamRangeForLevel(level: number): number {
        const visibleWidth = view.getVisibleSize().width;
        const screenWidth = visibleWidth > 0
            ? visibleWidth
            : PurificationTowerSkill.BEAM_SCREEN_WIDTH_FALLBACK;
        const maxLevel = Math.max(1, PurificationTowerSkill.CONFIG.maxLevel ?? 10);
        const normalizedLevel = Math.max(1, Math.min(maxLevel, Math.floor(level)));
        const levelProgress = maxLevel <= 1 ? 0 : (normalizedLevel - 1) / (maxLevel - 1);
        const widthRatio = PurificationTowerSkill.BEAM_MIN_SCREEN_WIDTH_RATIO
            + (PurificationTowerSkill.BEAM_MAX_SCREEN_WIDTH_RATIO - PurificationTowerSkill.BEAM_MIN_SCREEN_WIDTH_RATIO) * levelProgress;
        return screenWidth * widthRatio;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
        if (this.isTowerActive) {
            this.refreshOverloadTowerState();
        }
    }

    public getDescription(): string {
        const transformedText = this.isTransformed
            ? '终阶「灯塔过载」：单塔常驻至召唤结束，部署在玩家与最近敌人之间，双向扇形光束高速旋转扫射。'
            : '净化塔会在玩家附近不同位置轮换部署，并持续旋转扫描敌人。';
        const lifetimeText = this.isTransformed
            ? `过载塔将持续至本次召唤结束（约 ${this.summonDuration.toFixed(1)}s）`
            : `每次出现后持续 ${this.activeDuration.toFixed(1)}s，消失后等待 ${this.respawnCooldown.toFixed(1)}s 再在附近重新部署`;
        return `${lifetimeText}，射出约占屏幕宽度 ${Math.round(PurificationTowerSkill.BEAM_MIN_SCREEN_WIDTH_RATIO * 100)}%~${Math.round(PurificationTowerSkill.BEAM_MAX_SCREEN_WIDTH_RATIO * 100)}%（当前约 ${Math.round(this.beamRange)}）的扇形光束，被照射的敌人会短暂定身。${transformedText}`;
    }

    public update(dt: number): void {
        if (!this.isSummoned || !this.ownerNode || !this.summonParent) {
            return;
        }

        this.summonElapsed += dt;
        if (this.summonElapsed >= this.summonDuration) {
            this.clearTower();
            return;
        }

        if (!this.isTowerActive) {
            this.respawnElapsed += dt;
            if (this.respawnElapsed >= this.respawnCooldown) {
                this.spawnTower();
            }
            return;
        }

        this.towerElapsed += dt;
        this.damageTickElapsed += dt;
        this.updateTowerVisual(dt);

        while (this.damageTickElapsed >= this.damageTickInterval) {
            this.damageTickElapsed -= this.damageTickInterval;
            this.applyBeamDamage();
        }

        if (!this.isTransformed && this.towerElapsed >= this.activeDuration) {
            this.dismissTower();
        }
    }

    protected onSummon(context: SkillContext): void {
        this.clearTower();

        this.ownerNode = context.ownerNode;
        this.summonParent = BulletHell.inst?.bullets;
        if (!this.summonParent) {
            console.warn('[召唤] 净化塔：缺少 bullets 节点，无法召唤');
            return;
        }

        const prefab = context.payload?.visual?.projectilePrefab ?? null;
        if (!prefab) {
            console.warn('[召唤] 净化塔：未配置 tower prefab，无法召唤');
            return;
        }

        this.isSummoned = true;
        this.summonElapsed = 0;
        this.respawnElapsed = this.respawnCooldown;
        this.spawnTower(prefab);
    }

    public onUnequip(owner: Node): void {
        this.clearTower();
    }

    private spawnTower(prefabOverride?: import('cc').Prefab | null): void {
        const prefab = prefabOverride ?? this.resolveTowerPrefab();
        if (!this.ownerNode || !this.summonParent || !prefab) {
            return;
        }

        this.dismissTowerVisualOnly();
        this.pickTowerPosition();

        const visual = Skill.get(prefab);
        if (!visual) {
            console.warn('[召唤] 净化塔：创建 tower prefab 失败');
            return;
        }

        visual.insert(this.summonParent);
        visual.init();
        visual.disableAutoRotation = true;
        visual.velocity.set(0, 0, 0);
        visual.lifeTime = 999999;
        this.configureTowerCollision(visual);

        this.towerVisual = visual;
        this.towerAnimations = visual.node.getComponentsInChildren(Animation);
        this.towerBeamNode = visual.node.getChildByName('beam');
        this.towerBeamAnimations = this.towerBeamNode?.getComponentsInChildren(Animation) ?? [];
        // 对象池复用时 beam 子节点会保留上次缩放，必须先重置再取基准
        if (this.towerBeamNode) {
            this.towerBeamNode.setScale(1, 1, 1);
        }
        this.towerBeamBaseScale.set(1, 1, 1);
        this.isTowerActive = true;
        this.towerElapsed = 0;
        this.respawnElapsed = 0;
        this.damageTickElapsed = 0;
        this.beamAngle = Math.random() * Math.PI * 2;

        this.syncTowerToWorld();
        this.playTowerAnimations();
        this.ensureBeamMirrorVisual();
        this.updateTowerVisual(0);
    }

    private resolveTowerPrefab(): import('cc').Prefab | null {
        const skillManager = this.ownerNode?.getComponent('SkillManager') as {
            resolveSkillVisual?: (skillId: string, level: number) => { prefab?: import('cc').Prefab | null };
        } | null;
        return skillManager?.resolveSkillVisual?.(this.id, this.level)?.prefab ?? null;
    }

    private pickTowerPosition(): void {
        if (this.isTransformed) {
            this.pickOverloadTowerPosition();
            return;
        }

        const ownerPos = this.ownerNode?.worldPosition;
        if (!ownerPos) {
            this.towerPosition.set(0, 0, 0);
            return;
        }

        const angle = Math.random() * Math.PI * 2;
        const radius = this.minSpawnDistance + Math.random() * Math.max(0, this.maxSpawnDistance - this.minSpawnDistance);
        this.towerPosition.set(
            ownerPos.x + Math.cos(angle) * radius,
            ownerPos.y + Math.sin(angle) * radius,
            ownerPos.z
        );
    }

    private pickOverloadTowerPosition(): void {
        const ownerPos = this.ownerNode?.worldPosition;
        if (!ownerPos) {
            this.towerPosition.set(0, 0, 0);
            return;
        }

        const nearestEnemy = this.findNearestEnemyToOwner();
        if (nearestEnemy) {
            const enemyPos = nearestEnemy.node.worldPosition;
            this.towerPosition.set(
                ownerPos.x + (enemyPos.x - ownerPos.x) * 0.55,
                ownerPos.y + (enemyPos.y - ownerPos.y) * 0.55,
                ownerPos.z
            );
            return;
        }

        const angle = Math.random() * Math.PI * 2;
        const radius = this.minSpawnDistance + Math.random() * Math.max(0, this.maxSpawnDistance - this.minSpawnDistance) * 0.5;
        this.towerPosition.set(
            ownerPos.x + Math.cos(angle) * radius,
            ownerPos.y + Math.sin(angle) * radius,
            ownerPos.z
        );
    }

    private findNearestEnemyToOwner(): Enemy | null {
        const ownerPos = this.ownerNode?.worldPosition;
        const enemyRoot = BulletHell.inst?.objects;
        if (!ownerPos || !enemyRoot) {
            return null;
        }

        let nearestEnemy: Enemy | null = null;
        let nearestDistanceSq = Number.POSITIVE_INFINITY;
        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState) {
                continue;
            }

            const dx = enemyNode.worldPosition.x - ownerPos.x;
            const dy = enemyNode.worldPosition.y - ownerPos.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < nearestDistanceSq) {
                nearestDistanceSq = distanceSq;
                nearestEnemy = enemy;
            }
        }

        return nearestEnemy;
    }

    private refreshOverloadTowerState(): void {
        this.ensureBeamMirrorVisual();
        this.updateTowerVisual(0);
    }

    private ensureBeamMirrorVisual(): void {
        this.clearBeamMirror();
        if (!this.isTransformed || !this.towerBeamNode?.parent) {
            this.applyBeamTint();
            return;
        }

        this.towerBeamMirrorNode = instantiate(this.towerBeamNode);
        this.towerBeamMirrorNode.name = 'beam_mirror';
        this.towerBeamMirrorNode.parent = this.towerBeamNode.parent;
        this.towerBeamMirrorNode.setSiblingIndex(this.towerBeamNode.getSiblingIndex() + 1);
        this.applyBeamTint();
    }

    private applyBeamTint(): void {
        const primarySprite = this.towerBeamNode?.getComponent(Sprite);
        if (primarySprite) {
            primarySprite.color = new Color(
                255,
                255,
                255,
                this.isTransformed
                    ? PurificationTowerSkill.BEAM_OVERLOAD_PRIMARY_ALPHA
                    : PurificationTowerSkill.BEAM_NORMAL_ALPHA
            );
        }

        const mirrorSprite = this.towerBeamMirrorNode?.getComponent(Sprite);
        if (mirrorSprite) {
            mirrorSprite.color = new Color(255, 255, 255, PurificationTowerSkill.BEAM_OVERLOAD_MIRROR_ALPHA);
        }
    }

    private clearBeamMirror(): void {
        if (this.towerBeamMirrorNode) {
            this.towerBeamMirrorNode.destroy();
            this.towerBeamMirrorNode = null;
        }
    }

    private syncTowerToWorld(): void {
        if (!this.towerVisual || !this.summonParent) {
            return;
        }

        Vec3.subtract(this.tempLocalPosition, this.towerPosition, this.summonParent.worldPosition);
        this.towerVisual.setPosition(this.tempLocalPosition);
    }

    private playTowerAnimations(): void {
        for (const animation of this.towerAnimations) {
            animation.stop();
            animation.play();
        }

        for (const animation of this.towerBeamAnimations) {
            animation.stop();
            animation.play();
        }
    }

    private updateTowerVisual(dt: number): void {
        if (!this.towerVisual || !this.towerBeamNode) {
            return;
        }

        this.syncTowerToWorld();
        this.beamAngle += this.beamRotationSpeed * dt;
        this.towerBeamNode.setRotationFromEuler(
            0,
            0,
            this.beamAngle * 180 / Math.PI - PurificationTowerSkill.BEAM_ART_OFFSET_DEG
        );

        const baseLength = this.getTowerBeamBaseLength(this.towerBeamNode);
        const rangeScale = this.beamRange / Math.max(1, baseLength);
        this.tempBeamScale.set(
            this.towerBeamBaseScale.x * rangeScale,
            this.towerBeamBaseScale.y * rangeScale,
            this.towerBeamBaseScale.z
        );
        this.towerBeamNode.setScale(this.tempBeamScale);
        if (this.towerBeamMirrorNode) {
            this.towerBeamMirrorNode.setRotationFromEuler(
                0,
                0,
                (this.beamAngle + Math.PI) * 180 / Math.PI - PurificationTowerSkill.BEAM_ART_OFFSET_DEG
            );
            this.towerBeamMirrorNode.setScale(this.tempBeamScale);
        }
        // beam 锚点 (0,0) 在扇形顶点，与贴图发射点一致
        this.towerBeamNode.getWorldPosition(this.beamOrigin);
    }







    private applyBeamDamage(): void {
        if (!this.ownerNode || !this.towerBeamNode || isSkillDamageDisabledForTesting(PurificationTowerSkill.CONFIG.id)) {
            return;
        }

        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return;
        }

        const beamCenterAngles = this.isTransformed
            ? [this.beamAngle, this.beamAngle + Math.PI]
            : [this.beamAngle];

        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState) {
                continue;
            }

            let isHit = false;
            for (const centerAngle of beamCenterAngles) {
                if (this.isEnemyInsideBeamSector(enemyNode, centerAngle)) {
                    isHit = true;
                    break;
                }
            }

            if (!isHit) {
                continue;
            }

            enemy.takeDamage(Math.max(1, Math.round(this.damagePerTick)), this.ownerNode);
            this.applyBeamImmobilize(enemy);
        }
    }

    private applyBeamImmobilize(enemy: Enemy): void {
        if (enemy.isBoss) {
            enemy.applyMovementDebuff(this.immobilizeDuration * 0.6, 0.32);
            return;
        }

        enemy.applyStun(this.immobilizeDuration);
    }

    private isEnemyInsideBeamSector(enemyNode: Node, beamCenterAngle: number): boolean {
        const beamDirectionX = Math.cos(beamCenterAngle);
        const beamDirectionY = Math.sin(beamCenterAngle);
        const cosHalfAngle = Math.cos(this.beamHalfAngle);
        const maxDistanceSq = this.beamRange * this.beamRange;

        this.tempEnemyDelta.set(
            enemyNode.worldPosition.x - this.beamOrigin.x,
            enemyNode.worldPosition.y - this.beamOrigin.y,
            0
        );

        const distanceSq = this.tempEnemyDelta.lengthSqr();
        if (distanceSq <= 0.0001 || distanceSq > maxDistanceSq) {
            return false;
        }

        const distance = Math.sqrt(distanceSq);
        const dirX = this.tempEnemyDelta.x / distance;
        const dirY = this.tempEnemyDelta.y / distance;
        return dirX * beamDirectionX + dirY * beamDirectionY >= cosHalfAngle;
    }

    private getTowerBeamBaseLength(node: Node): number {
        // 使用 UITransform 的 contentSize.width 作为基准长度，
        // 因为 beam 的 Sprite 实际显示在 UITransform 的 contentSize 中，
        // 缩放 X 轴时视觉长度 = contentSize.width * scaleX。
        // 之前使用 SpriteFrame 的 originalSize (64x64) 会导致缩放比例计算错误，
        // 使得视觉长度比实际伤害范围 (beamRange) 大 1.56 倍。
        const transform = node.getComponent(UITransform);
        if (transform) {
            return Math.max(1, transform.contentSize.width);
        }

        // 回退：如果找不到 UITransform，尝试使用 SpriteFrame 的原始尺寸
        const sprite = node.getComponent(Sprite);
        const spriteFrame = sprite?.spriteFrame as any;
        const originalSize = spriteFrame?.originalSize as { width?: number; height?: number } | undefined;
        if (originalSize?.width || originalSize?.height) {
            return Math.max(1, Math.max(originalSize.width ?? 0, originalSize.height ?? 0));
        }

        return this.beamVisualBaseLengthFallback;
    }


    private configureTowerCollision(visual: Skill): void {
        if (!visual.body) {
            return;
        }

        visual.trigger = false;
        visual.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        visual.body.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        visual.body.mask = 0;
    }

    private dismissTower(): void {
        this.dismissTowerVisualOnly();
        this.isTowerActive = false;
        this.towerElapsed = 0;
        this.damageTickElapsed = 0;
        this.respawnElapsed = 0;
    }

    private dismissTowerVisualOnly(): void {
        this.clearBeamMirror();
        if (this.towerVisual) {
            tween(this.towerVisual.node).stop();
            Skill.put(this.towerVisual);
            this.towerVisual = null;
        }

        this.towerAnimations = [];
        this.towerBeamNode = null;
        this.towerBeamAnimations = [];
        this.towerBeamBaseScale.set(1, 1, 1);
    }

    private clearTower(): void {
        this.dismissTowerVisualOnly();
        this.ownerNode = null;
        this.summonParent = null;
        this.isSummoned = false;
        this.isTowerActive = false;
        this.summonElapsed = 0;
        this.towerElapsed = 0;
        this.respawnElapsed = 0;
        this.damageTickElapsed = 0;
        this.beamAngle = 0;
        this.towerPosition.set(Vec3.ZERO);
        this.beamOrigin.set(Vec3.ZERO);
    }
}

export class CleaningRobotSkill extends SummonSkill {
    private static readonly MOVE_CLIP_NAME = 'idle';
    private static readonly VACUUM_CLIP_NAME = 'tansuo';

    static CONFIG: SkillConfig = {
        id: 'cleaning_robot',
        name: '清洁机器人',
        description: '周期性跟随玩家并锁定最近敌人，用吸尘器在正方形范围内持续牵引目标。',
        icon: 'skill_robot',
        ...commonSummonSkillConfig,
    } as SkillConfig;

    private summonDuration = 24;
    private followDurationBeforeSeek = 1.1;
    private vacuumDuration = 2.1;
    private vacuumRangeSize = 132;
    private damagePerTick = 1;
    private damageTickInterval = 0.32;
    private pullStrength = 128;
    private pullPulseDuration = 0.14;
    private pullJitterScale = 0.72;
    private outwardStruggleScale = 0.42;
    private slowMultiplier = 0.72;
    private standbyRadius = 76;
    private minPlayerClearRadius = 52;
    private maxLeashRadius = 186;
    private followMoveSpeed = 156;
    private seekMoveSpeed = 520;
    private readonly vacuumVisualBaseSizeFallback = 96;

    private ownerNode: Node | null = null;
    private summonParent: Node | null = null;
    private robotVisual: Skill | null = null;
    private vacuumVisual: Skill | null = null;
    private robotAnimations: Animation[] = [];
    private vacuumAnimations: Animation[] = [];
    private seekTargetEnemy: Enemy | null = null;
    private phase: 'follow' | 'seek' | 'vacuum' = 'follow';
    private isSummoned = false;
    private summonElapsed = 0;
    private phaseElapsed = 0;
    private damageTickElapsed = 0;
    private readonly robotPosition = new Vec3();
    private readonly desiredWorldPosition = new Vec3();
    private readonly seekTargetWorldPosition = new Vec3();
    private readonly standbyOffset = new Vec3();
    private readonly tempLocalPosition = new Vec3();
    private readonly tempMoveDelta = new Vec3();
    private readonly tempOwnerOffset = new Vec3();
    private readonly tempEnemyDirection = new Vec3();
    private readonly tempPerpendicular = new Vec3();
    private readonly tempPullDirection = new Vec3();
    private readonly robotBaseScale = new Vec3(1, 1, 1);
    private readonly vacuumBaseScale = new Vec3(1, 1, 1);
    private readonly vacuumScaledSize = new Vec3(1, 1, 1);
    private vacuumVisualBaseSize = 96;

    constructor(level: number = 1) {
        super(CleaningRobotSkill.CONFIG, level);
        this.updateByLevel();
    }

    private updateByLevel() {
        this.summonDuration = 18 + this.level * 2.4;
        this.followDurationBeforeSeek = Math.max(0.5, 1.15 - 0.05 * (this.level - 1));
        this.vacuumDuration = 1.35 + this.level * 0.14 + (this.isTransformed ? 0.55 : 0);
        this.vacuumRangeSize = 104 + this.level * 18 + (this.isTransformed ? 48 : 0);
        this.damagePerTick = 0.18 + this.level * 0.26 + (this.isTransformed ? 5.2 : 0);
        this.damageTickInterval = Math.max(0.16, 0.34 - 0.012 * (this.level - 1));
        this.pullStrength = (112 + this.level * 18) * (this.isTransformed ? 2.2 : 1);
        this.pullJitterScale = this.isTransformed ? 0.32 : 0.82;
        this.outwardStruggleScale = this.isTransformed ? 0.12 : 0.48;
        this.slowMultiplier = Math.max(this.isTransformed ? 0.26 : 0.42, 0.78 - this.level * 0.045);
        this.standbyRadius = 56 + this.level * 4;
        this.minPlayerClearRadius = Math.min(this.standbyRadius - 8, 44 + this.level * 2);
        this.maxLeashRadius = 144 + this.level * 7;
        this.followMoveSpeed = 132 + this.level * 12;
        this.seekMoveSpeed = 420 + this.level * 28;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
        this.refreshVacuumVisualScale();
    }

    public getDescription(): string {
        const phaseText = this.isTransformed
            ? '终阶后伤害和拉力明显增强，敌人会被更扎实地拽向机器人。'
            : '前期以持续牵引和轻微清理伤害为主，敌人会边挣扎边被吸过去。';
        return `机器人会先跟随玩家 ${this.followDurationBeforeSeek.toFixed(1)}s，再锁定离玩家最近的敌人并前往作业点，展开边长 ${Math.round(this.vacuumRangeSize)} 的正方形吸附区，持续 ${this.vacuumDuration.toFixed(1)}s。${phaseText}`;
    }

    public update(dt: number): void {
        if (!this.isSummoned || !this.ownerNode || !this.summonParent || !this.robotVisual) {
            return;
        }

        if (this.robotVisual.node.parent !== this.summonParent) {
            this.robotVisual.insert(this.summonParent);
            this.syncVisualToWorld(this.robotVisual, this.robotPosition);
            this.configureVisualCollision(this.robotVisual);
        }

        const desiredVacuumParent = this.getVacuumVisualParent();
        if (this.vacuumVisual && desiredVacuumParent && this.vacuumVisual.node.parent !== desiredVacuumParent) {
            this.vacuumVisual.insert(desiredVacuumParent);
            this.syncVacuumVisualLayer();
            this.configureVisualCollision(this.vacuumVisual);
            this.vacuumVisual.node.active = this.phase === 'vacuum';
            this.syncVisualToWorld(this.vacuumVisual, this.robotPosition);
        }

        this.summonElapsed += dt;
        this.phaseElapsed += dt;
        if (this.phase === 'vacuum') {
            this.damageTickElapsed += dt;
        }

        if (this.summonElapsed >= this.summonDuration) {
            this.clearRobot();
            return;
        }

        switch (this.phase) {
            case 'follow':
                this.followOwner(dt);
                if (this.phaseElapsed >= this.followDurationBeforeSeek) {
                    this.tryEnterSeekPhase();
                }
                break;
            case 'seek':
                this.updateSeekPhase(dt);
                break;
            case 'vacuum':
                this.updateVacuumPhase();
                break;
        }
    }

    protected onSummon(context: SkillContext): void {
        this.ownerNode = context.ownerNode;
        this.summonParent = BulletHell.inst?.bullets;
        if (!this.summonParent) {
            console.warn('[召唤] 清洁机器人：缺少 bullets 节点，无法召唤');
            return;
        }

        const robotPrefab = context.payload?.visual?.projectilePrefab ?? null;
        if (!robotPrefab) {
            console.warn('[召唤] 清洁机器人：未配置机器人 prefab，无法召唤');
            return;
        }

        if (!this.robotVisual) {
            this.robotVisual = Skill.get(robotPrefab);
            if (!this.robotVisual) {
                console.warn('[召唤] 清洁机器人：创建机器人实体失败');
                return;
            }
            this.robotVisual.insert(this.summonParent);
            this.robotVisual.init();
            this.robotVisual.velocity.set(0, 0, 0);
            this.robotVisual.disableAutoRotation = true;
        }

        this.configureVisualCollision(this.robotVisual);
        this.robotVisual.lifeTime = 999999;
        this.robotVisual.node.active = true;
        this.robotAnimations = this.robotVisual.node.getComponentsInChildren(Animation);
        this.robotBaseScale.set(this.robotVisual.node.scale);

        this.ensureVacuumVisual(context.payload?.visual?.impactPrefab ?? null);
        this.refreshVacuumVisualScale();

        this.isSummoned = true;
        this.phase = 'follow';
        this.summonElapsed = 0;
        this.phaseElapsed = 0;
        this.damageTickElapsed = 0;
        this.seekTargetEnemy = null;
        this.pickStandbyOffset();
        this.robotPosition.set(this.ownerNode.worldPosition);
        this.robotPosition.add(this.standbyOffset);
        this.syncVisualToWorld(this.robotVisual, this.robotPosition);
        this.hideVacuumVisual();
        this.playAnimation(this.robotAnimations, CleaningRobotSkill.MOVE_CLIP_NAME);
    }

    public onUnequip(owner: Node): void {
        this.clearRobot();
    }

    private updateSeekPhase(dt: number): void {
        if (!this.seekTargetEnemy || this.seekTargetEnemy.isDead || this.seekTargetEnemy.isDyingState) {
            this.enterFollowPhase();
            return;
        }

        this.seekTargetWorldPosition.set(this.seekTargetEnemy.node.worldPosition);
        if (this.moveRobotTowards(this.seekTargetWorldPosition, this.seekMoveSpeed, dt)) {
            this.enterVacuumPhase();
        }
    }

    private updateVacuumPhase(): void {
        this.syncVisualToWorld(this.robotVisual, this.robotPosition);
        this.updateVacuumVisual();
        this.applyVacuumPull();

        while (this.damageTickElapsed >= this.damageTickInterval) {
            this.damageTickElapsed -= this.damageTickInterval;
            this.applyVacuumDamage();
        }

        if (this.phaseElapsed >= this.vacuumDuration) {
            this.enterFollowPhase();
        }
    }

    private tryEnterSeekPhase(): void {
        const nearestEnemy = this.findNearestEnemyToOwner();
        if (!nearestEnemy) {
            return;
        }

        this.seekTargetEnemy = nearestEnemy;
        this.seekTargetWorldPosition.set(nearestEnemy.node.worldPosition);
        this.phase = 'seek';
        this.phaseElapsed = 0;
        this.playAnimation(this.robotAnimations, CleaningRobotSkill.MOVE_CLIP_NAME);
    }

    private enterFollowPhase(): void {
        this.phase = 'follow';
        this.phaseElapsed = 0;
        this.damageTickElapsed = 0;
        this.seekTargetEnemy = null;
        this.pickStandbyOffset();
        this.hideVacuumVisual();
        this.playAnimation(this.robotAnimations, CleaningRobotSkill.MOVE_CLIP_NAME);
    }

    private enterVacuumPhase(): void {
        this.phase = 'vacuum';
        this.phaseElapsed = 0;
        this.damageTickElapsed = 0;
        this.seekTargetEnemy = null;
        this.showVacuumVisual();
        this.applyVacuumPull();
        this.applyVacuumDamage();
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
        if (this.moveRobotTowards(this.desiredWorldPosition, this.followMoveSpeed, dt)) {
            this.pickStandbyOffset();
        }
    }

    private findNearestEnemyToOwner(): Enemy | null {
        const ownerPos = this.ownerNode?.worldPosition;
        const enemyRoot = BulletHell.inst?.objects;
        if (!ownerPos || !enemyRoot) {
            return null;
        }

        let nearestEnemy: Enemy | null = null;
        let nearestDistanceSq = Number.POSITIVE_INFINITY;
        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState) {
                continue;
            }

            const dx = enemyNode.worldPosition.x - ownerPos.x;
            const dy = enemyNode.worldPosition.y - ownerPos.y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < nearestDistanceSq) {
                nearestDistanceSq = distanceSq;
                nearestEnemy = enemy;
            }
        }

        return nearestEnemy;
    }

    private collectEnemiesInVacuumRange(): Enemy[] {
        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return [];
        }

        const halfSize = this.vacuumRangeSize * 0.5;
        const enemies: Enemy[] = [];
        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState) {
                continue;
            }

            const dx = enemyNode.worldPosition.x - this.robotPosition.x;
            const dy = enemyNode.worldPosition.y - this.robotPosition.y;
            if (Math.abs(dx) <= halfSize && Math.abs(dy) <= halfSize) {
                enemies.push(enemy);
            }
        }

        return enemies;
    }

    private applyVacuumPull(): void {
        const owner = this.ownerNode;
        if (!owner) {
            return;
        }

        const enemies = this.collectEnemiesInVacuumRange();
        const halfSize = Math.max(1, this.vacuumRangeSize * 0.5);
        for (let index = 0; index < enemies.length; index++) {
            const enemy = enemies[index];
            const enemyPos = enemy.node.worldPosition;
            this.tempEnemyDirection.set(
                this.robotPosition.x - enemyPos.x,
                this.robotPosition.y - enemyPos.y,
                0
            );

            const distance = this.tempEnemyDirection.length();
            if (distance <= 0.001) {
                continue;
            }

            this.tempEnemyDirection.multiplyScalar(1 / distance);
            this.tempPerpendicular.set(-this.tempEnemyDirection.y, this.tempEnemyDirection.x, 0);

            const jitterPhase = this.phaseElapsed * 15 + index * 0.95;
            const lateralJitter = Math.sin(jitterPhase) * this.pullJitterScale;
            const outwardPulse = Math.max(0, Math.sin(jitterPhase * 1.1 + 0.6)) * this.outwardStruggleScale;
            const inwardBias = this.isTransformed ? 1.72 : 1.24;

            this.tempPullDirection.set(
                this.tempEnemyDirection.x * (inwardBias - outwardPulse) + this.tempPerpendicular.x * lateralJitter,
                this.tempEnemyDirection.y * (inwardBias - outwardPulse) + this.tempPerpendicular.y * lateralJitter,
                0
            );
            this.tempPullDirection.normalize();

            const edgeFactor = Math.max(0.62, 1 - distance / halfSize);
            const jitterBoost = 1 + Math.abs(lateralJitter) * (this.isTransformed ? 0.36 : 0.74);
            const pullStrength = this.pullStrength * edgeFactor * jitterBoost * (enemy.isBoss ? 0.4 : 1);
            enemy.applyMovementDebuff(this.pullPulseDuration, enemy.isBoss ? Math.max(0.64, this.slowMultiplier + 0.28) : this.slowMultiplier);
            enemy.applyKnockback(this.tempPullDirection, pullStrength, this.pullPulseDuration);
        }
    }

    private applyVacuumDamage(): void {
        if (!this.ownerNode || isSkillDamageDisabledForTesting(CleaningRobotSkill.CONFIG.id)) {
            return;
        }

        const enemies = this.collectEnemiesInVacuumRange();
        for (const enemy of enemies) {
            const damage = enemy.isBoss ? this.damagePerTick * 0.65 : this.damagePerTick;
            enemy.takeDamage(Math.max(1, Math.round(damage)), this.ownerNode);
        }
    }

    private ensureVacuumVisual(prefab: import('cc').Prefab | null): void {
        const vacuumParent = this.getVacuumVisualParent();
        if (!this.summonParent || !vacuumParent) {
            return;
        }

        if (this.vacuumVisual && !prefab) {
            Skill.put(this.vacuumVisual);
            this.vacuumVisual = null;
            this.vacuumAnimations = [];
            return;
        }

        if (!prefab) {
            return;
        }

        if (!this.vacuumVisual) {
            this.vacuumVisual = Skill.get(prefab);
            if (!this.vacuumVisual) {
                console.warn('[召唤] 清洁机器人：创建吸附范围特效失败');
                return;
            }
            this.vacuumVisual.insert(vacuumParent);
            this.vacuumVisual.init();
            this.vacuumVisual.velocity.set(0, 0, 0);
            this.vacuumVisual.disableAutoRotation = true;
            this.configureVisualCollision(this.vacuumVisual);
        }

        this.vacuumVisual.lifeTime = 999999;
        this.vacuumVisual.node.active = false;
        this.syncVacuumVisualLayer();
        this.vacuumAnimations = this.vacuumVisual.node.getComponentsInChildren(Animation);
        this.vacuumBaseScale.set(this.vacuumVisual.node.scale);
        this.vacuumVisualBaseSize = this.getVacuumVisualBaseSize(this.vacuumVisual.node);
    }

    private getVacuumVisualParent(): Node | null {
        const objectsParent = BulletHell.inst?.objects;
        return objectsParent?.parent ?? this.summonParent;
    }

    private syncVacuumVisualLayer(): void {
        if (!this.vacuumVisual) {
            return;
        }

        const vacuumParent = this.vacuumVisual.node.parent;
        const objectsParent = BulletHell.inst?.objects;
        const bulletsParent = BulletHell.inst?.bullets;
        if (!vacuumParent || !objectsParent || !bulletsParent || objectsParent.parent !== vacuumParent || bulletsParent.parent !== vacuumParent) {
            return;
        }

        const backmostIndex = Math.min(objectsParent.getSiblingIndex(), bulletsParent.getSiblingIndex());
        this.vacuumVisual.node.setSiblingIndex(backmostIndex);
    }

    private refreshVacuumVisualScale(): void {
        if (!this.vacuumVisual) {
            return;
        }

        const scaleFactor = Math.max(0.08, this.vacuumRangeSize / Math.max(1, this.vacuumVisualBaseSize));
        this.vacuumScaledSize.set(
            this.vacuumBaseScale.x * scaleFactor,
            this.vacuumBaseScale.y * scaleFactor,
            this.vacuumBaseScale.z
        );
        this.vacuumVisual.setScale(this.vacuumScaledSize);
    }

    private showVacuumVisual(): void {
        if (!this.vacuumVisual) {
            return;
        }

        this.refreshVacuumVisualScale();
        this.vacuumVisual.node.active = true;
        this.syncVisualToWorld(this.vacuumVisual, this.robotPosition);
        this.playAnimation(this.vacuumAnimations, CleaningRobotSkill.VACUUM_CLIP_NAME);
    }

    private hideVacuumVisual(): void {
        if (!this.vacuumVisual) {
            return;
        }

        this.vacuumVisual.node.active = false;
    }

    private updateVacuumVisual(): void {
        if (!this.vacuumVisual || !this.vacuumVisual.node.active) {
            return;
        }

        this.refreshVacuumVisualScale();
        this.syncVisualToWorld(this.vacuumVisual, this.robotPosition);
    }

    private getVacuumVisualBaseSize(node: Node): number {
        const transform = node.getComponent(UITransform);
        if (!transform) {
            return this.vacuumVisualBaseSizeFallback;
        }

        return Math.max(1, Math.max(transform.contentSize.width, transform.contentSize.height));
    }

    private syncVisualToWorld(visual: Skill, worldPos: Vec3): void {
        const visualParent = visual.node.parent;
        if (!visualParent) {
            return;
        }

        Vec3.subtract(this.tempLocalPosition, worldPos, visualParent.worldPosition);
        visual.setPosition(this.tempLocalPosition);
    }

    private configureVisualCollision(visual: Skill): void {
        if (!visual.body) {
            return;
        }

        visual.trigger = false;
        visual.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        visual.body.group = PhysicsSystem.PhysicsGroup.DEFAULT;
        visual.body.mask = 0;
    }

    private moveRobotTowards(targetWorldPos: Vec3, speed: number, dt: number): boolean {
        const ownerPos = this.ownerNode?.worldPosition;
        if (ownerPos) {
            this.clampWithinLeash(ownerPos, targetWorldPos);
        }

        Vec3.subtract(this.tempMoveDelta, targetWorldPos, this.robotPosition);
        const distance = this.tempMoveDelta.length();
        if (distance <= 0.001) {
            this.robotPosition.set(targetWorldPos);
            this.syncVisualToWorld(this.robotVisual!, this.robotPosition);
            return true;
        }

        const maxStep = Math.max(0, speed) * dt;
        if (distance <= maxStep) {
            this.robotPosition.set(targetWorldPos);
            this.syncVisualToWorld(this.robotVisual!, this.robotPosition);
            return true;
        }

        this.tempMoveDelta.multiplyScalar(maxStep / distance);
        this.robotPosition.add(this.tempMoveDelta);
        this.syncVisualToWorld(this.robotVisual!, this.robotPosition);
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
        const angle = this.getCurrentRelativeAngle(this.ownerNode?.worldPosition ?? Vec3.ZERO) + (Math.random() - 0.5) * Math.PI * 0.5;
        const radius = this.standbyRadius * (0.74 + Math.random() * 0.2);
        this.standbyOffset.set(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
    }

    private getCurrentRelativeAngle(ownerWorldPos: Vec3): number {
        Vec3.subtract(this.tempOwnerOffset, this.robotPosition, ownerWorldPos);
        if (this.tempOwnerOffset.lengthSqr() <= 0.0001) {
            return randomAngle();
        }

        return Math.atan2(this.tempOwnerOffset.y, this.tempOwnerOffset.x);
    }

    private playAnimation(animations: Animation[], preferredClipName: string): void {
        if (!animations.length) {
            return;
        }

        for (const animation of animations) {
            const animationAny = animation as any;
            const clips = (animationAny.clips as Array<{ name?: string }> | undefined) ?? [];
            const clip = clips.find(item => (item?.name ?? '').trim().toLowerCase() === preferredClipName)
                ?? clips.find(item => (item?.name ?? '').trim().toLowerCase() === preferredClipName.toLowerCase())
                ?? animationAny.defaultClip
                ?? clips[0]
                ?? null;
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

    private clearRobot(): void {
        if (this.robotVisual) {
            tween(this.robotVisual.node).stop();
            Skill.put(this.robotVisual);
            this.robotVisual = null;
        }

        if (this.vacuumVisual) {
            tween(this.vacuumVisual.node).stop();
            Skill.put(this.vacuumVisual);
            this.vacuumVisual = null;
        }

        this.ownerNode = null;
        this.summonParent = null;
        this.seekTargetEnemy = null;
        this.robotAnimations = [];
        this.vacuumAnimations = [];
        this.isSummoned = false;
        this.phase = 'follow';
        this.summonElapsed = 0;
        this.phaseElapsed = 0;
        this.damageTickElapsed = 0;
        this.robotPosition.set(Vec3.ZERO);
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
    private compressionCastsThreshold = 3;
    private compressionRadiusFactor = 1.5;
    private compressionExecuteHpRatio = 0.15;
    private compressionDamageMultiplier = 1.28;
    private castsSinceCompression = 0;
    private isCompressionCast = false;
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
        this.castsSinceCompression = 0;
        this.isCompressionCast = false;
        this.applyTransformBonuses();
    }

    private applyTransformBonuses(): void {
        if (!this.isTransformed) {
            return;
        }

        this.vanishEveryCasts = 99;
        this.attackInterval = Math.max(0.95, this.attackInterval * 0.9);
        this.attackRadius = Math.round(this.attackRadius * 1.08);
        this.castLockDuration = Math.max(0.42, this.castLockDuration * 1.08);
        this.castSlowDuration = this.castLockDuration + 0.12;
        this.compressionCastsThreshold = 3;
        this.compressionRadiusFactor = 1.5;
        this.compressionExecuteHpRatio = 0.15;
        this.compressionDamageMultiplier = 1.28;
        this.castKillSuctionDuration = 0.34;
    }

    public levelUp(): void {
        super.levelUp();
        this.updateByLevel();
    }

    public getDescription(): string {
        const transformedText = this.isTransformed
            ? '终阶「压缩粉碎」：稳定驻场不再隐身，每 3 次攻击进入压缩模式，大范围吸扯并斩杀低血目标。'
            : '满级后进化为压缩粉碎，减少隐身并周期性发动压缩斩杀。';
        const overloadText = this.isTransformed
            ? `压缩模式吸力范围 ×${this.compressionRadiusFactor.toFixed(1)}，对血量 ≤${Math.round(this.compressionExecuteHpRatio * 100)}% 的非 Boss 敌人执行粉碎。`
            : '';
        return `卫兵环绕玩家移动，每 ${this.attackInterval.toFixed(1)}s 释放吸力打击，范围 ${Math.round(this.attackRadius)}，单次 ${this.castDamage} 伤害。${overloadText}${transformedText}`;
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
                if (!this.isTransformed && this.castsSinceVanish >= this.vanishEveryCasts) {
                    this.castsSinceVanish = 0;
                    const remainTime = this.summonDuration - this.summonElapsed;
                    // 召唤即将结束时不再进入隐身，避免出现“消失后看起来再也不回来”的观感。
                    if (remainTime > this.vanishDuration + 1.0) {
                        this.isVanishing = true;
                        this.guardVisual.node.active = false;
                    }
                } else if (this.isTransformed && this.castsSinceVanish >= this.vanishEveryCasts) {
                    this.castsSinceVanish = 0;
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
        this.castsSinceCompression = 0;
        this.isCompressionCast = false;

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

        if (this.isTransformed) {
            this.castsSinceCompression++;
            this.isCompressionCast = this.castsSinceCompression >= this.compressionCastsThreshold;
            if (this.isCompressionCast) {
                this.castsSinceCompression = 0;
            }
        } else {
            this.isCompressionCast = false;
        }

        this.isCasting = true;
        this.castLockElapsed = 0;
        this.castCenterWorldPosition.set(this.guardPosition);
        this.playGuardAttackAnimation();
        this.showVortexChargeEffect();
        this.setVortexCompressionVisual(this.isCompressionCast);

        const peakScale = this.isCompressionCast ? 1.68 : 1.45;
        tween(this.guardVisual.node)
            .stop()
            .to(0.18, { scale: new Vec3(peakScale, peakScale, 1) })
            .to(0.16, { scale: new Vec3(1, 1, 1) })
            .start();
    }

    private getActiveCastRadiusFactor(): number {
        return this.isCompressionCast ? this.compressionRadiusFactor : this.castControlRadiusFactor;
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

        const radius = this.attackRadius * this.getActiveCastRadiusFactor();
        const radiusSqr = radius * radius;
        const castDamage = this.isCompressionCast
            ? Math.max(1, Math.round(this.castDamage * this.compressionDamageMultiplier))
            : this.castDamage;
        let killCount = 0;
        let hitCount = 0;
        let executeCount = 0;

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

            const willBeKilled = enemy.currentHp <= castDamage;
            if (willBeKilled) {
                enemy.setSuctionDeathTarget(this.castCenterWorldPosition, this.castKillSuctionDuration);
            }

            enemy.takeDamage(castDamage, this.ownerNode);
            hitCount++;
            if (willBeKilled) {
                killCount++;
                continue;
            }

            if (this.isCompressionCast && this.tryExecuteLowHpEnemy(enemy)) {
                executeCount++;
                killCount++;
            }
        }

        if (hitCount > 0) {
            const modeLabel = this.isCompressionCast ? '压缩粉碎' : '收束打击';
            console.log(`[召唤] 垃圾桶卫兵释放${modeLabel}，命中 ${hitCount} 个目标，击杀 ${killCount} 个目标（斩杀 ${executeCount}），单次伤害 ${castDamage}`);
        }

        this.playVortexCastEffect(() => this.playGuardMoveAnimation());
    }

    private tryExecuteLowHpEnemy(enemy: Enemy): boolean {
        if (enemy.isBoss || enemy.isDead || enemy.maxHp <= 0) {
            return false;
        }

        const hpRatio = enemy.currentHp / enemy.maxHp;
        if (hpRatio > this.compressionExecuteHpRatio) {
            return false;
        }

        enemy.setSuctionDeathTarget(this.castCenterWorldPosition, this.castKillSuctionDuration);
        enemy.takeDamage(enemy.currentHp, this.ownerNode);
        return true;
    }

    private applyCastControl(): void {
        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return;
        }

        const radius = this.attackRadius * this.getActiveCastRadiusFactor();
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

            const slowMultiplier = this.isCompressionCast
                ? (enemy.isBoss ? 0.5 : 0.34)
                : (enemy.isBoss ? 0.28 : 0);
            enemy.applyMovementDebuff(this.castSlowDuration, slowMultiplier);
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
        this.castsSinceCompression = 0;
        this.isCompressionCast = false;
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
        this.setVortexCompressionVisual(false);
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

        const radiusVisualFactor = this.isCompressionCast ? this.compressionRadiusFactor : 1;
        const fullRangeScale = this.getVortexScaleForRadius(radiusVisualFactor);
        const overdriveScale = this.getVortexScaleForRadius(radiusVisualFactor * 1.08);

        tween(this.guardVortexNode).stop();
        this.guardVortexNode.active = true;
        this.guardVortexNode.setScale(this.vortexChargeScale);

        tween(this.guardVortexNode)
            .to(this.isCompressionCast ? 0.24 : 0.18, { scale: fullRangeScale })
            .to(this.isCompressionCast ? 0.22 : 0.18, { scale: overdriveScale })
            .to(0.22, { scale: this.vortexHiddenScale })
            .call(() => {
                if (!this.guardVortexNode) {
                    onComplete?.();
                    return;
                }
                this.guardVortexNode.active = false;
                this.setVortexCompressionVisual(false);
                onComplete?.();
            })
            .start();
    }

    private setVortexCompressionVisual(active: boolean): void {
        if (!this.guardVortexNode) {
            return;
        }

        const sprites = this.guardVortexNode.getComponentsInChildren(Sprite);
        for (const sprite of sprites) {
            sprite.color = active
                ? new Color(42, 34, 82, sprite.color.a)
                : new Color(255, 255, 255, sprite.color.a);
        }
    }

    private showVortexChargeEffect(): void {
        if (!this.guardVortexNode) {
            return;
        }

        const radiusVisualFactor = this.isCompressionCast ? this.compressionRadiusFactor : 1;
        const chargeScale = this.getVortexScaleForRadius(0.72 * radiusVisualFactor);
        this.vortexChargeScale.set(chargeScale);
        this.vortexCastScale.set(this.getVortexScaleForRadius(radiusVisualFactor));

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
    private static readonly MERGED_TRAIL_TICK_INTERVAL = 1;
    private static readonly MAX_TRAIL_MERGE_COUNT = 2;
    private static readonly MAX_MERGED_RADIUS_X = 72;
    private static readonly MAX_MERGED_RADIUS_Y = 34;
    private static readonly MAX_ACTIVE_TRAILS = 12;
    private static readonly NORMAL_TRAIL_COLOR = new Color(72, 182, 255);
    private static readonly MERGED_TRAIL_COLOR = new Color(42, 148, 228);

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
    private attackDamageMultiplier = 1;
    private trailMergeRadius = 0;
    private mergedTrailTickDamage = 0;
    private mergedTrailSlowMultiplier = 0.4;
    private dashChainRemaining = 0;
    private lastDashTargetEnemy: Enemy | null = null;

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
    private readonly tempScale = new Vec3(1, 1, 1);
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
        this.attackDamageMultiplier = 1;
        this.trailMergeRadius = 0;
        this.mergedTrailTickDamage = 0;
        this.applyTransformBonuses();
    }

    private applyTransformBonuses(): void {
        if (!this.isTransformed) {
            return;
        }

        this.attackInterval = Math.max(1.2, this.attackInterval * 0.88);
        this.attackDamageMultiplier = 1.18;
        this.dashMoveSpeed = Math.round(this.dashMoveSpeed * 1.12);
        this.trailDuration += 0.45;
        this.trailWidth = Math.round(this.trailWidth * 1.18);
        this.trailLength = this.trailWidth * 1.72;
        this.trailSpawnInterval = Math.max(14, this.trailSpawnInterval * 0.82);
        this.trailSlowMultiplier = Math.max(0.38, this.trailSlowMultiplier * 0.72);
        this.trailMergeRadius = this.trailWidth * 0.42;
        this.mergedTrailTickDamage = Math.max(4, Math.round(this.attackDamage * 0.14));
        this.mergedTrailSlowMultiplier = 0.4;
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

        this.syncTransformedGhostVisual();
        this.followOwner(dt);
    }

    public onUnequip(owner: Node): void {
        this.clearGhost();
    }

    public getDescription(): string {
        const transformedText = this.isTransformed
            ? '终阶「湿地领域」：连续双段突进，水渍自动连片成湿地并持续撕扯减速。'
            : '满级后进化为湿地领域，水渍连片并追加双段突进。';
        const overloadText = this.isTransformed
            ? `湿地移速降至 ${Math.round(this.mergedTrailSlowMultiplier * 100)}%，每秒 ${this.mergedTrailTickDamage} 点撕扯伤害。`
            : '';
        return `每 ${this.attackInterval.toFixed(1)}s 突进最近敌人，碰撞造成 ${Math.round(this.attackDamage * this.attackDamageMultiplier)} 伤害，并留下蓝色水渍减速敌人。${overloadText}${transformedText}`;
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
        this.syncTransformedGhostVisual();
        this.playGhostAnimation(MopGhostSkill.IDLE_CLIP_NAME);
    }

    private syncTransformedGhostVisual(): void {
        if (!this.ghostVisual) {
            return;
        }

        const scaleBoost = this.isTransformed ? 1.12 : 1;
        this.tempScale.set(
            this.ghostBaseScale.x * scaleBoost,
            this.ghostBaseScale.y * scaleBoost,
            this.ghostBaseScale.z
        );
        this.ghostVisual.setScale(this.tempScale);
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

    private beginAttack(excludeEnemy?: Enemy | null): boolean {
        const nearestEnemy = this.findNearestEnemy(this.ghostPosition, excludeEnemy ?? null);
        if (!nearestEnemy) {
            return false;
        }

        if (!excludeEnemy) {
            this.lastDashTargetEnemy = nearestEnemy;
            this.dashChainRemaining = this.isTransformed ? 1 : 0;
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
        if (this.isTransformed && this.dashChainRemaining > 0) {
            this.dashChainRemaining--;
            if (this.beginAttack(this.lastDashTargetEnemy)) {
                return;
            }
        }

        this.isAttacking = false;
        this.distanceSinceTrailSpawn = 0;
        this.hitEnemiesThisDash.clear();
        this.lastDashTargetEnemy = null;
        this.dashChainRemaining = 0;
        this.playGhostAnimation(MopGhostSkill.IDLE_CLIP_NAME);
        this.pickStandbyOffset();
    }

    private findNearestEnemy(origin: Vec3, excludeEnemy: Enemy | null = null): Enemy | null {
        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot) {
            return null;
        }

        let nearestEnemy: Enemy | null = null;
        let nearestDistanceSq = Number.POSITIVE_INFINITY;
        for (const enemyNode of enemyRoot.children) {
            const enemy = enemyNode.getComponent(Enemy);
            if (!enemy || enemy.isDead || enemy.isDyingState || enemy === excludeEnemy) {
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

            enemy.takeDamage(Math.round(this.attackDamage * this.attackDamageMultiplier), this.ownerNode);
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
            trail.tickElapsed += dt;

            if (enemyRoot) {
                const radiusXSq = trail.radiusX * trail.radiusX;
                const radiusYSq = trail.radiusY * trail.radiusY;
                const slowMultiplier = trail.isMergedZone
                    ? trail.zoneSlowMultiplier
                    : this.trailSlowMultiplier;
                for (const enemyNode of enemyRoot.children) {
                    const enemy = enemyNode.getComponent(Enemy);
                    if (!enemy || enemy.isDead || enemy.isDyingState) {
                        continue;
                    }

                    const dx = enemyNode.worldPosition.x - trail.worldPosition.x;
                    const dy = enemyNode.worldPosition.y - trail.worldPosition.y;
                    const ellipseFactor = (dx * dx) / Math.max(1, radiusXSq) + (dy * dy) / Math.max(1, radiusYSq);
                    if (ellipseFactor <= 1) {
                        const bossSlow = trail.isMergedZone
                            ? Math.max(0.48, slowMultiplier + 0.12)
                            : Math.max(0.58, slowMultiplier + 0.18);
                        enemy.applyMovementDebuff(this.trailSlowDuration, enemy.isBoss ? bossSlow : slowMultiplier);
                    }
                }
            }

            if (trail.isMergedZone && trail.tickDamage > 0) {
                while (trail.tickElapsed >= MopGhostSkill.MERGED_TRAIL_TICK_INTERVAL) {
                    trail.tickElapsed -= MopGhostSkill.MERGED_TRAIL_TICK_INTERVAL;
                    this.tickMergedTrailDamage(trail);
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

        if (this.isTransformed && this.trailStates.length >= MopGhostSkill.MAX_ACTIVE_TRAILS) {
            const oldest = this.trailStates.shift();
            oldest?.node.destroy();
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
            isMergedZone: false,
            tickDamage: 0,
            tickElapsed: 0,
            zoneSlowMultiplier: this.trailSlowMultiplier,
            mergeCount: 0,
        };

        if (this.isTransformed && this.trailMergeRadius > 0) {
            for (const existing of this.trailStates) {
                if (existing.mergeCount >= MopGhostSkill.MAX_TRAIL_MERGE_COUNT) {
                    continue;
                }

                const dx = existing.worldPosition.x - worldPosition.x;
                const dy = existing.worldPosition.y - worldPosition.y;
                const centerDistance = Math.sqrt(dx * dx + dy * dy);
                const overlapDistance = Math.min(existing.radiusX, trail.radiusX) * 0.48
                    + Math.min(existing.radiusY, trail.radiusY) * 0.32;
                if (centerDistance <= overlapDistance) {
                    this.mergeTrails(existing, trail);
                    return;
                }
            }
        }

        this.redrawTrail(trail, 1);
        this.trailStates.push(trail);
    }

    private mergeTrails(existing: MopTrailState, incoming: MopTrailState): void {
        const spanX = Math.abs(existing.worldPosition.x - incoming.worldPosition.x) * 0.5;
        const spanY = Math.abs(existing.worldPosition.y - incoming.worldPosition.y) * 0.5;
        existing.worldPosition.set(
            (existing.worldPosition.x + incoming.worldPosition.x) * 0.5,
            (existing.worldPosition.y + incoming.worldPosition.y) * 0.5,
            existing.worldPosition.z
        );
        existing.radiusX = Math.min(
            MopGhostSkill.MAX_MERGED_RADIUS_X,
            Math.max(existing.radiusX, incoming.radiusX) + spanX * 0.18 + this.trailWidth * 0.06
        );
        existing.radiusY = Math.min(
            MopGhostSkill.MAX_MERGED_RADIUS_Y,
            Math.max(existing.radiusY, incoming.radiusY) + spanY * 0.14 + this.trailWidth * 0.04
        );

        const existingRemaining = existing.duration - existing.elapsed;
        const incomingRemaining = incoming.duration - incoming.elapsed;
        existing.duration = existing.elapsed + Math.max(existingRemaining, incomingRemaining) + 0.25;
        existing.isMergedZone = true;
        existing.mergeCount += 1;
        existing.tickDamage = this.mergedTrailTickDamage;
        existing.zoneSlowMultiplier = this.mergedTrailSlowMultiplier;

        if (this.summonParent) {
            Vec3.subtract(this.tempLocalPosition, existing.worldPosition, this.summonParent.worldPosition);
            existing.node.setPosition(this.tempLocalPosition);
        }

        incoming.node.destroy();
        this.redrawTrail(existing, 1 - existing.elapsed / Math.max(0.001, existing.duration));
    }

    private tickMergedTrailDamage(trail: MopTrailState): void {
        if (!this.ownerNode || isSkillDamageDisabledForTesting(MopGhostSkill.CONFIG.id)) {
            return;
        }

        const enemyRoot = BulletHell.inst?.objects;
        if (!enemyRoot || trail.tickDamage <= 0) {
            return;
        }

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
                const damage = enemy.isBoss ? Math.max(1, Math.round(trail.tickDamage * 0.55)) : trail.tickDamage;
                enemy.takeDamage(damage, this.ownerNode);
            }
        }
    }

    private redrawTrail(trail: MopTrailState, opacityFactor: number): void {
        const baseColor = trail.isMergedZone ? MopGhostSkill.MERGED_TRAIL_COLOR : MopGhostSkill.NORMAL_TRAIL_COLOR;
        const alphaCap = trail.isMergedZone ? 118 : 150;
        const alphaBase = trail.isMergedZone ? 92 : 132;
        const alpha = Math.max(24, Math.min(alphaCap, Math.round(alphaBase * opacityFactor)));
        trail.graphics.clear();
        trail.graphics.fillColor = new Color(baseColor.r, baseColor.g, baseColor.b, alpha);
        trail.graphics.roundRect(-trail.radiusX, -trail.radiusY, trail.radiusX * 2, trail.radiusY * 2, trail.radiusY * 0.8);
        trail.graphics.fill();

        if (trail.isMergedZone) {
            trail.graphics.strokeColor = new Color(168, 228, 255, Math.min(150, alpha + 28));
            trail.graphics.lineWidth = 2;
            trail.graphics.roundRect(-trail.radiusX, -trail.radiusY, trail.radiusX * 2, trail.radiusY * 2, trail.radiusY * 0.8);
            trail.graphics.stroke();
        }
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
        this.lastDashTargetEnemy = null;
        this.dashChainRemaining = 0;
        this.ghostPosition.set(Vec3.ZERO);
    }
}
