# Module-HudUi

> 顶层路线见 [`../modular-roadmap.md`](../modular-roadmap.md)。本文件是 HudUi 模块的自留地:Port / 事件 / 内部子模块拆分。HUD 是**唯一**把模块事件渲染成玩家看到画面的模块,也是**唯一**完全无 Port 依赖的模块。

---

## 1. 职责

React 浮层:HP 条、经验条、计时、武器图标、暂停面板、Game Over、升级 / 商店卡片。**只读** + **只**发"用户已选 Reward"事件。

---

## 2. 对外 Port

文件:`game/src/runtime/ports/HudUiPort.ts`

```ts
interface HudUiPort {
  show(): void; // 启动 React
  hide(): void; // 暂停或重开过渡
  pickReward(id: RewardId): void; // 玩家在卡片上点击
}
```

`pickReward` 内部就是 `bus.emit({ type: 'reward:picked', id, kind })`,不在 Port 接口里暴露 EventBus。

---

## 3. 事件

- **输入事件**(本模块订阅,全部用于展示):
  - `player:damaged` / `player:died`
  - `xp:gained` / `level:up` / `level:phase` / `timer:tick`
  - `reward:available` / `reward:applied`
  - `enemy:killed`(可选,击杀计数)
  - `map:loaded`(关卡名显示)
- **输出事件**(本模块发出):
  - `reward:picked { id, kind }` ← 玩家在 UI 上选了哪个,RewardShop 间接 / Progression 直接 订阅

---

## 4. 权威字段

无(纯展示)。本模块内部可以缓存 `useState` 但**不**对外暴露。

---

## 5. HUD 怎么把数据变成画面

HUD 启动时由 RootContainer 调一次 `hud.show()` 把 React 树挂到 `/game` 路由的 div 上,**之后全自动工作**。

渲染策略 = **`EventBridge` 把 EventBus 转成一个 store(用 Zustand / Jotai / 自写 EventEmitter 均可),React 组件订阅 store**。

根组件 `<HudRoot>` 根据 `level:phase.scene` 切换**根布局**:

| `scene`            | 根布局内容                                                      | 背景游戏世界 |
| ------------------ | --------------------------------------------------------------- | ------------ |
| `character_select` | 全屏遮罩 + 角色选择卡片(渲染 `context.characters`)              | 黑屏 / 隐藏  |
| `running`          | 顶部条(血 / 经验 / 计时 / 关卡) + 右下角武器图标 + 击杀计数     | **显示并跑** |
| `levelup_modal`    | **世界仍可见**(半透明) + 中央三张升级卡(渲染 `context.choices`) | 暂停         |
| `portal`           | 顶部条 + 中央提示"找传送门" + 剩余敌人数                        | 暂停但仍可见 |
| `shop`             | **世界仍可见**(暗化) + 商店面板(渲染 `context.items`)           | 暂停         |
| `gameover`         | 全屏遮罩 + Game Over 面板(渲染 `context.stats`)                 | 冻结         |
| `victory`          | 全屏遮罩 + 胜利结算(渲染 `context.stats`)                       | 冻结         |

**关键**:**HUD 不知道 Progression 的存在**。它只订阅 `level:phase`,自己根据 `scene` 决定渲染哪个根组件。`context` 里携带的 `choices / items / characters / stats` 是纯数据,HUD 拿到什么就渲染什么。

---

## 6. 内部子模块草案

按渲染层次拆:

- `HudRoot`:挂到 React Router 的 `/game` 路由,根据 store.scene 切根布局。
- `EventBridge`:把 `GameEventBus` 转 Zustand / Jotai store,React 订阅。
- 通用小组件:`HealthBar` / `XpBar` / `Timer` / `WeaponIcon` / `KillCounter`。
- 浮层组件:`PauseOverlay` / `GameOverOverlay` / `LevelUpCards` / `ShopOverlay` / `CharacterSelect` / `VictoryOverlay`。

---

## 7. 与其他模块的 Port 依赖

**无**(HUD 是**唯一**完全无 Port 依赖的模块,只订阅事件)。

---

## 8. 验收

`pnpm exec vp check` 全绿;`pnpm dev` 接进 RootContainer 后手动 `GameEventBus.emit({...})` 模拟事件流,断言 DOM 响应:`player:damaged` → 血条缩短;`level:up` + `level:phase` → 三张升级卡出现;`reward:picked` 点击 → 卡片消失 + 升级条推进;`player:died` → Game Over 遮罩。

> 测试只在你给具体 repro 或点名时再补,见顶层 §5。

---

## 9. 不做清单

- 不渲染游戏世界(那是 Excalibur Canvas,React 只浮在上面)。
- 不做玩家控制(交给 Input / Player 模块)。
- 不做武器逻辑(只展示 `currentWeapon` 图标)。
- 不做 Game Over 之后的重开逻辑(那是 Progression 收到 `player:died` 后切 `gameover`,玩家点重开按钮走 RootContainer.dispose + 重建)。
