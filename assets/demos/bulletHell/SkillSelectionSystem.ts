// SkillSelectionSystem.ts - 技能选择系统
import { _decorator,tween, Component, Node, Label, Button, instantiate, Prefab,v3, UIOpacity } from 'cc';
import { ExperienceSystem, ExperienceEvents } from './ExperienceSystem';
import { GameStateManager } from './GameStateManager';
import { SkillOption, SkillSelectEventData, LevelUpEventData } from './types';
import { SkillLibrary } from './skills/SkillLibrary';
import { SkillOptionButton } from './SkillOptionButton';
import { BulletHell } from './bulletHell';

declare const cc: {
    tween: (target: any) => any;
    v3: (x: number, y: number, z: number) => any;
    // 如果用到其他模块，也可以加，比如 Node, Vec3 等
};

const { ccclass, property } = _decorator;

// 技能选择事件常量
export enum SkillSelectionEvents {
    ON_SKILL_SELECT = 'on-skill-select',
    ON_SELECTION_SHOW = 'on-selection-show',
    ON_SELECTION_HIDE = 'on-selection-hide'
}

class SkillSelectionEventEmitter {
    private listeners: Map<string, Array<{ callback: (...args: any[]) => void, target?: any }>> = new Map();

    on(event: string, callback: (...args: any[]) => void, target?: any) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event)!.push({ callback, target });
    }

    off(event: string, callback?: (...args: any[]) => void, target?: any) {
        if (!this.listeners.has(event)) return;
        if (!callback) {
            this.listeners.delete(event);
            return;
        }
        const arr = this.listeners.get(event);
        this.listeners.set(event, arr!.filter(listener =>
            listener.callback !== callback || (target && listener.target !== target)
        ));
    }

    emit(event: string, ...args: any[]) {
        if (!this.listeners.has(event)) return;
        for (const listener of this.listeners.get(event)!) {
            listener.callback.apply(listener.target, args);
        }
    }
}

@ccclass('SkillSelectionSystem')
export class SkillSelectionSystem extends Component {
    // 单例
    private static _inst: SkillSelectionSystem = null;
    static get inst(): SkillSelectionSystem { return this._inst; }
    
    // UI属性
    @property(Node)
    selectionPanel: Node = null;
    
    @property(Prefab)
    skillOptionPrefab: Prefab = null;
    
    @property(Node)
    optionsContainer: Node = null;

    @property(Node)
    bgNode: Node = null;  // 背景遮罩节点（用于淡入淡出）
    
    @property(Label)
    levelLabel: Label = null;
    
    // 技能池配置（数据驱动）
    @property({ type: [SkillOption], tooltip: "可配置的技能池，编辑器中设置" })
    skillPool: SkillOption[] = [];

    /**
     * 【测试用】强制指定弹窗中出现的技能 ID
     */
    @property({ type: [String], tooltip: "【测试】强制出现的技能 ID，按顺序填入选项槽，剩余槽位随机。留空=完全随机" })
    debugForcedSkillIds: string[] = [];

    /**
     * 强制技能轮转起点。
     */
    private debugForcedCursor: number = 0;

    private _pendingLevelQueue: number[] = [];
    private _isLevelSelectionShowing = false;
    private _nextQueuedSelectionCallback: (() => void) | null = null;
    private _retrySetupListenerCallback: (() => void) | null = null;
    private _isLevelListenerBound: boolean = false;
    private _pausedGameForSelection: boolean = false;

    // 事件系统
    private _eventTarget: SkillSelectionEventEmitter = new SkillSelectionEventEmitter();

    onLoad(): void {
        SkillSelectionSystem._inst = this;
    }
    
    start(): void {
        this.setupEventListeners();
    }

    onDestroy(): void {
        this._cleanupAll();
        SkillSelectionSystem._inst = null;
    }

