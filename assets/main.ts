import { Component, _decorator, director, log } from 'cc';

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
        this.loadScene(this.homeSceneName);
    }

    public openCollection(): void {
        this.loadScene(this.collectionSceneName);
    }

    public openGame(): void {
        log('open game scene');
        this.loadScene(this.gameSceneName);
    }

    private loadScene(sceneName: string): void {
        if (!sceneName) {
            return;
        }

        director.loadScene(sceneName);
    }
}

