// StateDependentComponent.ts - 使用 Node 事件系统的状态依赖组件
import { _decorator, Component, Node } from 'cc';
import { GameStateManager, GameStateEvents } from './GameStateManager';

const { ccclass, property } = _decorator;

@ccclass('StateDependentComponent')
export class StateDependentComponent extends Component {
    // 是否在暂停时停止更新
    @property({ tooltip: "游戏暂停时是否停止更新" })
    stopUpdateOnPause: boolean = true;
    
    // 是否在暂停时停止固定更新
    @property({ tooltip: "游戏暂停时是否停止固定更新" })
    stopFixedUpdateOnPause: boolean = true;
    
    // 是否在暂停时停止后期更新
    @property({ tooltip: "游戏暂停时是否停止后期更新" })
    stopLateUpdateOnPause: boolean = true;
    
    // 是否在游戏结束时停止更新
    @property({ tooltip: "游戏结束时是否停止更新" })
    stopUpdateOnGameOver: boolean = true;
    
    onLoad(): void {
        // ✅ 通过 GameStateManager.inst.node 监听状态变化
        if (GameStateManager.inst) {
            GameStateManager.inst.node.on(GameStateEvents.STATE_CHANGED, this.onGameStateChanged, this);
        } else {
            console.warn(`${this.node.name}: GameStateManager 实例不存在，无法监听状态变化`);
        }
    }
    
    onDestroy(): void {
        // ✅ 取消监听状态变化
        if (GameStateManager.inst) {
            GameStateManager.inst.node.off(GameStateEvents.STATE_CHANGED, this.onGameStateChanged, this);
        }
    }
    
    /**
     * 游戏状态变化回调
     */
    protected onGameStateChanged(event: any): void {
        const { newState, previousState, reason } = event;
        console.log(`${this.node.name} 收到状态变化: ${previousState} -> ${newState} (原因: ${reason || "未知"})`);
        
        // 子类可以重写此方法
        this.onStateChanged(newState, previousState, reason);
    }
    
    /**
     * 状态变化处理（可被子类重写）
     */
    protected onStateChanged(newState: string, previousState: string, reason?: string): void {
        // 空实现，子类可重写
    }
    
    /**
     * 检查是否应该更新
     */
    protected shouldUpdate(): boolean {
        if (!this.stopUpdateOnPause) return true;
        
        if (!GameStateManager.inst) {
            console.warn(`${this.node.name}: GameStateManager 实例不存在，默认允许更新`);
            return true;
        }
        
        // 检查运行状态
        if (!GameStateManager.inst.isRunning) {
            return false;
        }
        
        // 检查游戏结束状态
        if (this.stopUpdateOnGameOver && GameStateManager.inst.isGameOver) {
            return false;
        }
        
        return true;
    }
    
    /**
     * 检查是否应该固定更新
     */
    protected shouldFixedUpdate(): boolean {
        if (!this.stopFixedUpdateOnPause) return true;
        
        if (!GameStateManager.inst) {
            console.warn(`${this.node.name}: GameStateManager 实例不存在，默认允许固定更新`);
            return true;
        }
        
        return GameStateManager.inst.isRunning;
    }
    
    /**
     * 检查是否应该后期更新
     */
    protected shouldLateUpdate(): boolean {
        if (!this.stopLateUpdateOnPause) return true;
        
        if (!GameStateManager.inst) {
            console.warn(`${this.node.name}: GameStateManager 实例不存在，默认允许后期更新`);
            return true;
        }
        
        return GameStateManager.inst.isRunning;
    }
    
    /**
     * 获取当前游戏状态
     */
    protected getGameState(): string | null {
        return GameStateManager.inst?.currentState || null;
    }
    
    /**
     * 获取暂停原因
     */
    protected getPauseReason(): string | null {
        return GameStateManager.inst?.pauseReason || null;
    }
}