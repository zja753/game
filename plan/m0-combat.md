# M0 战斗核心 —— 任务拆分

> 范围:对应 `roadmap.md` 中 M0 段。结束态:**玩家能打、敌我有生死、死了能干净重开**。
> 每个任务都是独立可验证的最小切片,顺序按依赖排。建议一次只做一个,做完跑一次 `vp check` + 浏览器手测清单。

## 公共约定

- 文件落在 `game/src/game/` 下新建子目录:
  - `components/`(通用组件)
  - `weapons/`(武器与投射物)
  - `actors/`(通用 Actor 工厂)
- 所有数值走 `game/src/game/balance.ts`(M0 先建空文件,后续 M1/M3 往里塞),**禁止**在 scene/组件里硬编码魔数。
- 验证脚本统一记到 `game/plan/m0-checklist.md`,每条对应一个任务,做完了打勾。
- 任务完成定义:① `vp check` 退出码 0;② 浏览器手测清单对应项一次过;③ 没引入新的 `any` / 注释掉的死代码。

---

## M0.1 Health 组件骨架

**目标**:组件本身可用,与业务解耦。
**范围**:

- 新建 `components/Health.ts`,导出 `Health` 类(`Component` 子类),字段 `hp / maxHp / invulnerableTimer`。
- 公开 API:`takeDamage(amount, opts?)`、`heal(amount)`、`isInvulnerable()`。
- `takeDamage` 在 `invulnerableTimer > 0` 时直接 `return false`;成功扣血时把 `invulnerableTimer` 重置成组件自带的 `invulnerableDuration`(默认 0.4s)。
- 在 `update(elapsed)` 中按 `elapsed` 衰减 `invulnerableTimer`(秒)。
- 导出事件:`onDamage(payload) / onDeath()`(用 Excalibur 的 `EventEmitter` 或简单的 `on/off` 列表都行,选一种,本里程碑内统一)。

**验证**(全部在现有 `/game` 场景内进行,**不**新建路由 / Demo 页):

- 把 `Health` 临时挂到玩家身上做自检(等同 M0.2 的接法,只是写在前),`onPreUpdate` 里给自己 `takeDamage(1)`,持续 2 秒。
- 在控制台观察 `onDamage` 触发次数 ≈ 2 / 0.4 = 5 次(允许 ±1 抖动),`hp` 从初始值降到对应值。
- 验完这段自检逻辑可以留在玩家身上(M0.2 会复用),**不需要** M0.1 阶段再删。
- 替代品(强烈推荐):为 `Health` 写一个最薄的 `vitest` 单测,直接 `new Health({ maxHp: 10, invulnerableDuration: 0.4 })`,用假时钟(`vi.useFakeTimers()`)推进时间,断言 `onDamage` 调用次数 = `floor(t / 0.4)`。这条与场景无关,纯组件单测。
- `vp check` 通过。

---

## M0.2 Player 接入 Health + 血量可视化

**目标**:玩家有血条,被扣血看得到。
**范围**:

- `scene.ts` 里给 `Player` 挂 `Health`,`maxHp = 100`,`hp = 100`。
- 在玩家身上画一条血条:血条 Actor 跟随玩家;`onPostDraw` 用 `ctx.drawRectangle` 画绿色背景 + 当前比例的红色前景。
- 玩家被任何来源 `takeDamage(10)` 时,血条立即更新;`invulnerableTimer > 0` 时玩家整体 alpha 闪一下(0.3 透明 ↔ 1.0,每 0.1s 切换)。

**验证**:

- 在控制台手动 `playerHealth.takeDamage(10)`,能看到血条掉一格、闪白一次。
- 连点 3 次(每次扣 10),实际只掉一次(无敌帧生效),剩下两次 `onDamage` 不触发。
- 死亡(扣到 0)时玩家不消失,M0.5 再接死亡流程。

---

## M0.3 Player ↔ Enemy 接触伤害

**目标**:敌人群里冲撞会掉血,无敌帧可救。
**范围**:

- 玩家与任意 `Enemy` 在 `onCollisionStart` 时,Enemy 对玩家造成 `Enemy.contactDamage`(默认 10)。
- 给 `Enemy` 加 `contactDamage` 字段(写死常量,挪进 `balance.ts`)。
- 同一 Enemy 与玩家重叠期间**不重复扣血**(用 `onCollisionEnd` 清标志位,或者用 `excalibur` 自带 `pair` API,任选一种,在文件头注释里注明)。
- 验证时临时把 `ENEMY_SPAWN_INTERVAL_MS` 调到 100ms 加速验证,验完还原。

