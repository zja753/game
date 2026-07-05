/**
 * Runtime 模块共享类型。
 *
 * 这些类型供 Port 接口、模块实现、Mock 工厂共用,
 * **禁止**在 `modules/<other>/` 出现。
 *
 * 设计原则:类型形状只锁"语义",不强耦合到 Excalibur 的内部 class
 * (例如 `Actor` / `Scene` / `Vector`)。这样:
 *  - 上游:Excalibur 的具体类可以无缝塞进来(spawn 时 `new spec.kind(...)`)。
 *  - 下游:Mock 工厂可以用普通对象模拟 `Actor`。
 *  - 跨模块:消费者拿到的都是字面量 `{ x, y }` 而不是 Excalibur Vector 实例。
 */
import type { Actor, Scene } from "excalibur";

/** 二维向量/坐标。`x` / `y` 都是世界坐标(像素)。 */
export interface Vec2 {
  x: number;
  y: number;
}

/** Actor 唯一 ID。Runtime 在 spawn 时把 Excalibur 的 `actor.id` 提出来包成这个。 */
export type ActorId = number;

/** spawn 时用的 Actor 类。 */
export type ActorCtor<TConfig> = new (config: TConfig) => Actor;

/**
 * spawn 的规格:
 *  - `kind`:Actor 类的构造函数(Excalibur 风格,接受任意 config)。
 *  - `config`:传给构造函数的配置(位置、贴图、collision group 等,由调用方决定形状)。
 *  - `layer`:可选的 collision layer 名(注册过的字符串),Runtime 在内部映射到 Excalibur CollisionGroup。
 */
export interface ActorSpec<TConfig = unknown> {
  kind: ActorCtor<TConfig>;
  config: TConfig;
  layer?: string;
}

/**
 * 场景规格:
 *  - `key`:引擎里注册场景用的字符串 key(loadScene 内部用 `engine.addScene(key, ...)`)。
 *  - `setup`:可选钩子,场景被引擎激活时调用;把场景级共享状态挂到 `T` 上返回。
 */
export interface SceneSpec<T> {
  key: string;
  setup?: (scene: Scene) => T;
}

/**
 * Raycast 命中结果。
 *  - `actor`:被命中的 Excalibur Actor(权威引用,允许调用方读 `actor.id` / `actor.pos`)。
 *  - `position`:世界坐标命中点。
 *  - `normal`:命中面的法向量(单位向量,供 AI 反弹用)。
 *  - `distance`:从 `from` 沿 `dir` 到命中点的距离(像素)。
 */
export interface HitResult {
  actor: Actor;
  position: Vec2;
  normal: Vec2;
  distance: number;
}

/**
 * 按键意图(模块间共享的"逻辑按键"字面量联合)。
 *
 * 设计原则:
 *  - **不**绑定具体物理键位(W/A/S/D / Space / 等),而是用语义名。
 *  - 物理键位 → 语义键的映射在 `modules/input/internal/KeyboardMap` 里完成。
 *  - 这样 Player / Progression 等模块只引用 `InputKey`,换键位不影响它们。
 *  - 联合放在 `runtime/types.ts` 是因为它是"协议层"的一部分,不属于任何业务模块。
 */
export type InputKey = "up" | "down" | "left" | "right" | "fire" | "pause";

/**
 * 武器 ID(plan/modules/combat.md §2 武器字面量联合)。
 *
 * 设计原则:联合放在 `runtime/types.ts` 是因为它**既**被 `CombatPort` 接口
 * 引用(供其他模块按 ID 切换),**也**被 Combat 模块自己的 `WeaponRegistry`
 * 用作 key 索引 —— 属于"协议层共享类型",与 `InputKey` 同级。
 *
 * 第一版只有 `pistol`(完全复刻土豆兄弟首关开局武器);后续改造
 * 在此联合上加新字面量。
 */
export type WeaponId = "pistol";

/**
 * 轴对齐矩形(Camera clamp / MapObstacle bounds / 屏幕外裁剪 的共同几何)。
 *
 * 设计原则:只用 `{ min, max }` 表达,不带 `width/height` —— 调用方按需算,
 * 避免重复字段导致不一致(Camera 的"半视口"会从 `viewportSize` 算,而不是
 * 从 Rect 派生)。
 */
export interface Rect {
  /** 左下角(世界坐标,像素)。 */
  min: Vec2;
  /** 右上角(世界坐标,像素)。 */
  max: Vec2;
}

/**
 * 关卡 ID(plan/modules/obstacle.md §2)。
 *
 * 当前第一版只放 1 关(M1 复刻土豆兄弟开局 1 关);后续按需扩。
 * 与 `WeaponId` 同源:协议层共享类型,被 `MapObstaclePort.loadLevel`
 * 引用,也被 MapObstacle 模块自己的 `MapCatalog` 用作 key 索引。
 */
