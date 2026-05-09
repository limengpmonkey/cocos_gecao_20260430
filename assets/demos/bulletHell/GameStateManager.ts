// GameStateManager.ts - 使用正确的 Scheduler API
import { _decorator, Component, Node, input, Input, KeyCode, director } from 'cc';
import { GameState } from './types';

const { ccclass, property } = _decorator;

// 状态事件定义
export enum GameStateEvents {
    STATE_CHANGED = 'game_state_changed',
    BEFORE_PAUSE = 'before_pause',
    AFTER_PAUSE = 'after_pause',
    BEFORE_RESUME = 'before_resume',
    AFTER_RESUME = 'after_resume',
    GAME_OVER = 'game_over',
    GAME_START = 'game_start'
}

@ccclass('GameStateManager')
export class GameStateManager extends Component {
    // 单例
    private static _inst: GameStateManager = null;
    static get inst(): GameStateManager { return this._inst; }
    
    // 当前状态
    private _currentState: GameState = GameState.RUNNING;
    private _previousState: GameState = GameState.RUNNING;
    
    // 是否启用键盘暂停
    @property({ tooltip: "是否启用ESC键暂停" })
    enableEscapePause: boolean = true;
    
    // 时间缩放
    private _timeScale: number = 1.0;
    
    // 暂停原因
    private _pauseReason: string = '';

    // 当前暂停周期是否调用过 director.pause()
    private _usedDirectorPauseForCurrentPause: boolean = false;
    
    onLoad(): void {
        if (GameStateManager._inst && GameStateManager._inst !== this) {
            console.warn("存在多个 GameStateManager 实例，销毁当前实例");
            this.node.destroy();
            return;
        }
        GameStateManager._inst = this;
        
        console.log("GameStateManager 已加载，初始状态:", this._currentState);
        
        // 注册键盘事件
        if (this.enableEscapePause) {
            input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        }
    }
    
    onDestroy(): void {
        if (GameStateManager._inst === this) {
            GameStateManager._inst = null;
        }
        
        // 移除键盘事件
        if (this.enableEscapePause) {
            input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        }
    }
    
    /**
     * 键盘事件处理
     */
    private onKeyDown(event: any): void {
        if (event.keyCode === KeyCode.ESCAPE) {
            this.togglePause();
        }
    }
    
    /**
     * 切换暂停状态
     */
    togglePause(): void {
        if (this._currentState === GameState.RUNNING) {
            this.pauseGame("user_pressed_esc");
        } else if (this._currentState === GameState.PAUSED) {
            this.resumeGame();
        }
    }
    
    /**
     * 暂停游戏
     * @param reason 暂停原因
     */
    pauseGame(reason: string = "unknown"): boolean {
        if (this._currentState === GameState.PAUSED) {
            console.log("游戏已经处于暂停状态");
            return false;
        }
        
        console.log(`暂停游戏，原因: ${reason}`);
        this._pauseReason = reason;
        
        // 保存之前的状态
        this._previousState = this._currentState;
        
        // 使用 Node 的 emit 触发暂停前事件
        this.node.emit(GameStateEvents.BEFORE_PAUSE, {
            previousState: this._previousState,
            reason: reason
        });
        
        // 更新状态
        this._currentState = GameState.PAUSED;
        
        // 停止游戏逻辑
        this.stopGameLogic(reason);
        
        // 使用 Node 的 emit 触发状态改变事件
        this.node.emit(GameStateEvents.STATE_CHANGED, {
            newState: GameState.PAUSED,
            previousState: this._previousState,
            reason: reason
        });
        
        // 使用 Node 的 emit 触发暂停后事件
        this.node.emit(GameStateEvents.AFTER_PAUSE, {
            previousState: this._previousState,
            currentState: this._currentState,
            reason: reason
        });
        
        return true;
    }
    
