// SimpleAutoPlay.ts
import { _decorator, Component, Animation } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('SimpleAutoPlay')
export class SimpleAutoPlay extends Component {
    start() {
        // 获取Animation组件并播放默认动画
        const anim = this.getComponent(Animation);
        if (anim) {
            anim.play();  // 不传参数，自动播放defaultClip
        }
    }
}