export type LevelId = "level-1";

/**
 * 游戏场景状态机的状态(roadmap §1,progression.md §3)。
 *
 * `Progression` 模块**唯一**持有"现在处于哪个 scene"的事实;其他模块
 * 通过订阅 `level:phase` 事件被动响应。
 *
 * - `paused` 不是独立的 `GameScene` ——它是 `running` 内部的子态
 *   (progression.md §3 明确说明),由 Progression 自己维护,不在事件里发。
 */
export type GameScene =
  | "character_select"
  | "running"
  | "levelup_modal"
  | "portal"
  | "shop"
  | "gameover"
  | "victory";

/**
 * `level:phase` 事件 payload 里 `context` 字段的形状(progression.md §3)。
 *
 * 设计原则:每种 scene 只带它真正需要的数据,避免出现"假数据"(如
 * `gameover` 不应该有 `choices`)。HUD 拿到 context 之后只读 scene 决定
 * 渲染哪个根布局(roadmap §3.8 + hud.md §5),不解释具体字段。
 */
export type SceneContext =
  | { scene: "character_select"; characters: readonly CharacterId[] }
  | { scene: "running" }
  | { scene: "levelup_modal"; choices: readonly RewardId[] }
  | { scene: "portal"; portalPos: Vec2; remainingEnemies: number }
  | { scene: "shop"; items: readonly ShopItem[] }
  | { scene: "gameover"; stats: RunStats }
  | { scene: "victory"; stats: RunStats };

/**
 * 当前关配置(roadmap 描述 + progression.md §6 `LevelCatalog`)。
 *
 * `Progression.currentLevelConfig()` 读这个对象;`Enemy.SpawnScheduler`
 * 用 `duration / enemyDensity / allowedKinds` 决定一波刷几只、按什么间隔。
 *
 * `LevelConfig` **不是** 等级(玩家升级),而是"关卡"(stage)。命名上
 * 容易混,看到 `level: number` 时默认指**关卡**(1/2/3...),`xpLevel`
 * 才指玩家升级等级(由 `XpCurve` 派生)。
 */
export interface LevelConfig {
  /** 关卡内战斗时长(秒),倒计时归零进 `portal` scene。 */
  duration: number;
  /** 该关允许的敌人种类清单(子集约束;`EnemyRegistry` 必须覆盖)。 */
  allowedKinds: readonly EnemyKind[];
  /** 敌人生成密度(单位:只/秒),Enemy 模块用它调 `spawn` 节奏。 */
  enemyDensity: number;
  /** 该关精英敌人首次出现的剩余时间(秒);`undefined` 表示不刷精英。 */
  eliteAt?: number;
  /** 是否是最终关 —— `true` 时打掉 Boss 进 `victory` 而非 `shop`。 */
  isFinal: boolean;
}

/**
 * 敌人种类(plan/modules/enemy.md §2)。
 *
 * 第一版只放 `Chaser`(完全复刻土豆兄弟首关);后续按需扩。
 * 与 `WeaponId` 同源:被 `EnemyPort` 引用,也被 Enemy 模块自己的
 * `EnemyRegistry` 用作 key 索引。
 *
 * 注意:roadmap 明确"不预设任何具体敌人实现"——联合留 `string` 兜底,
 * 后续模块落地时在 Enemy 模块内部 `satisfies EnemyKind` 收紧即可,
 * 不影响调用方代码。
 */
// eslint-disable-next-line typescript/no-redundant-type-constituents -- 第一版只放 Chaser;roadmap §3.5 明确"不预设具体敌人实现",留 string 兜底供后续模块按字面量扩展
export type EnemyKind = "chaser" | string;

/**
 * 角色 ID(progression.md §2 / rewards.md 的角色选择入口)。
 *
 * 角色系统启用前(roadmap §1 `character_select` 标注"首版可跳到 running"),
 * 这条类型是"协议层占位"——首版不真正消费,只为后续扩展不破坏接口。
 */
export type CharacterId = string;

/**
 * 奖励 ID(rewards.md §2)。
 *
 * 字符串字面量联合 —— 第一版留 `string` 兜底(roadmap 明确"不预设
 * 具体奖励");RewardShop 模块在 `RewardCatalog` 注册时按 `id` 索引。
 *
 * 命名约定:`<source>_<descriptor>`(e.g. `weapon_pistol_dmg_up`、
 * `stat_speed_up`)。RewardShop 模块在装配时往联合加字面量(用
 * `declare module` / 字面量扩展),不破坏现有调用方。
 */
export type RewardId = string;

/**
 * 奖励种类(rewards.md §2 / progression.md §3 `reward:picked`)。
 *
 * - `levelup`:升级三选一卡片
 * - `shop`:商店商品(带价格)
 */