**验证**:

- 站住不动,1 秒内血量至少掉 30,且扣血节奏与无敌帧一致(不会每帧掉)。
- 移动脱离接触后停止掉血。
- 血量清零时不死机(死亡是 M0.5 的事,本任务允许"死了还显示血条 0 但玩家还站着")。

---

## M0.4 Weapon & Projectile 最小闭环(单发 Pistol + 射程)

**目标**:玩家按攻击键,**射程内有敌人才开火**;没敌人不浪费弹药。
**射程规则**(M0 锁定这套,后续不改):

- `Weapon` 持有 `range`(默认 360 像素)、`fireRate`(默认 2 发/秒)、`damage`(默认 10,先放 Weapon 自己,M1 之后挪到 `balance.ts`)。
- 玩家按攻击键时,`Weapon.tryFire(now, owner, playerPos, scene)` 内部:
  1. 找 `range` 内**最近**的 `Enemy`(简单遍历 + 距离平方比较;无需空间索引,M0 敌人数量级够用)。
  2. **找不到目标** → 直接 `return false`,**不**发弹、**不**消耗节流窗口(玩家放开后能立即再按)。
  3. 找到目标 → 算朝向目标的单位向量 `dir`,`Projectile` 沿 `dir` 飞出。
- `weapons/Projectile.ts`:`Projectile` Actor,字段 `damage / speed / lifetime / owner / range`,`onPreUpdate` 按 `dir` 匀速直行;`lifetime` 到 0、或已飞过 `range`、或撞墙(`scene.actors` 里 `wall.tag === 'wall'`)任一触发即 `kill()`。
- 玩家按 **空格** 调用 `tryFire`(留 TODO:接鼠标左键)。
- 临时:把 `Enemy` 挂上 `Health`(`maxHp = 30`)。Projectile 与 Enemy `onCollisionStart` 调 `enemyHealth.takeDamage(Projectile.damage)`,之后 `Projectile.kill()`。
- 共用一个"是否对 owner 友军"判断:owner === this 不造成伤害。

**验证**:

- 场上无敌人时连按空格:零发弹道出现,玩家不报错,console 干净。
- 走位让一个敌人在 360 像素内:连按 3 下空格,3 颗弹朝它飞出,3 发都消失(撞敌人或墙),敌人血量正确减少。
- 站到一个敌人在 400 像素外:连按空格,一颗都不发。
- 走到墙边、敌人不在视野:按 5 下空格,console 不报 "no target" 之类,只是不响。
- 移动中让敌人进入射程:第一次按下能立即开火(节流只在成功开火后才生效,**"打不到不消耗"是关键点**)。
- 朝墙打一颗弹,弹撞墙自毁(不穿出世界)。
- 朝玩家自己脚下打一颗(用 console 临时改 dir),玩家血量不变。
- `vp check` 通过。

---

## M0.5 玩家死亡 + 重开

**目标**:死掉出"Game Over"面板,点重开回到满血、空场。
**范围**:

- 玩家 `Health` 在 `hp <= 0` 触发 `onDeath`:`scene.engine.clock.stop()`、冻结所有 `Enemy` 与 `Projectile` 的 `vel`(遍历置 0),隐藏血条。
- DOM 层:在 `pages/Game.tsx` 监听 `onDeath`(通过一个简单的 `mitt` / 自写 EventBus),显示半透明遮罩 + "Game Over" + 按钮"重开"。
- "重开"点击 → `disposeGame(engine)` → 重新 `createGame(canvas)`。玩家满血、敌人清空、计时未接入所以不动。
- 死亡状态下不要清空 `xp` / 升级(M0 还没接入)。

**验证**:

- 让玩家被 1 只敌人围住直到血条归零,出现面板,场景真的停了(敌人不再移动、生成计时器停)。
- 点"重开":角色回到世界中心、满血、敌人重新刷,无 console error。
- 反复死/开 5 次无内存泄漏迹象(DevTools 内存面板基本稳定;不强求精确数字)。

---

## M0.6 Enemy 击杀 → 销毁

**目标**:敌人血量归零能被干净移除,M0.4 的子弹真的"杀得死"。
**范围**:

