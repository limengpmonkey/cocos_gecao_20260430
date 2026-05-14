import { _decorator, instantiate, Node, Prefab, Quat, Vec3 } from 'cc';
import { cBody } from '../../collision/Body';
import { Trigger } from '../../collision/Object';
import { Enemy } from './enemy';
const { ccclass, property } = _decorator;

const tempPos = new Vec3();
const tempRot = new Quat();
@ccclass('SnailTail')
export class SnailTail extends Enemy {

    //缓存池管理
    static pools: Array<SnailTail> = [];
    static get(prefab: Prefab): SnailTail {
        let snailtail = this.pools.pop();
        if (!snailtail) {
            let node = instantiate(prefab);
            snailtail = node.getComponent(SnailTail);
        }

        return snailtail;
    }

    static put(snailtail: SnailTail) {
        //压入缓存池管理节点
        this.pools.push(snailtail);
        //移除node不回收body
        snailtail.remove(false);
    }


    protected playDeathEffect(attackerNode?: Node, onComplete?: () => void): void {
        if (onComplete) {
            onComplete();
        }
    }

    protected recycle(): void {
        super.recycle();
        SnailTail.put(this);
    }

    onTrigger(b: cBody, trigger: Trigger) {
        if (trigger == Trigger.exit) return;

        // 交由父类统一处理受击、扣血、死亡与回收时机
        super.onTrigger(b, trigger);
    }
}

