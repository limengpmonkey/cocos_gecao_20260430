// ExperienceSystem.ts - 经验与等级系统
import { _decorator, CCInteger, Component, Label, ProgressBar, tween, Tween } from 'cc';
import { ExperienceEventData, LevelUpEventData } from './types';
import { ExpCurvePoint, computeExpNeedForLevel } from './balanceTable';

const { ccclass, property } = _decorator;

// 经验事件常量
export enum ExperienceEvents {
    ON_EXP_GAIN = 'on-exp-gain',
    ON_LEVEL_UP = 'on-level-up'
}

@ccclass('ExperienceSystem')
export class ExperienceSystem extends Component {
    // 单例
    private static _inst: ExperienceSystem = null;
    static get inst(): ExperienceSystem { return this._inst; }
    
    // 经验属性
    @property({ type: CCInteger, tooltip: "当前经验值" })
    private _currentExp: number = 0;
    
    @property({ type: CCInteger, tooltip: "当前等级" })
    private _currentLevel: number = 1;
    
    @property({ type: CCInteger, tooltip: "升级所需经验" })
    private _expToNextLevel: number = 100;

    @property({ type: Label, tooltip: "等级文本（可选）" })
    levelLabel: Label = null;

    @property({ type: ProgressBar, tooltip: "经验进度条（可选）" })
    expProgressBar: ProgressBar = null;

    @property({ type: Label, tooltip: "经验百分比文本（可选）" })
    expPercentLabel: Label = null;
    
    // 升级曲线系数
    @property({ tooltip: "升级所需经验增长系数" })
    private expGrowthFactor: number = 1.5;

    private _expCurve: ExpCurvePoint[] = [];
    private readonly expDisplayState = { progress: 0 };
    private readonly minExpBarTweenDuration = 0.16;
    private readonly maxExpBarTweenDuration = 0.42;
    private readonly levelUpExpBarResetDelay = 0.12;
    
    // 事件系统
    // private _eventTarget: EventTarget = new EventTarget();
    
    onLoad(): void {
        ExperienceSystem._inst = this;
        this.reset();
    }
    
    onDestroy(): void {
        ExperienceSystem._inst = null;
    }
    
    // 重置经验系统
    reset(): void {
        this._currentExp = 0;
        this._currentLevel = 1;
        this._expToNextLevel = this.computeExpToNextLevel(this._currentLevel);
        this.refreshUI(true);
    }

    configureExpCurve(curve: ExpCurvePoint[]): void {
        this._expCurve = Array.isArray(curve) ? [...curve] : [];
        this._expToNextLevel = this.computeExpToNextLevel(this._currentLevel);
        this.refreshUI(true);
    }

    private computeExpToNextLevel(level: number): number {
        if (this._expCurve.length > 0) {
            return computeExpNeedForLevel(level, this._expCurve);
        }

        const lv = Math.max(1, Math.floor(level));
        return Math.max(1, Math.floor(100 * Math.pow(this.expGrowthFactor, lv - 1)));
    }
    
    /**
     * 添加经验值
     * @param amount 经验值数量
     * @param source 经验来源（敌人类型等）
     */
    addExp(amount: number, source?: string): void {
        const gainedExp = Math.max(0, Math.floor(amount));
        if (gainedExp <= 0) {
            return;
        }

        this._currentExp += gainedExp;
        let levelUpCount = 0;
        
        // 检查是否升级
        while (this._currentExp >= this._expToNextLevel) {
            this.levelUp();
            levelUpCount++;
        }

        if (levelUpCount > 0) {
            this.refreshLevelLabel();
            this.playLevelUpProgressAnimation(levelUpCount);
        } else {
            this.refreshUI(true);
        }

        // 触发经验获取事件（在升级结算后触发，保证 UI 读到的是当前等级进度）
        this.node.emit(ExperienceEvents.ON_EXP_GAIN, {
            amount: gainedExp,
            totalExp: this._currentExp,
            source: source
        } as ExperienceEventData);
    }
    
