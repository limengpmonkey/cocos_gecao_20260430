/**
 * PassiveSkill.ts
 *
 * 被动技能基类：在装备后持续生效，可响应事件（例如击杀、被击、计时器等）。
 */

import { Node } from 'cc';
import { SkillBase } from './SkillBase';
import { SkillContext } from './SkillTypes';

export abstract class PassiveSkill extends SkillBase {
    /**
     * 装备技能时调用（可以在此处注册事件、初始化状态）
     */
    public onEquip(owner: Node): void {
        // 子类可覆盖
    }

    /**
     * 卸下技能时调用（清理注册的事件、状态等）
     */
    public onUnequip(owner: Node): void {
        // 子类可覆盖
    }

    /**
     * 主动触发（例如每帧调用）
     */
    public onUpdate?(dt: number, owner: Node): void;

    /**
     * 可选：当击杀敌人时调用
     */
    public onEnemyKilled?(enemyNode: Node, owner: Node): void;

    /**
     * 可选：当受到伤害时调用
     */
    public onOwnerDamaged?(damage: number, owner: Node): void;

    /**
     * 可选：当拾取道具时调用
     */
    public onItemCollected?(itemNode: Node, owner: Node): void;
}
