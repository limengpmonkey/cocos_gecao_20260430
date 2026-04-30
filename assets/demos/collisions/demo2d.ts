import { CCInteger, Component, Prefab, Quat, Vec2, Vec3, _decorator, clamp, instantiate } from 'cc';
import { Config } from './Config';
import { cCollider } from '../../collision/Collider';
import { cObject } from '../../collision/Object';
import { ShapeType } from '../../collision/Shape';
const { ccclass, property } = _decorator;


const tempPos = new Vec3();
const tempRot = new Quat();


@ccclass('demo2d')
export class demo2d extends Component {

    @property(Prefab)
    box: Prefab = null;

    @property(Prefab)
    sphere: Prefab = null;

    @property(CCInteger)
    capacity: number = 1024;

    @property(CCInteger)
    speed: number = 100;

    @property(Vec2)
    world: Vec2 = new Vec2(960, 640)

    objects: Array<cObject> = [];

    boxNum: number = 0;
    sphereNum: number = 0;


    resetRotation(): void {
      
        let objects = this.objects;
        let length = objects.length;
        for (let i = 0; i < length; i++) {

            let obj = objects[i];
            obj.setRotation(Quat.IDENTITY);
        }

    }

    randomRotation(): void {
        let objects = this.objects;
        let length = objects.length;
        for (let i = 0; i < length; i++) {
            let obj = objects[i];
            Quat.fromEuler(tempRot,0,0,Math.random()*360);
            obj.setRotation(tempRot);//更新节点旋转
        }
    }

    onDestroy(){
        
        this.boxNum = 0;
        this.sphereNum = 0;
        this.objects.length = 0;
       
        cCollider.inst.reset(); //重置复用
    
    }


    addObjects(num: number, prefab: Prefab,type:string) {

        for (let i = 0; i < num; i++) {

            let node = instantiate(prefab);
            this.node.addChild(node);

            tempPos.x = (Math.random() - 0.5) * this.world.x;
            tempPos.y = (Math.random() - 0.5) * this.world.y;
            tempPos.z = 0;
            node.position = tempPos; //更新位置


            let object = node.getComponent(cObject);
            let angle = (Math.random() * Math.PI * 2);
            let speed = this.speed * (Math.random() * 0.9 + 0.1);
            object.velocity.x = Math.cos(angle) * speed;
            object.velocity.y = Math.sin(angle) * speed;
            object.velocity.z = 0;
            object.name = type;

            if(Config.isRotate){
                //开启旋转检测
                Quat.fromEuler(tempRot,0,0,Math.random()*360);
                object.setRotation(tempRot);//更新节点旋转
            }

            this.objects.push(object);
        }
    }


    worldManager(dt:number){
            //控制全局速度      
            dt *= Config.maxSpeed;
        
            //动态增加 box 
            let boxNum = Math.round(Config.box * Config.maxNum);
            if (boxNum > this.boxNum) {
                let max =  clamp(boxNum - this.boxNum,0,20); //分帧
                this.addObjects(max, this.box,'1');
                this.boxNum+= max;
            }
            
            //动态增加 sphere
            let sphereNum = Math.round(Config.sphere * Config.maxNum);
            if (sphereNum > this.sphereNum) {
                let max =  clamp(sphereNum - this.sphereNum,0,20);//分帧
                this.addObjects(max, this.sphere,'2');
                this.sphereNum+=max;
            }
    
    
            let objects = this.objects;
            for (let i = 0; i < objects.length; i++) {
    
                let obj = objects[i];
                let velocity = obj.velocity;
                tempPos.set(obj.getPosition());
    
    
                if (Math.abs(tempPos.x + velocity.x * dt) > this.world.x / 2) {
                    velocity.x = -velocity.x;
                }
    
                if (Math.abs(tempPos.y + velocity.y * dt) > this.world.y / 2) {
                    velocity.y = -velocity.y;
                }
    
                // if (Math.abs(tempPos.z + velocity.z * dt) > HEIGHT / 2) {
                //     velocity.z = -velocity.z;
                // }    
    
                tempPos.x += velocity.x * dt;
                tempPos.y += velocity.y * dt;
                tempPos.z += velocity.z * dt;
    
                //更新节点位置
                obj.setPosition(tempPos);
                
                
    
                //动态删除box
                if (boxNum < this.boxNum) {
                    if(obj.name == '1'){
                        
                        //回收body删除node
                        obj.remove(true).destroy(); 
                        objects.splice(i--,1);
                        this.boxNum--;
                    } 
                }
    
                 //动态删除Sphere
                if (sphereNum < this.sphereNum) {
                    if(obj.name == '2'){
                        
                        //回收body删除node
                        obj.remove(true).destroy(); 
                        objects.splice(i--,1);
                        this.sphereNum--;
                    } 
                }
    
            }
    }

    update(dt: number) {
        this.worldManager(dt);
        cCollider.inst.update(dt);
    }
}

