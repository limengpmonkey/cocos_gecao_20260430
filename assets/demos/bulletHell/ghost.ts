import { _decorator, instantiate, PhysicsSystem, Prefab, Quat, Vec3,Node } from 'cc';
import { cBody } from '../../collision/Body';
import { Trigger } from '../../collision/Object';
import { Enemy } from './enemy';
import { Player } from './player';
const { ccclass, property } = _decorator;

const tempPos = new Vec3();
const tempRot = new Quat();

@ccclass('Ghost')
export class Ghost extends Enemy {
    // 缓存池管理
    static pools: Array<Ghost> = [];
    
    static get(prefab: Prefab): Ghost {
        let ghost = this.pools.pop();
        if (!ghost) {
            let node = instantiate(prefab);
            ghost = node.getComponent(Ghost);
        }
        ghost.node.active = true;
        return ghost;
    }

    static put(ghost: Ghost): void {
        this.pools.push(ghost);
        ghost.remove(false);
    }
    
    /** 重写死亡效果播放（鬼魂特有特效） */
    protected playDeathEffect(attackerNode?: Node, onComplete?: () => void): void {
        super.playDeathEffect(attackerNode, onComplete);
    }
    
    /** 重写回收方法（调用Ghost的对象池） */
    protected recycle(): void {
        // 先调用父类处理（取消所有定时器）
        super.recycle();
        // console.log(`${this.node.name} 被回收到Ghost对象池`);
        Ghost.put(this);
    }
    
    onTrigger(b: cBody, trigger: Trigger) {
        if(trigger == Trigger.exit) return;
        
        // 让父类处理碰撞和血量计算
        super.onTrigger(b, trigger);
    }
}