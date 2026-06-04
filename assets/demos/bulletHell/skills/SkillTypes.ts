/**
 * SkillTypes.ts
 *
 * 定义技能系统的基础类型、枚举、以及通用数据结构。
 */

export type SkillCategory = 'active' | 'passive' | 'summon' | 'boost';

/** 技能槽类型（用于区分可装备位置） */
export enum SkillSlotType {
    Active = 'active',
    Passive = 'passive',
    Summon = 'summon',
}

/** 一般用于技能升级、变质的状态数据 */
export interface SkillLevelState {
    level: number;
    maxLevel: number;
    /** 升级后是否达成质变（例如 Lv.10 解锁） */
    isTransformed: boolean;
}

/** 技能基础配置 */
export interface SkillConfig {
    /** 唯一 ID，建议用蛇形命名 */
    id: string;
    /** 技能名 */
    name: string;
    /** 技能描述（可用于 UI 展示） */
    description: string;
    /** 可选图标 key */
    icon?: string;
    /** 技能类型 */
    category: SkillCategory;
    /** 当前可装备的槽类型 */
    slotType: SkillSlotType;
    /** 最大等级 */
    maxLevel: number;
    /** 升级路径（为了便于扩展在配置中存挑战值） */
    transformLevel?: number; // 质变等级
}

export type SkillPrefabResolveSource =
    | 'skill-level'
    | 'skill-default'
    | 'global-default'
    | 'none';

export interface SkillVisualPayload {
    /** 用于该次技能释放的投射/特效预制体 */
    projectilePrefab: import('cc').Prefab | null;
    /** 用于该次技能释放的范围/冲击特效预制体 */
    impactPrefab?: import('cc').Prefab | null;
    /** 记录配置命中来源，便于排查配置问题 */
    source: SkillPrefabResolveSource;
    /** 当前释放技能 id */
    skillId: string;
    /** 当前释放技能等级 */
    skillLevel: number;
}

export interface SkillPayload {
    /** 视觉资源配置 */
    visual?: SkillVisualPayload;
    [key: string]: unknown;
}

/** 技能执行上下文，能够携带足够的信息给技能执行时使用 */
export interface SkillContext {
    /** 触发技能的节点（通常是玩家节点） */
    ownerNode: import('cc').Node;
    /** 触发时的目标点（例如投射方向、落点） */
    targetPosition?: import('cc').Vec3;
    /** 触发技能时的额外数据 */
    payload?: SkillPayload;
}

/** 通用技能接口 */
export interface ISkill {
    readonly id: string;
    readonly config: SkillConfig;
    level: number;
    readonly isTransformed: boolean;

    /** 升级（如果已满级则不再升级） */
    levelUp(): void;

    /** 是否可升级 */
    canLevelUp(): boolean;

    /** 获取当前技能描述（包含强化后） */
    getDescription(): string;
}
