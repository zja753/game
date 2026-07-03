# M0 战斗核心 —— 验收清单

> 与 `m0-combat.md` 一一对应:每完成一项就把 `- [ ]` 改成 `- [x]`,并在备注里
> 记下手测时间 / 截图 / 控制台输出(可选)。
> 任务完成定义:① `vp check` 退出码 0;② 浏览器手测清单对应项一次过;③ 没引入新的 `any` / 注释掉的死代码。

## M0.1 Health 组件骨架

- [x] `components/Health.ts` 导出 `Health` 组件,字段 `hp / maxHp / invulnerableTimer / invulnerableDuration / isDead`。
- [x] `takeDamage` / `heal` / `isInvulnerable` / `update` / `onDamage` / `onDeath` 全部就位,事件用 Excalibur `EventEmitter`。
- [x] `components/Health.test.ts` 7 个用例全过(vitest):
  - `floor(t / 0.4)` 节流触发 `damage` 5 次
  - HP 归零只发一次 `death`,后续扣血静默
  - `heal` 不超 `maxHp`,且不打破无敌帧
  - 无敌帧内 `takeDamage` 静默返回 `false`
  - `update` 推进 `invulnerableTimer` 到 0
  - `damage` payload 携带 `amount / hp / maxHp / source`
  - `HealthEvent` 常量与订阅通道一致
- [x] `scene.ts` 在玩家身上挂 `Health({ maxHp: 100 })`,前 2 秒每帧自扣 1 滴做自检,保留供 M0.2 复用。
- [x] `vp check` 退出码 0。

## M0.2 Player 接入 Health + 血量可视化

- [x] `scene.ts` 玩家 `Health.maxHp = 100` / `hp = 100` 已在 M0.1 接好。
- [x] `HealthBar` Actor:
  - 每帧在 `onPreUpdate` 中把 `pos` 与玩家同步(`pos.setTo(owner.x, owner.y)`,避免每帧克隆)。
  - 通过 `graphics.onPostDraw` 画 `BG_COLOR` 描边矩形 + `FG_COLOR` 比例前景条。
  - `z = 11`,画在玩家 `z = 10` 之上。
  - `CollisionType.PreventCollision`,不参与物理。
  - 死亡 (`Health.isDead`) 时整条隐藏。
- [x] 玩家 alpha 闪白:仅在 `invulnerableTimer > 0` 期间,以 `PLAYER_FLASH_INTERVAL_S = 0.1s` 切换 `PLAYER_FLASH_OPACITY_ON / OFF`(1.0 / 0.3);无敌帧耗尽时立即复位到 `ON`。
- [x] 所有魔数(尺寸 / 颜色 / 闪白参数)挪到 `balance.ts` 的 `HEALTH_BAR_*` / `PLAYER_FLASH_*`。
- [x] `vp check` 退出码 0。
- [x] 浏览器手测:开 `/game`,4 帧截图(tick 1~4)可见血条位于玩家头顶,红色前景条随时间缩短(M0.1 自检在 2s 内对玩家造成 5 次 1 点伤害 → HP 100 → 95),无 console error / warning。

## M0.3 Player ↔ Enemy 接触伤害

- [x] `balance.ts` 新增 `ENEMY_CONTACT_DAMAGE = 10`。
- [x] `Enemy` 新增 `contactDamage` 字段(默认走 `balance.ts`,构造时可覆写,留给 M3 敌人种类化)。
- [x] `player.on("collisionstart")` 监听:另一方是 `Enemy` 且未 `isKilled()` → `playerHealth.takeDamage(enemy.contactDamage, { source: enemy })`。
- [x] `player.on("collisionend")` 监听:把对应 enemy 从 `inContactEnemies` Set 中移除,保证同 enemy 重叠期间不重复扣血(实际节流仍由 `Health.invulnerableTimer` 把关)。
- [x] 接触短路:`other.isKilled()` 提前 return,为 M0.6 敌人 `Health` 接入留口。
- [x] 重复扣血防御策略:**用 `Set<Enemy>` + `collisionend` 标志**(玩家侧独占状态,enemy 端零侵入),不是 excalibur 的 `pair` API —— 选型理由在 `scene.ts` 注释里写明。
- [x] 关闭 M0.1 自检(2 秒自扣 1 滴):由接触伤害替代验证节奏,常量 `HEALTH_SELF_CHECK_DURATION_S = 0`。
- [x] `vp check --fix` 通过(format + lint + typecheck 全部 0 退出)。
- [x] 浏览器手测:`ENEMY_SPAWN_INTERVAL_MS` 已还原成 `900ms`(`scene.ts:69`),2026-07-03 验证。
  - 站住不动 1 秒,血量至少掉 30(900ms 刷怪节奏下,1 秒内会出现 1~2 只 enemy 入场造成接触伤害),与 0.4s 无敌帧节流一致。
  - 移动脱离接触后停止掉血(`inContactEnemies` 集合 + `collisionend` 清理)。
  - 血量清零时不死机:玩家还站着,血条隐藏(`HealthBar.onPreUpdate` 检测 `isDead`)。

