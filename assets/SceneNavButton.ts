import { _decorator, Component, director, warn } from 'cc';
import { ManagerScene } from './main';

const { ccclass, property } = _decorator;

@ccclass('SceneNavButton')
export class SceneNavButton extends Component {
    @property
    homeSceneName: string = 'home';

    @property
    collectionSceneName: string = 'collection';

    @property
    gameSceneName: string = 'game';

    public goHome(): void {
        const manager = ManagerScene.getInstance();
        if (manager) {
            manager.openHome();
            return;
        }

        warn('[SceneNavButton] ManagerScene not found, fallback to direct load home');
        director.loadScene(this.homeSceneName);
    }

    public goCollection(): void {
        const manager = ManagerScene.getInstance();
        if (manager) {
            manager.openCollection();
            return;
        }

        warn('[SceneNavButton] ManagerScene not found, fallback to direct load collection');
        director.loadScene(this.collectionSceneName);
    }

    public goGame(): void {
        const manager = ManagerScene.getInstance();
        if (manager) {
            manager.openGame();
            return;
        }

        warn('[SceneNavButton] ManagerScene not found, fallback to direct load game');
        director.loadScene(this.gameSceneName);
    }
}
