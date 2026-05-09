// ExperienceSystem.ts - 经验与等级系统
import { _decorator, CCInteger, Component, Label, ProgressBar } from 'cc';
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
        this.refreshUI();
    }

    configureExpCurve(curve: ExpCurvePoint[]): void {
        this._expCurve = Array.isArray(curve) ? [...curve] : [];
        this._expToNextLevel = this.computeExpToNextLevel(this._currentLevel);
        this.refreshUI();
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
        
        // 检查是否升级
        while (this._currentExp >= this._expToNextLevel) {
            this.levelUp();
        }

        this.refreshUI();

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
        const cost = this._expToNextLevel;
        this._currentExp = Math.max(0, this._currentExp - cost);
        this._currentLevel++;
        
        // 计算升到下一级所需的经验
        this._expToNextLevel = this.computeExpToNextLevel(this._currentLevel);
        this.refreshUI();
        
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

    private refreshUI(): void {
        const progress = this.expProgress;

        if (this.levelLabel) {
            this.levelLabel.string = `等级 ${this._currentLevel}`;
        }

        if (this.expProgressBar) {
            this.expProgressBar.progress = progress;
        }

        if (this.expPercentLabel) {
            this.expPercentLabel.string = `${Math.floor(progress * 100)}%`;
        }
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
        this.node.off(event, callback, target);
    }
}