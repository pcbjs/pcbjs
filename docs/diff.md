# Diff

`pcbjs diff <ref>`: each board of the working tree against the same entry at a git commit, as before, after and a tinted diff image with a JSON list of what changed.
Advanced. render.md has the 2D view both sides are drawn with, refs.md the item uids the comparison goes by, findings.md the fingerprints of the findings delta.

```sh
pcbjs diff HEAD~3                       # every entry of the config against three commits back
pcbjs diff main pcb.tsx --layer F.Cu    # one entry, front copper only
pcbjs diff origin/main --view sch       # the schematic, by pixels
```

## What it does

1. Checks `<ref>` out into a temporary git worktree under the user cache, `diff/` beside the model cache, or the temp folder; never inside the project. It is removed when the command ends.
2. Links the project's `node_modules` into the worktree, so both trees compile with the pcbjs installed here, and copies `.pcbjs/cache/route` there, so unchanged legs come from the same cache on both sides.
3. Compiles the same entries in both trees, each in a child process with its own config, defaults and registry: the config file at the same path in the ref, or none when the ref has none.
4. Draws both boards in one frame, the union of their outlines with 2 mm around, at 1280 by 960, and compares their copper.

| Flag | Does |
| --- | --- |
| `[entries...]` | the entries to compare, else the config's `entries` |
| `-o, --out <dir>` | the output folder, default `.pcbjs/diff` |
| `--view 2d\|sch` | the board, default, or the schematic compared by pixels |
| `--layer <name>` | only these layers or groups, as `shot --layer`; repeat it for several |
| `--side F\|B` | the side on top, default F |
| `-c, --config <file>` | the config file |

## Output

Per board and target, in `.pcbjs/diff/<board>[~<target>]/`:

| File | Holds |
| --- | --- |
| `before.png` | the board at the ref; the bare canvas when the entry is not there |
| `after.png` | the board of the working tree |
| `diff.png` | the board faded, removed copper red, added green, moved amber, its old place in a fainter amber |
| `diff.json` | the counts, every changed item, the findings delta, the frame |

One line per board:

```
T  +2 -0 ~3  findings +0 -0  .pcbjs/diff/T/
```

`+` added, `-` removed and `~` moved items, then new and fixed findings, then the folder and any note. The command exits 0, or 1 when the ref is no commit or either tree fails to compile, with the error of each failed entry prefixed `working tree:` or the ref.

## Matching

Copper is pads, vias, and tracks, pours and drawings on a copper layer.

- Unchanged is the same uid and rev on both sides: a uid names who made the item, its rev what it is now, refs.md.
- Of the rest, a removed and an added item with the same identity are one moved item, paired nearest first: its uid, which a move keeps, else a pad by part and number, a routed track or via by its route, layer and net, anything else by kind, layer, net, part and source file.
- What stays unpaired is added or removed.
- A pour compares by its outline and priority, never its fill, so a fill that follows other copper is no change.
- When a side has items without uids, items match by kind, layer, net and geometry to 1 µm instead, with a note.
- `--view sch` compares pixels alone: ink only before is red, only after green, changed amber.

## diff.json

```json
{
  "board": "T",
  "entry": "pcb.tsx",
  "ref": "HEAD~2",
  "sha": "05e3ecf…",
  "view": "2d",
  "by": "uid",
  "counts": { "added": 2, "removed": 0, "moved": 3 },
  "pixels": 5120,
  "notes": [],
  "frame": { "viewBox": [-2, -5.25, 52, 35.25], "size": [1280, 960], "mmPerPx": 0.042 },
  "items": [{ "change": "moved", "uid": "item:1f9a02919be6", "was": "item:1f9a02919be6", "ref": "route:1", "kind": "track", "layer": "F.Cu", "net": "SIG", "at": [12.5, 15], "from": [12.5, 12] }],
  "findings": { "new": [], "fixed": [] }
}
```

- `by` is `uid`, `geometry` or `pixels`; `pixels` counts the pixels that differ between before and after, silk and drawings included.
- An item's `ref` is a pad as `J3/1`, a routed track or via as `route:<n>`, else its uid; `at` is its centre after, a removed item's before, and `from` a moved item's centre before.
- `frame` maps board mm to the images: a pixel is `(x - viewBox[0]) / mmPerPx`, `(y - viewBox[1]) / mmPerPx`.
- `findings.new` and `findings.fixed` list `id`, `fingerprint`, `severity`, `rule` and `message`, matched by fingerprint, each once.

## Pull requests

`.github/workflows/diff.yml` runs on pull requests to `main` and `beta2`. For every example whose files changed it runs `pcbjs diff` against the merge base, uploads every folder as the `pcbjs-diff` artifact and posts one comment, updated on each push, with a row per board: the counts, the findings delta and, when anything changed, the path of its images in the artifact. It needs only `pull-requests: write`, and leaves a pull request from a fork uncommented.

## Limits

- Both trees compile with this pcbjs, so a compiler change shows as no change; check a compiler change with `pcbjs check` on both commits.
- Only 2D and the schematic; the 3D view and the findings drawn on the images are for later.
- A route renumbered by a route inserted above pairs by its new number, so its tracks show as moved or as added and removed.
