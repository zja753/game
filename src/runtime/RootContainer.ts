/**
 * `RootContainer` — 游戏装配层(plan/modular-roadmap.md §6.1)。
 *
 * 把所有第一版模块拼起来,实现浏览器端主循环:
 *   `character_select → running → levelup_modal → portal → shop → victory/gameover`
 *
 * 解耦铁律(roadmap §0.1):
 *  - 本文件**唯一** import 全部模块(包括各模块 `internal/*`);业务模块**不**能
 *    反向 import 根容器。
 *  - 模块之间互相**不** import,通信**只**走 EventBus / Port / GameContext。
 *
 * 装配顺序(roadmap §6.1):
 *  - 必须先 `createRuntimeModule` + `runtime.collision.addLayer(...)`,才能 spawn actor
 *    (collision group 必须在 actor 进 scene 之前注册)。
 *  - 模块依赖存在循环(Player → Combat → Enemy → Player),用 lazy Proxy 破环:
 *    Player 先建,挂 Combat Proxy;Enemy 后建(拿真实 Player);最后建 Combat(拿真实 Enemy)
 *    + Progression(拿真实 Enemy)。Proxy / closure 把"调用时机"延后到模块就绪之后。
 *
 * 关键副作用:
 *  - `root.start()` 会触发 `progression.startRun()` —— 把 `character_select` 直接切到
 *    `running`(roadmap §1:"首版可跳到 running"),广播 `level:phase`。
 *  - 装配完会订阅 player actor 的 `collisionstart/end` 事件,做"玩家 ↔ 敌人"接触
 *    伤害路由:Excalibur 触发 → 找 EnemyActor → 调 `enemy.handleContactStart()`。
 *    这条链路在 PlayerModule 文档里标注为"由根容器接线",实现就放这里。
 */
import type { Engine } from "excalibur";
import type { ActorId, ClockControl } from "./types";
import { createGameEventBus, type GameEventBus } from "./EventBus";
import { createGameContext, type GameContext, type GameContextBindings } from "./GameContextImpl";
import type { RuntimePort } from "../modules/runtime";
import { createRuntimeModule } from "../modules/runtime";
import { createInputModule } from "../modules/input";
import { createObstacleModule } from "../modules/obstacle";
import { createRewardModule } from "../modules/rewards";
import { createCombatModule, PROJECTILE_COLLISION_LAYER } from "../modules/combat";
import { createPlayerModule, PLAYER_CONTACT_LAYER } from "../modules/player";
import { createCameraModule } from "../modules/camera";
import { createEnemyModule, ENEMY_COLLISION_LAYER, ENEMY_CONTACT_LAYER } from "../modules/enemy";
import { createProgressionModule, PORTAL_COLLISION_LAYER } from "../modules/progression";
import { createHudUiModule } from "../modules/hud";

import { PlayerActor } from "../modules/player/internal/PlayerActor";
import { EnemyActor } from "../modules/enemy/internal/EnemyActor";

import type { InputPort } from "../runtime/ports/InputPort";
import type { MapObstaclePort } from "../runtime/ports/MapObstaclePort";
import type { RewardShopPort } from "../runtime/ports/RewardShopPort";
import type { CombatPort } from "../runtime/ports/CombatPort";
import type { PlayerPort } from "../runtime/ports/PlayerPort";
import type { CameraPort } from "../runtime/ports/CameraPort";
import type { EnemyPort } from "../runtime/ports/EnemyPort";
import type { ProgressionPort } from "../runtime/ports/ProgressionPort";
import type { HudUiPort } from "../runtime/ports/HudUiPort";

// PORTAL_COLLISION_LAYER 当前不在 Excalibur 碰撞对里出现(Portal 由 Progression 距离判定),
// 这里 `void` 它只为保留 import(后续若改成 Excalibur 触发直接复用)。
void PORTAL_COLLISION_LAYER;