    private _cleanupAll(): void {
        // 清理所有回调
        if (this._nextQueuedSelectionCallback) {
            this.unschedule(this._nextQueuedSelectionCallback);
            this._nextQueuedSelectionCallback = null;
        }
        if (this._retrySetupListenerCallback) {
            this.unschedule(this._retrySetupListenerCallback);
            this._retrySetupListenerCallback = null;
        }
        
        // 停止所有动画
        this._stopPanelTweens();

        this._resumeGameplayIfNeeded();
        
        this.removeEventListeners();
    }

    /**
     * 设置事件监听器
     */
    private setupEventListeners(): void {
        if (!ExperienceSystem.inst) {
            console.warn("ExperienceSystem 实例不存在，稍后重试监听升级事件");

            if (!this._retrySetupListenerCallback) {
                this._retrySetupListenerCallback = () => {
                    this._retrySetupListenerCallback = null;
                    this.setupEventListeners();
                };
                this.scheduleOnce(this._retrySetupListenerCallback, 0.2);
            }
            return;
        }

        if (this._isLevelListenerBound) {
            return;
        }
        
        console.log("SkillSelectionSystem 开始监听升级事件...");
        
        ExperienceSystem.inst.node.on(ExperienceEvents.ON_LEVEL_UP, this.onLevelUp, this);
        this._isLevelListenerBound = true;
        
        console.log(`是否已监听: ${ExperienceSystem.inst.node.hasEventListener(ExperienceEvents.ON_LEVEL_UP)}`);
    }

    /**
     * 移除事件监听器
     */
    private removeEventListeners(): void {
        if (ExperienceSystem.inst) {
            ExperienceSystem.inst.node.off(ExperienceEvents.ON_LEVEL_UP, this.onLevelUp, this);
        }
        this._isLevelListenerBound = false;
    }

    /**
     * 升级时触发技能选择
     */
    private onLevelUp(event: LevelUpEventData): void {
        console.log(`收到升级事件，等级: ${event.newLevel}`);

        this._pendingLevelQueue.push(event.newLevel);
        this.tryShowNextQueuedLevelSelection();
    }

    private tryShowNextQueuedLevelSelection(): void {
        if (this._isLevelSelectionShowing || this._pendingLevelQueue.length <= 0) {
            return;
        }

        const nextLevel = this._pendingLevelQueue.shift();
        const skillOptions = this.generateSkillOptions(3, nextLevel);
        this.show(skillOptions, nextLevel);
    }
    
    /**
     * 生成技能选项（数据驱动版本）
     */
    private generateSkillOptions(count: number, currentLevel: number = 1): SkillOption[] {
        console.log(`生成 ${count} 个技能选项，当前等级: ${currentLevel}`);

        let availableSkills = this.skillPool.length > 0 ? this.skillPool : this.getDefaultSkillPool();

        // 过滤解锁的技能
        availableSkills = availableSkills.filter(skill => {
            const unlockLevel = skill.unlockLevel || 1;
            return currentLevel >= unlockLevel;
        });

        // 过滤掉在 SkillLibrary 中不存在的技能
        const validSkillIds = new Set(SkillLibrary.getAvailableSkillIds());
        availableSkills = availableSkills.filter(skill => {
            if (!validSkillIds.has(skill.id)) {
                console.warn(`[SkillSelectionSystem] 技能 ID 未注册: ${skill.id}`);
                return false;
            }
            return true;
        });
        
        if (availableSkills.length === 0) {
            console.warn("没有可用的技能选项");
            return [];
        }

        const selected: SkillOption[] = [];
        const usedIds = new Set<string>();

        // 【测试】优先填入 debugForcedSkillIds 指定的技能
        if (this.debugForcedSkillIds.length > 0) {
            const allPool = this.getDefaultSkillPool();
            const forcedIds = this.debugForcedSkillIds;
            const forcedCount = forcedIds.length;

            for (let i = 0; i < forcedCount && selected.length < count; i++) {
                const forcedIndex = (this.debugForcedCursor + i) % forcedCount;
                const forcedId = forcedIds[forcedIndex];
                if (selected.length >= count) break;
                if (usedIds.has(forcedId)) continue;
                if (!validSkillIds.has(forcedId)) {
                    console.warn(`[SkillSelectionSystem] debugForcedSkillIds 中的技能 ID 未注册: ${forcedId}`);
                    continue;
                }
                const found = allPool.find(s => s.id === forcedId);
                if (found) {
                    selected.push(found);
                    usedIds.add(forcedId);
                }
            }

            if (forcedCount > 0) {
                this.debugForcedCursor = (this.debugForcedCursor + Math.max(1, count)) % forcedCount;
            }
        }

        // 剩余槽位用权重随机填充
        while (selected.length < count && selected.length < availableSkills.length) {
            const skill = this.selectSkillByWeight(availableSkills, usedIds);
            if (skill) {
                selected.push(skill);
                usedIds.add(skill.id);
            } else {
                break;
            }
        }

        console.log(`生成的技能选项: ${selected.map(s => s.name).join(', ')}`);
        return selected;
    }
    
