import { Player } from "../player";
import Viewer from "@interactify/infinite-viewer";
import { useRef } from "react";
import useStore from "../store/use-store";
import StateManager from "@designcombo/state";
import SceneEmpty from "./empty";
import Board from "./board";
import useZoom from "../hooks/use-zoom";
import { SceneInteractions } from "./interactions";

interface SceneProps {
  stateManager: StateManager;
  onVideoUploadStart?: (file: File) => void;
  onVideoUploadProgress?: (progress: number) => void;
  onVideoUploadComplete?: (videoData: { id: string; url: string }) => void;
  onIndexingProgress?: (progress: number, step: string) => void;
  onIndexingComplete?: () => void;
}

export default function Scene({
  stateManager,
  onVideoUploadStart,
  onVideoUploadProgress,
  onVideoUploadComplete,
  onIndexingProgress,
  onIndexingComplete
}: SceneProps) {
  const viewerRef = useRef<Viewer>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const { size, trackItemIds } = useStore();
  const { zoom, handlePinch } = useZoom(containerRef, viewerRef, size);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        position: "relative",
        flex: 1,
      }}
      ref={containerRef}
    >
      {trackItemIds.length === 0 && (
        <SceneEmpty 
          onVideoUploadStart={onVideoUploadStart}
          onVideoUploadProgress={onVideoUploadProgress}
          onVideoUploadComplete={onVideoUploadComplete}
          onIndexingProgress={onIndexingProgress}
          onIndexingComplete={onIndexingComplete}
        />
      )}
      <Viewer
        ref={viewerRef}
        className="player-container bg-sidebar"
        displayHorizontalScroll={false}
        displayVerticalScroll={false}
        zoom={zoom}
        usePinch={true}
        pinchThreshold={50}
        onPinch={handlePinch}
      >
        <Board size={size}>
          <Player />
          <SceneInteractions
            stateManager={stateManager}
            viewerRef={viewerRef}
            containerRef={containerRef}
            zoom={zoom}
            size={size}
          />
        </Board>
      </Viewer>
    </div>
  );
}
