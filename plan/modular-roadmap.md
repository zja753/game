# 土豆兄弟风格游戏 —— 模块化开发路线(顶层)

完整范围:**复刻土豆兄弟核心循环**。不做:成就 / 每日挑战 / 解锁 / i18n / 触屏 / 联机 / 账号。

> **核心原则**:开发阶段**不**开浏览器。验收只看类型安全(tsc 通过)。需要手测由你触发,我只描述现象、给定位。

---

## 0. 解耦原则

- 模块 A **不** import 模块 B 的任何符号。
- 模块 A **不**直接 `new` 模块 B 的 Actor / 组件。

跨模块通信**只**允许三种:

| 渠道            | 谁用           | 形态                                                                      |
| --------------- | -------------- | ------------------------------------------------------------------------- |
| **EventBus**    | 任一→任一      | payload 是纯数据(`{ x, y, hp, kind, ... }`),**不**放 Actor 引用           |
| **GameContext** | 任一→任一 只读 | 各模块把权威字段以 getter 暴露,模块只读不写;写一律走 EventBus / Port      |
| **Port**        | 通过根容器注入 | 模块持**接口**(`interface`),实现类在根容器里注册,模块不知道也不关心实现方 |

权威表(每个数据字段**只有**一个模块写):

| 数据                      | 权威模块                     |
| ------------------------- | ---------------------------- |
| 玩家位置/朝向/血量        | Player                       |
| 投射物生成/命中           | Combat                       |
| 敌人 AI/行为/击杀         | Enemy                        |
| 经验/升级/关卡阶段/场景机 | Progression                  |
| 升级/商店奖励发放         | RewardShop                   |
| 地图障碍/静态碰撞         | MapObstacle                  |
| 输入意图                  | Input                        |
| HUD 显示                  | HudUi(纯渲染,值改别人就 bug) |
| 引擎实例/Actor 池/帧      | Runtime                      |
| 摄像机世界坐标/视口       | Camera                       |

---

## 1. 场景状态机

`Progression` 模块独占持有 `GameScene` 状态机,其他模块**只**通过订阅 `level:phase` 事件被动响应。

```ts
type GameScene =
  | "character_select" // 起始;首版可跳到 running
  | "running" // 关卡战斗中,时钟走
  | "levelup_modal" // 升级三选一,Combat 暂停、时钟停
  | "portal" // 倒计时到点,时钟停
  | "shop" // 商店面板,时钟停
  | "gameover" // 死亡,引擎 clock 冻结
  | "victory"; // 通关
```

| 当前               | 触发             | 下一个          | 副作用                        |
| ------------------ | ---------------- | --------------- | ----------------------------- |
| `character_select` | 玩家点开始       | `running`       | spawn 玩家 + 加载关卡 1       |
| `running`          | `xp >= xpToNext` | `levelup_modal` | 停时钟,RewardShop 拿 3 个选项 |
| `levelup_modal`    | `reward:picked`  | `running`       | `applyReward`,恢复时钟        |
| `running`          | 倒计时 = 0       | `portal`        | spawn Portal,停时钟           |
| `portal`           | 玩家进 Portal    | `shop`          | 清场 + 加载商店               |
| `shop`             | 玩家离开         | `running`       | 加载下一关,恢复时钟           |
| 任意               | `player:died`    | `gameover`      | `clock.stop`                  |
| `running`          | 打死最终 Boss    | `victory`       | `clock.stop`                  |

切换由 `Progression` 调三件事:`emit('level:phase', ...)` / `clock.start|stop` / `MapObstacle.loadLevel`。

---

## 2. 粘合层(`src/runtime/`,所有模块共享)

**事件命名** `xxx:action`(首批已落地:`input:*`,其余见各模块文档):

- 输入:`input:move` `input:fire` `input:pause`
- 玩家:`player:moved` `player:damaged` `player:died`
- 战斗:`projectile:hit` `enemy:killed`
- 敌人:`enemy:spawned` `enemy:dying`
- 进度:`xp:gained` `level:up` `level:phase` `timer:tick` `portal:appeared`
- 奖励:`reward:available` `reward:applied` `reward:picked`
- 地图/摄像机:`map:loaded` `camera:moved`

`EventBus` API 形状:`on(type, handler) → unsubscribe` / `emit(event)` / `clear()`(重开用)。

`GameContext` 上暴露的快照类别: `player` / `weapons` / `enemies` / `map` / `camera`(具体字段见各模块文档)。

`RootContainer` 是**唯一** import 全部模块的地方;模块构造函数签名统一 `new XxxModule(deps)`(`deps = { bus, ctx, ports }`)。装配本身不感知场景循环,场景循环由 Progression 驱动。

---

## 3. 模块清单(每个文档回答两件事:**对外 Port + 自己怎么用别人的能力**)