export type RewardKind = "levelup" | "shop";

/**
 * 商店物品(rewards.md §2 + progression.md §3 `SceneContext` 里 `shop.items`)。
 *
 * 本质 = `RewardId` + 价格。`price` 是相对金币数(暂不引入货币系统,
 * Roadmap §0.4 明确"完全复刻土豆兄弟核心循环";首版商店可能靠
 * "波次奖励"驱动,价格只是展示字段)。
 */
export interface ShopItem {
  /** 关联的奖励 ID(在 `RewardCatalog` 里查得到)。 */
  id: RewardId;
  /** 名称(HUD 渲染用)。 */
  name: string;
  /** 描述(HUD 渲染用)。 */
  description: string;
  /** 价格(M8+ 引入货币时启用;首版可视为 0)。 */
  price: number;
}

/**
 * 本局结算数据(progression.md §3 `SceneContext` 里 `gameover.stats` / `victory.stats`)。
 *
 * HUD 渲染 GameOver / Victory 面板时用;HudUi 模块**不**知道数据
 * 怎么来的,只读字段。
 */
export interface RunStats {
  /** 通关时长(秒)。 */
  elapsed: number;
  /** 击杀总数。 */
  kills: number;
  /** 累计伤害。 */
  damageDealt: number;
  /** 最终关卡(玩家到达的关卡)。 */
  level: number;
  /** 玩家最终等级。 */
  playerLevel: number;
}

/**
 * 奖励注册项(rewards.md §2 / §6)。
 *
 * RootContainer 装配阶段,各模块向 `RewardShop.register()` 提交。
 * `apply` 闭包由注册方持有,RewardShop **不**持有其他模块的 Port
 * 引用(roadmap §0.1 解耦铁律 + rewards.md §6 关键设计点)。
 *
 * `apply` 的 `ports` 参数由 RewardShop 在调用时透传 —— RewardShop
 * 不构造这个对象,而是由 RootContainer 装配时把"全量 Port 快照"
 * 注入 RewardShop 的内部 `applyReward` 路径;具体形状是
 * 业务模块自留的(见 `modules/rewards/RewardRegistration.ts`
 * 落地时定义),协议层只描述"该注册项的语义"。
 */
export interface RewardRegistration {
  id: RewardId;
  /** 决定此奖励出现在 `rollLevelUpChoices` 还是 `rollShopItems` 的结果里。 */
  kind: RewardKind;
  /** 名称 / 描述(HUD 渲染用;可选,默认从 Catalog 读)。 */
  name?: string;
  description?: string;
  /**
   * 商店基础价格(rewards.md §5 `ShopRoller`:`ShopItem.price` 派生自此)。
   *
   * - 仅在 `kind === "shop"` 时有意义;`kind === "levelup"` 时忽略。
   * - 不传走 `0`(rewards.md §2 注释:"首版可视为 0";M8+ 引入货币时由注册方填)。
   * - `ShopRoller` 按 `1 + (level - 1) * 0.2` 的乘子上调,向上取整。
   */
  price?: number;
}

/**
 * `RewardShopPort.applyReward` 的返回(rewards.md §2)。
 *
 * - `{ ok: true }` —— 找到注册项并执行
 * - `{ ok: false, reason }` —— 未注册 / 重复 id / 内部错误(由实现方
 *   决定 reason 集合;协议层只规定 "失败时返回这个形状,绝不抛错")
 */
export type ApplyResult = { ok: true } | { ok: false; reason: ApplyFailureReason };

/** `ApplyResult` 的失败原因枚举(协议层)。 */
export type ApplyFailureReason = "unregistered" | "internal_error";

/**
 * 引擎时钟控制子口(roadmap §1 场景切换的物理实现第 2 步)。
 *
 * Progression 调 `runtime.engine.clock.start()/stop()` 暂停 / 恢复
 * 物理世界 —— 但**不**应该让 Progression 直接拿 `Engine` 实例
 * (roadmap §0.1 强调"模块只持有 Port")。这里给出窄口,Runtime
 * 在装配时把 `(start, stop)` 注入 Progression。
 *
 * 不暴露 `Engine` 整体是为了**阻止 Progression 调 `engine.addScene`
 * / `engine.removeScene` 这类"应该走 RuntimePort.loadScene"的
 * 副作用路径**。clock 控制是唯一允许 Progression 越界的地方
 * (见 `runtime.md` §2.1 `engine` 注释:"少数情况(Progression 想
 * `engine.clock.start()/stop()`)就拿这个口子")。
 */
export interface ClockControl {
  /** 启动物理时钟(场景切回 `running` / `portal` / `shop` 后调)。 */
  start(): void;
  /** 暂停物理时钟(切到 `levelup_modal` / `gameover` 等"冻住世界"的场景时调)。 */
  stop(): void;
}
