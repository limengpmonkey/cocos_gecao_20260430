// PlayerSkillSystem.ts - 技能管理中间件
import { _decorator, Component, Node } from 'cc';
import { SkillSelectionSystem, SkillSelectionEvents } from './SkillSelectionSystem';
import { SkillSelectEventData } from './types';
import { SkillLibrary } from './skills/SkillLibrary';
import { SkillSlotType } from './skills/SkillTypes';
import { Player } from './player';

const { ccclass } = _decorator;

@ccclass('PlayerSkillSystem')
export class PlayerSkillSystem extends Component {
    // 技能等级映射
    private skillLevels: Map<string, number> = new Map();

    private findActiveSkillSlots(skillId: string): number[] {
        const player = Player.inst;
        if (!player?.skillManager) return [];

        const slots: number[] = [];
        for (let i = 0; i < player.skillManager.activeSlots.length; i++) {
            if (player.skillManager.activeSlots[i]?.id === skillId) {
                slots.push(i);
            }
        }
        return slots;
    }

    private findPassiveSkillSlots(skillId: string): number[] {
        const player = Player.inst;
        if (!player?.skillManager) return [];

        const slots: number[] = [];
        for (let i = 0; i < player.skillManager.passiveSlots.length; i++) {
            if (player.skillManager.passiveSlots[i]?.id === skillId) {
                slots.push(i);
            }
        }
        return slots;
    }

    private findSummonSkillSlots(skillId: string): number[] {
        const player = Player.inst;
        if (!player?.skillManager) return [];

        const slots: number[] = [];
        for (let i = 0; i < player.skillManager.summonSlots.length; i++) {
            if (player.skillManager.summonSlots[i]?.id === skillId) {
                slots.push(i);
            }
        }
        return slots;
    }

    private cleanupDuplicateSkills(skillId: string, slotType: SkillSlotType, keepSlotIndex: number): void {
        const player = Player.inst;
        if (!player?.skillManager) return;

        const duplicateSlots = slotType === SkillSlotType.Active
            ? this.findActiveSkillSlots(skillId)
            : slotType === SkillSlotType.Passive
                ? this.findPassiveSkillSlots(skillId)
                : [];

        for (const slotIndex of duplicateSlots) {
            if (slotIndex === keepSlotIndex) continue;
            player.skillManager.unequipSkill(slotType, slotIndex);
            console.log(`[PlayerSkillSystem] 移除重复技能：${skillId} 于槽位 ${slotType}[${slotIndex}]`);
        }
    }

    private resolveEquipSlot(skillId: string, slotType: SkillSlotType): number {
        const player = Player.inst;
        if (!player?.skillManager) return 0;

        if (slotType === SkillSlotType.Active) {
            const existingSlots = this.findActiveSkillSlots(skillId);
            if (existingSlots.length > 0) {
                return existingSlots[0];
            }

            const emptySlot = player.skillManager.activeSlots.findIndex(s => s === null);
            return emptySlot >= 0 ? emptySlot : 0;
        }

        if (slotType === SkillSlotType.Passive) {
            const existingSlots = this.findPassiveSkillSlots(skillId);
            if (existingSlots.length > 0) {
                return existingSlots[0];
            }

            const emptySlot = player.skillManager.passiveSlots.findIndex(s => s === null);
            return emptySlot >= 0 ? emptySlot : 0;
        }

        if (slotType === SkillSlotType.Summon) {
            const existingSlots = this.findSummonSkillSlots(skillId);
            if (existingSlots.length > 0) {
                return existingSlots[0];
            }

            const emptySlot = player.skillManager.summonSlots.findIndex(s => s === null);
            return emptySlot >= 0 ? emptySlot : 0;
        }

        return 0;
    }
    
    onLoad(): void {
        // 监听技能选择事件（SkillSelectionSystem 可能尚未初始化）
        this.tryBindSkillSelectionListener();
    }
    
    onDestroy(): void {
        SkillSelectionSystem.inst?.off(SkillSelectionEvents.ON_SKILL_SELECT, this.onSkillSelect, this);
        this.unschedule(this.tryBindSkillSelectionListener);
    }

    /**
     * 如果 SkillSelectionSystem 尚未初始化，则持续尝试绑定监听。
     */
    private tryBindSkillSelectionListener(): void {
        if (!SkillSelectionSystem.inst) {
            // 0.1 秒后重试
            this.scheduleOnce(this.tryBindSkillSelectionListener, 1);
            return;
        }

        SkillSelectionSystem.inst.on(SkillSelectionEvents.ON_SKILL_SELECT, this.onSkillSelect, this);
        console.log('[PlayerSkillSystem] 已绑定技能选择事件');
    }
    
    /**
     * 处理技能选择
     */
    private onSkillSelect(event: SkillSelectEventData): void {
        const skillId = event.skillId;
        const currentLevel = this.skillLevels.get(skillId) || 0;
        const skillPreview = SkillLibrary.create(skillId, 1);
        const maxLevel = skillPreview?.config.maxLevel ?? 10;
        const newLevel = SkillSelectionSystem.inst?.resolveGrantedSkillLevel(currentLevel, maxLevel)
            ?? Math.min(maxLevel, currentLevel + 1);
        
        // 更新技能等级
        this.skillLevels.set(skillId, newLevel);
        
        console.log(`技能 ${skillId} 升级到 ${newLevel} 级`);
        
        // 应用技能效果
        this.applySkillEffect(skillId, newLevel);
    }
    
    /**
     * 应用技能效果
     */
    private applySkillEffect(skillId: string, level: number): void {
        const player = Player.inst;
        if (!player || !player.skillManager) {
            console.warn('[PlayerSkillSystem] 无法应用技能效果，玩家或技能管理器不存在');
            return;
        }

        // 将技能装配到合适的槽位
        const skill = SkillLibrary.create(skillId, level);
        if (!skill) return;

        const slotType = skill.config.slotType as SkillSlotType;
        const slotIndex = this.resolveEquipSlot(skillId, slotType);

        player.skillManager.equipSkill(skillId, level, slotType, slotIndex);

        if (slotType === SkillSlotType.Active || slotType === SkillSlotType.Passive) {
            this.cleanupDuplicateSkills(skillId, slotType, slotIndex);
        }

        console.log(`[PlayerSkillSystem] 装备技能：${skill.config.name} (Lv${level}) 到槽位 ${slotType}[${slotIndex}]`);
    }
    
    /**
     * 获取技能等级
     */
    getSkillLevel(skillId: string): number {
        return this.skillLevels.get(skillId) || 0;
    }
}