- 给 `Enemy` 挂 `Health`,`maxHp = 30`,在 `Enemy` 被 `takeDamage` 致死时 `enemy.kill()`。
- `scene.on('postupdate')` 现有的越界清理保留,确认不会和 `kill()` 冲突。
- 死亡瞬间 Enemy 不再造成接触伤害(在 `M0.3` 的接触伤害里增加 `enemy.isKilled()` 短路判断)。

**验证**:

- 朝一个静止敌人连按 4 下空格(M0.4 一发 10,3 发必杀),敌人消失、地图上无残留。
- 死亡瞬间再撞到它,不掉血。
- 验证完把 `ENEMY_SPAWN_INTERVAL_MS` 还原成 900ms,场上密度回到正常手感。

---

## M0.7 玩家 ↔ Enemy 击杀通讯 + 投射物命中事件(给 M1 留口)

**目标**:M0 阶段就用最干净的事件桥把"敌人死亡"和"投射物命中"广播出去,M1 直接订阅。
**范围**:

- 新建 `game/Events.ts`,提供一个全局 `GameEventBus`(单例)。
- 事件:
  - `enemy:killed({ kind, position, xp })` — M0 内 `xp` 写死 1,M1 再接配置。
  - `player:died()` — 已经在 M0.5 触发,本任务里统一挪到 `GameEventBus`。
  - **`projectile:hit({ position, targetKind, damage, isKill })`** — 在 M0.4 的 Projectile ↔ Enemy 碰撞处触发;`isKill = (target.health.hp - damage) <= 0`。
- M0.5 的 DOM 监听改用 `GameEventBus`,不再用局部 `mitt`。
- 事件命名走 `xxx:action` 风格(已在用:`enemy:killed` / `player:died` / `projectile:hit`),文档头注释里写明约定。
- M0.7 自身**不**实现击杀掉落 / 特效 / 统计,只发事件。

**验证**:

- 在控制台挂两个监听:
  ```ts
  GameEventBus.on("enemy:killed", (e) => console.log("K", e));
  GameEventBus.on("projectile:hit", (e) => console.log("H", e));
  ```
- 击杀一个敌人(连按空格):先看到 N 次 `H`(N = 弹与敌人碰撞次数),最后 1 次 `H` 的 `isKill = true`,紧接着 1 次 `K`。
- 没击杀的命中(打血厚的敌人,先打 2 发):console 各 1 次 `H`,`isKill = false`,**没有** `K`。
- 触发玩家死亡时打印 1 次 `player:died`,且 M0.5 的"Game Over"面板照常弹出。
- 没有未捕获的 console warning / error。

---

## M0.8 投射物撞墙销毁 + 综合回归

**目标**:关底级验收,把 M0 所有改动串起来走一遍,顺手补漏。
**范围**:

- M0.4 已实现 Projectile 撞墙销毁;本任务**只做回归 + 边界用例**。
- 检查项:
  - 玩家贴墙按攻击键,弹道不泄漏到墙外(贴上沿往正北打,弹朝上飞 0 距离后销毁,不留残留)。
  - 同时存在 30 个 `Projectile` + 30 个 `Enemy` 时不掉帧(< 16ms / 帧,在 1080p 窗口下目测顺滑即可,不强求 profile)。
  - 玩家、敌人、投射物、墙的 `collisionType` 设置在 `scene.ts` 顶部以表格注释呈现(M1/M3 还会动,这次先把"现状"写清楚)。
- 更新 `roadmap.md` 的 M0 段:把"现状缺口"项打勾,改写为"已交付"。

**验证**(完整 M0 验收清单):

1. `vp check` 0 退出。
2. 进入 `/game`,玩家满血 100,血条 100% 绿色。
3. 站住不动 2 秒,血量被敌人接触扣到 ≤ 60,且无敌帧生效(掉血不连续)。
4. 朝最近敌人连按空格,敌人血量减少,3~4 击击杀,敌人消失,console 收到 1 次 `enemy:killed`。
5. 朝墙打一颗弹,弹撞墙自毁。
6. 被打到 0 血,出现"Game Over"面板,场景冻结,无报错。
7. 点"重开",玩家满血、敌人重新刷。
8. DevTools console 全程无 error。

---

## 完成 M0 后

- 跑一次 `vp check --fix` 让 pre-commit 风格自检过。
- 在 `game/plan/m0-checklist.md` 里把 8 个任务逐条打勾、留手测视频/截图链接(可选)。
- 通知用户验收 → 通过即开始 M1 拆分。
