# UI 与 Canvas 拆分计划

> 目标：**Canvas 只画游戏世界**（主角、怪物、投射物、地图障碍、传送门）；
> **所有 UI 面板**（首页 / 角色选择 / 商店 / 升级 / 暂停 / 结算）**改用普通 React 组件**，
> 不再走 Excalibur 场景机。

---

## 1. 现状与问题

- `App.tsx` 只有两个路由：`/` 占位、`/game` = canvas + HUD。
- `HUD` 模块（HudUiModule）虽然已经是 React，但它和 canvas 一起挂在
  `/game` 路由下的 `.hud-mount` div 里，`HudRoot` 根据 `level:phase.scene`
  把 **全屏浮层**（角色选择 / 商店 / GameOver / Victory）都渲染在 canvas 上面。
- 痛点：和"游戏世界"无关的 UI 也被迫走 `level:phase` 场景机 + Excalibur 时钟生命周期；
  改首页、改商店交互要碰 HUD 模块、RootContainer、Progression 三处。

---

## 2. 新路由结构

| 路由         | 内容                             | 是否需要 canvas        |
| ------------ | -------------------------------- | ---------------------- |
| `/`          | 首页（纯 React，按钮 → /select） | 否                     |
| `/select`    | 角色选择（纯 React）             | 否                     |
| `/play`      | **游戏主界面**                   | ✅ canvas + 游戏中 HUD |
| `/shop`      | 商店（纯 React）                 | 否                     |
| `/game-over` | 结算（纯 React）                 | 否                     |
| `/victory`   | 通关（纯 React）                 | 否                     |

> 关键词：**全屏 = 路由**（和游戏世界无关，可以完全脱离 canvas）；
> **在游戏中暂停 = HUD 浮层**（仍要看到背后世界，不适合切路由）。

### Canvas vs React 划分

| 元素                                             | 归属                    | 原因                         |
| ------------------------------------------------ | ----------------------- | ---------------------------- |
| 主角 / 敌人 / 投射物 / 地图 / 传送门             | **Canvas**              | 游戏世界实体，每帧渲染       |
| 顶部 HUD（HP / XP / Timer / 等级 / 武器 / 击杀） | **React（游戏中浮层）** | 跟随游戏过程，不需要路由切换 |
| 升级三选一卡片                                   | **React（游戏中浮层）** | 玩家要看到背后游戏世界再选   |
| 暂停面板                                         | **React（游戏中浮层）** | 同上                         |
| 传送门提示                                       | **React（游戏中浮层）** | 同上                         |
| 首页                                             | **路由**                | 完全是"游戏外"               |
| 角色选择                                         | **路由**                | 同上                         |
| 商店                                             | **路由**                | 用户明确要求脱离游戏世界     |
| 结算 / 通关                                      | **路由**                | 同首页                       |

---

## 3. 最小改动清单

按改动量从小到大，每步可独立 `vp check` 验证。

### 第 1 步：HUD 模块瘦身（只动 HUD 内部）

在 `HudRoot.renderByScene` 里**只保留**和游戏过程相关的 scene 分支：

```ts
// 删掉这些 case（移交给路由）
case "character_select":  // → /select 路由
case "shop":              // → /shop 路由
case "gameover":          // → /game-over 路由
case "victory":           // → /victory 路由

// 保留这些 case（HUD 浮层）
case "running":           // HudTopBar（HP/XP/Timer/...）
case "levelup_modal":     // HudTopBar + LevelUpCards
case "portal":            // HudTopBar + PortalHint
case "pause"（用 context.scene 区分）  // HudTopBar + PauseOverlay
```

> `overlays.tsx` 里 `CharacterSelect` / `ShopOverlay` / `GameOverOverlay` /
> `VictoryOverlay` 组件**可以删除**（迁出去），或者保留作为内部组件被路由复用。
> 建议删除，避免后续重复维护。

### 第 2 步：新增路由页面

在 `src/pages/` 下新建（**纯 React**，不 import 任何 `modules/*` 内部）：

- `Home.tsx`（替换占位）：标题 + "开始游戏" 按钮 → `navigate("/select")`
- `CharacterSelectPage.tsx`：列出 `RewardShop.listByKind("character")` 或
  `progression.characters()`，点角色 → `bus.emit("character:picked", id)` + `navigate("/play")`
- `PlayPage.tsx`（替换 `Game.tsx`）：挂 canvas + HudUiModule（同现行逻辑）；
  用 `useGameState()` 拿到 `progression` Port；切到非 `running/levelup/portal/pause` 的
  scene 时**自动跳走**（见第 3 步）
- `ShopPage.tsx`：读 `rewardShop.listByKind("shop")`，点商品 → 调
  `progression.applyReward(id, "shop")` → `navigate("/play")`
- `GameOverPage.tsx` / `VictoryPage.tsx`：读 `runStats` 快照，"再来一局" →
  `progression.startRun()` → `navigate("/select")`