/** 装配依赖(canvas + 可选元素解析器)。 */
export interface RootContainerDeps {
  /** Excalibur 引擎挂载的 canvas(由 `Game` 路由创建并传入)。 */
  canvas: HTMLCanvasElement;
  /**
   * 视口尺寸(像素);不传走 canvas 客户端尺寸。
   * 真实游戏常用 `window.innerWidth / innerHeight`。
   */
  width?: number;
  height?: number;
  /** 背景色(`#rrggbb` / `#rrggbbaa`)。 */
  backgroundColor?: string;
  /**
   * HUD 容器解析器(默认 `document.querySelector(".hud-mount")`)。
   * 测试或 SSR 环境可以传一个 stub。
   */
  hudContainer?: () => HTMLElement | null;
}

/** `RootContainer.start()` 返回的句柄。 */
export interface RootContainerHandle {
  /** GameContext(只读快照,roadmap §2.2)。 */
  readonly ctx: GameContext;
  /** 事件总线 —— 调试 / 集成测试可用。 */
  readonly bus: GameEventBus;
  /** Excalibur 引擎逃生舱口(roadmap §6.1 + RuntimePort `engine` 字段)。 */
  readonly engine: Engine;
  /**
   * Progression Port —— 供 `src/pages/*` 路由组件调用场景转移
   * (`pickCharacter` / `startRun` / `advance` / `pauseToggle`)。新增于
   * ui-react-split.md §4:路由层需要直接调 Progression,但模块间解耦铁律
   * (roadmap §0.1)阻止页面 import 任何 modules 下的 internal,所以 Port
   * 引用通过本 handle 暴露。**只读暴露**(模块不通过这里修改 handle 内部)。
   */
  readonly progression: ProgressionPort;
  /**
   * RewardShop Port —— 供 `/shop` 路由调用 `applyReward`。同 §4。
   */
  readonly rewardShop: RewardShopPort;
  /**
   * 启动游戏主循环:广播 `level:phase character_select → running` 一系列事件,
   * Player / Enemy / HUD 全自动响应。幂等 —— 重复调用只在第一次生效。
   */
  start(): void;
  /**
   * 反订阅所有 EventBus / Runtime 句柄,销毁 Excalibur 引擎。
   * 用于 React `useEffect` cleanup、HMR、集成测试。
   */
  dispose(): void;
}

/**
 * 装配并启动游戏。
 *
 * @returns `RootContainerHandle`。调用 `start()` 真正进入 `running` 场景。
 *
 * 装配阶段**不**主动广播 `level:phase`(由 `progression.startRun` 在 `start()`
 * 时触发);只 `obstacle.loadLevel("level-1")` 广播一次 `map:loaded`。
 */
