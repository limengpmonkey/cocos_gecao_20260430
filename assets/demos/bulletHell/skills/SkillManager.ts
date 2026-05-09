/**
 * SkillManager.ts
 *
 * 管理玩家的技能槽，并负责技能的触发、升级、卸载等生命周期。
 *
 * 体系说明：
 * - 主动技能：4 个槽位。可以通过 useActiveSkill 调用。
 * - 被动技能：2 个槽位。自动生效，可响应事件。
 * - 召唤技能：多个槽位（默认 2 个）。支持并存。
 *
 * 此模块仅为逻辑框架。具体的技能行为由 SkillDefinitions 中的类实现。
 */

import { _decorator, Component, Node, Prefab, Vec3 } from 'cc';
import { ActiveSkill } from './ActiveSkill';
import { PassiveSkill } from './PassiveSkill';
import { SummonSkill } from './SummonSkill';
import { SkillContext, SkillSlotType, SkillPrefabResolveSource } from './SkillTypes';
import { SkillLibrary } from './SkillLibrary';

const { ccclass, property } = _decorator;

@ccclass('SkillLevelPrefabBinding')
class SkillLevelPrefabBinding {
    @property({ type: Number, tooltip: '技能等级（>=1）' })
    level: number = 1;

    @property({ type: Prefab, tooltip: '该等级使用的 Prefab' })
    prefab: Prefab = null;
}

@ccclass('SkillVisualBinding')
class SkillVisualBinding {
    @property({ tooltip: '技能 ID（例如：high_pressure_water_gun）' })
    skillId: string = '';

    @property({ type: Prefab, tooltip: '该技能的默认 Prefab（当未命中分级配置时使用）' })
    defaultPrefab: Prefab = null;

    @property({
        type: [SkillLevelPrefabBinding],
        tooltip: '按等级配置 Prefab。优先精确等级，其次使用不超过当前等级的最高配置。'
    })
    levelPrefabs: Array<SkillLevelPrefabBinding> = [];
}

export type ActiveSkillSlotIndex = 0 | 1 | 2 | 3;
export type PassiveSkillSlotIndex = 0 | 1;

@ccclass('SkillManager')
export class SkillManager extends Component {
    /** 4 个主动技能槽 */
    public activeSlots: Array<ActiveSkill | null> = [null, null, null, null];

    /** 技能特效 Prefab（供 SkillDefinitions 中使用） */
    @property({ type: Prefab, tooltip: '用于技能投射/效果的通用 Prefab（例如 Skill 预制体）' })
    public skillPrefab: Prefab = null;

    /**
     * 技能视觉配置（推荐使用）：支持按技能+等级配置 prefab，并提供技能级默认 prefab。
     */
    @property({
        type: [SkillVisualBinding],
        tooltip: '推荐配置：可按技能和等级区分 prefab；未命中等级时回退到技能默认 prefab。'
    })
    public skillVisualBindings: Array<SkillVisualBinding> = [];

    /** 2 个被动技能槽 */
    public passiveSlots: Array<PassiveSkill | null> = [null, null];

    /** 多个召唤技能槽（预留多召唤共存能力） */
    public summonSlots: Array<SummonSkill | null> = [null, null];

    /** 兼容旧代码：等价于 summonSlots[0] */
    public get summonSlot(): SummonSkill | null {
        return this.summonSlots[0] ?? null;
    }

    public set summonSlot(value: SummonSkill | null) {
        this.summonSlots[0] = value;
    }

    /** 记录玩家最近一次攻击伤害加成（由被动技能触发） */
    public nextAttackDamageBonus: number = 0;

    private normalizeSkillId(id: string): string {
        return (id || '').trim().toLowerCase();
    }

    onLoad(): void {
        // 允许通过组件编辑器给槽位赋默认技能
        this.validateSkillVisualBindings();
    }

    update(dt: number): void {
        // 处理“主动技能”作为大被动自动触发（周期/冷却）
        for (let slotIndex = 0; slotIndex < this.activeSlots.length; slotIndex++) {
            const skill = this.activeSlots[slotIndex];
            if (!skill) continue;

            // 更新冷却
            skill.update?.(dt);

            // 只要冷却结束，自动触发一次（变为周期性发动）
            if (skill.isReady()) {
                this.useActiveSkill(slotIndex as ActiveSkillSlotIndex);
            }
        }

        // 小被动技能持续生效
        for (const passive of this.passiveSlots) {
            passive?.onUpdate?.(dt, this.node);
        }

        // 召唤技能持续更新
        for (const summon of this.summonSlots) {
            summon?.update?.(dt);
        }
    }

