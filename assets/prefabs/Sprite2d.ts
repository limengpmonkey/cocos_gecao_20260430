import { _decorator, Color, Sprite } from 'cc';
import { cBody } from '../collision/Body';
import { cObject, Trigger } from '../collision/Object';
const { ccclass, property } = _decorator;

@ccclass('Sprite2d')
export class Sprite2d extends cObject {


    sprite: Sprite = null;
    isHit: boolean = false;

    start(): void {
        this.sprite = this.node.getComponent(Sprite);
    }

    setColor(color: Color) {
        if (this.sprite)
            this.sprite.color = color;
    }

    protected update(dt: number): void {
        this.setColor(this.isHit ? Color.GREEN : Color.WHITE);
        this.isHit = false;
    }

    // remove(): void {
    //     super.remove();
    //     //如需要改善性能，自行回收到内存池
    //     this.node.removeFromParent();
    //     this.node.destroy();
    // }

    onTrigger(b: cBody, trigger: Trigger): void {

        let isHit = trigger != Trigger.exit;
        if (isHit && !this.isHit) {
            this.isHit = isHit;
        }

    }
}