    /**
     * 基于权重随机选择技能
     */
    private selectSkillByWeight(skills: SkillOption[], excludeIds: Set<string>): SkillOption | null {
        let totalWeight = 0;
        const candidates = skills.filter(skill => !excludeIds.has(skill.id));
        
        for (const skill of candidates) {
            totalWeight += skill.weight || 1;
        }
        
        if (totalWeight === 0) return null;
        
        let random = Math.random() * totalWeight;
        for (const skill of candidates) {
            random -= skill.weight || 1;
            if (random <= 0) {
                return skill;
            }
        }
        
        return candidates[candidates.length - 1];
    }
    
    /**
     * 获取默认技能池
     */
    private getDefaultSkillPool(): SkillOption[] {
        const skillIds = SkillLibrary.getAvailableSkillIds();
        const skillOptions: SkillOption[] = [];

        for (const id of skillIds) {
            const skill = SkillLibrary.create(id, 1);
            if (!skill) continue;

            const config = (skill as any).config;
            if (!config) continue;

            skillOptions.push({
                id: config.id,
                name: config.name,
                description: config.description,
                icon: config.icon || '',
                weight: 1,
                unlockLevel: 1,
                maxLevel: config.maxLevel || 0,
                category: config.category || ''
            });
        }

        return skillOptions;
    }
    
    /**
     * 显示技能选择界面
     */
    show(options: SkillOption[], level: number): void {
        console.log(`========== 开始显示技能选择界面 ==========`);
        console.log(`等级: ${level}`);
        console.log(`选项数量: ${options.length}`);
        console.log(`selectionPanel 是否存在: ${!!this.selectionPanel}`);
        console.log(`selectionPanel 激活状态: ${this.selectionPanel?.active}`);
        console.log(`skillOptionPrefab 是否存在: ${!!this.skillOptionPrefab}`);
        console.log(`========================================`);
        
        if (!this.selectionPanel) {
            console.error("❌ selectionPanel 未绑定，无法显示技能选择界面");
            return;
        }
        if (!this.skillOptionPrefab) {
            console.error("❌ skillOptionPrefab 未绑定，无法创建技能卡片");
            return;
        }

        const container = this.optionsContainer || this.selectionPanel;
        if (!this.optionsContainer) {
            console.warn("⚠️ optionsContainer 未绑定，回退使用 selectionPanel 作为卡片容器");
        }

        this._isLevelSelectionShowing = true;
        this._pauseGameplayForSelection();

        // 立即激活面板
        this.selectionPanel.active = true;
        if (this.selectionPanel.parent) {
            this.selectionPanel.setSiblingIndex(this.selectionPanel.parent.children.length - 1);
        }
        console.log(`✅ 已激活 selectionPanel: ${this.selectionPanel.active}`);

        // 重置可见状态，避免 hide() 退场动画后残留透明度/缩放导致面板不可见。
        if (this.bgNode) {
            const bgOpacity = this.bgNode.getComponent(UIOpacity) || this.bgNode.addComponent(UIOpacity);
            bgOpacity.opacity = 255;
        }
        if (this.optionsContainer) {
            this.optionsContainer.setScale(1, 1, 1);
            const containerOpacity = this.optionsContainer.getComponent(UIOpacity) || this.optionsContainer.addComponent(UIOpacity);
            containerOpacity.opacity = 255;
        }
        
        // 显示当前等级
        if (this.levelLabel) {
            this.levelLabel.string = `等级 ${level}`;
        }
        
        // 清空现有选项
        container.removeAllChildren();
        
        // 创建技能选项
        options.forEach((option, index) => {
            const optionNode = instantiate(this.skillOptionPrefab);
            container.addChild(optionNode);
            this._animateCardIn(optionNode, index);
            this.setupOptionNode(optionNode, option, index);
            console.log(`✅ 创建技能选项 ${index}: ${option.name}`);
        });
        
        // 触发显示事件
        this._eventTarget.emit(SkillSelectionEvents.ON_SELECTION_SHOW, { level });
        console.log("✅ 技能选择界面显示完成");
    }
    