export function createRootContainer(deps: RootContainerDeps): RootContainerHandle {
  // ---- 0. EventBus ----
  const bus: GameEventBus = createGameEventBus();

  // ---- 1. Runtime ----
  const runtime: RuntimePort = createRuntimeModule({
    canvas: deps.canvas,
    width: deps.width,
    height: deps.height,
    backgroundColor: deps.backgroundColor,
  });

  // 引擎 clock 子口(roadmap §1:"切换由 Progression 调三件事: emit / clock / loadLevel")。
  // Excalibur 的 `engine.clock` 提供 start/stop;roadmap 用窄口协议层
  // (`ClockControl`),这里用适配器把它包成 `ClockControl`。
  const clock: ClockControl = {
    start: () => runtime.engine.clock.start(),
    stop: () => runtime.engine.clock.stop(),
  };

  // ---- 2. 注册 collision layer(必须在 spawn actor 之前)----
  // 真实碰撞对:`player-contact` ↔ `enemy-contact`(接触伤害),
  // `projectile` ↔ `enemy`(投射物命中)。
  // player ↔ wall 由 PlayerMover 走 `MapObstaclePort.isBlocked` 查询,不进 Excalibur 碰撞层;
  // portal 由 Progression 距离判定,也不进。
  runtime.collision.addLayer(PLAYER_CONTACT_LAYER, ENEMY_CONTACT_LAYER);
  runtime.collision.addLayer(PROJECTILE_COLLISION_LAYER, ENEMY_COLLISION_LAYER);

  // ---- 3. Input ----
  const input: InputPort = createInputModule({ bus, runtime });

  // ---- 4. MapObstacle + 加载默认关卡 ----
  const obstacles: MapObstaclePort = createObstacleModule({ bus });
  // loadLevel 立刻触发 `map:loaded`(Camera 订阅它重算 clamp 范围);
  // 在 Player / Enemy spawn 之前调,以便它们的出生点 = 当前关卡的 `playerSpawn()`。
  obstacles.loadLevel("level-1");

  // ---- 5. Lazy proxies 解决装配期 Player → Combat → Enemy → Player 循环 ----
  // 闭包里的"目标"在 `bindReal` 时被替换;模块只持有 Proxy,调用时再 deref。
  const unresolved = makeUnresolved();

  // ---- 6. RewardShop + 注册默认奖励 ----
  const rewardShop: RewardShopPort = createRewardModule({ bus });
  registerDefaultRewards(
    rewardShop,
    () => unresolved.player,
    () => unresolved.combat,
  );

  // ---- 7. Player(Combat 用 lazy proxy)----
  const player: PlayerPort = createPlayerModule({
    bus,
    runtime,
    input,
    obstacles,
    combat: unresolved.combatProxy,
    initialPos: obstacles.playerSpawn(),
  });

  // ---- 8. 拿 player actor 引用,spawn 进场景 ----
  const playerActorExt = player as PlayerPort & {
    __actor: PlayerActor;
    __setId: (id: ActorId) => void;
  };
  const playerActor = playerActorExt.__actor;
  // 把 player actor 放进 Excalibur scene;layer 用 player 自己的标识。
  // 玩家主碰撞 = `player-contact`(接触伤害入口);不另开"player-wall"层
  // (墙壁不在 Excalibur 里,PlayerMover 自己处理撞墙)。
  const playerId: ActorId = runtime.spawnActor({
    kind: PlayerActor as unknown as new (config: unknown) => PlayerActor,
    config: playerActor,
    layer: PLAYER_CONTACT_LAYER,
  });
  playerActorExt.__setId(playerId);

  // ---- 9. Camera(拿到 player 后才能算 follow 目标)----
  const camera: CameraPort = createCameraModule({
    bus,
    runtime,
    obstacles,
    player,
  });
  const cameraExt = camera as CameraPort & { start: () => void; __dispose: () => void };
  cameraExt.start();

  // ---- 10. Enemy(玩家已就位;Progression 用 lazy proxy)----
  const enemy: EnemyPort = createEnemyModule({
    bus,
    runtime,
    player,
    progression: unresolved.progressionProxy,
    obstacles,
  });

  // ---- 11. Combat(Enemy 已就位)----
  const combat: CombatPort = createCombatModule({
    bus,
    runtime,
    enemies: enemy,
    // isEnemy 谓词:enemy 列表里有这个 id 才算"可扣血"——挡墙 / 撞友军时
    // 走 HitResolver 的"非敌人"分支,no-op。
    // 真实路径下 projectiles 撞到玩家 Actor (id != enemy id) / Portal 等都不扣血。
    isEnemy: (id) => {
      const list = enemy.list();
      for (const e of list) {
        if (e.id === id) return true;
      }
      return false;
    },
  });

  // ---- 12. Progression(Enemy / RewardShop 都已就位)----
  const progression: ProgressionPort = createProgressionModule({
    bus,
    runtime,
    clock,
    map: obstacles,
    enemies: enemy,
    rewardShop,
  });

  // ---- 13. 把 lazy proxy 真正绑定到已建好的实例 ----
  unresolved.bindReal({
    player,
    combat,
    progression,
  });

  // ---- 14. HUD(挂 React 树)----
  const hud: HudUiPort = createHudUiModule({
    bus,
    resolveContainer: deps.hudContainer ?? defaultHudContainerResolver,
  });
  hud.show();

  // ---- 15. GameContext(只读快照,装配完成后随时可读)----
  const ctx: GameContext = createGameContext({
    player,
    weapons: combat,
    enemies: enemy,
    map: obstacles,
    camera,
    playerActorFacing: () => playerActor.facing.facingAngle(),
  } satisfies GameContextBindings);

  // ---- 16. 接触伤害路由:player actor 的 collision 事件 → enemy.handleContactStart ----
  // Excalibur 触发 `collisionstart`/`collisionend` 时回调;`e.other.owner` 是对方 Actor。
  // 这里用 instanceof 守卫:只在对方是 EnemyActor 时调它的接触伤害入口,
  // 避免投射物 / Portal / 残留旧 actor 误触发。
  // Excalibur `Actor.on()` 返回 `Subscription`(有 `.close()`),不是反订阅函数。
  const contactStartSub = playerActor.on("collisionstart", (e) => {
    const other = e.other.owner;
    if (!(other instanceof EnemyActor)) return;
    if (other.isDead()) return;
    other.handleContactStart();
  });
  const contactEndSub = playerActor.on("collisionend", (e) => {
    const other = e.other.owner;
    if (!(other instanceof EnemyActor)) return;
    other.handleContactEnd();
  });

  // ---- 17. start / dispose ----
  let started = false;
  const handle: RootContainerHandle = {
    ctx,
    bus,
    engine: runtime.engine,
    progression,
    rewardShop,
    start() {
      if (started) return;
      started = true;
      // 角色选择 → running(roadmap §1:"首版可跳到 running")。
      // 用 ProgressionPort.pickCharacter("default"):内部走
      // `character_select → running` 转移表(roadmap §1 表格)。
      //
      // 注:`startRun()` 是反向入口(`gameover/victory → character_select`),
      // 起始阶段调它会被 `scene !== "gameover/victory" → return` 守卫短路 no-op,
      // scene 永远停在 character_select —— 必须用 pickCharacter。
      progression.pickCharacter("default");
    },
    dispose() {
      contactStartSub.close();
      contactEndSub.close();
      cameraExt.__dispose();
      const playerExt = player as PlayerPort & { __dispose: () => void };
      playerExt.__dispose();
      const combatExt = combat as CombatPort & { __dispose: () => void };
      combatExt.__dispose();
      const enemyExt = enemy as EnemyPort & { __dispose: () => void };
      enemyExt.__dispose();
      const progressionExt = progression as ProgressionPort & {
        __dispose: () => void;
      };
      progressionExt.__dispose();
      hud.hide();
      const hudExt = hud as HudUiPort & { __dispose: () => void };
      hudExt.__dispose();
      const inputExt = input as InputPort & { __dispose: () => void };
      inputExt.__dispose();
      bus.clear();
      const runtimeExt = runtime as RuntimePort & { __dispose: () => void };
      runtimeExt.__dispose();
      started = false;
    },
  };

  return handle;
}