- [x] `balance.ts` 新增 `WEAPON_*` / `PROJECTILE_*` / `WALL_TAG` / `ENEMY_TAG` / `ENEMY_MAX_HP` 常量,所有魔数收敛。
- [x] `weapons/Pistol.ts`:持有 `range / fireRate / damage`,`tryFire(ctx)` 找射程内最近敌人,找不到返回 `false` 且不推进节流。
- [x] `weapons/Projectile.ts`:`damage / speed / lifetime / range / owner` 字段,`onPreUpdate` 推进三保险(寿命 / 射程 / 撞墙),`handleCollision` 区分 owner-友军 / 敌人 / 墙。
- [x] `scene.ts` 在玩家 `preupdate` 中监听 `Keys.Space.wasPressed` → `Pistol.tryFire`;Enemy 已挂 `Health({ maxHp: 30 })` 与 `ENEMY_TAG`。
- [x] `weapons/Pistol.test.ts` 4 个用例全过:射程内开火、射程外不消耗节流、节流窗口拒绝、无目标反复 tryFire 不推进。
- [x] `weapons/Projectile.test.ts` 8 个用例全过(本轮新增,与 `Pistol.test.ts` 同级):lifetime / range / 撞墙 / 命中敌人扣血 / 命中 owner 静默 / 命中已死敌人不重复结算 / `consumed` 守卫 / 默认 speed & lifetime 取自 `balance`。
- [x] `vp check` 0 退出(19/19 vitest 用例全过)。
- [x] 浏览器手测(headless):用 `window.___EXCALIBUR_DEVTOOL` + `_keysDown.push('Space')` 模拟攻击键,逐条验证:
  - Check 1 无敌人 → 3 次空格 → 0 弹。
  - Check 2 敌人 300px 内 → 3 次空格(节流 2 发/秒)→ 3 弹,逐发 HP 30→20→10→0 击杀。
  - Check 3 敌人 401px 外 → 0 弹。
  - Check 4 无敌人 5 次空格 → 0 警告 / 0 错误。
  - Check 5 移动中敌人进入射程 → 第一次按立刻开火(节流只在成功后推进,Check 2 iter 0 即证明)。
  - Check 6 弹丸撞边界自毁:实测从 (0,0) 朝 -y 飞,~360px 时 `range` 检查触发 `kill()`(当前 `WEAPON_RANGE_PX=360 < WORLD_SIZE/2=400` 的设计下,射程保险必先于墙体;撞墙代码路径在 `Projectile.test.ts` 覆盖)。
  - Check 7 友军 / 自打:`Pistol.findNearestEnemy` 只看 `enemy` tag 排除玩家;`Projectile.handleCollision` 对 owner 静默(单测覆盖)。
  - 截图确认玩家/敌人贴图渲染正常,弹丸(8px)在世界坐标系内飞行。

## M0.5 玩家死亡 + 重开

- [ ]
- [ ]

## M0.6 Enemy 击杀 → 销毁

- [ ]
- [ ]

## M0.7 玩家 ↔ Enemy 击杀通讯 + 投射物命中事件(给 M1 留口)

- [ ]
- [ ]

## M0.8 投射物撞墙销毁 + 综合回归

- [ ]
- [ ]
