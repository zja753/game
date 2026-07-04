# Module-Runtime

> 顶层路线见 [`../modular-roadmap.md`](../modular-roadmap.md)。本文件是 Runtime 模块的**自留地**:Port / 事件 / 内部子模块拆分 / 验收点都在这里。Runtime 是最底层,被所有其他模块依赖。

---

## 1. 职责

封装 Excalibur:Engine 生命周期、帧驱动 tick、Actor 工厂、对象池、坐标系统、碰撞层。**不**做游戏逻辑。

---

## 2. 对外 Port

文件:`game/src/runtime/ports/RuntimePort.ts`

```ts
interface RuntimePort {
  engine: Engine;
  now(): number; // 毫秒,统一时钟
  spawnActor(spec: ActorSpec): ActorId; // 统一工厂
  despawnActor(id: ActorId): void;
  loadScene<T>(scene: SceneSpec<T>): T; // 拿到场景根句柄
  onTick(cb: (dt: number) => void): () => void; // 帧驱动订阅
  objectPool<T>(
    key: string,
    factory: () => T,
    reset: (t: T) => void,
  ): { acquire(): T; release(t: T): void };
  collision: {
    addLayer(a: string, b: string): void;
    raycast(from: Vec2, dir: Vec2, maxDist: number, layers: string[]): HitResult | null;
  };
}
```

`ActorSpec` / `SceneSpec` / `ActorId` 等类型在 `runtime/types.ts` 集中定义。

---

## 3. 事件

- **输入事件**:无(最底层)。
- **输出事件**:无(它只提供 tick 钩子,让 Progression 自己 `onTick` 推时间)。

---

## 4. 权威字段

`Engine` 实例、Actor 句柄表、对象池表、碰撞层表。

---

## 5. 内部子模块草案

按职能拆 4 个内部子模块,**都**在本模块目录 `modules/runtime/` 下,**不**外露:

- `EngineFactory`:创建 / 销毁 Excalibur `Engine`;处理 resize、像素比。
- `ObjectPool`:泛型对象池(`{ acquire, release }`),reset 回调保证复用对象状态干净。
- `FrameClock`:对外 `onTick(cb)` 与 `now()`,内部订阅 `engine.on('preupdate', ...)` 并换算 dt。
- `CollisionLayerManager`:`addLayer(a, b)` 注册 Excalibur collision groups,`raycast` 封装空间查询。

> 本模块如再拆更深,自建 `modules/runtime/sub/<name>.md` 子目录。

---

## 6. 独立验收点

- **Demo 页** `/demo/runtime`:创建 Engine,画 1 个 Actor 让它以 100px/s 速度走 2 秒,断言位置 = (200, 0) ± 2。
- **vitest**:
  - `ObjectPool` 在 acquire/release 1000 次后无内存泄漏(acquired 数归零)。
  - `raycast` 在已知布局下命中正确点(给定墙坐标,断言 hit.position)。

---

## 7. 不做清单

- 不做游戏对象(玩家 / 敌人 / 投射物)的逻辑,只提供"创建 / 销毁 / 池化 / 帧"。
- 不发任何业务事件(它产出的唯一"事件"是 tick 回调)。
- 不感知 `GameScene` 状态机(状态机归 Progression 拥有,Runtime 只听 Progression 调 `engine.clock.start/stop`)。
