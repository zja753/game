# Module-RewardShop

> 顶层路线见 [`../modular-roadmap.md`](../modular-roadmap.md)。本文件是 RewardShop 模块的自留地:Port / 事件 / 内部子模块拆分。RewardShop 是**唯一**"会主动改其他模块权威字段"的地方,改的入口是**注册回调**,不是 Port 引用。

---

## 1. 职责

升级三选一选项生成、商店物品列表、`applyReward` 真正改权威字段。**不**做 UI、不做关卡。

---

## 2. 对外 Port

文件:`game/src/runtime/ports/RewardShopPort.ts`

```ts
interface RewardShopPort {
  rollLevelUpChoices(level: number): readonly RewardId[]; // M0 占位,M5 真实
  rollShopItems(level: number): readonly ShopItem[];
  applyReward(id: RewardId): ApplyResult; // 真正调用 PlayerPort / CombatPort
  listRewards(): readonly RewardSpec[]; // 给 HUD

  // RootContainer 装配阶段调,业务代码不调
  register(spec: RewardRegistration): void;
  unregister(id: RewardId): void;
}
```

`RewardId` 是字符串字面量联合,`ShopItem` = `RewardId` + `price`。`ApplyResult` = `{ ok: true } | { ok: false, reason: 'unregistered' }`。`RewardRegistration` = `{ id, kind: 'levelup' | 'shop', apply: (ports) => ApplyResult }`。

---

## 3. 事件

- **输入事件**(本模块订阅):
  - `level:up` → 调 `rollLevelUpChoices` 并发 `reward:available { ids }`(给 HUD)
  - `level:phase = shop` → 调 `rollShopItems` 并发 `reward:available { ids, isShop: true }`
- **输出事件**(本模块发出):
  - `reward:available { ids, isShop }`
  - `reward:applied { id, kind }`

> **不**订阅 `reward:picked`——这是 HUD 玩家点击发的,Progression 收到后调本模块的 `applyReward`,本模块只被动提供能力。

---

## 4. 权威字段

无(它只调度奖励,真正改 HP / 武器 / Buff 是 Player / Combat / 其他模块自己的回调)。

---

## 5. 内部子模块草案

按职责拆 3 个内部子模块,**都**在本模块目录 `modules/rewards/` 下:

- `RewardCatalog`:`RewardId → { name, description, kind, apply: (ports) => ApplyResult }` 的注册表。`register` / `unregister` 维护它。
- `LevelUpRoller`:从 Catalog 按 level 抽 3 个不重复 ID。
- `ShopRoller`:从 Catalog 抽 4~6 个,价格随关卡递增。

---

## 6. 与其他模块的 Port 依赖(由 RootContainer 注入)

**不持有**其他模块的 Port 类型引用(否则就成了反向 import)。

改其他模块权威字段的机制:RootContainer 装配阶段,各模块向 RewardShop 的 `RewardCatalog` **注册回调**(`{ id, kind, apply(deps) }`),`applyReward(id)` 时按回调表分发,谁注册谁执行。RewardShop 模块**只持有** `RewardCatalog`(纯数据),不持有 Player / Combat 等 Port。

> **关键设计点**:这是全游戏唯一"主动改别人权威字段"的合法路径。任何"在 RewardShop 之外的代码里改别的模块字段"都是 bug。

---

## 7. 验收

`pnpm exec vp check` 全绿;`pnpm dev` 接进 RootContainer 并在装配时 `rewardShop.register({ id: 'heal_small', kind: 'levelup', apply: () => mockPlayer.hp += 20 })` 后:调 `rollLevelUpChoices(1)` 3 次 → 每次返回 3 个不重复 ID;`applyReward('heal_small')` 后 Mock Player hp +20。验证"按回调表分发",RewardShop 不知道 Player 存在。

> 测试只在你给具体 repro 或点名时再补,见顶层 §5。

---

## 8. 不做清单

- 不做 UI 卡片渲染(交给 HudUi 订阅 `reward:available` 渲染)。
- 不做关卡计时 / 场景切换(交给 Progression)。
- 不持有其他模块的 Port 引用(否则破坏解耦铁律)。
- 不做奖励的"性价比平衡"(留给 M8 数值调优,本模块只跑机制)。
