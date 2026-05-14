/**
 * SkillBase.ts
 *
 * 定义技能系统的抽象基类，负责管理公共状态（等级、转变等）以及简单生命周期。
 */

import { SkillConfig, ISkill, SkillLevelState } from './SkillTypes';

export abstract class SkillBase implements ISkill {
    constructor(public readonly config: SkillConfig, initialLevel: number = 1) {
        this.level = Math.min(Math.max(initialLevel, 1), config.maxLevel);
    }

    public level: number;

    public get id(): string {
        return this.config.id;
    }

    public get isTransformed(): boolean {
        const transformLevel = this.config.transformLevel ?? this.config.maxLevel;
        return this.level >= transformLevel;
    }

    public canLevelUp(): boolean {
        return this.level < this.config.maxLevel;
    }

    public levelUp(): void {
        if (!this.canLevelUp()) return;
        this.level = Math.min(this.config.maxLevel, this.level + 1);
    }

    public getLevelState(): SkillLevelState {
        return {
            level: this.level,
            maxLevel: this.config.maxLevel,
            isTransformed: this.isTransformed,
        };
    }

    public getDescription(): string {
        // 默认描述包含等级信息，子类可覆盖
        const levelSuffix = this.level > 1 ? ` (Lv.${this.level})` : '';
        return `${this.config.description}${levelSuffix}`;
    }

    /**
     * 内部实现节流 -- 子类可以 override
     */
    public update?(dt: number): void;
}
