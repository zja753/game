# Module-Input

> 顶层路线见 [`../modular-roadmap.md`](../modular-roadmap.md)。本文件是 Input 模块的自留地:Port / 事件 / 内部子模块拆分 / 验收点都在这里。

---

## 状态:✅ 第一版已落地(2026-07-04)

实现文件:

- Port: [`../../src/runtime/ports/InputPort.ts`](../../src/runtime/ports/InputPort.ts)
- 事件: [`../../src/runtime/EventBus.ts`](../../src/runtime/EventBus.ts)(共享,见 modular-roadmap §2.1)
- 模块装配: [`../../src/modules/input/InputModule.ts`](../../src/modules/input/InputModule.ts)
- 子模块:
  - [`../../src/modules/input/internal/KeyboardMap.ts`](../../src/modules/input/internal/KeyboardMap.ts)
  - [`../../src/modules/input/internal/MouseMap.ts`](../../src/modules/input/internal/MouseMap.ts)
  - [`../../src/modules/input/internal/IntentNormalizer.ts`](../../src/modules/input/internal/IntentNormalizer.ts)
- Mock 工厂: [`../../src/modules/input/__mocks__/mockInput.ts`](../../src/modules/input/__mocks__/mockInput.ts)

测试:84 个用例通过(7 个测试文件),见 §6。`pnpm exec vitest run` / `pnpm exec vp check` 全绿。

与原计划的小偏差(均不影响接口语义):

1. `InputPort` **新增**了 `mousePos(): Vec2`,以配合 `axisAim(screenPos)` 形式:
   调用方写 `input.axisAim(input.mousePos())` 即可用上最近一次 `mousemove` 的位置。
   避免 Player / Progression 反向 import `MouseMap`。
2. `MouseMap` 暴露了 `buttonsDown()` 与 `MouseButton` 位掩码(接口预留),即便当前 `InputKey`
   没有"鼠标开火"——后续若开火改鼠标不需要再动 `MouseMap`。
3. `KeyboardMap` 暴露了 `clear()`(供 `InputModule` 在 `window.blur` 时调),防止 alt-tab 后
   "按着的键"留在 `held` 里变成幽灵输入。**不**影响 `enable / disable` 的语义。

---

## 1. 职责

键盘 / 鼠标 → 归一化为 `InputIntent` 事件和实时查询接口。**不**做游戏响应。

---

## 2. 对外 Port

文件:`game/src/runtime/ports/InputPort.ts`

```ts
interface InputPort {
  isDown(key: InputKey): boolean;
  axisMove(): Vec2; // WASD / 摇杆统一 → 单位向量
  axisAim(screenPos: Vec2): Vec2; // 鼠标位置 → 世界方向
  enable(): void;
  disable(): void; // 暂停时
}
```

`InputKey` 是共享字符串字面量联合(`'up' | 'down' | 'left' | 'right' | 'fire' | 'pause' | ...`),定义在 `runtime/types.ts`,**不**引用任何业务模块。

---

## 3. 事件

- **输入事件**:无(它从 DOM 监听键盘鼠标)。
- **输出事件**:
  - `input:move { dx, dy }` — 每帧最多发一次,玩家松开归零时也发
  - `input:fire { pressed }` — 边沿触发,只在按下瞬间发一次
  - `input:pause { pressed }` — 同上

---

## 4. 权威字段

当前按键状态(只供 InputPort 内部查询使用,**不**写到 GameContext)。

---

## 5. 内部子模块草案

按输入源拆 3 个内部子模块,**都**在本模块目录 `modules/input/` 下:

- `KeyboardMap`:`keydown` / `keyup` → 更新内部按键表,处理 modifier / 重复键抑制。
- `MouseMap`:`mousemove` / `mousedown` / `mouseup` → 更新鼠标位置与按钮状态。
- `IntentNormalizer`:从按键表算 `axisMove()` 单位向量;边沿检测产出 `input:fire` / `input:pause`。每帧由 Runtime 的 `onTick` 驱动推进。

---

## 6. 独立验收点

- **Demo 页** `/demo/input`:显示当前 `axisMove()`、`isDown('fire')`、`axisAim(mouse)` 的实时值;在 WASD 复合按压时确认归一化是单位向量。
- **vitest**:模拟 keydown / up 序列,断言:
  - `axisMove()` 输出符合预期(WASD 复合归一化后是单位向量)。
  - `input:fire` 仅在按下瞬间发 1 次(松开再按才发下一次)。
  - `enable() / disable()` 切换不影响按键表的清零逻辑。

---

## 7. 不做清单

- 不消费事件,只产生事件。
- 不绑定 Excalibur Input(完全走 DOM,避免与 Runtime 引擎耦合)。
- 不做"按住连发"——边沿触发语义由 `IntentNormalizer` 保证,不是 `KeyboardMap` 重复 keydown 的副作用。
