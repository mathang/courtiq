# Streetball player source

The continuous humanoid mesh and 65-bone armature are Quaternius's **Superhero Male** from **Universal Base Characters [Standard]**, released under CC0 1.0 Universal.

- Original author and licence declaration: https://quaternius.com/packs/universalbasecharacters.html
- Official pack: https://quaternius.itch.io/universal-base-characters
- Source file in that pack: `Base Characters/Godot - UE/Superhero_Male_FullBody.gltf`
- This byte-identical, texture-free GLB was obtained from the documented public mirror at https://github.com/programasweights/avatar/blob/a488723e3a93d73d5c562d88f8a85353c37bc721/public/assets/character.glb on 11 November 2026. The official itch.io download endpoint returned HTTP 429 during preparation.
- The original pack licence is retained in `public/assets/player/QUATERNIUS-LICENSE.txt`.

`npm run build:player` rebuilds and optimises the player over that rig. The singlet, shorts, compression sleeve, socks, cuffs and headband are material regions of the **same body surface**, obtained by splitting source triangles at clothing boundaries. They keep shared positions and interpolated source skin weights rather than overlapping a clothing shell with another skin surface. The feet are covered by fitted closed trainers; hair and eyes retain the original armature.

The singlet artwork is one opaque runtime canvas texture mapped directly onto its surface; there is no separate name/number plane. Appearance colours and back names remain independent for each player. `Body_*` meshes carry the `continuous-body` surface marker for geometry and deformation checks.

The shipping GLB has 65 bones, 22,174 triangles, 12 mesh groups and 17 keyframed animation clips, and is 1,286,024 bytes. glTF Transform 4.5.1 deduplicates and prunes with `--keep-attributes true` to retain the runtime jersey UVs. The unused-UV informational notices are expected for a material map applied at runtime. There are no validator errors or warnings.

The GLB remains importable in Blender via **File → Import → glTF 2.0**. No `.blend` source or bespoke sports motion capture is claimed. The import has a plain jersey until its dynamic artwork is applied by the game. The source base remains separate from the shipping asset for reproducibility.

## Keyframed animation library

The locomotion and jump source is Quaternius's **Universal Animation Library [Standard]**, also CC0:

- Author and licence: https://quaternius.com/packs/universalanimationlibrary.html
- Original glTF and binary are retained as `AnimationLibrary_Godot_Standard.gltf` and `.bin`.
- Public distribution mirror: https://github.com/J-Ponzo/gltf-universal-animation-library/tree/e24c23cf2a1323488a3faa226ea7ea21f644b73e
- Full CC0 text: `public/assets/player/ANIMATION-LICENSE.txt`.

`scripts/player-animations.mjs` retargets source world-rotation deltas from its reference pose onto the player's bind pose, samples at 30 Hz, preserves quaternion continuity and removes horizontal root translation. It adds basketball-specific torso accents over the retargeted movement. `npm run build:player` exports the resulting clips into the shipping GLB:

`court_idle`, `court_walk`, `court_jog`, `court_sprint`, `court_defend`, `court_gather`, `court_air`, `court_land`, `court_crossover`, `court_eurostep`, `court_spin`, `court_swipe`, `court_block`, `court_dunk_tomahawk`, `court_dunk_windmill`, `court_dunk_360`, `court_dunk_reverse`.

`BasketballAnimator` plays and blends clips in an independent pose buffer. `StreetballRig` then adds hand/ball IK, planted support feet and court clearance. Shared ball/gather/landing paths remain in `shared/rules/dribble.ts`, `dunks.ts`, `motionCurves.ts` and `streetMoves.ts`; authoritative movement and question timing are unchanged.

Source SHA-256:

```text
0ff075c7ad6855c5c2c37a171592ee8f0d6ab2f58259e2be77a9b63dd8027765  AnimationLibrary_Godot_Standard.gltf
6e65377d81558333c4093dbb144a48fd19019343d82b1a3a7992a98ec0e0543c  AnimationLibrary_Godot_Standard.bin
```

