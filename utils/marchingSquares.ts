import { Vector2D } from '../types';

export const computeField = (x: number, y: number, points: { pos: Vector2D, rSq: number, w: number }[]) => {
    let total = 0;
    for (const p of points) {
        const dx = x - p.pos.x, dy = y - p.pos.y;
        const r2 = dx * dx + dy * dy;
        const R2 = p.rSq;
        if (r2 < R2) {
            const t = 1 - r2 / R2;
            total += p.w * t * t * t;
        }
    }
    return total;
};