    /**
     * 装备技能到槽位（可用于技能选择 UI）
     */
    public equipSkill(skillId: string, level: number = 1, slotType: SkillSlotType = SkillSlotType.Active, slotIndex: number = 0): boolean {
        const skill = SkillLibrary.create(skillId, level);
        if (!skill) {
            return false;
        }

        switch (slotType) {
            case SkillSlotType.Active:
                if (slotIndex < 0 || slotIndex >= this.activeSlots.length) return false;
                this.activeSlots[slotIndex] = skill as ActiveSkill;
                return true;
            case SkillSlotType.Passive:
                if (slotIndex < 0 || slotIndex >= this.passiveSlots.length) return false;
                // 卸载旧技能
                const oldPassive = this.passiveSlots[slotIndex];
                oldPassive?.onUnequip(this.node);
                this.passiveSlots[slotIndex] = skill as PassiveSkill;
                (skill as PassiveSkill).onEquip(this.node);
                return true;
            case SkillSlotType.Summon:
                if (slotIndex < 0 || slotIndex >= this.summonSlots.length) return false;
                this.summonSlots[slotIndex]?.onUnequip(this.node);
                this.summonSlots[slotIndex] = skill as SummonSkill;
                this.useSummonSkill(slotIndex, this.node.worldPosition);
                return true;
            default:
                return false;
        }
    }

    /**
     * 卸下指定槽位技能
     */
    public unequipSkill(slotType: SkillSlotType, slotIndex: number = 0): void {
        switch (slotType) {
            case SkillSlotType.Active:
                if (slotIndex < 0 || slotIndex >= this.activeSlots.length) return;
                this.activeSlots[slotIndex] = null;
                break;
            case SkillSlotType.Passive:
                if (slotIndex < 0 || slotIndex >= this.passiveSlots.length) return;
                const passive = this.passiveSlots[slotIndex];
                passive?.onUnequip(this.node);
                this.passiveSlots[slotIndex] = null;
                break;
            case SkillSlotType.Summon:
                if (slotIndex < 0 || slotIndex >= this.summonSlots.length) return;
                this.summonSlots[slotIndex]?.onUnequip(this.node);
                this.summonSlots[slotIndex] = null;
                break;
        }
    }

    /**
     * 使用主动技能（例如玩家按下技能按钮）
     */
    public useActiveSkill(slotIndex: ActiveSkillSlotIndex, targetPosition?: Vec3): void {
        const skill = this.activeSlots[slotIndex];
        if (!skill) {
            console.warn(`[SkillManager] 主动技能槽 ${slotIndex} 为空`);
            return;
        }

        const resolvedVisual = this.resolveSkillVisual(skill.id, skill.level);
        const prefabToUse = resolvedVisual.prefab;

        if (!prefabToUse) {
            console.warn(`[SkillManager] 技能 ${skill.id} 未配置 prefab，无法生成投射物`);
        }

        // 在控制台输出解析来源，便于技能配置核对
        console.log(`[SkillManager] 技能 ${skill.id}(Lv${skill.level}) 使用 prefab: ${prefabToUse?.name || 'null'} (source=${resolvedVisual.source})`);

        const context: SkillContext = {
            ownerNode: this.node,
            targetPosition,
            payload: {
                visual: {
                    projectilePrefab: prefabToUse,
                    source: resolvedVisual.source,
                    skillId: skill.id,
                    skillLevel: skill.level,
                },
            },
        };

        skill.use(context);
    }

    private getSkillVisualBinding(skillId: string): SkillVisualBinding | null {
        const normalizedSkillId = this.normalizeSkillId(skillId);
        for (const binding of this.skillVisualBindings) {
            if (this.normalizeSkillId(binding.skillId) === normalizedSkillId) {
                return binding;
            }
        }
        return null;
    }

    private getLevelPrefab(binding: SkillVisualBinding | null, level: number): Prefab | null {
        if (!binding || !binding.levelPrefabs?.length) {
            return null;
        }

        const normalizedLevel = Math.max(1, Math.floor(level));

        // 优先命中精确等级
        for (const entry of binding.levelPrefabs) {
            if (!entry?.prefab) continue;
            if (Math.floor(entry.level) === normalizedLevel) {
                return entry.prefab;
            }
        }

        // 未精确命中时，回退到 <= 当前等级的最高配置
        let bestLevel = -1;
        let bestPrefab: Prefab | null = null;
        for (const entry of binding.levelPrefabs) {
            if (!entry?.prefab) continue;
            const entryLevel = Math.max(1, Math.floor(entry.level));
            if (entryLevel <= normalizedLevel && entryLevel > bestLevel) {
                bestLevel = entryLevel;
                bestPrefab = entry.prefab;
            }
        }

        return bestPrefab;
    }

    private resolveSkillVisual(skillId: string, level: number): { prefab: Prefab | null; source: SkillPrefabResolveSource } {
        const visualBinding = this.getSkillVisualBinding(skillId);
        const levelPrefab = this.getLevelPrefab(visualBinding, level);
        if (levelPrefab) {
            return { prefab: levelPrefab, source: 'skill-level' };
        }

        if (visualBinding?.defaultPrefab) {
            return { prefab: visualBinding.defaultPrefab, source: 'skill-default' };
        }

        if (this.skillPrefab) {
            return { prefab: this.skillPrefab, source: 'global-default' };
        }

        return { prefab: null, source: 'none' };
    }

