import { _decorator, Component, Node, Prefab, instantiate, warn } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('Game')
export class Game extends Component {
    @property(Prefab)
    demoBullet: Prefab = null;

    @property(Node)
    demosNode: Node = null;

    private bulletHellNode: Node = null;

    start() {
        this.enterBulletHell();
    }

    update(deltaTime: number) {
        
    }

    private enterBulletHell(): void {
        if (!this.demoBullet) {
            return;
        }

        const host = this.demosNode ?? this.node;

        // Prevent duplicate UI/joystick/cards caused by repeated BulletHell instantiation.
        const existing = this.bulletHellNode?.isValid
            ? this.bulletHellNode
            : host.getChildByName('BulletHell');

        if (existing) {
            this.bulletHellNode = existing;
            warn('[Game] BulletHell already exists, skip duplicate creation');
            return;
        }

        const bulletHell = instantiate(this.demoBullet);
        this.bulletHellNode = bulletHell;

        host.addChild(bulletHell);
    }

    onDestroy() {
        this.bulletHellNode = null;
    }
}

