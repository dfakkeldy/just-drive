// Which models are part of the offline download (tools/build-pwa.mjs) and which are not.
//
// The mail car's model follows its switch (web/src/car-switch.ts, BLENDER_CAR_DEFAULT). The Blender car is the
// default, so its two files are part of the offline download, like every other model.
//
// Do not roll the car back by setting the switch to false alone: revert the pull request that made it the
// default. With false, this rule takes the files out of the download, and the offline worker (web/pwa/sw.js) no
// longer passes a file outside the download to the network (that pass-through went when the car became the
// default). A player with offline play on who opens ?car=blender would get the code car and an "update" notice
// on every start, because the update has no car either. The revert brings the pass-through back.
export const OPTIONAL_CAR = /^mail-car(-low)?\.glb$/;

/** `switchSource` is the text of web/src/car-switch.ts. */
export function carIsDefault(switchSource) {
  const found = /^export const BLENDER_CAR_DEFAULT = (true|false);$/m.exec(switchSource);
  if (!found) throw Error('web/src/car-switch.ts no longer says "export const BLENDER_CAR_DEFAULT = true|false;"');
  return found[1] === 'true';
}

/** True when `models/<name>` belongs in the offline download. */
export const offlineModel = (name, switchSource) => !OPTIONAL_CAR.test(name) || carIsDefault(switchSource);