    /**
     * 恢复游戏
     */
    resumeGame(): boolean {
        if (this._currentState !== GameState.PAUSED) {
            console.log("游戏当前不是暂停状态，无法恢复");
            return false;
        }
        
        console.log("恢复游戏");
        
        // 使用 Node 的 emit 触发恢复前事件
        this.node.emit(GameStateEvents.BEFORE_RESUME, {
            currentState: this._currentState,
            targetState: this._previousState,
            reason: this._pauseReason
        });
        
        const previousPausedState = this._currentState;
        const resumeReason = this._pauseReason;
        
        // 恢复到之前的状态
        this._currentState = this._previousState;
        this._pauseReason = '';
        
        // 恢复游戏逻辑
        this.resumeGameLogic(resumeReason);
        
        // 使用 Node 的 emit 触发状态改变事件
        this.node.emit(GameStateEvents.STATE_CHANGED, {
            newState: this._currentState,
            previousState: previousPausedState,
            reason: `resume_from_${resumeReason}`
        });
        
        // 使用 Node 的 emit 触发恢复后事件
        this.node.emit(GameStateEvents.AFTER_RESUME, {
            previousState: previousPausedState,
            currentState: this._currentState,
            reason: resumeReason
        });
        
        return true;
    }
    
    /**
     * 停止游戏逻辑
     */
    private stopGameLogic(reason: string): void {
        console.log("停止游戏逻辑");

        // 技能选择期间需要保持 UI 可点击，因此不能暂停 director。
        if (reason === 'skill_selection') {
            this._usedDirectorPauseForCurrentPause = false;
            console.log("✅ skill_selection 暂停仅使用时间缩放，保持 UI 响应");
        } else {
            try {
                director.pause();
                this._usedDirectorPauseForCurrentPause = true;
                console.log("✅ 使用 director.pause() 暂停游戏");
            } catch (error) {
                this._usedDirectorPauseForCurrentPause = false;
                console.error("暂停游戏失败:", error);
            }
        }

        // 设置时间缩放
        this._timeScale = 0;
        this.setGlobalTimeScale(this._timeScale);
    }
    
    /**
     * 恢复游戏逻辑
     */
    private resumeGameLogic(reason: string): void {
        console.log("恢复游戏逻辑");

        if (this._usedDirectorPauseForCurrentPause) {
            // 仅当本次暂停确实调用过 director.pause() 时才恢复。
            try {
                director.resume();
                console.log("✅ 使用 director.resume() 恢复游戏");
            } catch (error) {
                console.error("恢复游戏失败:", error);
                this.resumeGameFallback();
            }
        } else {
            console.log(`✅ ${reason || 'unknown'} 暂停未冻结 director，跳过 director.resume()`);
        }

        this._usedDirectorPauseForCurrentPause = false;

        // 恢复时间缩放
        this._timeScale = 1.0;
        this.setGlobalTimeScale(this._timeScale);
    }
    
    /**
     * 备用暂停方案
     */
    private pauseGameFallback(): void {
        console.log("使用备用暂停方案");
        
        // 方案1：使用 director.pause()（会暂停整个游戏，包括UI）
        try {
            director.pause();
            console.log("✅ 使用 director.pause() 暂停游戏");
        } catch (error) {
            console.error("备用暂停方案失败:", error);
        }
    }
    
    /**
     * 备用恢复方案
     */
    private resumeGameFallback(): void {
        console.log("使用备用恢复方案");
        
        // 方案1：使用 director.resume()
        try {
            director.resume();
            console.log("✅ 使用 director.resume() 恢复游戏");
        } catch (error) {
            console.error("备用恢复方案失败:", error);
        }
    }
    
    /**
     * 设置全局时间缩放
     */
    private setGlobalTimeScale(scale: number): void {
        try {
            // 设置调度器时间缩放
            const scheduler = director.getScheduler();
            if (typeof scheduler.setTimeScale === 'function') {
                scheduler.setTimeScale(scale);
                console.log(`设置时间缩放: ${scale}`);
            }
        } catch (error) {
            console.error("设置时间缩放失败:", error);
        }
    }
    
