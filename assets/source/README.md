# Streetball player source

The continuous humanoid mesh and 65-bone armature are Quaternius's **Superhero Male** from **Universal Base Characters [Standard]**, released under CC0 1.0 Universal.

- Original author and licence declaration: https://quaternius.com/packs/universalbasecharacters.html
- Official pack: https://quaternius.itch.io/universal-base-characters
- Source file in that pack: `Base Characters/Godot - UE/Superhero_Male_FullBody.gltf`
- This byte-identical, texture-free GLB was obtained from the documented public mirror at https://github.com/programasweights/avatar/blob/a488723e3a93d73d5c562d88f8a85353c37bc721/public/assets/character.glb on 11 November 2026. The official itch.io download endpoint returned HTTP 429 during preparation.
- The original pack licence is retained in `public/assets/player/QUATERNIUS-LICENSE.txt`.

`npm run build:player` builds and optimises CourtIQ's original basketball clothing, trainers, hair and jersey artwork surfaces over that rig. The generated GLB is editable in Blender via **File → Import → glTF 2.0**. No `.blend` source or motion-capture clips are claimed. Blender was not installed or used for this iteration. Basketball poses and hand targets are authored in `client/game/characters/streetballRig.ts`.

The browser asset is `public/assets/player/streetball-player.glb`. Geometry is merged into ten material groups. glTF Transform 4.5.1 deduplicates and prunes the output with `--keep-attributes true`; the jersey UVs are required by the runtime name and number texture. The importable GLB has a plain jersey until the game applies that dynamic artwork. The source remains separate from the shipped asset for reproducibility. Appearance colours and jersey names are applied per instance at runtime; both players retain independent skeletons.
