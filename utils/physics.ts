import { Vector2D } from '../types';

export const lerp = (v0: number, v1: number, t: number) => v0 + t * (v1 - v0);

export const lerpAngle = (start: number, end: number, t: number) => {
    const diff = end - start;
    const delta = ((diff + 180) % 360) - 180; // Wrap to [-180, 180]
    return (start + delta * t + 360) % 360; // Keep within [0, 360]
};

export const solveIK = (origin: Vector2D, target: Vector2D, l1: number, l2: number, isRight: boolean): Vector2D => {
    const dx = target.x - origin.x;
    const dy = target.y - origin.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const d = Math.max(0.1, Math.min(dist, l1 + l2 - 0.1));
    const angle = Math.atan2(dy, dx);
    const cosAlpha = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
    const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));
    const kneeAngle = angle + (isRight ? alpha : -alpha);
    return {
        x: origin.x + Math.cos(kneeAngle) * l1,
        y: origin.y + Math.sin(kneeAngle) * l1
    };
};