    /**
     * 隐藏界面
     */
    hide(): void {
        console.log("隐藏技能选择界面");
        this._isLevelSelectionShowing = false;
        this._resumeGameplayIfNeeded();

        if (!this.selectionPanel) {
            this._afterHideCleanup();
            return;
        }

        // 触发隐藏事件
        this._eventTarget.emit(SkillSelectionEvents.ON_SELECTION_HIDE);

        // 面板未激活时跳过动画
        if (!this.selectionPanel.active) {
            this._afterHideCleanup();
            return;
        }

        this._stopPanelTweens();

        // 退场动画
        let pendingCount = 0;
        const onOneDone = () => {
            pendingCount--;
            if (pendingCount <= 0) {
                this.selectionPanel.active = false;
                this._afterHideCleanup();
            }
        };

        if (this.bgNode) {
            const bgOpacity = this.bgNode.getComponent(UIOpacity);
            if (bgOpacity) {
                pendingCount++;
                tween(bgOpacity)
                    .to(0.2, { opacity: 0 })
                    .call(onOneDone)
                    .start();
            }
        }

        if (this.optionsContainer) {
            pendingCount++;
            const cOpacity = this.optionsContainer.getComponent(UIOpacity);
            if (cOpacity) {
                tween(cOpacity)
                    .to(0.15, { opacity: 0 })
                    .start();
            }
            
            tween(this.optionsContainer)
                .to(0.2, { scale: v3(0.85, 0.85, 1) }, { easing: 'cubicIn' })
                .call(onOneDone)
                .start();
        }

        if (pendingCount === 0) {
            this.selectionPanel.active = false;
            this._afterHideCleanup();
        }
    }

    /** hide 动画结束后的后续逻辑 */
    private _afterHideCleanup(): void {
        if (this._pendingLevelQueue.length > 0) {
            if (this._nextQueuedSelectionCallback) {
                this.unschedule(this._nextQueuedSelectionCallback);
            }
            this._nextQueuedSelectionCallback = () => {
                this._nextQueuedSelectionCallback = null;
                this.tryShowNextQueuedLevelSelection();
            };
            this.scheduleOnce(this._nextQueuedSelectionCallback, 0.12);
        }
    }

    /** 每张卡片独立入场动画 */
    private _animateCardIn(cardNode: Node, index: number): void {
        cardNode.setScale(0.6, 0.6, 1);
        const cardOpacity = cardNode.getComponent(UIOpacity) || cardNode.addComponent(UIOpacity);
        cardOpacity.opacity = 0;
        
        tween(cardNode)
            .delay(0.15 + index * 0.07)
            .to(0.28, { scale: v3(1, 1, 1) }, { easing: 'backOut' })
            .start();
            
        tween(cardOpacity)
            .delay(0.15 + index * 0.07)
            .to(0.2, { opacity: 255 })
            .start();
    }
    
    /**
     * 技能被选中
     */
    private onSkillSelected(skillId: string): void {
        console.log(`选择了技能: ${skillId}`);
        
        this._eventTarget.emit(SkillSelectionEvents.ON_SKILL_SELECT, {
            skillId: skillId,
            level: ExperienceSystem.inst?.currentLevel || 1
        } as SkillSelectEventData);
        
        this.hide();
    }

