/**
 * `WeaponRegistry` — 武器规格表(plan/modules/combat.md §5 内部子模块 1)。
 *
 * 职责:把 `WeaponId` 映射到 `WeaponSpec`(`fireRate / damage / range /
 * projectileCount / spread`)。**只**放数据,不动逻辑。
 *
 * 第一版只注册 `pistol`(完全复刻土豆兄弟首关开局武器);后续改造
 * 往 `WEAPONS` 数组里加新条目即可。
 *
 * 设计原则:
 *  - **不**依赖 Excalibur;**不**持有 Actor / 池 —— 纯数据,单测不用起 Engine。
 *  - `WeaponSpec` 形状是稳定扩展面:M6 modifier / M5 enemy armor 等都在这加字段。
 *  - `baseCooldownMs = 1000 / fireRate` 在注册时算好(避免业务代码每帧除)。
 */
import type { WeaponId } from "../../../runtime/types";

/**
 * 武器规格(纯数据,plan §2 字段 + plan §5 内部子模块 1 描述)。
 *
 * 字段含义:
 *  - `fireRate`        — 射击频率(发/秒);Pistol = 4(每 250ms 一发)。
 *  - `damage`          — 单发伤害(命中时由 HitResolver 透传到 `projectile:hit.damage`)。
 *  - `range`           — 射程(像素);Pistol = 600。超过这个距离的敌人
 *                        **不**会被 `TargetSelector` 选中(plan §5 关键设计点:
 *                        "射程外不消耗节流")。
 *  - `projectileCount` — 一次开火打几发(霰弹武器用;Pistol = 1)。
 *  - `spread`          — 多发投射物的扇形散布角度(弧度);Pistol = 0。
 *  - `projectileSpeed` — 投射物速度(像素/秒);Pistol = 600(极速轻弹)。
 *  - `projectileLifetimeMs` — 投射物存活时间(毫秒);超过这个时间自动销毁,
 *                             避免"穿墙后永远飞"。
 *  - `baseCooldownMs`  — 派生:`1000 / fireRate`;Combat 在 tryFire 时用它判节流。
 */
export interface WeaponSpec {
  fireRate: number;
  damage: number;
  range: number;
  projectileCount: number;
  spread: number;
  projectileSpeed: number;
  projectileLifetimeMs: number;
  baseCooldownMs: number;
}

/**
 * `Pistol` 规格(plan §9 / 顶层路线 §3.4 — 第一版默认武器)。
 *
 * 数值参考土豆兄弟原版首关 Pistol:4 发/秒、单发 10 伤害、射程 600。
 */
const PISTOL_SPEC: WeaponSpec = {
  fireRate: 4,
  damage: 10,
  range: 600,
  projectileCount: 1,
  spread: 0,
  projectileSpeed: 600,
  projectileLifetimeMs: 1500,
  baseCooldownMs: 1000 / 4, // 250ms
};

/** 注册表:WeaponId → WeaponSpec。第一版只放 pistol。 */
const WEAPONS: Readonly<Record<WeaponId, WeaponSpec>> = {
  pistol: PISTOL_SPEC,
};

/** 全部已注册武器 ID(顺序固定,供 `listWeapons()` 用)。 */
const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

/**
 * 查表拿武器规格。
 * @returns `WeaponSpec` 引用;**不**做防御性拷贝(配置只读,没有 mutable state)。
 *          调用方**不**应改 spec 字段。
 */
export function getWeaponSpec(id: WeaponId): WeaponSpec {
  return WEAPONS[id];
}

/** 判断 `id` 是否已注册(Combat 内部 swapWeapon 防御用)。 */
export function hasWeapon(id: WeaponId): boolean {
  return id in WEAPONS;
}

/** 默认武器:第一把 = pistol。 */
export function defaultWeaponId(): WeaponId {
  return WEAPON_IDS[0];
}

/** 全部武器 ID 列表(`listWeapons()` 实现)。 */
export function listWeaponIds(): readonly WeaponId[] {
  return WEAPON_IDS;
}