    /**
     * 设置游戏状态
     */
    setState(newState: GameState, data?: any): boolean {
        if (this._currentState === newState) {
            console.log(`状态已经是 ${newState}，无需切换`);
            return false;
        }
        
        console.log(`切换状态: ${this._currentState} -> ${newState}`);
        
        const oldState = this._currentState;
        this._previousState = oldState;
        this._currentState = newState;
        
        // 使用 Node 的 emit 触发状态改变事件
        this.node.emit(GameStateEvents.STATE_CHANGED, {
            newState: newState,
            previousState: oldState,
            data: data
        });
        
        // 特殊状态处理
        if (newState === GameState.GAME_OVER) {
            this.node.emit(GameStateEvents.GAME_OVER, data);
        } else if (newState === GameState.RUNNING && oldState === GameState.GAME_OVER) {
            this.node.emit(GameStateEvents.GAME_START, data);
        }
        
        return true;
    }
    
    // 状态检查方法
    get currentState(): GameState { return this._currentState; }
    get previousState(): GameState { return this._previousState; }
    get pauseReason(): string { return this._pauseReason; }
    
    get isRunning(): boolean { return this._currentState === GameState.RUNNING; }
    get isPaused(): boolean { return this._currentState === GameState.PAUSED; }
    get isGameOver(): boolean { return this._currentState === GameState.GAME_OVER; }
    get isInMenu(): boolean { return this._currentState === GameState.MENU; }
    
    /**
     * 获取时间缩放
     */
    get timeScale(): number { return this._timeScale; }
    
    /**
     * 设置时间缩放
     */
    setTimeScale(scale: number): void {
        this._timeScale = scale;
        this.setGlobalTimeScale(scale);
    }
    
    /**
     * 监听状态事件
     * 使用 Node 的 on 方法
     */
    on(event: GameStateEvents, callback: (...args: any[]) => void, target?: any): void {
        this.node.on(event, callback, target);
    }
    
    /**
     * 取消监听
     * 使用 Node 的 off 方法
     */
    off(event: GameStateEvents, callback?: (...args: any[]) => void, target?: any): void {
        this.node.off(event, callback, target);
    }
    
    /**
     * 一次性监听
     * 使用 Node 的 once 方法
     */
    once(event: GameStateEvents, callback: (...args: any[]) => void, target?: any): void {
        this.node.once(event, callback, target);
    }
    
    /**
     * 重置状态
     */
    reset(): void {
        console.log("重置游戏状态");
        
        this._currentState = GameState.RUNNING;
        this._previousState = GameState.RUNNING;
        this._pauseReason = '';
        this._timeScale = 1.0;
        
        this.resumeGameLogic('reset');
        
        // 触发状态重置事件
        this.node.emit(GameStateEvents.STATE_CHANGED, {
            newState: GameState.RUNNING,
            previousState: GameState.RUNNING,
            reason: 'reset'
        });
    }
    
    /**
     * 获取状态统计信息
     */
    getStats(): any {
        return {
            currentState: this._currentState,
            previousState: this._previousState,
            pauseReason: this._pauseReason,
            timeScale: this._timeScale,
            // nodePath: this.node.getPath()
        };
    }
    
    /**
     * 打印状态信息
     */
    printStateInfo(): void {
        console.log("=== 游戏状态信息 ===");
        console.log("当前状态:", this._currentState);
        console.log("之前状态:", this._previousState);
        console.log("暂停原因:", this._pauseReason || "无");
        console.log("时间缩放:", this._timeScale);
        console.log("运行状态:", this.isRunning ? "是" : "否");
        console.log("暂停状态:", this.isPaused ? "是" : "否");
        console.log("游戏结束:", this.isGameOver ? "是" : "否");
        console.log("===================");
    }
}