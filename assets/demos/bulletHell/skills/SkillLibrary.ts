/**
 * SkillLibrary.ts
 *
 * 负责维护可用技能列表并创建技能实例。
 */

import { ISkill } from './SkillTypes';
import {
    WhirlwindBroomSkill,
    HighPressureWaterGunSkill,
    TrashBagFieldSkill,
    VacuumVortexSkill,
    BubbleShieldSkill,
    StaticEmitterSkill,
    PurificationTowerSkill,
    EfficiencyExpertSkill,
    RecyclingSkill,
    SterileAuraSkill,
    SortingMasterSkill,
    CleaningRobotSkill,
    TrashGuardSkill,
    MopGhostSkill,
} from './SkillDefinitions';

export type SkillConstructor = new (level?: number) => ISkill;

/**
 * 可扩展的技能注册中心
 */
export class SkillLibrary {
    private static registry: Record<string, SkillConstructor> = {
        [WhirlwindBroomSkill.CONFIG.id]: WhirlwindBroomSkill,
        [HighPressureWaterGunSkill.CONFIG.id]: HighPressureWaterGunSkill,
        [TrashBagFieldSkill.CONFIG.id]: TrashBagFieldSkill,
        [VacuumVortexSkill.CONFIG.id]: VacuumVortexSkill,
        [BubbleShieldSkill.CONFIG.id]: BubbleShieldSkill,
        [StaticEmitterSkill.CONFIG.id]: StaticEmitterSkill,
        [PurificationTowerSkill.CONFIG.id]: PurificationTowerSkill,
        [EfficiencyExpertSkill.CONFIG.id]: EfficiencyExpertSkill,
        [RecyclingSkill.CONFIG.id]: RecyclingSkill,
        [SterileAuraSkill.CONFIG.id]: SterileAuraSkill,
        [SortingMasterSkill.CONFIG.id]: SortingMasterSkill,
        [CleaningRobotSkill.CONFIG.id]: CleaningRobotSkill,
        [TrashGuardSkill.CONFIG.id]: TrashGuardSkill,
        [MopGhostSkill.CONFIG.id]: MopGhostSkill,
    };

    public static create(skillId: string, level: number = 1): ISkill | null {
        const ctor = this.registry[skillId];
        if (!ctor) {
            console.warn(`[SkillLibrary] 未找到技能 ${skillId}`);
            return null;
        }
        return new ctor(level);
    }

    public static register(skillId: string, ctor: SkillConstructor): void {
        this.registry[skillId] = ctor;
    }

    public static getAvailableSkillIds(): string[] {
        return Object.keys(this.registry);
    }
}
