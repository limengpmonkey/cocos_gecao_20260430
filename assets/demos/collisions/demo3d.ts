import { _decorator, CCInteger, clamp, Component, instantiate, Mesh, MeshRenderer, Prefab, primitives, Quat, utils, Vec3 } from 'cc';
import { cCollider } from '../../collision/Collider';
import { cObject } from '../../collision/Object';
import { ShapeType } from '../../collision/Shape';
import { Config } from './Config';
const { ccclass, property } = _decorator;


const tempPos = new Vec3();
const tempRot = new Quat();

const boxMesh =  utils.createMesh(primitives.box());
const sphereMesh =  utils.createMesh(primitives.sphere(0.5, { segments: 12 }));
@ccclass('demo3d')
export class demo3d extends Component {

    @property(Prefab)
    box:Prefab = null;

    @property(Prefab)
    sphere:Prefab = null;

    @property(CCInteger)
    capacity:number = 1024;

    @property(CCInteger)
    speed:number = 20;

    @property(Vec3)
    world:Vec3 = new Vec3(10,10,10)


    objects:Array<cObject> =  [];

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
            Quat.fromEuler(tempRot,Math.random()*360,Math.random()*360,Math.random()*360);
            obj.setRotation(tempRot);//更新节点旋转
        }
    }

    onDestroy(){
        
        this.boxNum = 0;
        this.sphereNum = 0;
        this.objects.length = 0;

        cCollider.inst.reset(); //重置复用
    }


    addObjects(num: number, prefab: Prefab,mesh:Mesh = null) {

        for (let i = 0; i < num; i++) {

            let node = instantiate(prefab);
            this.node.addChild(node);
            if( mesh != null){
               let render =  node.getComponent(MeshRenderer);
               render.mesh = mesh;
            }
            
            tempPos.x = (Math.random()-0.5)*this.world.x;
            tempPos.y = (Math.random()-0.5)*this.world.y;
            tempPos.z = (Math.random()-0.5)*this.world.z;
            node.position = tempPos; //更新位置
     

            let object = node.getComponent(cObject);
            let speed = this.speed*(Math.random()*0.9+0.1);
            tempPos.normalize().multiplyScalar(speed);
            object.velocity.set(tempPos);

            if(Config.isRotate){
                //开启旋转检测
                Quat.fromEuler(tempRot,Math.random()*360,Math.random()*360,Math.random()*360);
                object.setRotation(tempRot);
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
            this.addObjects(max, this.box,boxMesh);
            this.boxNum+=max;
        }
        
        //动态增加 sphere
        let sphereNum = Math.round(Config.sphere * Config.maxNum);
        if (sphereNum > this.sphereNum) {
            let max =  clamp(sphereNum - this.sphereNum,0,20);//分帧
            this.addObjects(max, this.sphere,sphereMesh);
            this.sphereNum+=max;
        }

        

        let objects = this.objects;
        for (let i = 0; i < objects.length; i++) {

            let obj = objects[i];
            let velocity = obj.velocity;
            tempPos.set(obj.node.position); 
            
            if (Math.abs(tempPos.x + velocity.x * dt) > this.world.x / 2) {
                velocity.x = -velocity.x;
            }

            if (Math.abs(tempPos.y + velocity.y * dt) > this.world.y / 2) {
                velocity.y = -velocity.y;
            }

            if (Math.abs(tempPos.z + velocity.z * dt) > this.world.z / 2) {
                velocity.z = -velocity.z;
            }

            tempPos.x += velocity.x * dt;
            tempPos.y += velocity.y * dt;
            tempPos.z += velocity.z * dt;

            //更新节点位置
            obj.setPosition(tempPos);



            //动态删除box
            if (boxNum < this.boxNum) {
                if(obj.type == ShapeType.Box){
                
                    //回收body删除node
                obj.remove().destroy(); 
                objects.splice(i--,1);
                this.boxNum--;
                } 
            }

                //动态删除Sphere
            if (sphereNum < this.sphereNum) {
                if(obj.type == ShapeType.Sphere){

                    //回收body删除node
                    obj.remove().destroy(); 
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

