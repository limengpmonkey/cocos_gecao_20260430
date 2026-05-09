// types.ts - 全局类型定义
import { _decorator } from 'cc';
const { ccclass, property } = _decorator;

@ccclass('SkillOption')
export class SkillOption {
    @property({ tooltip: "技能唯一ID" })
    id: string = '';

    @property({ tooltip: "技能显示名称" })
    name: string = '';

    @property({ tooltip: "技能描述" })
    description: string = '';

    @property({ tooltip: "技能图标资源名" })
    icon: string = '';

    @property({ type: Number, tooltip: "随机权重（越高越容易被选中，默认1）" })
    weight: number = 1;

    @property({ type: Number, tooltip: "解锁等级（默认1）" })
    unlockLevel: number = 1;

    @property({ type: Number, tooltip: "最大等级（默认无限）" })
    maxLevel: number = 0;

    @property({ tooltip: "技能分类（用于过滤）" })
    category: string = '';
}

export interface ExperienceEventData {
    amount: number;
    totalExp: number;
    source?: string;
}

export interface LevelUpEventData {
    newLevel: number;
    expToNextLevel: number;
}

export interface SkillSelectEventData {
    skillId: string;
    level: number;
}

export enum GameState {
    // 核心状态
    RUNNING = 'running',           // 游戏运行中
    PAUSED = 'paused',             // 游戏暂停（技能选择时）
    
    // 扩展状态
    MENU = 'menu',                 // 主菜单/设置菜单
    LOADING = 'loading',           // 加载中
    GAME_OVER = 'game_over',       // 游戏结束
    VICTORY = 'victory',           // 游戏胜利
    TRANSITION = 'transition'      // 状态过渡中
}