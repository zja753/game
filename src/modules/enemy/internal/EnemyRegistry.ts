/**
 * `EnemyRegistry` — 敌人种类 → 配置(plan/modules/enemy.md §5 内部子模块 1)。
 *
 * 职责:
 *  - 把"种类字符串"(`EnemyKind`)映射成 `EnemySpec`(速度 / HP / 接触伤害 /
 *    行为策略 id / XP 奖励等纯数据配置)。
 *  - 第一版只放 `chaser`,完全复刻土豆兄弟首关。
 *  - 行为策略用**字符串 id**索引(`BehaviorId`),由 `BehaviorStrategy` 工厂
 *    在装配阶段根据 id 解析;这样 `EnemySpec` 保持纯数据、可被序列化 /
 *    跨进程传输(未来用于"关卡文件"配置)。
 *
 * 关键不变量:
 *  - 注册表**只**在模块启动时调一次 `register`;之后**只读**,
 *    拿 `get` / `has` / `listIds` 查询。
 *  - `BehaviorId` 是**协议层**字面量联合(roadmap §3.5:不预设具体敌人实现,
 *    留 string 兜底),本文件是**唯一**把它收紧成字面量的地方。
 *  - `xpReward` 字段供 Combat 广播 `enemy:killed` 时填充 xp(M5 之前
 *    `HitResolver` 给的 xp = 0,M5 起从这里读)。
 */
import type { ActorId, EnemyKind, Vec2 } from "../../../runtime/types";

/**
 * 行为策略 id(plan §5 内部子模块 2:`BehaviorStrategy` 工厂的 key)。
 *
 * 字符串字面量联合 —— 留 `string` 兜底,新增策略时在这里加字面量。
 */
// eslint-disable-next-line typescript/no-redundant-type-constituents -- 第一版只放 chaser;roadmap §3.5 明确"不预设具体行为实现",留 string 兜底供后续模块按字面量扩展
export type BehaviorId = "chaser" | string;

/**
 * 敌人种类规格(纯数据;不持 Actor 引用,不持 Port 引用)。
 *
 * 字段语义:
 *  - `speed`:行为策略默认速度(像素/秒);行为策略可自己 ignore(比如
 *    `shooter` 行为可能只读 `fireRate` 不移动)。
 *  - `maxHp`:初始 HP;`applyDamage` 走 EnemyPort 内部表,`EnemyActor`
 *    在 spawn 时拉这个值。
 *  - `contactDamage`:与玩家接触时的伤害值;Enemy 模块的 `ContactDamage`
 *    内部用这个字段。
 *  - `xpReward`:被击杀时给 Progression 的经验值;`enemy:killed` 事件
 *    payload 里带这个值,Progression 监听者自己累加(plan §7 关键设计点:
 *    "xp 来源 = Enemy 模块的 EnemySpec",Combat **不**存 xp)。
 *  - `behavior`:行为策略 id,`BehaviorStrategy` 工厂按它解析。
 */
export interface EnemySpec {
  /** 行为策略 id(给 `BehaviorStrategy` 工厂解析)。 */
  behavior: BehaviorId;
  /** 默认移动速度(像素/秒)。 */
  speed: number;
  /** 初始 / 最大 HP。 */
  maxHp: number;
  /** 接触玩家时的单次伤害。 */
  contactDamage: number;
  /** 被击杀时奖励给 Progression 的经验值。 */
  xpReward: number;
  /** 调试 / 日志用标签,渲染层可选读。 */
  label: string;
}

/**
 * 行为策略帧驱动的"上下文" — 行为策略只读这张表,自己**不**缓存任何
 * 内部状态(状态 = vel / hp 等全在 `EnemyActor` 上持)。
 *
 * 设计原则:行为策略是**纯函数**(`tick(args) → Vec2 vel`),便于单测
 * + 后续以"策略注册表"的方式扩展新行为。
 */
export interface BehaviorContext {
  /** 当前逻辑时间(毫秒,来自 RuntimePort.now())。 */
  now: number;
  /** 帧 delta(毫秒),从 `onTick` 透传。 */
  dt: number;
  /** 敌人自身位姿(只读快照,行为策略**不**直接改;通过返回 vel 改)。 */
  self: { id: ActorId; kind: EnemyKind; pos: Vec2; hp: number };
  /** 玩家位姿(只读);`null` 表示"无玩家"(极端 / 调试场景)。 */
  player: { id: ActorId; pos: Vec2 } | null;
}

