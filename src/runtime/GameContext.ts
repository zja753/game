/**
 * `GameContext` — 跨模块"共享只读快照"窗口(见 plan/modular-roadmap.md §2.2)。
 *
 * 用途:
 *  - 各模块把**自己**的权威字段通过 getter 暴露到 `GameContext` 上;
 *  - 其他模块**只**通过 `GameContext` 读取"我应该关心但不该写"的数据;
 *  - 所有字段都是函数 / getter,**不**存副本 —— 实现方持有 Port,
 *    `getter` 内部调 Port 的对应读取方法,每次调用拿最新值。
 *
 * 解耦铁律(roadmap §0.1):
 *  - **不**提供任何"set"方法。任何"写"操作一律走 EventBus / Port。
 *  - 谁直接改 `GameContext` 谁就是 bug。
 *  - 字段**不**放 Actor 引用(同款"事件 payload 不放 Actor"原则)。
 *
 * 装配(roadmap §2.4 `RootContainer`):
 *  - RootContainer 在创建 `GameContext` 时把"对应模块的 Port"绑到 getter 上;
 *  - 模块构造时拿到 `GameContext`,通过 `ctx.player.pos()` 这样的形式读;
 *  - 模块**不**通过 `GameContext` 拿 Port 引用 —— 端口通过 `ModuleDeps.ports`
 *    注入(见各模块 `XxxModuleDeps` 形状);`GameContext` 只是"窗口",
 *    避免 EventBus 那种"全广播"造成不必要唤醒。
 *
 * 类别(roadmap §2.2):
 *  - `player`:`pos / hp / maxHp / facing`
 *  - `weapons`:`current`(当前武器 ID;列表走 `CombatPort.listWeapons`)
 *  - `enemies`:`list`(只读快照)
 *  - `map`:`bounds / isBlocked`
 *  - `camera`:`pos / viewportSize`
 */
import type { ActorId, Rect, Vec2, WeaponId } from "./types";
import type { EnemySnapshot } from "./ports/EnemyPort";

/**
 * 玩家上下文快照(roadmap §2.2 `player`)。
 *
 * 所有字段是 getter / 函数:每次调用走 `PlayerPort` 拿最新值。
 * `id` 主要给 Combat `tryFire` 用(玩家 ActorId 作 ownerId);HudUi 读 pos/hp 渲染。
 */
export interface PlayerContext {
  /** 玩家 ActorId(`PlayerPort.id()`,根容器装配后立刻调 `__setId` 注入)。 */
  readonly id: () => ActorId;
  /** 玩家世界坐标(像素)。 */
  readonly pos: () => Vec2;
  /** 当前 HP(已 clamp 到 `[0, maxHp]`)。 */
  readonly hp: () => number;
  /** HP 上限。 */
  readonly maxHp: () => number;
  /**
   * 当前面向角(弧度)。`{x:1,y:0}` 对应 0,`{x:0,y:1}` 对应 +π/2。
   * 玩家没移动且鼠标正中心时实现方走 0 兜底(同 `player:moved.facing` 语义)。
   */
  readonly facing: () => number;
}

/**
 * 武器上下文快照(roadmap §2.2 `weapons`)。
 *
 * 设计上**只**暴露 `current`(当前持有武器 ID);武器"全表"是 Combat 模块的
 * 内部状态,需要时调 `CombatPort.listWeapons()` 直接拿 —— 把它放 GameContext
 * 会让 Combat 模块"自动广播"每把武器的数据,违反 §0.2 权威原则
 * (Combat 是权威,HudUi 想看就读 CombatPort)。
 */
export interface WeaponsContext {
  /** 当前持有的武器 ID。 */
  readonly current: () => WeaponId;
}

/**
 * 敌人上下文快照(roadmap §2.2 `enemies`)。
 *
 * 返回 `readonly EnemySnapshot[]`:调用方拿到的是窗口,Combat 在 TargetSelector
 * 里现做距离过滤。Enemy 模块内部维护权威,Combat 通过 `EnemyPort.list()` 读。
 */
