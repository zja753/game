/**
 * `/game` 路由组件 —— 挂载 RootContainer + Excalibur canvas。
 *
 * 设计要点:
 *  - canvas + hud-mount div 是 Excalibur / HUD 的两个挂载点,放在 React tree 的
 *    受控位置(roadmap §3.8 + §6.1)。
 *  - `useEffect` 装配 RootContainer:mount 时建,unmount 时 dispose。
 *    React StrictMode 下 dev 会跑两次 effect(挂载→卸载→重挂),我们的 dispose
 *    必须幂等 / 完整清理,这点 RuntimeModule 与 PlayerModule 的 `__dispose` 已经覆盖。
 *  - **不**在 effect 里主动 `start()` —— RootContainer 暴露 `start()` 由用户
 *    决定何时进入 `running`(roadmap §6:"装配期不广播 level:phase")。
 *    第一版直接在 mount 后 `start()`;后续如果有"开始 / 继续"菜单,把 start
 *    改成按钮事件即可。
 */
import { useEffect, useRef } from "react";
import { createRootContainer, type RootContainerHandle } from "../runtime/RootContainer";

export function Game() {
  // 容器 div(同时包含 canvas + HUD);useRef 让 React 不会重渲染时把它换掉。
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 保存当前 handle 供 cleanup 用。
  const handleRef = useRef<RootContainerHandle | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // canvas 必须先于 RootContainer 存在 —— Runtime 模块要把它绑给 Excalibur。
    const canvas = document.createElement("canvas");
    canvas.className = "game-canvas";
    container.appendChild(canvas);

    // HUD 挂载点:HUD 模块默认查 `document.querySelector(".hud-mount")`。
    const hudMount = document.createElement("div");
    hudMount.className = "hud-mount";
    container.appendChild(hudMount);

    // 装配 + 启动。
    const handle = createRootContainer({
      canvas,
      width: container.clientWidth || window.innerWidth,
      height: container.clientHeight || window.innerHeight,
      backgroundColor: "#0b0d12",
      // 默认就走 `.hud-mount` 查询;这里显式传一份保证一致性。
      hudContainer: () => hudMount,
    });
    handleRef.current = handle;
    handle.start();

    return () => {
      handleRef.current?.dispose();
      handleRef.current = null;
      // 清理我们塞进 DOM 的节点(StrictMode 双调用安全)。
      canvas.remove();
      hudMount.remove();
    };
  }, []);

  return (
    <section className="page page-game">
      <div ref={containerRef} className="game-stage" />
    </section>
  );
}