    /**
     * 升级
     */
    private levelUp(): void {
        this._currentExp = 0;
        this._currentLevel++;
        
        // 计算升到下一级所需的经验
        this._expToNextLevel = this.computeExpToNextLevel(this._currentLevel);
        
        // 触发升级事件
        this.node.emit(ExperienceEvents.ON_LEVEL_UP, {
            newLevel: this._currentLevel,
            expToNextLevel: this._expToNextLevel
        } as LevelUpEventData);
        
        console.log(`玩家升级到 ${this._currentLevel} 级`);
    }
    
    // Getter
    get currentExp(): number { return this._currentExp; }
    get currentLevel(): number { return this._currentLevel; }
    get expToNextLevel(): number { return this._expToNextLevel; }
    get expProgress(): number {
        if (this._expToNextLevel <= 0) {
            return 0;
        }
        return Math.max(0, Math.min(1, this._currentExp / this._expToNextLevel));
    }

    private refreshUI(animateProgress: boolean = false): void {
        this.refreshLevelLabel();

        if (animateProgress) {
            this.animateProgressTo(this.expProgress);
            return;
        }

        this.applyDisplayedProgress(this.expProgress);
    }

    private refreshLevelLabel(): void {
        if (this.levelLabel) {
            this.levelLabel.string = `等级 ${this._currentLevel}`;
        }
    }

    private animateProgressTo(targetProgress: number): void {
        const clampedTarget = this.clampProgress(targetProgress);
        Tween.stopAllByTarget(this.expDisplayState);

        const startProgress = this.clampProgress(this.expDisplayState.progress);
        if (Math.abs(clampedTarget - startProgress) <= 0.0001) {
            this.applyDisplayedProgress(clampedTarget);
            return;
        }

        tween(this.expDisplayState)
            .to(this.getProgressTweenDuration(startProgress, clampedTarget), { progress: clampedTarget }, {
                easing: 'quadOut',
                onUpdate: (state: { progress: number }) => {
                    this.applyDisplayedProgress(state.progress);
                }
            })
            .start();
    }

    private playLevelUpProgressAnimation(levelUpCount: number): void {
        if (levelUpCount <= 0) {
            return;
        }

        Tween.stopAllByTarget(this.expDisplayState);

        let chain = tween(this.expDisplayState)
            .to(this.getProgressTweenDuration(this.expDisplayState.progress, 1), { progress: 1 }, {
                easing: 'quadOut',
                onUpdate: (state: { progress: number }) => {
                    this.applyDisplayedProgress(state.progress);
                }
            })
            .delay(this.levelUpExpBarResetDelay)
            .call(() => {
                this.applyDisplayedProgress(0);
            });

        for (let i = 1; i < levelUpCount; i++) {
            chain = chain
                .to(this.getProgressTweenDuration(0, 1), { progress: 1 }, {
                    easing: 'quadOut',
                    onUpdate: (state: { progress: number }) => {
                        this.applyDisplayedProgress(state.progress);
                    }
                })
                .delay(this.levelUpExpBarResetDelay)
                .call(() => {
                    this.applyDisplayedProgress(0);
                });
        }

        chain.start();
    }

    private applyDisplayedProgress(progress: number): void {
        const clampedProgress = this.clampProgress(progress);
        this.expDisplayState.progress = clampedProgress;

        if (this.expProgressBar) {
            this.expProgressBar.progress = clampedProgress;
        }

        if (this.expPercentLabel) {
            this.expPercentLabel.string = `${Math.floor(clampedProgress * 100)}%`;
        }
    }

    private clampProgress(progress: number): number {
        return Math.max(0, Math.min(1, progress || 0));
    }

    private getProgressTweenDuration(from: number, to: number): number {
        const delta = Math.abs(this.clampProgress(to) - this.clampProgress(from));
        return this.minExpBarTweenDuration + (this.maxExpBarTweenDuration - this.minExpBarTweenDuration) * delta;
    }
    
    /**
     * 监听经验事件
     * @param event 事件类型
     * @param callback 回调函数
     * @param target 目标对象
     */
    on(event: ExperienceEvents, callback: (...args: any[]) => void, target?: any): void {
        this.node.on(event, callback, target);
    }
    
    /**
     * 取消监听经验事件
     * @param event 事件类型
     * @param callback 回调函数
     * @param target 目标对象
     */
    off(event: ExperienceEvents, callback?: (...args: any[]) => void, target?: any): void {
        if (!this.node || !this.node.isValid) {
            return;
        }

        this.node.off(event, callback, target);
    }
}