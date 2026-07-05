# Module-Combat

> 顶层路线见 [`../modular-roadmap.md`](../modular-roadmap.md)。本文件是 Combat 模块的自留地:Port / 事件 / 内部子模块拆分。

---

## 1. 职责

武器数据 + 投射物 + 命中判定 + 击杀事件分发。**不**做玩家移动、不做敌人 AI、不做经验值。

---

## 2. 对外 Port

文件:`game/src/runtime/ports/CombatPort.ts`

```ts
interface CombatPort {
  tryFire(now: number, ownerId: ActorId, origin: Vec2): FireResult;
  swapWeapon(id: WeaponId): void;
  currentWeapon(): WeaponId;
  damageDealt(): number; // 本局累计,给 HUD
  kills(): number;
  listWeapons(): readonly WeaponId[];
}
```

`WeaponId` 是字符串字面量联合(`'pistol' | ...`),定义在 `runtime/types.ts` 或本模块的 `weapons` 子目录(见下)。`FireResult` 是 `unknown`(纯数据,避免类型泄露)。

---

## 3. 事件

- **输入事件**(本模块订阅):
  - `player:moved`(用于"近距优先"目标选择的兜底;主路径靠 `tryFire` 拿 origin)
  - `enemy:spawned` / `enemy:killed` / `enemy:dying`(维护内部"当前所有敌人"索引,供 `tryFire` 选目标)
- **输出事件**(本模块发出):
  - `projectile:hit { pos, targetKind, damage, isKill }`
  - `enemy:killed { kind, pos, xp }` — **击杀事件由 Combat 发出**,因为是投射物判定致死;Enemy 模块只广播 `enemy:dying`

---

## 4. 权威字段

`currentWeapon` / `weaponStats` / 投射物池 / 命中日志(累计 damageDealt / kills)。

---

## 5. 内部子模块草案

按职能拆 4 个内部子模块,**都**在本模块目录 `modules/combat/` 下:

- `WeaponRegistry`:每种 `WeaponId` 的 `WeaponSpec`(`fireRate / damage / range / projectileCount / spread`)。第一版只放 `pistol`。
- `ProjectileFactory`:从 `RuntimePort` 对象池取 Actor 包装成 `Projectile`。
- `HitResolver`:处理 `onCollisionStart` 时的伤害计算(M0 简单公式,未来 modifier 链)。
- `TargetSelector`:`tryFire` 内找射程内最近敌人;返回 `null` 时**不**消耗节流(关键!这就是"打不到不浪费弹药")。

> 第一版 `Pistol` + `Projectile` 旧文件迁入 `modules/combat/`,作为 `WeaponId="pistol"` 的实现。迁移细节记录在 `modules/combat/migration.md`(`weapon.tryFire` / `projectile.handleCollision` 等)。

---

## 6. 与其他模块的 Port 依赖(由 RootContainer 注入)

- 持有 `RuntimePort`(spawn 投射物、对象池)
- 持有 `MapObstaclePort`(投射物撞墙销毁)
- 持有 `EnemyPort`(只读 `list()` 选目标 + 调 `applyDamage()` 写伤害)

---

## 7. 关键设计点

Combat 与 Enemy 的耦合只有"读列表选目标"和"写伤害"两个动作,都通过 `EnemyPort` 接口,**不**直接 import Enemy 模块任何符号。投射物与敌人 `onCollisionStart` 回调里,只调 `EnemyPort.applyDamage(projectileId, dmg)`,**不知道也不关心** Enemy 模块内部怎么实现"扣血→判定死亡→广播"。

选目标靠 `EnemyPort.list()` 返回的纯数据快照(`readonly { kind, pos, hp }[]`),Combat 在自己的 `TargetSelector` 里做"射程内最近"逻辑。

击杀事件**双发**:

- `enemy:dying` ← Enemy 收到 `applyDamage` 后血归零发出
- `enemy:killed` ← Combat 在 `HitResolver` 里判定 `isKill=true` 后发出,携带 `xp` 字段供 Progression 累加

---

## 8. 验收

`pnpm exec vp check` 全绿;`pnpm dev` 接进 RootContainer 后:Mock 3 个静止"敌人"在 (100,0) / (0,200) / (-200,0),点 `tryFire` → 第一个被命中的是 (100,0);`projectile:hit` 事件 1 次 `damage=10`;4000px 外的目标按 5 次 `tryFire` 0 次发射(`TargetSelector` 节流)。

> 测试只在你给具体 repro 或点名时再补,见顶层 §5。

---

## 9. 不做清单

- 不做敌人行为(交给 Enemy)。
- 不做玩家移动(交给 Player)。
- 不做经验值(交给 Progression 订阅 `enemy:killed` 自己累加)。
- 不做武器外观 / 音效(留给打磨阶段)。