    private validateSkillVisualBindings(): void {
        const seenSkillIds = new Set<string>();

        for (const binding of this.skillVisualBindings) {
            const normalizedSkillId = this.normalizeSkillId(binding?.skillId);
            if (!normalizedSkillId) {
                console.warn('[SkillManager] skillVisualBindings 存在空 skillId，请补全。');
                continue;
            }

            if (seenSkillIds.has(normalizedSkillId)) {
                console.warn(`[SkillManager] skillVisualBindings 中 skillId 重复: ${binding.skillId}`);
            }
            seenSkillIds.add(normalizedSkillId);

            const levelSeen = new Set<number>();
            for (const levelEntry of binding.levelPrefabs || []) {
                const level = Math.max(1, Math.floor(levelEntry?.level ?? 1));
                if (levelSeen.has(level)) {
                    console.warn(`[SkillManager] 技能 ${binding.skillId} 的 levelPrefabs 存在重复等级: Lv${level}`);
                }
                levelSeen.add(level);

                if (!levelEntry?.prefab) {
                    console.warn(`[SkillManager] 技能 ${binding.skillId} 的 Lv${level} prefab 为空，将被忽略`);
                }
            }

            if (!binding.defaultPrefab && (!binding.levelPrefabs || binding.levelPrefabs.length === 0)) {
                console.warn(`[SkillManager] 技能 ${binding.skillId} 未配置 defaultPrefab 且无 levelPrefabs，等同未配置。`);
            }
        }

        if (!this.skillPrefab && this.skillVisualBindings.length === 0) {
            console.warn('[SkillManager] 未配置任何技能 prefab 来源（skillVisualBindings / skillPrefab）。');
        }
    }

    /**
     * 释放召唤技能
     */
    public useSummonSkill(slotIndex: number = 0, targetPosition?: Vec3): void {
        if (slotIndex < 0 || slotIndex >= this.summonSlots.length) {
            console.warn(`[SkillManager] 召唤技能槽 ${slotIndex} 越界`);
            return;
        }

        const summonSkill = this.summonSlots[slotIndex];
        if (!summonSkill) {
            console.warn(`[SkillManager] 召唤技能槽 ${slotIndex} 为空`);
            return;
        }

        const resolvedVisual = this.resolveSkillVisual(summonSkill.id, summonSkill.level);

        summonSkill.summon({
            ownerNode: this.node,
            targetPosition,
            payload: {
                visual: {
                    projectilePrefab: resolvedVisual.prefab,
                    source: resolvedVisual.source,
                    skillId: summonSkill.id,
                    skillLevel: summonSkill.level,
                },
            },
        });
    }

    /**
     * 手动触发所有召唤技能（例如测试用）
     */
    public useAllSummonSkills(targetPosition?: Vec3): void {
        for (let i = 0; i < this.summonSlots.length; i++) {
            if (this.summonSlots[i]) {
                this.useSummonSkill(i, targetPosition);
            }
        }
    }

    /**
     * 通知被动技能：敌人被击杀
     */
    public notifyEnemyKilled(enemyNode: Node): void {
        for (const passive of this.passiveSlots) {
            passive?.onEnemyKilled?.(enemyNode, this.node);
        }
    }

    /**
     * 通知被动技能：玩家受到伤害
     */
    public notifyOwnerDamaged(damage: number): void {
        for (const passive of this.passiveSlots) {
            passive?.onOwnerDamaged?.(damage, this.node);
        }
    }

    /**
     * 通知被动/增益技能：玩家拾取道具
     */
    public notifyItemCollected(itemNode: Node): void {
        for (const passive of this.passiveSlots) {
            passive?.onItemCollected?.(itemNode, this.node);
        }
    }

    /**
     * 合成技能示例：将两个主动技能融合生成新技能（可扩展为更复杂的融合逻辑）
     */
    public fuseActiveSkills(slotA: ActiveSkillSlotIndex, slotB: ActiveSkillSlotIndex): ActiveSkill | null {
        const a = this.activeSlots[slotA];
        const b = this.activeSlots[slotB];
        if (!a || !b) return null;

        // 示例：如果两个技能来自同一个类型，则等级 +1；否则直接生成一个基础技能
        if (a.id === b.id) {
            const fused = SkillLibrary.create(a.id, Math.min(a.config.maxLevel, a.level + 1)) as ActiveSkill;
            console.log(`[SkillManager] 融合技能：${a.id} + ${b.id} => ${fused.id} (Lv${fused.level})`);
            return fused;
        }

        // 更多融合规则可以在此扩展
        console.log('[SkillManager] 当前不支持该组合的融合技能，返回第一个技能的副本');
        return SkillLibrary.create(a.id, a.level) as ActiveSkill;
    }
}
