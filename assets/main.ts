import { Component, EventTouch, Label, Node, Prefab, _decorator, instantiate, setDisplayStats } from 'cc';
import { BulletHell } from './demos/bulletHell/bulletHell';
import { Player } from './demos/bulletHell/player';

const { ccclass, property } = _decorator;

@ccclass('main')
export class main extends Component {

    @property(Prefab)
    demoBullet: Prefab = null;

    @property(Node)
    demosNode: Node = null;

    @property(Label)
    totalTxt: Label = null;

    currScense: Node = null;

    start() {
        setDisplayStats(false);
        this.enterBulletHell();

        // 只保留计数显示
        this.schedule(() => {
            const bulletHell = this.currScense?.getComponentInChildren(BulletHell);
            const length = bulletHell?.objects?.children?.length ?? 0;

            if (this.totalTxt) {
                this.totalTxt.string = "" + length;
            }
        }, 0.1);
    }

    private enterBulletHell(): void {
        if (this.currScense) {
            this.currScense.removeFromParent();
            this.currScense.destroy();
            this.currScense = null;
        }

        this.currScense = instantiate(this.demoBullet);

        const left = this.node.getChildByName("Left");
        if (left) {
            left.active = false;
        }

        const skill = this.node.getChildByName("Skill");
        if (skill) {
            skill.active = true;
        }

        this.demosNode?.addChild(this.currScense);
    }

    onSkill(event: EventTouch) {
        Player.inst?.onSkill();

        if (!event?.target) {
            return;
        }

        event.target.active = false;
        this.scheduleOnce(() => {
            if (event.target?.isValid) {
                event.target.active = true;
            }
        }, 5);
    }
}

