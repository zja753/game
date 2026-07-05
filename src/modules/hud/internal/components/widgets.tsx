/**
 * 通用小组件(plan/modules/hud.md §6)。
 *
 * 设计原则:
 *  - 全部**纯展示** —— props 入参,无内部 state,不订阅 store。
 *  - 渲染层不发起事件,玩家点哪张卡由上层 overlay 把 id 传回 `pickReward`。
 *  - 没有 props 时退化为"未知"占位(由调用方决定是否传)。
 *  - 全部走 React 19 + `useSyncExternalStore`(由父层 `HudRoot` 提供数据)。
 */
import type { ReactElement } from "react";

/**
 * `HealthBar` —— 玩家血条。
 *
 * @param hp 当前 HP(来自 `player:damaged` 的 `hp` 字段)。
 * @param maxHp HP 上限;若为 0(初始未发 `player:damaged`)显示空槽。
 */
export function HealthBar({ hp, maxHp }: { hp: number; maxHp: number }): ReactElement {
  // 防御:`maxHp <= 0` 时百分比 = 0,避免出现除零 / NaN 宽度。
  const ratio = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
  const pct = `${(ratio * 100).toFixed(1)}%`;
  return (
    <div
      className="hud-health"
      role="meter"
      aria-label="health"
      aria-valuemin={0}
      aria-valuemax={Math.max(1, maxHp)}
      aria-valuenow={Math.max(0, Math.min(maxHp, hp))}
    >
      <div className="hud-health__fill" style={{ width: pct }} />
      <span className="hud-health__label">
        {Math.round(hp)} / {Math.round(maxHp)}
      </span>
    </div>
  );
}

/**
 * `XpBar` —— 经验条。
 *
 * 首版不接 Player 模块的 XpToNext(协议层没暴露),仅占位 —— 显示 `0% / 0%`
 * 文本,等 Progression / Player 把权威字段接到 bus 时再展示真实数据。
 */
export function XpBar({ xp }: { xp: number }): ReactElement {
  return (
    <div className="hud-xp" role="meter" aria-label="xp" aria-valuenow={xp}>
      <span className="hud-xp__label">XP {xp}</span>
    </div>
  );
}

/**
 * `Timer` —— 关卡倒计时(由 `timer:tick` 推动)。
 *
 * @param remaining 剩余秒数(浮点;<= 0 时显示 `00:00`)。
 * @param total 关卡总时长秒数;首版可传 0,不展示 " / total"。
 */
export function Timer({ remaining, total }: { remaining: number; total: number }): ReactElement {
  const r = Math.max(0, remaining);
  const mm = Math.floor(r / 60);
  const ss = Math.floor(r % 60);
  const text = `${pad(mm)}:${pad(ss)}`;
  const totalText =
    total > 0 ? ` / ${pad(Math.floor(total / 60))}:${pad(Math.floor(total % 60))}` : "";
  return (
    <div className="hud-timer" aria-label="time remaining">
      <span className="hud-timer__value">{text}</span>
      {totalText !== "" && <span className="hud-timer__total">{totalText}</span>}
    </div>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/**
 * `WeaponIcon` —— 当前武器图标(首版只有 `pistol`)。
 *
 * 无具体 sprite 时显示武器 ID 文本;真正 sprite 由 M2+ 接入资源后替换。
 */
export function WeaponIcon({ weaponId }: { weaponId: string | null }): ReactElement {
  return (
    <div className="hud-weapon" aria-label="weapon">
      <span className="hud-weapon__name">{weaponId ?? "—"}</span>
    </div>
  );
}

/**
 * `KillCounter` —— 玩家累计击杀(由 `enemy:killed` 推动)。
 */
export function KillCounter({ kills }: { kills: number }): ReactElement {
  return (
    <div className="hud-kills" aria-label="kills">
      <span className="hud-kills__value">{kills}</span>
    </div>
  );
}

/**
 * `LevelBadge` —— 当前关卡 ID。
 */
export function LevelBadge({ level }: { level: string | null }): ReactElement {
  return (
    <div className="hud-level" aria-label="level">
      <span className="hud-level__value">{level ?? "—"}</span>
    </div>
  );
}