## Recorded court sound

Three CC0 BigSoundBank recordings are retained here as MP3 source files. Author and licence declarations were verified on the source pages on 11 November 2026:

| Source | Author | Recording page |
| --- | --- | --- |
| `ball-rebounds-1045.mp3` | Joseph Sardin | https://bigsoundbank.com/ball-rebounds-s1045.html |
| `basketball-shoes-0938.mp3` | Thibaud Vaerman | https://bigsoundbank.com/gnashing-basketball-s0938.html |
| `crowd-cheer-0237.mp3` | Denis Chardonnet | https://bigsoundbank.com/shouts-and-applauses-of-teens-2-s0237.html |

`npm run build:audio` requires ffmpeg and rebuilds seven short, faded, filtered 24 kHz mono PCM recordings (265,260 bytes total). Exact cut offsets and gain normalisation are in `scripts/build-court-audio.mjs`. Normal application builds use the checked-in WAV files and do not require ffmpeg. Original designed impact, net and air layers are in `client/game/audio/courtSoundBank.ts`. Public credits and the complete licence are in `public/assets/audio/`.

```text
610c8bd30695877ff31ffc0e12a5ae1b842f8da724d97dc71ed80259e23233a2  ball-rebounds-1045.mp3
64bda68cd42608f3723489604773c2be8cecef662cb87c1287d1b9b567338f98  basketball-shoes-0938.mp3
95a4f366d867b9b8f71d731c2f53abf692b49340de9459c40b3e255ea887bd71  crowd-cheer-0237.mp3
```


## River and Sky character roster — 12 November 2026

The player-facing choices are **River** and **Sky**, each with all four existing colour palettes. Appearance IDs 0–3 retain the original looks; 4–7 select Sky. Both use the same 65-bone rest rig, limb lengths, basketball controls, physical reach, stamina and shot rules. Names/jersey artwork remain the student's choice. There are no gender labels in the chooser.

Sky uses Quaternius's authored **Superhero Female** base from the free **Universal Base Characters [Standard]** pack, rather than a hair/colour change to River. The original source `.gltf` and `.bin` are retained untouched. Licence declaration is `BASE-CHARACTERS-LICENSE.txt` (CC0 1.0), corroborated by the publisher at https://quaternius.com/packs/universalbasecharacters.html. Files were obtained from this pinned public pack mirror on 12 November 2026:

https://github.com/NafisRayan/Animate-Rigged-Humanoid-No-Blender/tree/5821923af517ac5fdc82505faa92a0d575fc1b1a/Universal%20Base%20Characters%5BStandard%5D/Universal%20Base%20Characters%5BStandard%5D/Base%20Characters/Godot%20-%20UE

`scripts/character-source.mjs` embeds the source buffer for reproducible loading without its original texture dependencies, and rebinds body/eyes/brows onto River's rest joints by bone name and weighted bind transforms. `build-player.mjs` adds the original continuous CourtIQ kit, fitted trainers and tied-back hair. Cloth front shaping bridges the jersey surface. Both assets use the same 17 animation contracts. Iris surfaces are now fitted to each source eye instead of using protruding black spheres.

`npm run build:player` rebuilds both via `build-characters.mjs`. The original asset URL remains River; Sky ships as `public/assets/player/athlete-sky.glb`. Normal production builds use the checked-in GLBs. No paid assets, purchases or AI generation services were used.

Source SHA-256:

```text
adedf28000a0716f689b009a70314506fc62f827498f77ba852acb5610f3f3f4  Superhero_Female_FullBody.gltf
3a8220a485b33d05d879115a50697728b45a151781106033afb8b8c243fca208  Superhero_Female_FullBody.bin
```

The two small `portrait-*.png` chooser images are local renders of the shipping GLBs, captured from Player Lab and cropped to the face. They add no rendering loop or external image/generation dependency to the lobby.
