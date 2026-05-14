import { _decorator, instantiate, Prefab, Quat, Vec3, CCInteger, PhysicsSystem } from 'cc';
import { cBody } from '../../collision/Body';
import { cObject, Trigger } from '../../collision/Object';
const { ccclass, property } = _decorator;

const tempPos = new Vec3();
const tempRot = new Quat();
const resetScale = new Vec3(1, 1, 1);
const resetRotation = new Quat();
Quat.identity(resetRotation);

@ccclass('Skill')
export class Skill extends cObject {

    private sourcePrefab: Prefab | null = null;

    @property({ type: CCInteger, tooltip: '技能伤害' })
    damage: number = 10;

    /** 可以穿透的目标次数（>=1） */
    @property({ type: CCInteger, tooltip: '可穿透目标数量（>=1）' })
    penetration: number = 1;

    /** 已命中次数 */
    hitCount: number = 0;

    /** 命中后的击退力（用于造成位移） */
    @property({ type: CCInteger, tooltip: '命中后施加的击退力量' })
    knockback: number = 0;

    /** 
     * 【标记】禁用自动旋转（某些技能如高压水枪需要精确控制旋转）
     */
    disableAutoRotation: boolean = false;

    // 缓存池管理：按 prefab 分池，避免不同技能视觉节点互相污染
    static pools: WeakMap<Prefab, Array<Skill>> = new WeakMap();
    static get(prefab: Prefab) {
        if (!prefab) {
            console.warn('[Skill] get 失败：prefab 为空');
            return null;
        }

        let pool = this.pools.get(prefab);
        if (!pool) {
            pool = [];
            this.pools.set(prefab, pool);
        }

        let skill = pool.pop();
        if (!skill) {
            let node = instantiate(prefab);
            skill = node.getComponent(Skill);
            if (!skill) {
                const beamComponent = node.getComponent('SkillBeam');
                if (beamComponent) {
                    beamComponent.destroy();
                }

                // 允许 prefab 不预挂 Skill 组件，运行时自动补挂，降低资源制作约束
                skill = node.addComponent(Skill);
                console.warn(`[Skill] 预制体 ${prefab.name} 未挂 Skill 组件，已运行时自动补挂`);
            }
        }

        skill.sourcePrefab = prefab;
        // 重置状态，避免复用时保留历史命中次数
        skill.resetForReuse();
        return skill;
    }

    static put(skill: Skill) {
        const prefab = skill.sourcePrefab;
        if (!prefab) {
            console.warn('[Skill] put 失败：缺少 sourcePrefab，直接移除节点');
            skill.remove(false);
            return;
        }

        let pool = this.pools.get(prefab);
        if (!pool) {
            pool = [];
            this.pools.set(prefab, pool);
        }

        //压入缓存池管理节点
        pool.push(skill);
        //移除node不回收body
        skill.remove(false);
    }

    /** 重置相关状态，供对象池复用 */
    resetForReuse() {
        this.hitCount = 0;
        // 默认穿透次数为 1（即命中后销毁）。可在技能创建时覆盖。
        this.penetration = 1;
        this.knockback = 0;
        this.disableAutoRotation = false;
        this.angle = 0;

        // 确保碰撞分组与子弹一致（用于敌人判定）
        this.group = PhysicsSystem.PhysicsGroup['bullet'];

        // 使得对象可触发碰撞（需要在 PhysicsSystem 中开启相应碰撞矩阵）
        this.trigger = true;

        // 【修复】重置视觉状态，避免被高压水枪的 setRotation/setScale 污染
        this.node.setScale(resetScale);
        this.node.setRotation(resetRotation);
    }

    //生命周期，回收时间
    lifeTime: number = 0;
    //attack: number = 0;

    angle:number = 0;


    update(dt: number) {
        this.lifeTime -= dt;
        if (this.lifeTime < 0) {
            //生命周期回收
            Skill.put(this);
            return;
        }

        //计算新位置
        let pos = this.getPosition();
        let velocity = this.velocity;

        tempPos.x = pos.x + velocity.x * dt;
        tempPos.y = pos.y + velocity.y * dt;
        tempPos.z = pos.z + velocity.z * dt;

        // 【修复】仅在未禁用自动旋转时才进行旋转（高压水枪需要禁用此项以使用自己的旋转逻辑）
        if (!this.disableAutoRotation) {
            this.angle += dt * 60 * 60;
            Quat.fromEuler(tempRot, 0, 0, this.angle);
            this.setRotation(tempRot);//更新节点旋转
        }

        this.setPosition(tempPos);
    }

    onTrigger(b: cBody, trigger: Trigger) {
        if (trigger === Trigger.exit) return;

        // 如果与敌人/玩家发生碰撞则处理命中逻辑
        if (b.group === PhysicsSystem.PhysicsGroup['enemy'] || b.group === PhysicsSystem.PhysicsGroup['player']) {
            this.hitCount++;

            // 触发击退（需要目标实现 applyKnockback）
            if (this.knockback > 0 && b.object?.node) {
                const targetNode = b.object.node;
                const dir = new Vec3();
                Vec3.subtract(dir, targetNode.worldPosition, this.node.worldPosition);
                dir.normalize();

                const enemyComp = targetNode.getComponent('Enemy') as any;
                if (enemyComp && typeof enemyComp.applyKnockback === 'function') {
                    enemyComp.applyKnockback(dir, this.knockback);
                }
            }

            // 穿透次数用完则回收投射物
            if (this.hitCount >= this.penetration) {
                Skill.put(this);
            }
        }

        // 这里也可以添加爆炸特效、音效等
    }
}

