import { _decorator, Color, MeshRenderer } from 'cc';
import { cBody } from '../collision/Body';
import { cObject, Trigger } from '../collision/Object';

const { ccclass, property } = _decorator;

@ccclass('Sprite3d')
export class Sprite3d extends cObject {


    isHit: boolean = false;
    color: Color = new Color();
    sprite: MeshRenderer = null;
    colorData = new Float32Array(4);

    start(): void {
        this.sprite = this.node.getComponent(MeshRenderer);
        this.sprite.model["_worldBounds"] = null;
        this.setColor(Color.WHITE);
    }


    setColor(color: Color) {

        if(this.sprite){
            if(!this.color.equals(color)){
                let data = this.colorData;
                data[0] = color.r / 255.0;
                data[1] = color.g / 255.0;
                data[2] = color.b / 255.0;
                data[3] = color.a / 255.0;
                this.sprite.setInstancedAttribute("i_color", this.colorData);
            }
        }
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

