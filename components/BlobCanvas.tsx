import React from 'react';
import { useEngine } from '../hooks/useEngine';
import { Engine } from '../core/Engine';

interface BlobCanvasProps {
  settings: any;
  onWordSwallowed?: (word: { id: string, text: string }) => void;
  onEngineInit?: (engine: Engine) => void;
}

const BlobCanvas: React.FC<BlobCanvasProps> = ({ settings, onWordSwallowed, onEngineInit }) => {
  const { canvasRef, engineRef } = useEngine(settings, onWordSwallowed as any);

  React.useEffect(() => {
    if (engineRef.current && onEngineInit) {
      onEngineInit(engineRef.current);
    }
  }, [onEngineInit]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full cursor-none"
    />
  );
};

export default BlobCanvas;