# Wide Card Parallel Reflow Animation

## Goal

When a cover reveals that its archive card must widen from 150px to 316px, animate that visual expansion while surrounding cards move into their packed positions. Both effects run concurrently for 150ms with the existing easing.

## Design

Keep dense packing and flex layout unchanged. `ArchiveGrid` still commits final order and dimensions once. Its existing FLIP pass records each card's settled `left`, `top`, and `width`. On a later layout version, it compares the previous and next rectangles:

- position change produces the existing inverse `translate`;
- width change produces an inverse horizontal scale equal to `previousWidth / nextWidth`;
- position and scale use one Web Animation so they start and finish together;
- different cards retain independent Web Animations and therefore animate in parallel.

The browser never transitions flex width frame by frame. Layout reaches its final state first; only compositor-friendly visual properties animate.

## Constraints

- Duration: 150ms.
- Easing: `cubic-bezier(0.22, 1, 0.36, 1)`.
- Preserve dense backfill, final-row centering, card widths, offscreen animation guard, and animation cancellation behavior.
- `prefers-reduced-motion` skips both movement and width animation.
- No dependency, API, cache, or server changes.

## Testing

Extend archive layout tests to require width capture, inverse width scale, combined keyframes, 150ms duration, and the existing parallel per-card animation loop. Run focused layout tests, then full test, lint, check, build, and whitespace verification.
