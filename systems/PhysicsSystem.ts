import { System } from '../core/types';
import { Engine } from '../core/Engine';
import { BLOB_CONSTANTS, COLORS } from '../constants';
import { solveIK, lerp } from '../utils/physics';
import { computeField } from '../utils/marchingSquares';
import { Vector2D, Leg } from '../core/types';

export class PhysicsSystem implements System {
    private engine!: Engine;
    private gaitSequence = [0, 3, 1, 2];
    private currentGaitIdx = 0;

    init(engine: Engine) {
        this.engine = engine;

        // Initialize Core and Legs
        const startX = engine.width / 2;
        const startY = engine.height / 2;

        this.engine.blobState.corePos = { x: startX, y: startY };
        this.engine.targetPos = { x: startX, y: startY };

        const labels = ['FL', 'FR', 'BL', 'BR'];
        this.engine.blobState.legs = BLOB_CONSTANTS.HIP_OFFSETS.map((offset, i) => {
            const footX = startX + offset.x * 2.5;
            const footY = startY + offset.y * 2.5;
            return {
                id: labels[i],
                hipOffset: offset,
                footPos: { x: footX, y: footY },
                kneePos: { x: footX, y: footY },
                stepStart: { x: footX, y: footY },
                stepTarget: { x: footX, y: footY },
                stepProgress: 1,
                isStepping: false
            };
        });
    }

    update(dt: number) {
        const s = this.engine.config;
        const core = this.engine.blobState.corePos;
        const target = this.engine.targetPos;

        const prevCore = { ...core };

        // Organic idle wobble
        const time = performance.now() * 0.001;
        const wobbleX = Math.sin(time * 0.7) * 4 + Math.cos(time * 1.3) * 2;
        const wobbleY = Math.cos(time * 0.8) * 4 + Math.sin(time * 1.1) * 2;

        core.x += (target.x + wobbleX - core.x) * s.coreLerp;
        core.y += (target.y + wobbleY - core.y) * s.coreLerp;
        this.engine.blobState.coreVel = { x: core.x - prevCore.x, y: core.y - prevCore.y };

        const legs = this.engine.blobState.legs;
        const coreVel = this.engine.blobState.coreVel;

        if (!legs.some(l => l.isStepping)) {
            const leg = legs[this.gaitSequence[this.currentGaitIdx]];
            const hipPos = { x: core.x + leg.hipOffset.x, y: core.y + leg.hipOffset.y };
            const ideal = {
                x: hipPos.x + leg.hipOffset.x * 1.5 + coreVel.x * BLOB_CONSTANTS.STEP_LEAD,
                y: hipPos.y + leg.hipOffset.y * 1.5 + coreVel.y * BLOB_CONSTANTS.STEP_LEAD
            };
            if (Math.sqrt((leg.footPos.x - ideal.x) ** 2 + (leg.footPos.y - ideal.y) ** 2) > s.stepTrigger) {
                leg.isStepping = true; leg.stepProgress = 0; leg.stepStart = { ...leg.footPos }; leg.stepTarget = { ...ideal };
                this.currentGaitIdx = (this.currentGaitIdx + 1) % this.gaitSequence.length;
            }
        }

        legs.forEach(leg => {
            if (leg.isStepping) {
                leg.stepProgress += 1 / BLOB_CONSTANTS.STEP_DURATION;
                const t = -(Math.cos(Math.PI * leg.stepProgress) - 1) / 2;
                const arc = Math.sin(leg.stepProgress * Math.PI) * BLOB_CONSTANTS.STEP_HEIGHT;
                leg.footPos.x = leg.stepStart.x + (leg.stepTarget.x - leg.stepStart.x) * t;
                leg.footPos.y = leg.stepStart.y + (leg.stepTarget.y - leg.stepStart.y) * t - arc;
                if (leg.stepProgress >= 1) { leg.footPos = { ...leg.stepTarget }; leg.isStepping = false; }
            }
            leg.kneePos = solveIK({ x: core.x + leg.hipOffset.x, y: core.y + leg.hipOffset.y }, leg.footPos, s.l1, s.l2, leg.hipOffset.x > 0);
        });
    }

