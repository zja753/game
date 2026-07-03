/**
 * 全局数值表 (M0 占位)。
 *
 * 设计:
 * - 任何"在游戏世界里影响手感"的魔数都应先落在这里,scene / 组件层只读不写。
 * - 后续 M1 (升级 / 词条) / M3 (敌人种类) 直接往本表追加常量,不必改调用方。
 *
 * M0.1 阶段只塞与 `Health` 相关的默认值,其它位留空等后续里程碑补齐。
 */

/** `Health` 组件默认无敌帧时长(秒)。`takeDamage` 成功扣血后会被重置成该值。 */
export const HEALTH_INVULNERABLE_DURATION_S = 0.4;

/**
 * 玩家血条(M0.2) —— 跟随玩家绘制,世界坐标。
 *
 * - `WIDTH / HEIGHT`:血条外框大小,玩家是 `PLAYER_SIZE` 见 `scene.ts`,宽度取 ~1.5x。
 * - `OFFSET_Y`:血条相对玩家中心的纵向偏移,正值向下;放在玩家头顶。
 * - `BG_COLOR`:血条"槽"色,深色画底;`FG_COLOR` 是当前血量比例的前景色。
 * - `BORDER_COLOR / BORDER_THICKNESS`:外框描边色与粗细。
 */
export const HEALTH_BAR_WIDTH = 72;
export const HEALTH_BAR_HEIGHT = 8;
export const HEALTH_BAR_OFFSET_Y = 36;
export const HEALTH_BAR_BG_COLOR = "#1b1d22";
export const HEALTH_BAR_FG_COLOR = "#e63946";
export const HEALTH_BAR_BORDER_COLOR = "#3a4150";
export const HEALTH_BAR_BORDER_THICKNESS = 2;

/**
 * 玩家受伤后整体 alpha 闪白(M0.2)。
 * - `FLASH_INTERVAL_S`:切换一次不透明度的时间间隔。
 * - `FLASH_OPACITY_ON` / `FLASH_OPACITY_OFF`:两种交替的目标 alpha。
 * 仅在 `Health.invulnerableTimer > 0` 期间生效。
 */
export const PLAYER_FLASH_INTERVAL_S = 0.1;
export const PLAYER_FLASH_OPACITY_ON = 1.0;
export const PLAYER_FLASH_OPACITY_OFF = 0.3;

/**
 * 敌人接触伤害 (M0.3) —— 玩家与 `Enemy` 发生 `collisionstart` 时,
 * `Enemy` 对玩家造成此数值伤害。后续 M3 敌人种类化后,
 * 不同敌人可以读这个值或覆写自己的 `contactDamage`。
 */
export const ENEMY_CONTACT_DAMAGE = 10;

/**
 * 武器 & 投射物 (M0.4) —— 单发 Pistol + 固定射程。
 *
 * 射程规则 (M0 锁定这套,后续不改):
 * - `WEAPON_RANGE_PX` 360 像素内的最近敌人会被锁定;找不到目标则不开火、不消耗节流。
 * - `WEAPON_FIRE_RATE_HZ` 默认 2 发/秒 → 节流窗口 0.5s,**只在成功开火后才推进**。
 * - `WEAPON_DAMAGE` 10 点;先放 Weapon 自己,M1 之后挪到更细的伤害表。
 */
export const WEAPON_RANGE_PX = 360;
export const WEAPON_FIRE_RATE_HZ = 2;
export const WEAPON_DAMAGE = 10;

/**
 * 敌人血量 (M0.4 / M0.6 共用) —— 30 点 = Pistol 三发必杀,与验证清单对齐。
 */
export const ENEMY_MAX_HP = 30;

/**
 * 投射物本体 (M0.4):
 * - `PROJECTILE_SPEED_PX`:子弹飞行速度(像素/秒,世界坐标),沿开火瞬间锁定的 dir 匀速。
 * - `PROJECTILE_LIFETIME_S`:超过这个时间自毁;同时 `range` 限制也会在位移超程时自毁,
 *   两个保险都保留 —— 任一触发即 `kill()`。
 * - `PROJECTILE_SIZE_PX` / `PROJECTILE_COLOR`:子弹的占位绘制尺寸与颜色,后续可换贴图。
 */
export const PROJECTILE_SPEED_PX = 600;
export const PROJECTILE_LIFETIME_S = 1.5;
export const PROJECTILE_SIZE_PX = 8;
export const PROJECTILE_COLOR = "#f9c74f";

/** 投射物命中墙的 tag(M0.4 也用 `wall` tag 兜底,后续 M3 改用真实墙体 collider)。 */
export const WALL_TAG = "wall";
/** 投射物命中敌人群体的 tag —— 简化命中分支。 */
export const ENEMY_TAG = "enemy";
/**
 * Game Over 浮层 (M0.5) —— DOM 半透明遮罩 + 面板 + 按钮。
 * 颜色与现有 HUD 调性一致,沿用 `app.css` 现有的色板。
 */
export const GAME_OVER_OVERLAY_BG = "rgba(11, 13, 18, 0.78)";
export const GAME_OVER_PANEL_BG = "#1b1d22";
export const GAME_OVER_PANEL_BORDER = "#3a4150";
export const GAME_OVER_TEXT_COLOR = "#ececec";
export const GAME_OVER_SUBTEXT_COLOR = "#9aa3b2";
export const GAME_OVER_BUTTON_BG = "#4cc9f0";
export const GAME_OVER_BUTTON_BG_HOVER = "#7ad7f5";
export const GAME_OVER_BUTTON_TEXT = "#0b0d12";
