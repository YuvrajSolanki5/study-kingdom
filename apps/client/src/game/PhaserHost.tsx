import Phaser from 'phaser';
import { useEffect, useRef } from 'react';
import { useBattleHud } from '../state/battleHud.ts';
import { useGame } from '../state/store.ts';
import { BattleScene, type BattleSceneData } from './BattleScene.ts';
import { VillageScene } from './VillageScene.ts';

/** Hosts the single Phaser game and swaps the village and battle scenes. */
export function PhaserHost() {
  const ref = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const readyRef = useRef(false);
  const battle = useGame((s) => s.battle);
  const battleKey = battle ? `${battle.id}:${battle.replay ? 'r' : 'l'}` : null;

  useEffect(() => {
    if (!ref.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: ref.current,
      // The forest floor around the map (groundTexture), so zooming out shows no edge.
      backgroundColor: '#3f7a2a',
      antialias: true,
      banner: false,
      disableContextMenu: true,
      scale: { mode: Phaser.Scale.RESIZE, width: '100%', height: '100%' },
      fps: { target: 60 },
      scene: [],
    });
    game.scene.add('village', VillageScene, false);
    game.scene.add('battle', BattleScene, false);
    gameRef.current = game;
    // isBooted becomes true before default textures and scene systems are ready.
    // Starting then can queue scenes in a discarded StrictMode instance, which
    // boots later and competes with the live game. Start only the current, ready game.
    readyRef.current = false;
    const onReady = () => {
      if (gameRef.current !== game) return;
      readyRef.current = true;
      syncScene(game);
    };
    if (game.isRunning) onReady();
    else game.events.once('ready', onReady);
    return () => {
      game.events.off('ready', onReady);
      game.destroy(true);
      if (gameRef.current === game) {
        gameRef.current = null;
        readyRef.current = false;
      }
    };
  }, []);

  useEffect(() => {
    const game = gameRef.current;
    if (game && readyRef.current) syncScene(game);
  }, [battleKey]);

  return <div ref={ref} className="phaser-host" data-testid="phaser-host" />;
}

function syncScene(game: Phaser.Game) {
  const b = useGame.getState().battle;
  if (b) {
    if (game.scene.isActive('village')) game.scene.stop('village');
    if (game.scene.isActive('battle')) game.scene.stop('battle');
    useBattleHud.getState().reset();
    const data: BattleSceneData = {
      setup: b.setup,
      commands: b.commands,
      replay: b.replay,
      onEnd: (result) =>
        useGame.getState().patchBattle({ localResult: result, phase: b.replay ? 'done' : 'submitting' }),
    };
    game.scene.start('battle', data);
  } else {
    if (game.scene.isActive('battle')) game.scene.stop('battle');
    if (!game.scene.isActive('village')) game.scene.start('village');
  }
}