### 第 3 步：场景切换 ↔ 路由切换的桥

新增 `src/runtime/RouteSceneBridge.tsx`（**只是一个 React 组件**，无样式）：

```tsx
export function RouteSceneBridge() {
  const { bus, navigate } = useGameState();
  useEffect(() => {
    return bus.on("level:phase", (e) => {
      // 全屏 scene → 跳路由；游戏中 scene → 留在 /play
      if (e.scene === "character_select") navigate("/select");
      else if (e.scene === "shop") navigate("/shop");
      else if (e.scene === "gameover") navigate("/game-over");
      else if (e.scene === "victory") navigate("/victory");
      else navigate("/play");
    });
  }, [bus, navigate]);
  return null;
}
```

挂在 `App` 内部、`<Routes>` 外面。

### 第 4 步：把 RootContainer 提到 Context

**问题**：现在 RootContainer 在 `PlayPage` 的 `useEffect` 里创建；
切到 `/shop` 时 PlayPage 卸载，RootContainer 也跟着 dispose，Progression /
RewardShop 状态全没了。

**最小改动**：把 RootContainer 提升到 `App` 层级的 React Context：

```
App
├── BrowserRouter
│   ├── GameStateProvider           ← 创建 EventBus + RootContainer + Port refs
│   │   ├── RouteSceneBridge        ← 第 3 步
│   │   └── <Routes>...</Routes>
```

- `GameStateProvider` 在 `useEffect` 里 `createRootContainer(...)`，
  把 `bus` / `progression` / `rewardShop` 存进 ref + Context。
- `PlayPage` 不再创建 RootContainer，只用 Context 里的 `engine` 挂 canvas。
- 离开 `/play` 时**不** dispose（Context 的 dispose 只在 App 卸载时跑）。
- App 卸载 / HMR 时 `dispose()` 一次。

> 这一步是**唯一**真正"大"的改动（约 30 行代码），但不需要改任何模块的内部实现，
> 模块契约（ProgressionPort / RewardShopPort）已经够用了。

### 第 5 步：App 路由表更新

```tsx
// App.tsx 新结构
<BrowserRouter>
  <GameStateProvider>
    <RouteSceneBridge />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/select" element={<CharacterSelectPage />} />
      <Route path="/play" element={<PlayPage />} />
      <Route path="/shop" element={<ShopPage />} />
      <Route path="/game-over" element={<GameOverPage />} />
      <Route path="/victory" element={<VictoryPage />} />
    </Routes>
  </GameStateProvider>
</BrowserRouter>
```

`.app-nav` 导航条可以删掉（首页本身就有按钮）；或者保留用于开发期调试。

---

## 4. 不动的东西（铁律）

- `src/runtime/RootContainer.ts`：装配顺序、lazy proxy、contact-damage 路由都不动。
- `src/modules/*/internal/*`：模块内部一行不改。
- `src/runtime/EventBus.ts`：事件字典 + `level:phase` 仍然由 Progression 广播，
  只是**消费方**从"HUD 渲染全屏"变成"路由切换"。
- 模块间解耦铁律（roadmap §0.1）：新页面**只**通过 Context 拿到 Port 引用，
  不直接 import `modules/*/internal/*`。
- `vp check` 的 grep 检查（"modules 不跨模块 import"）继续生效。

---

## 5. 开发节奏

按 §3 的 5 步顺序走，每步结束跑 `vp check`：

1. **第 1 步**（HUD 瘦身）：删 `HudRoot` 的 4 个 scene case + 对应组件。
   此时 `/game` 路由下，进商店 / GameOver 会**没有 UI**（因为场景变了但 HUD 不再渲染）—— 正常。
2. **第 2 步**（新增页面）：建 6 个 `src/pages/*.tsx` 文件，每个先用静态占位数据。
   `vp check` 绿，但运行时还跑不通（Context 还没建）。
3. **第 3 + 4 步**（Context + Bridge）：建 `GameStateProvider` + `RouteSceneBridge`，
   改 `App.tsx` 路由表。改完 `/game` 改成 `/play`，能跑通就是成功。
4. **第 5 步**：打磨各页面交互（按钮、样式、stats 显示）。

> 旧 `src/pages/Game.tsx`、`src/pages/Home.tsx` 在第 5 步完成后删除。
> 旧 `src/styles/app.css` 里 `.page-game` / `.game-stage` / `.game-canvas` 等
> 全屏规则按需调整（PlayPage 会复用部分样式）。

---

## 6. 不在本次范围

- 商店 / 角色选择的具体视觉 / 交互设计（先把路由 + 切换跑通）
- 暂停页面是否升级为路由（保留为 HUD 浮层，更省事）
- HUD 浮层里的样式重做（hud.css 不动）
- i18n / 移动端适配
- 多角色数据建模（首版 `pickCharacter("default")` 占位即可）