    /**
     * 公开方法：可通过 UI Button 事件绑定调用
     */
    public selectSkill(skillId: string): void {
        this.onSkillSelected(skillId);
    }

    private _pauseGameplayForSelection(): void {
        BulletHell.inst?.joystick?.setInputEnabled(false);

        if (this._pausedGameForSelection) {
            return;
        }

        const gameStateManager = GameStateManager.inst;
        if (!gameStateManager) {
            console.warn('[SkillSelectionSystem] GameStateManager 不存在，无法暂停游戏');
            return;
        }

        if (gameStateManager.isPaused) {
            console.log(`[SkillSelectionSystem] 游戏已处于暂停状态，原因: ${gameStateManager.pauseReason || 'unknown'}`);
            return;
        }

        this._pausedGameForSelection = gameStateManager.pauseGame('skill_selection');
    }

    private _resumeGameplayIfNeeded(): void {
        BulletHell.inst?.joystick?.setInputEnabled(true);

        if (!this._pausedGameForSelection) {
            return;
        }

        const gameStateManager = GameStateManager.inst;
        this._pausedGameForSelection = false;

        if (!gameStateManager) {
            return;
        }

        if (!gameStateManager.isPaused) {
            return;
        }

        if (gameStateManager.pauseReason !== 'skill_selection') {
            console.log(`[SkillSelectionSystem] 当前暂停原因已变更为 ${gameStateManager.pauseReason || 'unknown'}，跳过恢复`);
            return;
        }

        gameStateManager.resumeGame();
    }
    
    /**
     * 设置技能选项节点
     */
    private setupOptionNode(node: Node, option: SkillOption, index: number): void {
        console.log(`设置技能选项节点 ${index}: ${option.name}`);
        
        // 优先使用 SkillOptionButton 组件进行自动绑定
        const optionButton = node.getComponent(SkillOptionButton) || node.getComponentInChildren(SkillOptionButton);
        if (optionButton) {
            optionButton.bind(option.id, this);
            return;
        }

        // 备用方案：手动查找 Button 并绑定回调
        const buttonComponent = node.getComponent(Button) || node.getComponentInChildren(Button);
        if (buttonComponent) {
            buttonComponent.node.on(Button.EventType.CLICK, () => {
                this.onSkillSelected(option.id);
            }, this);
        } else {
            console.warn(`选项节点 ${index} 缺少 Button 组件`);
        }
    }
    
    /**
     * 监听技能选择事件
     */
    on(event: SkillSelectionEvents, callback: (...args: any[]) => void, target?: any): void {
        this._eventTarget.on(event, callback, target);
    }

    /**
     * 取消监听技能选择事件
     */
    off(event: SkillSelectionEvents, callback?: (...args: any[]) => void, target?: any): void {
        this._eventTarget.off(event, callback, target);
    }
    
    /**
     * 手动触发技能选择
     */
    public triggerSkillSelection(count: number = 3, level?: number): void {
        const currentLevel = level || ExperienceSystem.inst?.currentLevel || 1;
        const skillOptions = this.generateSkillOptions(count, currentLevel);
        this.show(skillOptions, currentLevel);
    }

    public triggerBossRewardSelection(count: number = 4): void {
        const realLevel = ExperienceSystem.inst?.currentLevel || 1;
        const rewardLevel = realLevel + 2;
        const optionCount = Math.max(3, count);
        const skillOptions = this.generateSkillOptions(optionCount, rewardLevel);
        this.show(skillOptions, realLevel);
    }

    /**
     * 停止面板动画
     */
    private _stopPanelTweens(): void {
        const container = this.optionsContainer || this.selectionPanel;

        // if (this.bgNode) {
        //     tween.stopAllByTarget(this.bgNode);
        //     const bgOpacity = this.bgNode.getComponent(UIOpacity);
        //     if (bgOpacity) tween.stopAllByTarget(bgOpacity);
        // }

        // if (container) {
        //     tween.stopAllByTarget(container);
        //     const cOpacity = container.getComponent(UIOpacity);
        //     if (cOpacity) tween.stopAllByTarget(cOpacity);
        // }
    }
}