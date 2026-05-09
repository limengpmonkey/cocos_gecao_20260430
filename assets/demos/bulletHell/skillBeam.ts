import { _decorator, instantiate, Prefab, Quat, Vec3, CCInteger, PhysicsSystem } from 'cc';
import { cBody } from '../../collision/Body';
import { cObject, Trigger } from '../../collision/Object';

const { ccclass, property } = _decorator;

const resetScale = new Vec3(1, 1, 1);
const resetRotation = new Quat();
Quat.identity(resetRotation);

@ccclass('SkillBeam')
export class SkillBeam extends cObject {
    private sourcePrefab: Prefab | null = null;

    @property({ type: CCInteger, tooltip: '技能伤害' })
    damage: number = 10;

    @property({ type: CCInteger, tooltip: '可穿透目标数量（>=1）' })
    penetration: number = 9999;

    @property({ type: CCInteger, tooltip: '命中后施加的击退力量' })
    knockback: number = 0;

    hitCount: number = 0;
    lifeTime: number = 0;

    static pools: WeakMap<Prefab, Array<SkillBeam>> = new WeakMap();

    static get(prefab: Prefab) {
        if (!prefab) {
            console.warn('[SkillBeam] get 失败：prefab 为空');
            return null;
        }

        let pool = this.pools.get(prefab);
        if (!pool) {
            pool = [];
            this.pools.set(prefab, pool);
        }

        let beam = pool.pop();
        if (!beam) {
            const node = instantiate(prefab);
            beam = node.getComponent(SkillBeam);
            if (!beam) {
                const projectileComponent = node.getComponent('Skill');
                if (projectileComponent) {
                    projectileComponent.destroy();
                }

                beam = node.addComponent(SkillBeam);
                console.warn(`[SkillBeam] 预制体 ${prefab.name} 未挂 SkillBeam 组件，已运行时自动补挂`);
            }
        }

        beam.sourcePrefab = prefab;
        beam.resetForReuse();
        return beam;
    }

    static put(beam: SkillBeam) {
        const prefab = beam.sourcePrefab;
        if (!prefab) {
            console.warn('[SkillBeam] put 失败：缺少 sourcePrefab，直接移除节点');
            beam.remove(false);
            return;
        }

        let pool = this.pools.get(prefab);
        if (!pool) {
            pool = [];
            this.pools.set(prefab, pool);
        }

        pool.push(beam);
        beam.remove(false);
    }

    resetForReuse() {
        this.hitCount = 0;
        this.penetration = 9999;
        this.knockback = 0;
        this.lifeTime = 0;
        this.velocity.set(0, 0, 0);

        this.group = PhysicsSystem.PhysicsGroup['bullet'];
        this.trigger = true;

        this.node.setScale(resetScale);
        this.node.setRotation(resetRotation);
    }

    update(dt: number) {
        this.lifeTime -= dt;
        if (this.lifeTime < 0) {
            SkillBeam.put(this);
        }
    }

    onTrigger(b: cBody, trigger: Trigger) {
        if (trigger === Trigger.exit) return;

        if (b.group === PhysicsSystem.PhysicsGroup['enemy'] || b.group === PhysicsSystem.PhysicsGroup['player']) {
            this.hitCount++;

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

            if (this.hitCount >= this.penetration) {
                SkillBeam.put(this);
            }
        }
    }
}