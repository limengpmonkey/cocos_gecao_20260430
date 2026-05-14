/**
 * SkillUtils.ts
 *
 * 技能系统通用工具函数。
 *
 * 使用示例：
 *   // 随机方向发射 5 颗子弹（无扇形）
 *   const dirs = fanDirections(5, randomAngle(), 0);
 *
 *   // 以随机朝向展开 90° 扇形（7 颗子弹）
 *   const dirs = fanDirections(7, randomAngle(), Math.PI / 2);
 *
 *   // 朝目标方向展开 60° 扇形
 *   const base = directionToTarget(owner.worldPosition, target);
 *   const dirs = fanDirections(3, base, Math.PI / 3);
 */

import { Vec3 } from 'cc';

// -------------------------
// 角度 / 方向基础工具
// -------------------------

/** 返回 [0, 2π) 内的随机弧度 */
export function randomAngle(): number {
    return Math.random() * Math.PI * 2;
}

/** 将角度弧度转换为 2D 单位方向向量 */
export function angleToDir(angle: number): Vec3 {
    return new Vec3(Math.cos(angle), Math.sin(angle), 0);
}

/** 返回随机的 2D 单位方向向量 */
export function randomDirection(): Vec3 {
    return angleToDir(randomAngle());
}

/**
 * 计算从 from 朝向 to 的 2D 方向（已归一化）。
 * 当 to 不存在或与 from 重合时，返回随机方向。
 */
export function directionToTarget(from: Vec3, to?: Vec3): Vec3 {
    if (!to) return randomDirection();
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 1e-6) return randomDirection();
    const inv = 1 / Math.sqrt(lenSq);
    return new Vec3(dx * inv, dy * inv, 0);
}

/** 从起点沿方向偏移固定距离，返回新的世界坐标。 */
export function offsetAlongDirection(origin: Vec3, direction: Vec3, distance: number): Vec3 {
    return new Vec3(
        origin.x + direction.x * distance,
        origin.y + direction.y * distance,
        origin.z
    );
}

// -------------------------
// 扇形方向数组生成
// -------------------------

/**
 * 生成一组扇形排列的方向向量。
 *
 * @param count       投射物数量（≥1）
 * @param baseAngle   扇面中心角度（弧度）。传入 randomAngle() 即可随机朝向。
 * @param spreadAngle 扇面总张角（弧度）。0 表示所有子弹同向，Math.PI/2 表示 90° 扇面。
 * @returns           长度为 count 的归一化 Vec3 数组
 *
 * @example
 *   // 7颗子弹、随机朝向、90° 扇面
 *   const dirs = fanDirections(7, randomAngle(), Math.PI / 2);
 *
 *   // 朝向目标的 60° 三叉投射
 *   const base = Math.atan2(dy, dx);
 *   const dirs = fanDirections(3, base, Math.PI / 3);
 */
export function fanDirections(count: number, baseAngle: number, spreadAngle: number = 0): Vec3[] {
    const dirs: Vec3[] = [];
    for (let i = 0; i < count; i++) {
        const offset = count === 1 ? 0 : (i / (count - 1) - 0.5) * spreadAngle;
        dirs.push(angleToDir(baseAngle + offset));
    }
    return dirs;
}

/**
 * 生成一组均匀分布在 360° 圆周上的方向向量。
 *
 * @param count      投射物数量（≥1）
 * @param baseAngle  起始角偏移（弧度），默认为随机值
 * @returns          长度为 count 的归一化 Vec3 数组
 *
 * @example
 *   // 8 方向均匀散射
 *   const dirs = circularDirections(8);
 */
export function circularDirections(count: number, baseAngle?: number): Vec3[] {
    const start = baseAngle ?? randomAngle();
    const step = (Math.PI * 2) / count;
    return Array.from({ length: count }, (_, i) => angleToDir(start + i * step));
}
