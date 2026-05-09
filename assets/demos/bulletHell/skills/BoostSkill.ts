/**
 * BoostSkill.ts
 *
 * 增益技能基类：语义上区别于普通被动技能。
 * 目前仍复用被动槽位与生命周期，后续可扩展专属槽位或专属 UI 过滤。
 */

import { PassiveSkill } from './PassiveSkill';

export abstract class BoostSkill extends PassiveSkill {}