/**
 * `BehaviorStrategy` — 单个行为策略对象(plan §5 内部子模块 2)。
 *
 * - `tick(ctx) → Vec2 vel`:行为策略决定敌人这一帧的速度向量。
 * - 行为策略**只**返回 vel,实际位移由 `EnemyActor` 撞墙处理
 *   (与 `PlayerMover` 一样的轴分离思路)。
 */
export interface BehaviorStrategy {
  /** 该策略的 id(注册到 `BehaviorStrategy` 工厂时用)。 */
  readonly id: BehaviorId;
  /**
   * 帧驱动:返回这一帧的目标速度(像素/秒)。
   *
   * 返回 `{x:0, y:0}` 表示"原地不动"(比如 `Chaser` 在失去玩家时)。
   */
  tick(ctx: BehaviorContext): Vec2;
}

/** 内部注册表:`EnemyKind → EnemySpec`。 */
const specs = new Map<EnemyKind, EnemySpec>();

/** 内部策略工厂注册表:`BehaviorId → BehaviorStrategy`。 */
const behaviors = new Map<BehaviorId, BehaviorStrategy>();

/**
 * 注册一个敌人种类(模块启动时调一次)。
 *
 * 重复注册同 `kind` = 覆盖(单测里能 reload 同一个 spec)。生产代码
 * 不会重复注册,只走"模块启动一次"路径。
 */
export function registerEnemySpec(kind: EnemyKind, spec: EnemySpec): void {
  specs.set(kind, spec);
}

/**
 * 注册一个行为策略(模块启动时调一次)。
 *
 * 同 `BehaviorId` 重复注册 = 覆盖(便于单测 reload)。
 */
export function registerBehavior(strategy: BehaviorStrategy): void {
  behaviors.set(strategy.id, strategy);
}

/** 查 spec;未注册返回 `null`(由调用方决定 no-op 还是 throw)。 */
export function getEnemySpec(kind: EnemyKind): EnemySpec | null {
  return specs.get(kind) ?? null;
}

/** 查 spec;未注册抛错(供"必须存在"路径用,比如 `spawn` 接受 `EnemyKind`
 *  后需要做合法性校验)。 */
export function requireEnemySpec(kind: EnemyKind): EnemySpec {
  const s = specs.get(kind);
  if (!s) {
    throw new Error(`[Enemy] Unknown EnemyKind "${String(kind)}" (not registered)`);
  }
  return s;
}

/** 查行为策略;未注册抛错。 */
export function requireBehavior(id: BehaviorId): BehaviorStrategy {
  const b = behaviors.get(id);
  if (!b) {
    throw new Error(`[Enemy] Unknown BehaviorId "${String(id)}" (not registered)`);
  }
  return b;
}

/** 查行为策略;未注册返回 `null`(供"宽松匹配"路径用)。 */
export function getBehavior(id: BehaviorId): BehaviorStrategy | null {
  return behaviors.get(id) ?? null;
}

/** 是否注册过这个 spec。 */
export function hasEnemySpec(kind: EnemyKind): boolean {
  return specs.has(kind);
}

/** 当前所有已注册 kind 的列表(只读,顺序按注册顺序)。 */
export function listEnemyKinds(): readonly EnemyKind[] {
  return Array.from(specs.keys());
}

/**
 * 内部测试 / HMR 工具:清空注册表(只在测试 setup 调,生产代码不碰)。
 * 正常路径下 `registerXxx` 只在模块加载时跑一次。
 */
export function _resetRegistryForTests(): void {
  specs.clear();
  behaviors.clear();
}

/** 默认 Chaser spec —— 复刻土豆兄弟首关"接近玩家"型杂兵。 */
export const DEFAULT_CHASER_SPEC: EnemySpec = {
  behavior: "chaser",
  speed: 80,
  maxHp: 20,
  contactDamage: 5,
  xpReward: 1,
  label: "chaser",
};
