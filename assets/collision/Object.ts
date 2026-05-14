import { CCInteger, Color, Component, Node, PhysicsSystem, Quat, UITransform, Vec2, Vec3, _decorator, ccenum } from 'cc';
import { cBody } from './Body';
import { cCollider } from './Collider';
import { ShapeType, cBox, cPolygon, cShape, cSphere } from './Shape';
const { ccclass, property } = _decorator;

export enum Trigger {
    default = 0,
    enter = 1,
    stay = 2,
    exit = 3,
};

export enum Dirty {
    R = 1,
    T = 2,
    S = 4,
    RTS = 7,
    RS = R | S,
    NON = 0,
};

ccenum(ShapeType)
@ccclass('cObject')
export class cObject extends Component {

    @property({ group: "Body" })
    trigger: boolean = false; //碰撞开关

    @property({ type: PhysicsSystem.PhysicsGroup, group: "Body" })
    group = PhysicsSystem.PhysicsGroup.DEFAULT; //碰撞分组

    @property({ type: ShapeType, group: "Shape" })
    type: ShapeType = ShapeType.Box; //相交形状类型

    @property({ group: "Shape" })
    center: Vec3 = new Vec3();  //偏移位置，是shape相对node节点的中心偏移

    @property({ group: "Shape", visible() { return this.type == ShapeType.Box; } })
    size: Vec3 = new Vec3(); //方块的长宽高

    @property({ group: "Shape", visible() { return this.type == ShapeType.Sphere; } })
    radius: number = 0; //半径，sphere 或者 capsule

    @property({ type:[Vec2] , group: "Shape", visible() { return this.type == ShapeType.Polygon; } })
    points: Array<Vec2> = [];


    @property({ group: "Agent" })
    agent: boolean = false; //Agent开关

    
    @property({ min:0.01 , max:1.0, step:0.01, group: "Agent", visible() { return this.agent; } })
    weight: number = 0.5; //Agent 权值越小，穿透力越强

    @property({ group: "Agent", visible() { return this.agent; } })
    maxRadius: number = 0; //Agent碰撞半径,小于等于物体体积

    @property({ group: "Agent", visible() { return this.agent; } })
    maxVelocity: number = 0; //Agent 最大速度上限

    @property({ group: "Agent", visible() { return this.agent; }, tooltip: "是否与同分组 Agent 相互避让" })
    avoidSameGroupAgents: boolean = true;
    
    tryVelocity:Vec3 = new Vec3(); //最大期望速度
    velocity: Vec3 = new Vec3(); //当前实际速度
    isDirty: Dirty = Dirty.RTS;
    shape: cShape = null;
    body: cBody = null;


    onLoad() {

        //创建碰撞形状
        switch (this.type) {
            case ShapeType.Box:
                this.shape = new cBox(this.center, this.size);
                break;
            case ShapeType.Sphere:
                this.shape = new cSphere(this.center, this.radius);
                break;
            case ShapeType.Polygon:
                this.shape = new cPolygon(this.center, this.points);
                break;
        }


        //创建碰撞body容器
        this.body = cCollider.inst.create(this);

        
        this.body.shape = this.shape; //绑定碰撞形状
        this.body.group = this.group; //碰撞分组掩码
        this.body.isAgent = this.agent; // agent 检测开关
        this.body.weight = this.weight; // agent 避让优先级
        this.body.neighborDist = this.maxRadius; // agent 体积半径
        this.body.maxVelocity = this.maxVelocity; // agent 最大速度
        this.body.avoidSameGroupAgents = this.avoidSameGroupAgents;
        this.body.mask = PhysicsSystem.instance.collisionMatrix[this.group];

        //把body加入碰撞管理
        cCollider.inst.insert(this.body);


        this.isDirty = Dirty.RTS;   //首次更新标记
    }

    //同步位置到body
    setPosition(position: Vec3) {
        this.node.position = position;
        this.isDirty |= Dirty.T;
    }

    //同步旋转到body
    setRotation(rotation: Quat) {
        this.node.rotation = rotation;
        this.isDirty |= Dirty.R;
    }

    //同步缩放到body
    setScale(scale: Vec3) {
        this.node.scale = scale;
        this.isDirty |= Dirty.S;
    }

    //设置瞄点，2D专用
    setAnchor(anchor: Vec2) {

        let c0 = this.center;
        let c1 = this.shape.center;
        let uts = this.node.getComponent(UITransform);
        if(uts){
            uts.anchorPoint = anchor;

            let s = uts.contentSize;
            c1.x = (0.5 - anchor.x) * s.width + c0.x;
            c1.y = (0.5 - anchor.y) * s.height + c0.y;
            
            this.isDirty |= Dirty.T;
        }
    }

    getRotation() { return this.node.rotation; }
    getPosition() { return this.node.position; }
    getScale() { return this.node.scale; }

    //删除当前节点
    remove(retrieve: boolean = true) {

        //移除body, retrieve: 是否回收body ？
        cCollider.inst.remove(this.body, retrieve);

        //从父节点移除
        this.node.removeFromParent();

        //最后node用户自己控制回收和释放
        //this.remove().destroy() // 回收body，释放node
        //pool.push(this.remove(false)); //不回收body , 回收node

        return this.node;
    }

    //重新添加到父节点
    insert(parent: Node) {

        //插入body, 强制更新body数据
        cCollider.inst.insert(this.body, true);

        //添加到父节点
        if (this.node.parent != parent)
            parent.addChild(this.node);
    }


    setAnimation(name: string) { }
    setColor(color: Color) { }
    init() { }

    //trigger 回调 enter,stay exit
    onTrigger(b: cBody, trigger: Trigger) {

        switch (trigger) {
            case Trigger.enter:
                //onTriggerEnter();
                break;
            case Trigger.stay:
                //onTriggerStay();
                break;
            case Trigger.exit:
                //onTriggerExit();
                break;
        }
    }

    hasChangeDirty(){
        let isDirty = this.isDirty
        let flag = this.node.hasChangedFlags;
        if(flag){
            if(flag&Node.TransformBit.POSITION) isDirty|=Dirty.T; 
            if(flag&Node.TransformBit.ROTATION) isDirty|=Dirty.R; 
            if(flag&Node.TransformBit.SCALE) isDirty|=Dirty.S; 
        }

        this.isDirty = Dirty.NON;
        
        return isDirty;
    }

    onDestroy() {
        cCollider.inst.remove(this.body,true);
        this.unscheduleAllCallbacks();
        this.shape = null;
        this.body = null;

    }
}