| #   | 模块                                    | 一句话能力                                                       |
| --- | --------------------------------------- | ---------------------------------------------------------------- |
| M1  | [Runtime](./modules/runtime.md)         | Excalibur 引擎 + 帧 + Actor 池 + 碰撞层(最底层)                  |
| M2  | [Input](./modules/input.md)             | 键鼠 → `InputIntent` + 轴/边沿查询(只发事件)                     |
| M3  | [Player](./modules/player.md)           | 玩家 Actor 生命周期/移动/血量/朝向/受击                          |
| M4  | [Combat](./modules/combat.md)           | 武器 + 投射物 + 命中 + 击杀事件                                  |
| M5  | [Enemy](./modules/enemy.md)             | 敌人数据 + AI + 生成调度 + 接触伤害                              |
| M6  | [Progression](./modules/progression.md) | 场景机 + 经验/升级 + 关卡倒计时 + 传送门编排                     |
| M7  | [RewardShop](./modules/rewards.md)      | 升级三选一 + 商店商品 + `applyReward` 回调分发                   |
| M8  | [HudUi](./modules/hud.md)               | React 浮层;按 `level:phase.scene` 切根布局(**唯一无 Port 依赖**) |
| M9  | [MapObstacle](./modules/obstacle.md)    | 静态地图 + `isBlocked` 查询 + 关卡切换(纯数据)                   |
| M10 | [Camera](./modules/camera.md)           | 玩家跟随 + 边缘 hard clamp + `isOnScreen` 复用同一份几何         |

子文档递归:**自身**进一步拆分时自己开子目录,不再回写到上一层。

---

## 4. 目录结构

```
game/
├── plan/                  ← 本文档 + modules/<name>.md
├── src/
│   ├── runtime/           ← 粘合层(模块之间不允许跨过这一层互相 import)
│   │   ├── EventBus.ts
│   │   ├── GameContext.ts
│   │   ├── RootContainer.ts
│   │   ├── ports/         ← 每模块一个 *.ts(只放 Port interface)
│   │   └── types.ts
│   ├── modules/<name>/    ← 每个模块一个目录,实现 + (按需)internal/ + (按需)__mocks__/
│   ├── pages/Game.tsx     ← 薄壳,挂 RootContainer
│   ├── main.tsx
│   ├── App.tsx
│   └── styles/app.css
└── (旧 src/game/* / src/pages/Home.tsx / src/assets/* 在对应模块落地后按"删一补一"清掉)
```

---

## 5. 开发节奏(开发阶段)

**当前阶段**:各模块独立开发。**验收 = 仅类型安全**: `pnpm exec vp check` 全绿(tsc + lint + format)。

模块开发**两步走**,**不**接入 `RootContainer`、**不**开浏览器手测、不写测试:

1. **画契约**——在 `runtime/ports/<Name>Port.ts` 写 interface,标好事件订阅与 Port 依赖。
2. **实现**——`modules/<name>/` 下,把 Port 实例化、内部逻辑跑通;只做 `vp check`,**不**拼 RootContainer、**不**跑 `pnpm dev`。

**接入 / 浏览器联调 / 写测试,统一推迟到第 6 节"联调阶段"**,届时所有模块都已落库再一起做。

### 铁律(开发阶段)

- 每个模块**不**在 `RootContainer` 里注册、`pnpm dev` **不**预期跑通该模块的画面/输入流。
- `runtime/ports/*.ts` 只放 type / interface,实现一律在 `modules/<name>/`。
- `vp check` 跑 grep 检查的"禁跨模块 import"在开发阶段就生效;任何为了让单模块"跑起来"而临时引别的模块的行为,一律走 Port / EventBus / GameContext。
- **不**为单模块创建临时 demo 页、`/demo/*` 路由或 `src/pages/demos/`;旧 `src/game/**` / `src/pages/Home.tsx` / `src/pages/Game.tsx` / `src/assets/*` 新代码**禁止** import。
- **不**主动 `pnpm dev` / 起浏览器 / 用浏览器工具复现 —— 即便发现可疑交互 bug,也只描述现象、给出定位,留给你手测。浏览器手测由用户触发。
- 验收只看类型层:`pnpm exec tsc --noEmit`(或 `vp check` 包含 tsc 时跑一遍)全绿 = 通过。

---

## 6. 联调阶段(所有模块完成后才启动)

触发条件:**模块清单(§3)全部勾完** + 每个模块 `vp check` 全绿。

联调阶段才做的事:

1. **接入**——`RootContainer` 把所有模块拼起来,`pnpm dev` 在浏览器跑通核心循环(`character_select → running → levelup_modal → portal → shop → victory/gameover`)。
2. **测试**——按需补 `*.test.ts` / `__mocks__/`;触发条件见下"测试何时补"。

### 测试何时补

默认**不**写测试,联调阶段也只按需:

- 你给出了具体 bug repro;
- 模块有隐藏边界(`isOnScreen`、伤害衰减曲线、场景机转移表)光靠手测盯不住;
- 你点名要测。

补测试时按"`*.test.ts` 紧贴实现 / `__mocks__/` 放 Mock 工厂"的旧规,**位置约束保留**,但**数量**按 bug 需要来,不按覆盖面铺。

---

## 7. 铁律(贯穿开发 + 联调)

以下条款在**开发阶段**和**联调阶段**都生效:

- `modules/<name>/` **严禁** import 别的 `modules/<other>/`。`vp check` 跑 grep 检查。
- `runtime/ports/*.ts` 只放 type / interface,实现一律在 `modules/<name>/`。
- **不**创建 `src/pages/demos/`,**不**加 `/demo/*` 路由。
- 旧 `src/game/**` / `src/pages/Home.tsx` / `src/pages/Game.tsx` / `src/assets/*` 新代码**禁止** import。
- 第一版只放 1 把 Pistol + 1 种 Chaser 接口框架;具体武器/敌人走 `WeaponRegistry` / `EnemyRegistry`,不硬编码。
