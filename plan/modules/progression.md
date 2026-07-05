# Module-Progression

> 顶层路线见 [`../modular-roadmap.md`](../modular-roadmap.md)。本文件是 Progression 模块的自留地:Port / 事件 / 内部子模块拆分。Progression 是整局游戏的"导演",**唯一**拥有 `GameScene` 状态机的模块。

---

## 1. 职责

**游戏场景状态机 + 关卡进度**。本模块是整个游戏的"导演":

- 维护一个 `GameScene` 有限状态机(见顶层文档 §1),决定"现在玩家处于什么场景、谁该被激活、谁该被暂停"
- 经验、升级、关卡倒计时、传送门生成、商店编排、升级三选一编排

**不**做武器、不做 UI、不做玩家血量(死亡流程是 Player 模块广播 `player:died`,Progression 收到后**切到 `gameover` 场景**,不是 Progression 杀死玩家)。

---

## 2. 对外 Port

文件:`game/src/runtime/ports/ProgressionPort.ts`

```ts
interface ProgressionPort {
  // 读
  level(): number;
  xp(): number;
  xpToNext(): number;
  scene(): GameScene; // 当前场景
  phase(): "running" | "portal" | "shop"; // 兼容旧调用,= scene() 的子集
  timer(): number; // 剩余秒(running 时有意义)
  currentLevelConfig(): LevelConfig;

  // 写
  startRun(): void; // 从 gameover 回 character_select
  pickCharacter(id: CharacterId): void; // 从 character_select 切 running
  advance(): void; // portal → shop;shop → running(下一关)
  pauseToggle(): void; // 玩家按 ESC:running ↔ paused(新增子态)
  endRun(): void; // 玩家手动弃局(M7+ 才有)
}
```

`GameScene` / `SceneContext` / `LevelConfig` 类型在 `runtime/types.ts` 或本模块目录集中定义(本路线不锁位置)。

---

## 3. 事件

- **输入事件**(本模块订阅):
  - `enemy:killed { xp }` → 加经验,达阈值时**先**发 `xp:gained`,**再**切 scene 到 `levelup_modal`
  - `input:pause` → 切 `running` ↔ `paused`(暂停子态,**不**是独立 GameScene)
  - `reward:picked` → 切 `levelup_modal` → `running`,同时调 `RewardShopPort.applyReward`
  - `player:died` → 切到 `gameover`

- **输出事件**(本模块发出):
  - `xp:gained { amount, total }`
  - `level:up { level, choices: RewardId[] }` — **升级触发与 `scene → levelup_modal` 是同一时刻发的两件事**,HUD 用 `scene` 决定弹不弹浮层,用 `choices` 渲染卡片内容
  - `level:phase { scene: GameScene, context: SceneContext }` — **场景切换的唯一信源**,`context` 携带该场景需要的额外数据:
    ```ts
    type SceneContext =
      | { scene: "running" }
      | { scene: "levelup_modal"; choices: readonly RewardId[] }
      | { scene: "portal"; portalPos: Vec2; remainingEnemies: number }
      | { scene: "shop"; items: readonly ShopItem[] }
      | { scene: "character_select"; characters: readonly CharacterId[] }
      | { scene: "gameover"; stats: RunStats }
      | { scene: "victory"; stats: RunStats };
    ```
  - `timer:tick { remaining, total }` — 只在 `running` scene 下发
  - `portal:appeared { pos }` — 只在 `running → portal` 转移瞬间发 1 次

---

## 4. 权威字段

`level / xp / scene / timer / currentLevelConfig` / `paused`(子态)。

---

## 5. 场景切换的物理实现

场景切换 = **三件事**(只有 Progression 做):

1. `GameEventBus.emit({ type: "level:phase", scene, context })` —— 通知 HUD 和所有订阅者
2. `runtime.engine.clock.start() / stop()` —— 暂停 / 恢复物理世界(玩家、敌人、投射物冻住,UI 不冻)
3. 调 `MapObstacle.loadLevel(n)` / 清场等 —— 物理资源换页

其他模块**只能**通过 `ProgressionPort` 申请切换(如 `advance()` 申请 `portal → shop`)。

---

## 6. 内部子模块草案

按职责拆 5 个内部子模块,**都**在本模块目录 `modules/progression/` 下:

- `GameSceneController`:**状态机**实现,负责"切换 scene 时要做哪些副作用"。所有状态转移都走它,**只有它**调 `engine.clock` 和 `MapObstacle.loadLevel`。
- `XpCurve`:`xpToNext(level)` 纯函数(单测覆盖,数值表在 `modules/_shared/xpCurve.ts`)。
- `LevelCatalog`:`level → LevelConfig { duration, enemyDensity, allowedKinds, eliteAt, isFinal }`。
- `PortalSpawner`:`scene → portal` 时通过 `RuntimePort` 生成 PortalActor。
- `ShopOrchestrator`:`scene → shop` 时调 `RewardShopPort.rollShopItems(level)`,把结果塞进 `SceneContext`。
- `LevelUpOrchestrator`:`scene → levelup_modal` 时调 `RewardShopPort.rollLevelUpChoices(level)`,塞进 `SceneContext`。

---

## 7. 与其他模块的 Port 依赖(由 RootContainer 注入)

- 持有 `RuntimePort`(控 clock / spawn PortalActor)
- 持有 `MapObstaclePort`(`scene → shop` 后 `loadLevel(n+1)`)
- 持有 `RewardShopPort`(roll 升级 / 商店选项)
- 持有 `EnemyPort`(切关时 `clear()`)

---

## 8. 验收

`pnpm exec vp check` 全绿;`pnpm dev` 接进 RootContainer 后:Mock 3 次 `enemy:killed { xp: 10 }` → 触发 1 次 `level:up` + `level:phase.scene="levelup_modal"` 且 `choices.length=3` + `clock.stop`;模拟 `reward:picked` 后 `level:phase.scene="running"` + `clock.start`。推进 30 秒应出 `portal` 场景 + `portal:appeared` 1 次。

> 测试只在你给具体 repro 或点名时再补,见顶层 §5。

---

## 9. 不做清单

- 不做玩家血量 / 受伤 / 死亡(只接收 `player:died` 切 scene)。
- 不做武器伤害(只接收 `enemy:killed` 累加经验)。
- 不做 UI 渲染(只发 `level:phase`,HUD 自己决定怎么渲染)。
- 不做敌人 AI(只调 `EnemyPort.spawn` 控密度)。
