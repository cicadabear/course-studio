import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

test('player keeps normal controls and favorites without recovery or diagnostic tools',async()=>{
  const base=new URL('../public/',import.meta.url);
  const [html,app,css]=await Promise.all(['index.html','app.js','styles.css'].map(file=>fs.readFile(new URL(file,base),'utf8')));
  for(const id of ['play-toggle','previous','next','backward','forward','player-favorite','player-complete','sleep','open-queue'])assert.ok(html.includes('id="'+id+'"'),id);
  for(const id of ['audio-recover','playback-diagnostics','playback-diagnostics-open','playback-report','native-audio-test-open','native-test-audio']){
    assert.ok(!html.includes('id="'+id+'"'),id);assert.ok(!app.includes("$('"+id+"')"),id);
  }
  assert.doesNotMatch(app,/function (?:reloadAudio|tracePlayback|showPlaybackDiagnostics|bootNativeAudioTest)\(/);
  assert.doesNotMatch(app,/nativeAudioTestParams|setItem\(playbackTraceKey/);
  assert.doesNotMatch(app,/resumeFromMediaSession|handleNativePlayback|handleNativePause|syncPlaybackVisibility|syncMediaPlaybackState|pauseIntent|playRequest/);
  assert.match(app,/play:startAudio,pause:\(\)=>audio\.pause\(\)/);
  assert.doesNotMatch(css,/\.playback-diagnostics|\.native-audio-test/);
  assert.match(app,/audio\.loop=loopHandoff/);
  assert.match(html,/<h2 id="player-title" tabindex="-1" autofocus>/);
  assert.doesNotThrow(()=>new vm.Script(app));
});