// ============================================================
// 内部工具:lazy proxy(装配期循环依赖)
// ============================================================

/**
 * 装配期循环依赖的解决容器 —— "unresolved" 表示目标 Port 尚未创建;
 * 调用 `bindReal(...)` 后,Proxy 转发到真实 Port。
 *
 * 解的循环:
 *  - Player 的 deps.combat —— Combat 需要 Enemy,Enemy 需要 Player;
 *    先建 Player(拿 Combat Proxy),再建 Enemy,再建 Combat,最后 bind。
 *  - Enemy 的 deps.progression —— Progression 需要 Enemy;
 *    先建 Enemy(拿 Progression Proxy),再建 Progression,最后 bind。
 *
 * 实现说明:
 *  - `Player` 的 `input:fire` handler 闭包调 `combat.tryFire(...)`;
 *    `Enemy` 的 `onTick` 闭包调 `progression.currentLevelConfig()`;
 *    两处都是运行时调用,装配期 Proxy 的 target 还未绑定 —— 等
 *    `bindReal` 把 target 写进内部变量,后续调用走真实 Port。
 *  - Proxy 比"占位 stub + 后期 patch"更安全:
 *    占位 stub 必须事先声明所有方法签名,新方法扩展时易漏;
 *    Proxy 自动转发任意属性访问,代码无感。
 */
