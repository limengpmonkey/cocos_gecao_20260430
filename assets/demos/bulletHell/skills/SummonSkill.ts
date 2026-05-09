/**
 * SummonSkill.ts
 *
 * 召唤技能基类：在指定位置召唤实体（例如机器人、守卫、幽灵）。
 */

import { Node } from 'cc';
import { SkillBase } from './SkillBase';
import { SkillContext } from './SkillTypes';

export abstract class SummonSkill extends SkillBase {
    /**
     * 召唤实体的预制体（可选，由具体实现提供）
     */
    public summonPrefab?: any;

    /**
     * 执行召唤。
     */
    public summon(context: SkillContext): void {
        this.onSummon(context);
    }

    /**
     * 卸下召唤技能时调用，子类可回收已召唤实体。
     */
    public onUnequip(owner: Node): void {
        // 子类可覆盖
    }

    protected abstract onSummon(context: SkillContext): void;
}
