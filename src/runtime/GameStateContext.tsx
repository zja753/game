/**
 * `GameStateContext` — 全局游戏状态 Context(plan/ui-react-split.md §4)。
 *
 * 解决的问题:
 *  - RootContainer 原本在 `PlayPage` 的 useEffect 里创建,导致切到 `/shop` /
 *    `/game-over` 等路由时 PlayPage 卸载、RootContainer 也 dispose,Progression
 *    / RewardShop 状态全没了。
 *  - 改为在 App 层级一次性创建并长存,跨路由保留状态。
 *
 * 设计要点:
 *  - Provider 在 `useEffect` 里 `createRootContainer(...)`,把 `handle` 存进 ref,
 *    同时把需要的 Port 引用 (`progression` / `rewardShop` / `bus` / `engine`)
 *    通过 Context 暴露。
 *  - canvas + hud-mount 在 Provider 的 JSX 里直接渲染(ref 持有),
 *    useEffect 里把 canvas 绑给 createRootContainer;hud.show() 会查
 *    `.hud-mount`,所以 DOM 上必须有这个 div。
 *  - 整个 `game-stage-persistent` div 始终在 DOM 里(无论路由);CSS 控制
 *    在非 `/play` 路由下隐藏,Excalibur / HUD 的 React tree 持续运转
 *    —— 这样玩家在 `/shop` 买东西、退出后回到 `/play`,关卡状态完整保留。
 *  - React StrictMode dev 下 useEffect 会跑两次(挂载→卸载→重挂);
 *    cleanup 必须幂等(handle.dispose() 已经覆盖)。
 *
 * 解耦铁律(plan/modular-roadmap.md §0.1):
 *  - 本文件只 import runtime 下的东西,不 import 任何 modules 下的 internal。
 *  - 路由页面通过 useGameState() 拿到 Port 引用,不直接 import Port 文件
 *    之外的内容。
 */
import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";

import { createRootContainer } from "./RootContainer";
import type { RootContainerHandle } from "./RootContainer";
import type { ProgressionPort } from "./ports/ProgressionPort";
import type { RewardShopPort } from "./ports/RewardShopPort";
import type { GameEventBus } from "./EventBus";
import type { Engine } from "excalibur";

/**
 * 暴露给消费者的"游戏状态"快照。
 *
 * 全部都是只读引用:业务代码拿到的是 Progression / RewardShop Port,通过
 * Port 的方法触发场景转移 / 应用奖励;**不**直接修改 handle 内部。
 */
export interface GameState {
  /** RootContainer 句柄 —— 仅 GameStateProvider 内部 use,业务代码不要直接调。 */
  readonly handle: RootContainerHandle;
  /** 事件总线 —— 路由层 (`RouteSceneBridge`) 订阅 `level:phase` 用。 */
  readonly bus: GameEventBus;
  /** Excalibur Engine —— 已绑到 Provider 渲染的 canvas,业务代码不应再绑。 */
  readonly engine: Engine;
  /** Progression Port —— 路由层调用 `pickCharacter` / `startRun` / `advance`。 */
  readonly progression: ProgressionPort;
  /** RewardShop Port —— `/shop` 路由调用 `applyReward`。 */
  readonly rewardShop: RewardShopPort;
}

/** Context 默认值 —— `useGameState` 在 Provider 外被调时返回 null,调用方需 guard。 */
const GameStateContext = createContext<GameState | null>(null);

/** `useGameState()` 读取当前 Provider 暴露的 GameState。Provider 外返回 null。 */
export function useGameState(): GameState | null {
  return useContext(GameStateContext);
}

interface GameStateProviderProps {
  children: ReactNode;
}

/**
 * App 层级 Provider —— 一次性创建 RootContainer + 暴露 Port。
 *
 * 渲染内容:
 *  - `<canvas class="game-canvas" />` —— Excalibur 引擎绑定的画布;
 *    CSS 控制始终在 DOM 但默认隐藏,只在 `/play` 路由下显示。
 *  - `<div class="hud-mount" />` —— HudUiModule 的 React 树挂载点;
 *    `createRootContainer` 内部 `hud.show()` 会查这个 div。
 *  - `children` —— React Router 的 `<Routes>`(含 `/play` 等路由)。
 */
export function GameStateProvider({ children }: GameStateProviderProps): ReactElement {
  // canvas / hud-mount 的 DOM ref;createRootContainer 需要先有这两个节点。
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hudMountRef = useRef<HTMLDivElement | null>(null);
  // handle 存 ref(不存 state —— 不希望每次 mount/dispose 触发额外 re-render);
  // GameState 通过 state 暴露,setState 触发 children 重新订阅 Context。
  const handleRef = useRef<RootContainerHandle | null>(null);
  const [state, setState] = useState<GameState | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const hudMount = hudMountRef.current;
    if (!canvas || !hudMount) return;

    // 装配 RootContainer(canvas + hudMount 已经存在,可以直接绑)。
    const handle = createRootContainer({
      canvas,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: "#0b0d12",
      hudContainer: () => hudMount,
    });
    handleRef.current = handle;
    setState({
      handle,
      bus: handle.bus,
      engine: handle.engine,
      progression: handle.progression,
      rewardShop: handle.rewardShop,
    });

    return () => {
      // React StrictMode dev 下 cleanup 会跑一次(挂载→卸载→重挂);
      // handle.dispose() 幂等,可以安全重入。
      handle.dispose();
      handleRef.current = null;
      setState(null);
    };
  }, []);

  return (
    <GameStateContext.Provider value={state}>
      {/* 持久化游戏舞台 —— 始终在 DOM,默认隐藏,仅 /play 路由下显示。 */}
      <div className="game-stage-persistent">
        <canvas ref={canvasRef} className="game-canvas" />
        <div ref={hudMountRef} className="hud-mount" />
      </div>
      {/* Context 还没就绪时不渲染子节点(子节点可能用 useGameState)。 */}
      {state !== null ? children : null}
    </GameStateContext.Provider>
  );
}
