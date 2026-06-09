# stress-tv — CPU vs GPU bound testing on a TV

A representative TV home-screen workload (rounded-rectangle cards + image
thumbnails + SDF text) with remote-driven element-count control and a live
on-screen read-out. Use it to find where a target device stops hitting frame
rate and to classify whether that ceiling is CPU- or GPU-bound.

Source: [tests/stress-tv.ts](tests/stress-tv.ts)

## Run

```
pnpm start:prod      # prod transpile — required to validate Chrome 38 targets
# then on the TV browser:
http://<host>:5173/?test=stress-tv&debug=true&resolution=720
```

`?debug=true` is what surfaces FPS / draws / quads / VAO and the per-interval GL
call counts — without it you only get the bottom-left count/tier HUD.

### Remote controls (arrows + OK only)

| Key          | Action                                                |
| ------------ | ----------------------------------------------------- |
| Up / Down    | step card count up/down the ladder (rebuilds grid)    |
| Left / Right | cycle scene tier (rect → +image → +text → full card)  |
| Enter (OK)   | toggle an alpha pulse on every card (per-frame churn) |

Ladder: 50, 100, 200, 400, 800, 1200, 1600, 2000, 3000, 4000
(scaled by `?multiplier=N`).

## Method

The grid auto-fits the screen, so **on-screen fill stays ~constant as count
changes**. That decoupling is the whole point: count scales CPU per-node cost
while leaving GPU fill roughly fixed, so the two bottlenecks move independently.

1. **Find the crossover.** Hold Up until FPS drops below target. Record N_crit
   per tier — that tells you which ingredient (rect / image / text) costs most.
2. **Classify N_crit** with two orthogonal levers:
   - Lower `?resolution=540` (or `?ppr`): big FPS recovery ⇒ **GPU / fill bound**.
   - `?novao=true`: FPS drops and `vAttribPtr` / `enaVAA` climb ⇒ **CPU / driver bound**.
   - More cards at constant fill still drops FPS ⇒ **CPU / scene-graph bound**.

### Reading the VAO signal in the overlay

| Path        | vAttribPtr | enaVAA | bindVAO | total GL calls |
| ----------- | ---------- | ------ | ------- | -------------- |
| VAO **on**  | ~0         | ~0     | = draws | lower          |
| VAO **off** | climbs     | climbs | 0       | higher         |

The ΔFPS between the two, at a fixed count near the crossover, **is** the
"how much does VAO help this TV app" answer. It grows with draw-call count
(more texture switches → more attribute rebinds), so expect the image+text
tiers to benefit more than rect-only.

## Results sheet

Device: ****\_\_**** Backend (overlay line 2): ****\_\_**** Target FPS: \_\_\_\_

### Crossover sweep (res 720, VAO on, full cards / tier 4)

| count | FPS | draws | quads | notes |
| ----- | --- | ----- | ----- | ----- |
| 200   |     |       |       |       |
| 400   |     |       |       |       |
| 800   |     |       |       |       |
| 1200  |     |       |       |       |
| 1600  |     |       |       |       |
| 2000  |     |       |       |       |

N_crit (first count below target): **\_\_**

### VAO A/B (at N_crit, per tier)

| tier   | res | VAO | FPS | GL calls | vAttribPtr | bindVAO | ΔFPS (on−off) |
| ------ | --- | --- | --- | -------- | ---------- | ------- | ------------- |
| 1 rect | 720 | on  |     |          |            |         |               |
| 1 rect | 720 | off |     |          |            |         |               |
| 4 full | 720 | on  |     |          |            |         |               |
| 4 full | 720 | off |     |          |            |         |               |

### Fill lever (at N_crit, VAO on, tier 4)

| res | FPS | Δ vs 720 | ⇒ fill-bound? |
| --- | --- | -------- | ------------- |
| 720 |     | —        |               |
| 540 |     |          |               |
