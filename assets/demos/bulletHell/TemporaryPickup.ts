import { _decorator, instantiate, Node, PhysicsSystem, Prefab, tween, Vec3 } from 'cc';
import { ShapeType } from '../../collision/Shape';
import { cObject } from '../../collision/Object';
import { Player } from './player';
import { BulletHell } from './bulletHell';
import { ExperienceSystem } from './ExperienceSystem';

const { ccclass } = _decorator;

export type PickupEffectType = 'temporary_damage_boost' | 'exp_burst' | 'heal_burst';

@ccclass('TemporaryPickup')
export class TemporaryPickup extends cObject {
    static fallbackPool: Array<TemporaryPickup> = [];
    static prefabPools: WeakMap<Prefab, Array<TemporaryPickup>> = new WeakMap();

    public effectType: PickupEffectType = 'temporary_damage_boost';
    public effectValue = 1.2;
    public effectDuration = 6;
    public lifeTime = 8;

    private _collected = false;
    private sourcePrefab: Prefab | null = null;
    private idleElapsed = 0;
    private baseScale = new Vec3(1, 1, 1);
    private baseY = 0;
    private static readonly tempScale = new Vec3();
    private static readonly tempPos = new Vec3();

    static get(prefab?: Prefab | null): TemporaryPickup {
        const sourcePrefab = prefab ?? null;

        if (sourcePrefab) {
            let pool = this.prefabPools.get(sourcePrefab);
            if (!pool) {
                pool = [];
                this.prefabPools.set(sourcePrefab, pool);
            }

            let pickup = pool.pop();
            if (!pickup) {
                const node = instantiate(sourcePrefab);
                pickup = node.getComponent(TemporaryPickup) || node.addComponent(TemporaryPickup);
            }

            pickup.sourcePrefab = sourcePrefab;
            return pickup;
        }

        let pickup = this.fallbackPool.pop();
        if (!pickup) {
            const node = new Node('TemporaryPickup');
            pickup = node.addComponent(TemporaryPickup);
        }
        pickup.sourcePrefab = null;
        return pickup;
    }

    static put(pickup: TemporaryPickup): void {
        pickup._collected = false;
        pickup.idleElapsed = 0;
        pickup.velocity.set(0, 0, 0);

        const prefab = pickup.sourcePrefab;
        if (prefab) {
            let pool = this.prefabPools.get(prefab);
            if (!pool) {
                pool = [];
                this.prefabPools.set(prefab, pool);
            }
            pool.push(pickup);
        } else {
            this.fallbackPool.push(pickup);
        }

        pickup.remove(false);
    }

    static clearPools(): void {
        this.fallbackPool.length = 0;
        this.prefabPools = new WeakMap();
    }

    onLoad(): void {
        this.trigger = true;
        this.group = PhysicsSystem.PhysicsGroup['goods'];
        this.type = ShapeType.Sphere;
        this.radius = 18;
        this.center.set(0, 0, 0);
        this.maxVelocity = 0;

        super.onLoad();

        // goods 组默认即可，显式刷新一次避免运行时动态创建时出现掩码不一致。
        this.body.group = this.group;
        this.body.mask = PhysicsSystem.instance.collisionMatrix[this.group];
    }

    public initPickup(
        effectType: PickupEffectType,
        effectValue: number,
        effectDuration: number,
        lifeTime: number,
        worldPos: Vec3
    ): void {
        this.effectType = effectType;
        this.effectValue = effectValue;
        this.effectDuration = effectDuration;
        this.lifeTime = lifeTime;
        this._collected = false;
        this.idleElapsed = 0;

        // 作为 cObject 子节点坐标，直接用世界坐标即可（父节点通常是场景根）。
        this.setPosition(new Vec3(worldPos.x, worldPos.y, 0));
        this.baseScale.set(this.node.scale);
        this.baseY = this.node.position.y;
    }

    update(dt: number): void {
        if (this._collected) {
            return;
        }

        this.lifeTime -= dt;
        if (this.lifeTime <= 0) {
            TemporaryPickup.put(this);
            return;
        }

        // 简单漂浮呼吸效果，保证拾取物有可感知动态。
        this.idleElapsed += dt;
        const pulse = 1 + Math.sin(this.idleElapsed * 5) * 0.06;
        const bobY = Math.sin(this.idleElapsed * 3) * 4;

        TemporaryPickup.tempScale.set(this.baseScale).multiplyScalar(pulse);
        this.setScale(TemporaryPickup.tempScale);

        const pos = this.getPosition();
        TemporaryPickup.tempPos.set(pos.x, this.baseY + bobY, pos.z);
        this.setPosition(TemporaryPickup.tempPos);
    }

    public collect(owner: Node): void {
        if (this._collected) {
            return;
        }
        this._collected = true;

        const worldPos = this.node.worldPosition.clone();

        if (this.effectType === 'temporary_damage_boost') {
            Player.inst?.applyTemporaryDamageBoost(this.effectValue, this.effectDuration);
        } else if (this.effectType === 'exp_burst') {
            ExperienceSystem.inst?.addExp(Math.max(1, Math.floor(this.effectValue)), 'relief-pickup');
        } else if (this.effectType === 'heal_burst') {
            Player.inst?.heal(Math.max(1, Math.floor(this.effectValue)));
        }

        this.playCollectEffect(worldPos);

        TemporaryPickup.put(this);
    }

    private playCollectEffect(worldPos: Vec3): void {
        const effectPrefab = BulletHell.inst?.pickupCollectEffectPrefab;
        if (!effectPrefab) {
            return;
        }

        const parent = BulletHell.inst?.objects || this.node.parent;
        if (!parent) {
            return;
        }

        const effectNode = instantiate(effectPrefab);
        parent.addChild(effectNode);

        const localPos = new Vec3();
        Vec3.subtract(localPos, worldPos, parent.worldPosition);
        effectNode.setPosition(localPos);

        effectNode.setScale(new Vec3(0.5, 0.5, 1));
        tween(effectNode)
            .to(0.18, { scale: new Vec3(1.2, 1.2, 1) })
            .to(0.12, { scale: new Vec3(0.1, 0.1, 1) })
            .call(() => effectNode.destroy())
            .start();
    }
}