    draw(ctx: CanvasRenderingContext2D) {
        const s = this.engine.config;
        const core = this.engine.blobState.corePos;
        const legs = this.engine.blobState.legs;

        // Draw Skeleton
        if (s.showSkeleton) {
            ctx.strokeStyle = COLORS.BONE_LINE; ctx.lineWidth = 1;
            legs.forEach(leg => {
                const h = { x: core.x + leg.hipOffset.x, y: core.y + leg.hipOffset.y };
                ctx.beginPath(); ctx.moveTo(h.x, h.y); ctx.lineTo(leg.kneePos.x, leg.kneePos.y); ctx.lineTo(leg.footPos.x, leg.footPos.y); ctx.stroke();
                ctx.fillStyle = 'rgba(255,255,255,0.2)';[h, leg.kneePos, leg.footPos].forEach(p => { ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, Math.PI * 2); ctx.fill(); });
            });
            ctx.beginPath(); ctx.arc(core.x, core.y, BLOB_CONSTANTS.FACE_ZONE_RADIUS, 0, Math.PI * 2); ctx.setLineDash([5, 10]); ctx.strokeStyle = COLORS.FACE_ZONE; ctx.stroke(); ctx.setLineDash([]);
        }

        // Draw Metaballs
        const metaballPoints: { pos: Vector2D, r: number, w: number }[] = [];
        metaballPoints.push({ pos: core, r: s.coreRadius, w: s.coreWeight });
        legs.forEach(l => {
            const hip = { x: core.x + l.hipOffset.x, y: core.y + l.hipOffset.y };
            metaballPoints.push({ pos: hip, r: s.hipRadius, w: s.hipWeight });
            metaballPoints.push({ pos: l.kneePos, r: s.kneeRadius, w: s.kneeWeight });
            let fr = s.footRadius; if (l.isStepping) fr *= (1 - Math.sin(l.stepProgress * Math.PI) * 0.25);
            metaballPoints.push({ pos: l.footPos, r: fr, w: s.footWeight });
        });

        // Marching Squares Rendering
        // Bounds
        let minX = core.x, minY = core.y, maxX = core.x, maxY = core.y;
        metaballPoints.forEach(p => { minX = Math.min(minX, p.pos.x - p.r); minY = Math.min(minY, p.pos.y - p.r); maxX = Math.max(maxX, p.pos.x + p.r); maxY = Math.max(maxY, p.pos.y + p.r); });

        const cellSize = s.cellSize, iso = s.isoThreshold, padding = BLOB_CONSTANTS.METABALL.ROI_PADDING;
        const gridMinX = Math.floor((minX - padding) / cellSize) * cellSize, gridMinY = Math.floor((minY - padding) / cellSize) * cellSize;
        const cols = Math.floor((Math.ceil((maxX + padding) / cellSize) * cellSize - gridMinX) / cellSize);
        const rows = Math.floor((Math.ceil((maxY + padding) / cellSize) * cellSize - gridMinY) / cellSize);

        if (cols > 0 && rows > 0) {
            const gridValues: number[][] = [];
            for (let i = 0; i <= cols; i++) { gridValues[i] = []; for (let j = 0; j <= rows; j++) gridValues[i][j] = computeField(gridMinX + i * cellSize, gridMinY + j * cellSize, metaballPoints); }
            ctx.beginPath(); ctx.strokeStyle = COLORS.OUTLINE; ctx.lineWidth = 1.5;

            for (let i = 0; i < cols; i++) {
                for (let j = 0; j < rows; j++) {
                    const x = gridMinX + i * cellSize, y = gridMinY + j * cellSize;
                    const v0 = gridValues[i][j], v1 = gridValues[i + 1][j], v2 = gridValues[i + 1][j + 1], v3 = gridValues[i][j + 1];
                    let caseIdx = 0; if (v0 >= iso) caseIdx += 1; if (v1 >= iso) caseIdx += 2; if (v2 >= iso) caseIdx += 4; if (v3 >= iso) caseIdx += 8;
                    if (caseIdx === 0 || caseIdx === 15) continue;

                    const gp = (p0: Vector2D, p1: Vector2D, va0: number, va1: number) => { const t = (iso - va0) / (va1 - va0); return { x: lerp(p0.x, p1.x, t), y: lerp(p0.y, p1.y, t) }; };
                    const p0 = { x, y }, p1 = { x: x + cellSize, y }, p2 = { x: x + cellSize, y: y + cellSize }, p3 = { x, y: y + cellSize };
                    const e0 = gp(p0, p1, v0, v1), e1 = gp(p1, p2, v1, v2), e2 = gp(p2, p3, v2, v3), e3 = gp(p3, p0, v3, v0);
                    const dl = (a: Vector2D, b: Vector2D) => { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); };

                    switch (caseIdx) { case 1: case 14: dl(e3, e0); break; case 2: case 13: dl(e0, e1); break; case 3: case 12: dl(e3, e1); break; case 4: case 11: dl(e1, e2); break; case 5: dl(e0, e1); dl(e2, e3); break; case 6: case 9: dl(e0, e2); break; case 7: case 8: dl(e3, e2); break; case 10: dl(e3, e0); dl(e1, e2); break; }
                }
            }
            ctx.stroke();
        }
    }

    cleanup() { }
}
