"use client";
import { useEffect, useRef, useState } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { ImperativePanelHandle } from "react-resizable-panels";
import Navbar from "./navbar";
import MenuList from "./menu-list";
import { MenuItem } from "./menu-item";
import { ControlItem } from "./control-item/control-item";
import Timeline from "./timeline/timeline";
import Scene from "./scene/scene";
import CropModal from "./crop-modal/crop-modal";
import FloatingControl from "./control-item/floating-controls/floating-control";
import StateManager from "@designcombo/state";
import useStore from "./store/use-store";
import useTimelineEvents from "./hooks/use-timeline-events";
import useDataState from "./store/use-data-state";
import { FONTS } from "./data/fonts";
import { SECONDARY_FONT, SECONDARY_FONT_URL } from "./constants/constants";
import { getCompactFontData, loadFonts } from "./utils/fonts";
import AIAssistant, { AIAssistantRef } from "./ai-assistant/ai-assistant";
import ToggleButton from "./ai-assistant/toggle-button";

const stateManager = new StateManager({
  size: {
    width: 1080,
    height: 1920,
  },
});

const Editor = () => {
  const [projectName, setProjectName] = useState<string>("Untitled video");
  const timelinePanelRef = useRef<ImperativePanelHandle>(null);
  const { timeline, playerRef } = useStore();
  const [showAIAssistant, setShowAIAssistant] = useState(true);
  const aiAssistantRef = useRef<AIAssistantRef>(null);

  // Upload and indexing callbacks to connect Scene with AI Assistant
  const handleVideoUploadStart = (file: File) => {
    aiAssistantRef.current?.handleVideoUploadStart?.(file);
  };

  const handleVideoUploadProgress = (progress: number) => {
    aiAssistantRef.current?.handleVideoUploadProgress?.(progress);
  };

  const handleVideoUploadComplete = (videoData: { id: string; url: string }) => {
    aiAssistantRef.current?.handleVideoUploadComplete?.(videoData);
  };

  const handleIndexingProgress = (progress: number, step: string) => {
    aiAssistantRef.current?.handleIndexingProgress?.(progress, step);
  };

  const handleIndexingComplete = () => {
    aiAssistantRef.current?.handleIndexingComplete?.();
  };

  useTimelineEvents();

  const { setCompactFonts, setFonts } = useDataState();

  useEffect(() => {
    setCompactFonts(getCompactFontData(FONTS));
    setFonts(FONTS);
  }, []);

  useEffect(() => {
    loadFonts([
      {
        name: SECONDARY_FONT,
        url: SECONDARY_FONT_URL,
      },
    ]);
  }, []);

  useEffect(() => {
    const screenHeight = window.innerHeight;
    const desiredHeight = 300;
    const percentage = (desiredHeight / screenHeight) * 100;
    timelinePanelRef.current?.resize(percentage);
  }, []);

  const handleTimelineResize = () => {
    const timelineContainer = document.getElementById("timeline-container");
    if (!timelineContainer) return;

    timeline?.resize(
      {
        height: timelineContainer.clientHeight - 90,
        width: timelineContainer.clientWidth - 40,
      },
      {
        force: true,
      },
    );
  };

  useEffect(() => {
    const onResize = () => handleTimelineResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [timeline]);

  return (
    <div className="flex h-screen w-screen flex-col">
      <Navbar
        projectName={projectName}
        user={null}
        stateManager={stateManager}
        setProjectName={setProjectName}
      />
      <div className="flex flex-1">
        <ResizablePanelGroup style={{ flex: 1 }} direction="vertical">
          <ResizablePanel className="relative" defaultSize={70}>
            <FloatingControl />
            <ToggleButton isVisible={showAIAssistant} onClick={() => setShowAIAssistant(!showAIAssistant)} />
            <div className="flex h-full flex-1">
              <div className="bg-sidebar flex flex-none border-r border-border/80">
                <MenuList />
                <MenuItem />
              </div>
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  position: "relative",
                  flex: 1,
                  overflow: "hidden",
                }}
              >
                <CropModal />
                <Scene 
                  stateManager={stateManager}
                  onVideoUploadStart={handleVideoUploadStart}
                  onVideoUploadProgress={handleVideoUploadProgress}
                  onVideoUploadComplete={handleVideoUploadComplete}
                  onIndexingProgress={handleIndexingProgress}
                  onIndexingComplete={handleIndexingComplete}
                />
              </div>
              {showAIAssistant && (
                <div className="w-[300px] flex-none">
                  <AIAssistant ref={aiAssistantRef} />
                </div>
              )}
            </div>
          </ResizablePanel>
          <ResizableHandle />
          <ResizablePanel
            className="min-h-[50px]"
            ref={timelinePanelRef}
            defaultSize={30}
            onResize={handleTimelineResize}
          >
            {playerRef && <Timeline stateManager={stateManager} />}
          </ResizablePanel>
        </ResizablePanelGroup>
        <ControlItem />
      </div>
    </div>
  );
};

export default Editor;