function makeUnresolved() {
  let realPlayer: PlayerPort | null = null;
  let realCombat: CombatPort | null = null;
  let realProgression: ProgressionPort | null = null;

  const combatProxy = new Proxy({} as CombatPort, {
    get(_t, prop) {
      if (realCombat === null) {
        throw new Error(`[RootContainer] Combat Proxy read before bind: ${String(prop)}`);
      }
      return Reflect.get(realCombat, prop, realCombat);
    },
  });
  const progressionProxy = new Proxy({} as ProgressionPort, {
    get(_t, prop) {
      if (realProgression === null) {
        throw new Error(`[RootContainer] Progression Proxy read before bind: ${String(prop)}`);
      }
      return Reflect.get(realProgression, prop, realProgression);
    },
  });

  return {
    combatProxy,
    progressionProxy,
    bindReal(ports: {
      player: PlayerPort;
      combat: CombatPort;
      progression: ProgressionPort;
    }): void {
      realPlayer = ports.player;
      realCombat = ports.combat;
      realProgression = ports.progression;
    },
    get player(): PlayerPort {
      if (realPlayer === null) throw new Error("[RootContainer] player not bound");
      return realPlayer;
    },
    get combat(): CombatPort {
      if (realCombat === null) throw new Error("[RootContainer] combat not bound");
      return realCombat;
    },
  };
}

// ============================================================
// 默认奖励注册(roadmap §6.2 + rewards.md §6 关键设计点:
// "改其他模块权威字段的机制:注册回调 apply(deps),谁注册谁执行")
// ============================================================

/**
 * 注册第一版默认奖励:
 *  - `heal_small` (levelup) —— 立即 +20 HP(PlayerPort.applyHeal)
 *  - `weapon_dmg_up` (levelup) —— 武器伤害 +25%(用 PlayerPort.addBuff 记一笔,
 *    Combat 后续接 modifier 时生效)
 *  - `heal_big` (shop) —— +50 HP,价格 10
 *  - `weapon_pistol_dmg_up` (shop) —— Pistol 伤害 +5,价格 15
 *
 * `apply` 闭包通过 `getPlayer / getCombat` 拿到"装配完成后"的真实 Port
 * (奖励在 `applyReward` 时调用,装配早已结束,real 已被 bind)。
 */
function registerDefaultRewards(
  rewardShop: RewardShopPort,
  getPlayer: () => PlayerPort,
  getCombat: () => CombatPort,
): void {
  rewardShop.register({
    id: "heal_small",
    kind: "levelup",
    name: "小恢复",
    description: "立即恢复 20 点 HP",
    apply: () => {
      getPlayer().applyHeal(20);
      return { ok: true };
    },
  });
  rewardShop.register({
    id: "weapon_dmg_up",
    kind: "levelup",
    name: "伤害提升",
    description: "武器伤害 +25%(整局持续)",
    apply: () => {
      // 真实修改 = Combat 内部读 Player 身上的 buff;首版只记账。
      getPlayer().addBuff({
        id: "weapon_dmg_up",
        label: "伤害提升",
        modifiers: { kind: "weapon_dmg_mult", mult: 1.25 },
      });
      // 占位:实际伤害乘算放在 Combat 路径(M6+ 接 modifier 时再写)。
      void getCombat();
      return { ok: true };
    },
  });
  rewardShop.register({
    id: "heal_big",
    kind: "shop",
    name: "大恢复",
    description: "立即恢复 50 点 HP",
    price: 10,
    apply: () => {
      getPlayer().applyHeal(50);
      return { ok: true };
    },
  });
  rewardShop.register({
    id: "weapon_pistol_dmg_up",
    kind: "shop",
    name: "手枪伤害升级",
    description: "Pistol 伤害 +5",
    price: 15,
    apply: () => {
      getPlayer().addBuff({
        id: "weapon_pistol_dmg_up",
        label: "手枪伤害升级",
        modifiers: { kind: "weapon_dmg_add", weapon: "pistol", amount: 5 },
      });
      void getCombat();
      return { ok: true };
    },
  });
}

// ============================================================
// HUD 容器解析(默认 `.hud-mount`)
// ============================================================

function defaultHudContainerResolver(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(".hud-mount");
}
