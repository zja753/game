/**
 * `/game` 路由占位。
 *
 * 当前阶段所有第一层模块尚未组装,RootContainer 还没影,
 * 所以这里不挂 Excalibur canvas,只渲染一段静态提示。
 * 后续 Runtime + 业务模块落地后,这里会改为挂 `RootContainer.start()`。
 */
export function Game() {
  return (
    <section className="page page-game-placeholder">
      <h2>游戏场景</h2>
      <p>模块化开发路线 · 第一层模块装配中</p>
    </section>
  );
}
