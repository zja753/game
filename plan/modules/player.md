# Module-Player

> 顶层路线见 [`../modular-roadmap.md`](../modular-roadmap.md)。本文件是 Player 模块的自留地:Port / 事件 / 内部子模块拆分 / 验收点都在这里。

---

## 1. 职责

玩家 Actor 的生命周期、移动、血量、朝向、受击反馈。**不**做武器 / 攻击判定 / 敌人 AI / 关卡。

---

## 2. 对外 Port

文件:`game/src/runtime/ports/PlayerPort.ts`

```ts
interface PlayerPort {
  pos(): Vec2;
  setPos(v: Vec2): void; // 初始化 / 传送门后
  hp(): number;
  maxHp(): number;
  applyDamage(amount: number, from?: DamageSource): boolean; // true = 实际扣血
  applyHeal(amount: number): void;
  addBuff(buff: BuffSpec): void; // 被动叠加,M6+ 用
  isDead(): boolean;
  reset(): void; // 重开
}
```

`DamageSource` 是 `unknown`(纯占位,避免类型泄露),`BuffSpec` 在本模块内 export,其他模块通过 `RewardShop` 的回调注册间接用上,**不**直接引用类型名。

---

## 3. 事件

- **输入事件**(本模块订阅):
  - `input:move { dx, dy }` → 推 `vel`,订阅 `runtime.onTick` 推进位置
  - `input:fire { pressed: true }` → 调 `CombatPort.tryFire()`
- **输出事件**(本模块发出):
  - `player:moved { x, y, facing }` — 每帧或阈值变化时(见下)
  - `player:damaged { hp, maxHp }`
  - `player:died { at }`

`player:moved` 触发策略:vel 变化 > 阈值 / 移动距离 > 阈值时发,**不**每帧发,避免事件洪流。

---

## 4. 权威字段

`pos / hp / maxHp / facing / buffs / invulnerableTimer / inContactEnemies`。

---

## 5. 内部子模块草案

按职责拆 4 个内部子模块,**都**在本模块目录 `modules/player/` 下:

- `PlayerMover`:vel 积分 + 墙碰撞查询(用 `MapObstaclePort.isBlocked`,以 Port 形式注入)。
- `HealthController`:HP 状态机、无敌帧(`invulnerableTimer` 节流)、`onDamage` / `onDeath` 钩子分发。
- `PlayerActor`:Excalibur Actor 包装,挂上述两个子模块为 Excalibur Component;死亡时整条隐藏 + `vel=0`。
- `FacingTracker`:维护 `facing`(从 vel 或鼠标方向二选一,默认鼠标方向,需要 `InputPort.axisAim`)。

> `HealthController` 即旧 `components/Health.ts` 的迁移目标(见顶层文档 §"迁移"——本模块子文档之后另起一份 `modules/player/migration.md` 也行,本路线不锁死)。

---

## 6. 与其他模块的 Port 依赖(由 RootContainer 注入)

- 持有 `RuntimePort`(spawn 自己、订阅 tick)
- 持有 `MapObstaclePort`(碰撞查询)
- 持有 `CombatPort`(调 `tryFire`)
- 持有 `InputPort`(读 `axisAim` 算朝向,可选)

---

## 7. 独立验收点

- **Demo 页** `/demo/player`:Mock `MapObstacle` 全空 + Mock `Combat` 记录调用次数,玩家满血,按 WASD 移动,断言位置同步;`applyDamage(50)` 看到血量变化 + `player:damaged` 事件;`applyDamage(999)` 触发 `player:died`。
- **vitest**:
  - 受伤 3 次(10/10/10)只有 2 次实际扣血(无敌帧 `0.4s` 节流)。
  - 死亡时 `isDead()` 一次 true 后不再变化。
  - `player:moved` 触发频率满足阈值策略(不每帧发)。
  - 接触伤害节流:`inContactEnemies` Set + `collisionend` 清理,同 enemy 重叠期间只扣一次。

---

## 8. 不做清单

- 不做武器选型(交给 Combat + RewardShop 回调)。
- 不做攻击判定 / 命中结算(交给 Combat)。
- 不做敌人 AI(交给 Enemy)。
- 不做关卡计时(交给 Progression,本模块只响应 `player:died` 由 Progression 切 scene)。
