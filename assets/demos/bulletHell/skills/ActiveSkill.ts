/**
 * ActiveSkill.ts
 *
 * 主动技能基类：可触发并产生即时效果（伤害、位移、AOE 等）。
 */

import { Vec3, Node } from 'cc';
import { SkillBase } from './SkillBase';
import { SkillContext } from './SkillTypes';

export abstract class ActiveSkill extends SkillBase {
    /** 冷却时间（秒），0 表示即时可用 */
    public cooldown: number = 0;
    public currentCooldown: number = 0;

    /** 是否可用（冷却完毕） */
    public isReady(): boolean {
        return this.currentCooldown <= 0;
    }

    /**
     * 主动触发技能。
     * @param context 技能执行上下文
     */
    public use(context: SkillContext): void {
        if (!this.isReady()) {
            return;
        }

        this.onUse(context);

        if (this.cooldown > 0) {
            this.currentCooldown = this.cooldown;
        }
    }

    /**
     * 真正执行的逻辑，由子类实现
     */
    protected abstract onUse(context: SkillContext): void;

    /**
     * 需要在每帧或定时器中调用，以扣减冷却时间等
     */
    public update(dt: number): void {
        if (this.currentCooldown > 0) {
            this.currentCooldown = Math.max(0, this.currentCooldown - dt);
        }
    }
}