export interface EnemiesContext {
  /** 当前场上所有敌人只读快照(每次调用现算)。 */
  readonly list: () => readonly EnemySnapshot[];
  /** 当前场上敌人数(HUD 击杀计数 / "剩余敌人数"提示)。 */
  readonly count: () => number;
}

/**
 * 地图上下文快照(roadmap §2.2 `map`)。
 *
 * `bounds` 走 `MapObstaclePort.bounds()`;`isBlocked` 是高频调用的
 * 碰撞查询 —— Player / Combat / Enemy 的移动 / 弹道 / 寻路都查它,
 * 走 Port 会让代码难读,所以 GameContext 也开一份;两者**完全等价**
 * (都从同一个 Port 取数),任选其一即可。
 */
export interface MapContext {
  /** 当前关卡轴对齐包围盒。 */
  readonly bounds: () => Rect;
  /** 点 `p` 是否被静态障碍占据。 */
  readonly isBlocked: (p: Vec2) => boolean;
}

/**
 * 摄像机上下文快照(roadmap §2.2 `camera`)。
 *
 * HudUi 读 `pos` 做小地图 / 屏幕边缘提示;`viewportSize` 也能从这里拿,
 * 但 Combat / Enemy 的屏幕外裁剪**不**走这里(camera.md §6 明确:
 * 走 `CameraPort.isOnScreen` 而不是 `viewportSize`,因为它是"摄像机语义")。
 */
export interface CameraContext {
  /** 摄像机世界坐标(左上角像素)。 */
  readonly pos: () => Vec2;
  /** 视口尺寸(像素)。 */
  readonly viewportSize: () => Vec2;
}

/**
 * 完整的 `GameContext` 形状(roadmap §2.2)。
 *
 * 字段全是 `readonly` + 函数 / getter,实现方持有 Port 引用,
 * 每次调用走 Port 拿最新值。
 */
export interface GameContext {
  readonly player: PlayerContext;
  readonly weapons: WeaponsContext;
  readonly enemies: EnemiesContext;
  readonly map: MapContext;
  readonly camera: CameraContext;
}

/**
 * `createGameContext` 工厂:由 RootContainer 在装配阶段调,绑定各 Port 的读取闭包。
 *
 * 实现方约定(roadmap §2.2):
 *  - 工厂接收"已经创建好的 Port 引用集合",把它们包成"只读快照窗口";
 *  - 工厂**不**做 Port 的生命周期管理(那是 RootContainer 的事);
 *  - 工厂**不**做"快照缓存" —— 每次 getter 调用直透 Port,拿到的是当时
 *    状态(roadmap §2.2 明确"模块用'发布者更新内部状态'模式")。
 *
 * 装配时(伪代码):
 *  ```ts
 *  const ctx = createGameContext({
 *    player: playerPort,
 *    weapons: combatPort,
 *    enemies: enemyPort,
 *    map: obstaclePort,
 *    camera: cameraPort,
 *  });
 *  // 之后各模块 createXxxModule({ ..., ctx })
 *  ```
 *
 * 具体实现留到 RootContainer 装配时填(roadmap 进度表标注 ⬜ "等首个消费者";
 * 首个消费者 = Enemy 模块 M5 上线,因为 Enemy 是 GameContext 三个 Port
 * 全部就位后的第一个用上 `ctx.enemies` 的模块)。
 */
export interface GameContextSources {
  player: import("./ports/PlayerPort").PlayerPort;
  weapons: import("./ports/CombatPort").CombatPort;
  enemies: import("./ports/EnemyPort").EnemyPort;
  map: import("./ports/MapObstaclePort").MapObstaclePort;
  camera: import("./ports/CameraPort").CameraPort;
}

/**
 * 工厂签名(定义在这里,实现**不**在协议层)。
 *
 * `runtime/GameContext.ts` 协议层只暴露"形状",实现放在
 * `modules/_shared/GameContextImpl.ts`(roadmap §5 目录结构里 `_shared/`
 * 是跨模块共享目录)。**当前** M0 阶段不实现 —— 待 M5 第一个用上 `ctx.enemies`
 * 的模块落地时再写实现。
 */
export type CreateGameContext = (sources: GameContextSources) => GameContext;
