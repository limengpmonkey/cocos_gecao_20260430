import { Component, _decorator, director, log } from 'cc';
import { SceneTransition } from './SceneTransition';

const { ccclass, property } = _decorator;

@ccclass('ManagerScene')
export class ManagerScene extends Component {
    public static inst: ManagerScene | null = null;

    public static getInstance(): ManagerScene | null {
        if (ManagerScene.inst && ManagerScene.inst.isValid) {
            return ManagerScene.inst;
        }

        const scene = director.getScene();
        if (!scene) {
            return null;
        }

        const found = scene.getComponentInChildren(ManagerScene);
        if (found) {
            ManagerScene.inst = found;
        }

        return ManagerScene.inst;
    }

    @property
    homeSceneName: string = 'home';

    @property
    collectionSceneName: string = 'collection';

    @property
    gameSceneName: string = 'game';

    onLoad() {
        ManagerScene.inst = this;
    }

    onDestroy() {
        if (ManagerScene.inst === this) {
            ManagerScene.inst = null;
        }
    }

    start() {
        this.openHome();
    }

    public openHome(): void {
        if (director.getScene()?.name === 'ManagerScene') {
            director.loadScene(this.homeSceneName);
            return;
        }

        this.loadScene(this.homeSceneName, '返回首页...');
    }

    public openCollection(): void {
        this.loadScene(this.collectionSceneName, '打开图鉴...');
    }

    public openGame(): void {
        log('open game scene');
        this.loadScene(this.gameSceneName, '进入战斗...');
    }

    private loadScene(sceneName: string, message: string = '加载中...'): void {
        if (!sceneName) {
            return;
        }

        SceneTransition.loadScene(sceneName, message);
    }
}

