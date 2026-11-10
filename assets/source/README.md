# Streetball player source

The continuous humanoid mesh and 65-bone armature are Quaternius's **Superhero Male** from **Universal Base Characters [Standard]**, released under CC0 1.0 Universal.

- Original author and licence declaration: https://quaternius.com/packs/universalbasecharacters.html
- Official pack: https://quaternius.itch.io/universal-base-characters
- Source file in that pack: `Base Characters/Godot - UE/Superhero_Male_FullBody.gltf`
- This byte-identical, texture-free GLB was obtained from the documented public mirror at https://github.com/programasweights/avatar/blob/a488723e3a93d73d5c562d88f8a85353c37bc721/public/assets/character.glb on 11 November 2026. The official itch.io download endpoint returned HTTP 429 during preparation.
- The original pack licence is retained in `public/assets/player/QUATERNIUS-LICENSE.txt`.

`npm run build:player` rebuilds and optimises the player over that rig. The singlet, shorts, compression sleeve, socks, cuffs and headband are material regions of the **same body surface**, obtained by splitting source triangles at clothing boundaries. They keep shared positions and interpolated source skin weights rather than overlapping a clothing shell with another skin surface. The feet are covered by fitted closed trainers; hair and eyes retain the original armature.

The singlet artwork is one opaque runtime canvas texture mapped directly onto its surface; there is no separate name/number plane. Appearance colours and back names remain independent for each player. `Body_*` meshes carry the `continuous-body` surface marker for geometry and deformation checks.

The shipping GLB has 65 bones, 22,174 triangles and 12 mesh groups, and is approximately 1 MB. glTF Transform 4.5.1 deduplicates and prunes with `--keep-attributes true` to retain the runtime jersey UVs. The unused-UV informational notices are expected for a material map applied at runtime. There are no validator errors or warnings.

The GLB remains importable in Blender via **File → Import → glTF 2.0**. No `.blend` source or motion-capture clips are claimed. The import has a plain jersey until its dynamic artwork is applied by the game. The source base remains separate from the shipping asset for reproducibility. Basketball poses, foot contact and transitions are authored in `client/game/characters/streetballRig.ts`; shared ball/gather/landing paths are in `shared/rules/dribble.ts`, `dunks.ts`, `motionCurves.ts` and `streetMoves.ts`.
