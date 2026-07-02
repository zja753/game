/**
 * Placeholder for the Excalibur.js scene.
 *
 * The Excalibur engine needs a DOM canvas. The plan is:
 *   1. `vp add excalibur`
 *   2. Create an `Engine`, hand it a `<canvas>` rendered inside this page.
 *   3. Add an effect that mounts/unmounts the engine with the page lifecycle
 *      so navigating away doesn't leak RAF + audio contexts.
 */
export function Game() {
  return (
    <section className="page page-game">
      <h1>Game</h1>
      <div className="game-stage" data-empty="true">
        Excalibur scene lands here.
      </div>
    </section>
  );
}
