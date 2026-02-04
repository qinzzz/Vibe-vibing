import { TextBlock, Token, Letter } from '../types';
import { LAYOUT_CONSTANTS } from '../constants';

export const tokenizeAndLayout = (text: string, blockX: number, blockY: number, ctx: CanvasRenderingContext2D): TextBlock => {
    const rawTokens = text.split(/(\s+)/);
    const tokens: Token[] = [];
    let currentX = 0;
    let currentY = 0;
    const maxWidth = LAYOUT_CONSTANTS.BLOCK_WIDTH;
    const fontSize = LAYOUT_CONSTANTS.FONT_SIZE;
    ctx.font = `${fontSize}px monospace`;

    rawTokens.forEach((raw) => {
        if (raw.trim() === '') {
            const spaceWidth = ctx.measureText(raw).width;
            if (currentX + spaceWidth > maxWidth) {
                currentX = 0;
                currentY += LAYOUT_CONSTANTS.LINE_HEIGHT;
            } else {
                currentX += spaceWidth;
            }
            return;
        }

        const subTokens = raw.split(/([,.!?;:])/).filter(t => t.length > 0);
        subTokens.forEach((sub) => {
            const metrics = ctx.measureText(sub);
            const tokenWidth = metrics.width;

            if (currentX + tokenWidth > maxWidth && currentX > 0) {
                currentX = 0;
                currentY += LAYOUT_CONSTANTS.LINE_HEIGHT;
            }

            const tokenId = Math.random().toString(36).substr(2, 9);
            const letters: Letter[] = [];
            let charX = currentX;

            for (let i = 0; i < sub.length; i++) {
                const char = sub[i];
                const charWidth = ctx.measureText(char).width;
                letters.push({
                    char,
                    x: blockX + charX + charWidth / 2,
                    y: blockY + currentY + fontSize / 2,
                    tokenId
                });
                charX += charWidth;
            }

            tokens.push({
                id: tokenId,
                text: sub,
                x: blockX + currentX,
                y: blockY + currentY,
                width: tokenWidth,
                height: fontSize,
                state: 'present',
                letters
            });

            currentX += tokenWidth;
        });
    });

    return {
        id: Math.random().toString(36).substr(2, 9),
        tokens,
        x: blockX,
        y: blockY,
        width: maxWidth,
        height: currentY + LAYOUT_CONSTANTS.LINE_HEIGHT
    };
};
