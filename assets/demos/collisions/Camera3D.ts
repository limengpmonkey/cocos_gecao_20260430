
import { Camera, clamp, Component, input, Input, Node, Quat, toRadian, Vec2, Vec3, _decorator } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('Camera3D')
export class Camera3D extends Component {

    @property
    distance:number = 25
    @property
    vertical:number = 30;
    @property
    horizontal:number = 45;

    @property(Node)
    target:Node;

    camera:Camera = null;


    private rot: Quat = new Quat();
    private curXY: Vec2 = new Vec2();

    private curScale: number = 1;
    private touchCount: number = 0;
    private touchs: any = [{ id: -1, pre: new Vec2(), cur: new Vec2() }, { id: -1, pre: new Vec2(), cur: new Vec2() }];

    private rotTemp:Quat = new Quat();

    start(){
        
        this.camera = this.getComponentInChildren(Camera);
        this.curXY.set(toRadian(this.horizontal),-toRadian(this.vertical));

        if(this.camera){
            this.camera.node.position = new Vec3(0,0,this.distance);
        }
    }

    onEnable() {
        input.on(Input.EventType.MOUSE_WHEEL, this.onMouseScale, this);
        input.on(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.on(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.on(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.on(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    onDisable() {
        input.off(Input.EventType.MOUSE_WHEEL, this.onMouseScale, this);
        input.off(Input.EventType.TOUCH_START, this.onTouchStart, this);
        input.off(Input.EventType.TOUCH_MOVE, this.onTouchMove, this);
        input.off(Input.EventType.TOUCH_CANCEL, this.onTouchEnd, this);
        input.off(Input.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    updateRotate() {

        let node = this.node;
        let rotation = this.rot;
        this.curXY.y = clamp(this.curXY.y, toRadian(-60),toRadian(30));
        Quat.rotateY(rotation, Quat.IDENTITY, -this.curXY.x);
        Quat.rotateX(rotation, rotation, this.curXY.y);
        Quat.slerp(rotation, node.rotation, rotation, 0.25);
        node.rotation = rotation;

        if(this.target){
            let rotate = this.target.rotation;
            node.position.lerp(this.target.position,0.25);
            Quat.fromAxisAngle(this.rotTemp,Vec3.UNIT_Y,-this.curXY.x);
            this.target.rotation = rotate.lerp(this.rotTemp,0.25);
        }
     
    }

    onMouseScale(event) {
        let scale = event.getScrollY() > 0 ? 1 : -1;
        this.curScale = clamp(this.curScale - scale * 0.1, 0.25, 1.5);
        this.node.scale = new Vec3(this.curScale, this.curScale, this.curScale);
    }

    onTouchStart(event) {
        let id = event.getID();
        let pos = event.getUILocation();
        for (let i = 0; i < 2; i++) {
            let t = this.touchs[i];
            if (t.id == -1) {
                t.id = id;
                t.pre.set(pos);
                t.cur.set(pos);
                this.touchCount++;
                break;
            }
        }
    }

    onTouchMove(event) {

        let curTouch = null;
        let id = event.getID();
        let pos = event.getUILocation();
        for (let i = 0; i < 2; i++) {
            let t = this.touchs[i];
            if (t.id == id) {
                t.cur.set(pos);
                curTouch = t;
            }
        }

        if (this.touchCount == 1) {
            let scale = 0.008;
            let cur = event.getUIDelta();
            this.curXY.x += cur.x * scale;
            this.curXY.y += cur.y * scale;

            // this.updateRotate();
        } else if (this.touchCount == 2) {
            let p0 = this.touchs[0];
            let p1 = this.touchs[1];

            let curLen = Vec2.distance(p0.cur, p1.cur);
            let oldLen = Vec2.distance(p0.pre, p1.pre);
            this.curScale = clamp(this.curScale - (curLen - oldLen) * 0.002, 0.25, 1.5);
            this.node.scale = new Vec3(this.curScale, this.curScale, this.curScale);
        }

        if (curTouch) {
            curTouch.pre.set(curTouch.cur);
        }

    }

    onTouchEnd(event) {
        let id = event.getID();
        for (let i = 0; i < 2; i++) {
            let t = this.touchs[i];
            if (t.id == id) {
                t.id = -1;
                this.touchCount--;
            }
        }
    }

    update(dt: number) {
        this.updateRotate();
    }

}

