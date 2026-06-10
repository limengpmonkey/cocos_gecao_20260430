import { _decorator, Animation, Button, Component, Node, Vec3 } from 'cc';

const { ccclass, property } = _decorator;

type HeroGirlState = 'idle' | 'walking' | 'paused' | 'falling';

@ccclass('HomeHeroGirlController')
export class HomeHeroGirlController extends Component {
    private static readonly STOP_CLIP = 'play_girl_stop_in_home_scene';
    private static readonly WALK_CLIP = 'play_girl_walking_in_home_scene';
    private static readonly FALL_CLIP = 'play_girl_fallingdown_in_home_scene';

    @property(Animation)
    animation: Animation | null = null;

    @property({ tooltip: '行走终点（相对父节点 Layout 的本地坐标）' })
    walkTargetX = 94.349;

    @property
    walkTargetY = 58.638;

    @property({ tooltip: '直线移动速度（像素/秒）' })
    moveSpeed = 28;

    @property({ tooltip: '站立时，开始行走前的最短等待（秒）' })
    minIdleDuration = 2.5;

    @property
    maxIdleDuration = 6;

    @property({ tooltip: '行走中每隔多久判定一次随机停下（秒）' })
    walkStopCheckInterval = 1.2;

    @property({ tooltip: '每次判定时停下的概率（0~1）' })
    walkStopChance = 0.28;

    @property({ tooltip: '随机停下后，最短停留时间（秒）' })
    minPauseDuration = 1.8;

    @property
    maxPauseDuration = 4.2;

    @property({ tooltip: '到达终点的判定距离（像素）' })
    arriveThreshold = 2;

    private state: HeroGirlState = 'idle';
    private readonly originPosition = new Vec3();
    private readonly walkDestination = new Vec3();
    private readonly moveTarget = new Vec3();
    private readonly tempDelta = new Vec3();
    private headingToWalkTarget = true;
    private idleTimer = 0;
    private pauseTimer = 0;
    private walkStopTimer = 0;

    onLoad(): void {
        if (!this.animation) {
            this.animation = this.getComponent(Animation);
        }

        if (this.animation) {
            this.animation.playOnLoad = false;
        }

        Vec3.copy(this.originPosition, this.node.position);
        this.walkDestination.set(this.walkTargetX, this.walkTargetY, 0);
        this.disableTouchBlockingChildren();
        this.bindButtonClick();
    }

    onDestroy(): void {
        this.node.off(Button.EventType.CLICK, this.onButtonClicked, this);
        this.node.off(Node.EventType.TOUCH_END, this.onButtonClicked, this);
        this.unschedule(this.onFallingFinished);
    }

    start(): void {
        this.enterIdle(this.randomRange(this.minIdleDuration, this.maxIdleDuration));
    }

    /** 供 Button 组件 Click Event 在编辑器里绑定。 */
    public onHeroButtonClicked(): void {
        this.onButtonClicked();
    }

    update(deltaTime: number): void {
        if (this.state === 'falling') {
            return;
        }

        if (this.state === 'idle') {
            this.idleTimer -= deltaTime;
            if (this.idleTimer <= 0) {
                this.startWalking();
            }
            return;
        }

        if (this.state === 'paused') {
            this.pauseTimer -= deltaTime;
            if (this.pauseTimer <= 0) {
                this.resumeWalking();
            }
            return;
        }

        this.updateWalking(deltaTime);
    }

    private disableTouchBlockingChildren(): void {
        for (const child of this.node.children) {
            if (child.name === 'Label') {
                child.active = false;
            }
        }
    }

    private bindButtonClick(): void {
        const button = this.getComponent(Button);
        if (button) {
            this.node.on(Button.EventType.CLICK, this.onButtonClicked, this);
            return;
        }

        this.node.on(Node.EventType.TOUCH_END, this.onButtonClicked, this);
    }

    private onButtonClicked(): void {
        if (this.state === 'falling') {
            return;
        }

        this.enterFalling();
    }

    private enterFalling(): void {
        this.state = 'falling';
        const duration = this.playClipAndGetDuration(HomeHeroGirlController.FALL_CLIP);
        this.unschedule(this.onFallingFinished);
        this.scheduleOnce(this.onFallingFinished, duration);
    }

    private onFallingFinished(): void {
        if (this.state !== 'falling') {
            return;
        }

        this.enterIdle(this.randomRange(this.minIdleDuration, this.maxIdleDuration));
    }

    private updateWalking(deltaTime: number): void {
        const currentPosition = this.node.position;
        Vec3.subtract(this.tempDelta, this.moveTarget, currentPosition);
        const distance = this.tempDelta.length();

        if (distance <= this.arriveThreshold) {
            this.node.setPosition(this.moveTarget);
            this.headingToWalkTarget = !this.headingToWalkTarget;
            this.enterIdle(this.randomRange(this.minIdleDuration, this.maxIdleDuration));
            return;
        }

        const step = Math.min(this.moveSpeed * deltaTime, distance);
        this.tempDelta.normalize().multiplyScalar(step);
        this.node.setPosition(
            currentPosition.x + this.tempDelta.x,
            currentPosition.y + this.tempDelta.y,
            currentPosition.z,
        );

        this.walkStopTimer -= deltaTime;
        if (this.walkStopTimer > 0) {
            return;
        }

        this.walkStopTimer = this.walkStopCheckInterval;
        if (Math.random() < this.walkStopChance) {
            this.enterPaused();
        }
    }

    private startWalking(): void {
        this.state = 'walking';
        this.playClip(HomeHeroGirlController.WALK_CLIP);
        this.setMoveTarget(this.headingToWalkTarget ? this.walkDestination : this.originPosition);
        this.walkStopTimer = this.walkStopCheckInterval;
    }

    private resumeWalking(): void {
        this.state = 'walking';
        this.playClip(HomeHeroGirlController.WALK_CLIP);
        this.walkStopTimer = this.walkStopCheckInterval;
    }

    private enterIdle(duration: number): void {
        this.state = 'idle';
        this.idleTimer = duration;
        this.playClip(HomeHeroGirlController.STOP_CLIP);
    }

    private enterPaused(): void {
        this.state = 'paused';
        this.pauseTimer = this.randomRange(this.minPauseDuration, this.maxPauseDuration);
        this.playClip(HomeHeroGirlController.STOP_CLIP);
    }

    private setMoveTarget(target: Vec3): void {
        Vec3.copy(this.moveTarget, target);
    }

    private playClip(clipName: string): void {
        this.playClipAndGetDuration(clipName);
    }

    private playClipAndGetDuration(clipName: string): number {
        if (!this.animation) {
            return 0.7;
        }

        this.animation.stop();
        const state = this.animation.play(clipName);
        if (!state) {
            return 0.7;
        }

        return state.duration / Math.max(state.speed, 0.0001);
    }

    private randomRange(min: number, max: number): number {
        return min + Math.random() * (max - min);
    }
}
