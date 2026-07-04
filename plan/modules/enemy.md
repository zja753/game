# Module-Enemy

> 顶层路线见 [`../modular-roadmap.md`](../modular-roadmap.md)。本文件是 Enemy 模块的自留地:Port / 事件 / 内部子模块拆分 / 验收点都在这里。

---

## 1. 职责

敌人数据 + AI 行为 + 状态机 + 生成调度 + 接触伤害。**不**做武器、不做关卡计时、不做投射物。

---

## 2. 对外 Port

文件:`game/src/runtime/ports/EnemyPort.ts`

```ts
interface EnemyPort {
  list(): readonly EnemySnapshot[]; // 供 Combat 选目标
  applyDamage(id: ActorId, amount: number): DamageResult; // 供 Combat 调
  spawn(kind: EnemyKind, pos: Vec2): ActorId; // 供 Progression 调
  count(): number;
  clear(): void; // 切关时
}
```

`EnemySnapshot` = `{ id, kind, pos, hp }`(纯数据);`DamageResult` = `{ isKill: boolean, remainingHp: number }`。

---

## 3. 事件

- **输入事件**(本模块订阅):
  - `player:moved`(AI 跟随)
  - `level:phase`(phase=`portal` / `shop` 时停止 spawn)
- **输出事件**(本模块发出):
  - `enemy:spawned { kind, pos }`
  - `enemy:dying { id, kind, pos, hp }` — dying 通知,**Combat 再发 `enemy:killed`**

为什么不直接发 `enemy:killed`?因为**判定权在 Combat**(投射物打死的),Enemy 只能说"我要死了"。Combat 收到 `enemy:dying` 后做最终结算发 `enemy:killed`。

---

## 4. 权威字段

所有 EnemyActor 的状态(`pos / vel / hp / kind / behavior / lastHitAt` / 接触玩家 Set)。

---

## 5. 内部子模块草案

按职能拆 4 个内部子模块,**都**在本模块目录 `modules/enemy/` 下:

- `EnemyRegistry`:`EnemyKind → EnemySpec { speed, hp, damage, behavior }`。第一版只放 `Chaser`,M3+ 加 `Dasher` / `Shooter`。
- `BehaviorStrategy`:`{ tick(enemy, ctx, dt): Vec2 }` 策略对象。第一版 `ChaserBehavior`(匀速朝玩家),后续加 `DasherBehavior` / `ShooterBehavior`。**不**写 if/else 大链,新增行为 = 注册新策略。
- `SpawnScheduler`:从 `ProgressionPort` 拿当前关配置决定种类 + 密度;按 `level:phase` 启停。
- `ContactDamage`:与玩家接触时调 `PlayerPort.applyDamage()`;用 `lastHitAt` 节流避免每帧扣血。

---

## 6. 与其他模块的 Port 依赖(由 RootContainer 注入)

- 持有 `RuntimePort`(spawn 敌人)
- 持有 `PlayerPort`(接触伤害)
- 持有 `ProgressionPort`(拿关卡配置,响应 scene 启停 spawn)
- 持有 `MapObstaclePort`(AI 寻路时避墙,可选)

---

## 7. 独立验收点

- **Demo 页** `/demo/enemy`:Mock 一个静止"玩家"在原点,spawn 5 个 Chaser,5 秒后断言它们平均位置距玩家 < 100px(都在追)。Mock 一个在 1000px 外的 Chaser,5 秒后仍 < 50px 移速进展(没在追玩家——验证 Behavior 的"目标选择"逻辑)。
- **vitest**:
  - `BehaviorStrategy` 单测 Chaser 在固定 dt 下位置变化正确(速度 × dt)。
  - `ContactDamage` 不会每帧扣血(`lastHitAt` 节流)。
  - `EnemyRegistry` 切换 `swapKind` 后 `list()` 返回新 spec。
  - `applyDamage` 在 hp 归零时返回 `isKill: true` 并发 `enemy:dying`。

---

## 8. 不做清单

- 不做投射物 / 武器(交给 Combat)。
- 不做关卡倒计时 / 场景切换(交给 Progression)。
- 不做玩家血量写入(只调 `PlayerPort.applyDamage`)。
- 不做死亡粒子 / 音效(留给打磨阶段)。
